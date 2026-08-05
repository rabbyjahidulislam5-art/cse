# Unified Outstanding Due Settlement & Financial Restriction — Session Summary

**Date:** 2026-07-31
**Scope:** A consolidated Semester Fee payment that automatically sweeps in every other
outstanding due (Library Fine, Admin Fine, Shop Pay Later) and settles all of them atomically in
one payment, distributed correctly to each department's own ledger. Adds a live-derived financial
restriction for overdue Semester Fees, and an Accounts Office offline bank-payment recording flow.
Committed as `1ed4348` on `main` (local only — not pushed to `origin/main`).

---

## 1. Why

Read all 14 existing session-summary `.md` files in the project root first, then investigated the
live code (schema, payment routes, dues aggregation, frontend payment flows) via a read-only
Explore pass before planning, per the user's instruction. This confirmed the actual gap behind the
request:

- `POST /payment/init` already accepted a mixed `items[]` array spanning every due type, and
  `confirmSslPayment()` already looped every item in a bundled payment through one atomic
  `$transaction`. The multi-source settlement machinery already existed.
- **The one route a student actually uses to pay their Semester Fee —
  `POST /semester-fees/pay`, called by `SemesterFeeModal.tsx` — only ever bundled `SemesterFee`
  rows.** It ignored Library/Admin/Pay-Later dues entirely. This is the literal gap behind "a
  student can ignore outstanding dues from different departments and still proceed with semester
  fee payment."
- A real atomicity bug: the per-source settlement function (`markItemPaid`) ended every branch in
  `.catch(() => {})`, silently swallowing failures instead of rolling back the transaction —
  meaning a "unified" settlement could already have half-applied silently.
- `PayLaterDue` got a hard 7-day deadline computed at creation — needed to become a lifetime due.
- No financial-restriction concept, and no offline/manual bank-payment recording path, existed
  anywhere in the app.

## 2. Decisions made with the user (via plan-mode clarifying questions)

| Decision | Reasoning |
|---|---|
| Consolidation computed **live, at payment time** (not snapshotted when Accounts Office pushes the invoice) | Reuses the same aggregation query `/dues` already runs; always reflects the true current balance, including a fine added after the invoice was pushed but before it's paid. |
| Restriction is **derived live, never a stored flag** — true exactly when a `SemesterFee` is `Pending` past its own due date | Self-heals the instant that fee is marked Paid by any settlement path (online or offline) — satisfies "reactivate with no manual DB change" exactly, with no cron job needed. |
| Restricted scope = **Dues/Settlement + Profile + Logout only** | Everything else that creates *new* discretionary spend (Transfer, new shop purchases) is blocked; paying down existing dues through any channel is never blocked, since the spec requires individual Shop/Library/Admin-fine payment to keep working unconditionally. |
| Unified settlement only activates when a real Semester Fee is actually pending | Keeps `/semester-fees/pay` semantically "pay the semester fee (and sweep in everything else)" rather than turning it into a general pay-anything endpoint; a student with only a library/shop due and no semester fee keeps using those modules' own flows. |

## 3. Database Schema (`server/prisma/schema.prisma`) — additive only

- `@@index([studentId, status])` added to `SemesterFee`, `LibraryFine`, `AdminFine`,
  `PayLaterDue` — the new aggregation function is now called on every semester-fee checkout, every
  restriction check, and every manual-payment lookup.
- `Transaction.bankTxnId` changed to `@unique` — the idempotency key for offline bank-payment
  recording. Verified against the live DB first (`29` distinct non-null values, zero duplicates)
  before pushing, so the constraint couldn't fail on existing data.
- Pushed via `prisma db push`, same pattern every prior session in this project has used.

## 4. Backend — Shared Settlement Library (new: `server/src/lib/settlement.ts`)

- **`markItemPaid(item, reference, studentId, db)`** — extracted out of `confirmSslPayment`'s
  closure. Every per-source branch (`semester`/`library`/`admin`/`payLater`) is now a *conditional*
  `updateMany({ where: { id, status: 'Pending' } })` that **throws `SettlementConflictError`** if
  it touches zero rows, instead of the old `.catch(() => {})` silent swallow. This is both the
  atomicity fix (a failed item now genuinely rolls back the whole `$transaction`) and a real
  concurrency guard (two settlements racing for the same due can't both silently "succeed"). Also
  writes one `CREDIT_PAYMENT` `LedgerEntry` per item, chained off the previous entry's
  `balanceAfter` — unchanged from the original logic, just no longer allowed to fail silently.
- **`getOutstandingDues(studentId)`** — the same 4-source aggregation `/dues` already returns
  (Semester + Library + Admin + Pay Later), filtered to `Pending`, as a flat item list + total +
  per-source breakdown. Reused by semester-fee bundling, the restriction check, and the new manual
  settlement route, so none of them can drift out of sync with what the student actually sees.
- **`isFinanciallyRestricted(studentId)`** — finds `Pending` `SemesterFee` rows and parses each
  `dueDate` with `Date` (not a raw string comparison — `dueDate` is free-text CSV-imported data
  with no enforced format, so an unparseable value is treated as "no enforceable deadline" rather
  than risking a wrongful restriction on garbage input). Restricted exactly when at least one is
  in the past.

`confirmSslPayment()` now calls this extracted `markItemPaid` — identical behavior, minus the bug.

## 5. Backend — Route Changes

- **`POST /semester-fees/pay`** (`SemesterFeeModal.tsx`'s payment route) — now requires an actual
  pending `SemesterFee` to activate (unchanged 400 otherwise), then bundles every outstanding due
  via `getOutstandingDues()`. The wallet-direct branch settles every item through `markItemPaid` in
  one `$transaction`; the SSLCommerz branch needed no structural change, since `confirmSslPayment`
  already generically handles whatever's in `itemsJson`. Response now includes an itemized
  `items`/`breakdown` so the frontend can show what was actually included.
- **`POST /semester-fees/lookup`** — same total/breakdown added, so the review step a payer sees
  before paying always matches what `/pay` will actually charge.
- **`POST /shops/pay`** — the `dueDate.setDate(+7)` computation removed entirely; `PayLaterDue`
  rows are now created with no computed expiry (Lifetime Outstanding Due).
- **New `POST /student/financial-status`** — self-scoped live restriction check + outstanding
  total, called by the frontend on every student page load (not the cached login-time user object,
  since a restriction can appear or clear mid-session).
- **New `POST /accounts/student-outstanding-dues`** and **`POST /accounts/manual-payment/record`**
  — Accounts Office looks a student up by ID, sees the live consolidated outstanding total, and
  records an offline bank payment. Requires `amountReceived >= total` (full settlement only),
  settles every item via the same `markItemPaid`, creates one `Transaction`
  (`gateway: 'Manual'`, `paymentMethod: 'Bank Transfer'`, `bankTxnId` = the bank receipt reference),
  one `AuditLog` entry, and a student notification. The new unique constraint on `bankTxnId` turns
  replaying the same receipt into a hard `409`, not a silent double-settlement.
- **`blockIfFinanciallyRestricted`** (new `server/src/lib/restriction.ts`) — applied narrowly to
  `POST /transfer`, `POST /shops/pay`, and `POST /payment/init` only when
  `purpose === 'shop_payment'`. Every route that *pays down* an existing due (`/payment/init` for
  `semester_fee`/`library_fine`/`admin_fine`/`pay_later`, `/semester-fees/pay`,
  `/library/qr/create-payment`) stays completely open while restricted.

## 6. Frontend

- **`StudentLayout.tsx`** — polls `/student/financial-status` every 30s (same pattern as the
  existing dispute-badge poll). While restricted: persistent banner with the live outstanding
  total, and any route outside `/student/dues`/`/student/profile` redirects back to Dues.
- **`SemesterFeeModal.tsx`** — review step gains a "Consolidated Settlement" breakdown card,
  itemized by source, shown only when the payment actually bundles more than the semester fee
  itself.
- **`DuesPage.tsx`** — inline restriction notice with the exact reason text; `handlePaySingle` now
  bundles every pending due whenever the item being paid is a Semester Fee (so a student's own
  direct "Pay" click on the Semester tab gets the same automatic bundling the dedicated Pay-Fee
  modal gets — both funnel through the same already-tested `/payment/init` + `PaymentConfirmModal`
  flow, no new payment UI).
- **`ShopDetailPage.tsx` / `QrScannerPage.tsx`** — "7-day payment deadline" / "Pay Later (7-day
  due)" copy replaced with lifetime-due language.
- **New `src/pages/accounts/ManualBankPaymentPage.tsx`** (`/accounts/manual-payment`) — student
  search → itemized outstanding-dues breakdown + restricted badge → bank reference/amount/note
  form → success screen with explicit "account reactivated" messaging when applicable. New nav
  entry in `AccountsLayout.tsx`'s More menu.

## 7. Enterprise-Banking Requirements — How They're Met

- **Atomicity**: one Prisma `$transaction` per settlement (SSLCommerz confirm, wallet-direct pay,
  and manual bank recording all funnel through the same `markItemPaid`), now genuinely rolling back
  on any item conflict instead of silently partial-applying.
- **Idempotency**: `Transaction.reference` (`@unique`, unchanged) for online payments;
  `Transaction.bankTxnId` (`@unique`, new) for manual ones.
- **Concurrency**: every per-item update is a conditional `updateMany` guarded on
  `status: 'Pending'` — a due settled a moment earlier by a different request is rejected, not
  double-credited.
- **Role-based authorization**: manual settlement is `requireRole('Accounts Office')` only;
  `/student/financial-status` is self-scoped via the JWT, no student-ID override accepted.
- **Audit trail**: one `AuditLog` row per settlement action (existing convention) plus one
  `LedgerEntry` per settled item — a single semester-fee checkout that swept up a library fine and
  a shop due leaves 3 distinct, individually-traceable ledger rows. Accounting separation is
  preserved exactly — only the *payment* is unified, never the bookkeeping.
- **Backward compatibility**: every existing route, field, and UI flow named in the spec (Shop QR,
  Library QR, Accounts QR category chooser, individual Shop/Library/Admin-fine payment, wallet
  ledger, dispute system) is untouched except for the specific, additive edits above.

## 8. Verification Performed

**Unit** (`server/src/tests/settlement.test.ts`, 13 tests, mocked Prisma client): `getOutstandingDues`
aggregation correctness, `isFinanciallyRestricted` true/false/garbage-date/no-date cases,
`markItemPaid`'s conflict-throw behavior and ledger `balanceAfter` chaining across a multi-item batch.

**Integration** (`server/src/tests/unifiedSettlement.integration.test.ts`, 4 tests, real Neon DB,
dedicated disposable test student — no residue on any real account): full aggregate → restrict →
settle-atomically → restriction-clears-itself cycle, plus a concurrency test proving a second
settlement attempt on an already-Paid due rolls back the *entire* batch (not just the conflicting
item).

**Regression**: full existing backend suite, **93/93 passing** (76 pre-existing + 17 new).
`tsc --noEmit` (backend) and `tsc -b` (frontend) both clean.

**Live smoke test** (Playwright against real running dev servers, two disposable test students,
all data cleaned up and dev servers stopped afterward):
- Mixed-due student (Semester ৳45,500 + Library ৳500 + Admin ৳1,200, overdue) → Accounts Office's
  new Bank Payment page correctly displayed the itemized ৳47,200 total and "Financially restricted"
  badge → recorded → success screen confirmed "account has been reactivated" → student's own
  transaction history showed the real settlement row (`Manual Bank Settlement · BANK-...`) →
  `/student/dues` showed all 3 items flipped to Paid.
- Second, still-restricted student: confirmed the persistent banner, the exact live-derived reason
  text, and that navigating to `/student/shops` redirected back to `/student/dues`; confirmed
  Profile stayed reachable.
- Regression spot-check: Shop browsing/detail page still renders correctly, "Pay Later" now reads
  **"No fixed deadline — pay anytime"** live in the method-selection card.

## 9. Repository Map (new/changed, this session)

```
server/prisma/schema.prisma                @@index additions, Transaction.bankTxnId @unique
server/src/lib/settlement.ts                New — markItemPaid, getOutstandingDues, isFinanciallyRestricted
server/src/lib/restriction.ts               New — blockIfFinanciallyRestricted middleware
server/src/index.ts                         confirmSslPayment() uses extracted markItemPaid;
                                             /semester-fees/pay + /lookup bundle all due sources;
                                             /shops/pay drops the 7-day dueDate;
                                             new /student/financial-status,
                                             /accounts/manual-payment/record,
                                             /accounts/student-outstanding-dues;
                                             blockIfFinanciallyRestricted applied to
                                             /transfer, /shops/pay, /payment/init(shop_payment)
server/src/tests/settlement.test.ts                     New — 13 unit tests
server/src/tests/unifiedSettlement.integration.test.ts  New — 4 integration tests (real DB)

src/components/StudentLayout.tsx            Financial-restriction poll, banner, route gate
src/components/SemesterFeeModal.tsx         Itemized consolidated-settlement breakdown
src/components/AccountsLayout.tsx           New nav item: Bank Payment
src/App.tsx                                 New route: /accounts/manual-payment
src/lib/api.ts                              Typed client functions for every new endpoint
src/pages/accounts/ManualBankPaymentPage.tsx   New — offline settlement UI
src/pages/student/DuesPage.tsx              Restriction notice; bundle-on-direct-semester-pay
src/pages/student/ShopDetailPage.tsx        Lifetime-due copy
src/pages/student/QrScannerPage.tsx         Lifetime-due copy
```

## 10. Commit

```
1ed4348  feat(payments): Unified Outstanding Due Settlement + financial restriction
15 files changed, 1087 insertions(+), 76 deletions(-)
```

Committed on `main`, **local only** — not pushed to `origin/main`.
