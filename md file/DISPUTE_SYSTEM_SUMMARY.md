# Financial Dispute & Case Management System — Work Summary

This document summarizes the Financial Dispute & Case Management System added to EWU Smart
Campus in this session: what it is, how it's built, what was verified, and what's deliberately
out of scope. It follows the same format as `AUTH_WORK_SUMMARY.md` and
`EMAIL_OTP_FIX_SUMMARY.md` — a session record, not a design proposal.

---

## 1. What This Is

A complete dispute/case-management module covering every payment source already in the platform
(wallet transfer, top-up, withdrawal, semester fee, library fine, admin fine, shop QR payment,
SSLCommerz), added as a **pure addition**. No existing route body, schema field, or payment
control flow was rewritten — only extended at a small number of precise, documented points.

Students can raise a dispute on any completed payment; Accounts Office investigates and resolves
it (including processing refunds back to the wallet); Admin has platform-wide oversight, fraud
signals, and high-value refund approval; Library and Shop have scoped inboxes for cases forwarded
to them. Every case update is pushed live over Socket.IO.

---

## 2. Architecture Decisions (and why)

| Decision | Reasoning |
|---|---|
| Solo, sequential build in 5 module-shaped phases (not literal parallel subagents) | The feature is tightly coupled to one shared Prisma schema — parallel agents would have been guessing at interfaces the earlier phases hadn't built yet. |
| New route files (`server/src/routes/disputes/*.ts`), not more of `index.ts` | `index.ts` was already 2,282 lines. Existing routes are untouched; new ones are mounted additively. |
| Status fields are `String`, not Prisma `enum` | Matches the existing schema's convention exactly (every other model already does this). |
| No standalone `DisputeAudit` model | The app already has a general-purpose `AuditLog` used everywhere for this. Dispute actions write to it with `entityType: 'Dispute'` so there's one immutable audit trail, not two. `DisputeTimeline` (human-readable case narrative) and `DisputeStatusHistory` (strict status transitions) are still their own models — they serve different purposes than a security audit log. |
| `Transaction` got 7 new **nullable** columns (`receiverId`, `receiverRoleSnapshot`, `receiverDepartmentSnapshot`, `balanceBefore`, `balanceAfter`, `ipAddress`, `deviceInfo`) | This is the only way to show sender/receiver/balance-history/IP/device on the expandable payment card. Populated going forward at each money-movement call site; historical transactions before this shipped simply show "Not recorded." |
| Real Socket.IO, not polling | Explicitly requested. Render's backend is a persistent Node process (not serverless), so this is viable; free-tier idle spin-down is a pre-existing limitation, not a new one. |
| Real file validation (magic-byte sniffing) + a pluggable scan hook, not a fake "clean" scanner | No antivirus engine is provisioned in this project. The hook reports `pending`, never a fabricated `clean` — that would be a placeholder pretending to be a real security check. |
| Food Payment / Food Subscription: schema-extensible only | Neither feature exists anywhere in the app. The dispute system's payment-source handling doesn't hard-code against a fixed list, so these can plug in later with zero schema changes — but no food-ordering feature was invented. |
| Wallet-freeze / account-lock guards actually enforced | Added a small early-return guard at each wallet-debit entry point (`/transfer`, `/wallet/withdraw`, the wallet branch of `/semester-fees/pay`), otherwise "Freeze Wallet" would be a no-op admin button. |

---

## 3. Database Schema (`server/prisma/schema.prisma`)

**9 new models** + 1 utility model:

- `Dispute` — case number, category, description, status, priority, risk score, SLA due date,
  freeze state, merge/split self-relations, soft-delete field.
- `DisputeMessage` — conversation + internal notes (`isInternal` flag).
- `DisputeAttachment` — real content-validated uploads with a `scanStatus` field.
- `DisputeAssignment` — append-only assignment history.
- `Refund` / `RefundApproval` — refund requests and the Admin approval chain for high-value ones.
- `DisputeTimeline` — the human-readable "Audit Timeline" feed.
- `DisputeStatusHistory` — strict status-transition log.
- `DisputeNotification` — persisted, per-recipient notifications (bell/badge source of truth).
- `SequenceCounter` — atomic case-number generator (`DSP-2026-000125`), via a single
  `upsert(... increment: 1)` — safe under concurrent filers, no new infra.

**Additive columns** on existing models: `Transaction` (7 new nullable columns, see table above),
`Wallet.frozen`, `Shop.flagged`, `User.flagged` / `User.flagReason`.

---

## 4. What Was Built, By Phase

### Phase 1 — Data + Backend Core
- Schema migration (`prisma db push`, verified with `prisma validate`).
- `server/src/lib/disputes/`: `caseNumber.ts`, `slaClock.ts`, `refundLedger.ts`,
  `fileValidation.ts`, `notify.ts`.
- `server/src/routes/disputes/shared.ts` + `student.ts`: transaction-detail assembly (sender,
  receiver, gateway, SSLCommerz validation ID, wallet balance before/after, IP, device), dispute
  creation with attachments, list/detail/reply/close, dispute PDF.
- Additive audit-context fields wired into all 6 existing money-movement call sites
  (`/transfer`, `/wallet/withdraw`, both branches of `/semester-fees/pay`, `confirmSslPayment`,
  `/payment/init` top-up), plus the 2 wallet-freeze guards and `app.set('trust proxy', 1)`.

### Phase 2 — Student UI
- `TransactionDetailCard.tsx` — the expandable payment card (Transaction ID, Reference,
  SSLCommerz Validation ID, Sender, Receiver + role/department, Payment Source, Gateway, Wallet
  Balance Before/After, Time, IP, Device, Status, Download/Print Receipt, Raise Dispute).
- `DisputeWizard.tsx` — 3-step modal (category → description + attachments → review/submit).
- `DisputesPage.tsx` / `DisputeDetailPage.tsx` — case list and detail with timeline, reply,
  close, PDF download.
- Home page "Financial Disputes" quick action; Ledger rows became expandable in place.

### Phase 3 — Accounts Case Management + Refund Engine + Reports
- `DisputesDashboardPage.tsx` — Kanban-style status counts, SLA/refund KPIs, filterable case list.
- `DisputeCaseDetailPage.tsx` — full payment info, SSLCommerz gateway log, student profile, risk
  score, previous cases, related transactions, and every case action (assign, reply, internal
  note, request documents, freeze/unfreeze, forward, escalate, resolve, reject, merge, split,
  close, refund).
- Refund engine (`finalizeRefund` in `shared.ts`, `processWalletRefund` /
  `recordManualAdjustment` in `refundLedger.ts`) — full/partial, wallet credit / original
  payment / manual adjustment, auto-processed below ৳20,000, pending Admin approval at/above it.
- CSV (hand-rolled), Excel (`exceljs`), and PDF (`pdfkit`) report export.

### Phase 4 — Admin, Library, Shop, Realtime
- `DisputeOversightPage.tsx` — platform stats, staff performance, fraud signals (repeat
  disputers, repeat shops, repeat rejections), export.
- `AdminDisputeDetailPage.tsx` — assign officer, override decision (audited reason required),
  approve/reject high-value refunds, freeze wallet, lock account, flag user/merchant.
- Library inbox — cases are only visible if currently or ever `WaitingForLibrary`; Reply,
  and Approve/Reject/Waive recommendations forwarded back to Accounts (Library never moves money
  directly — the same authorization hierarchy every other payment path in the app uses).
- Shop inbox — scoped permanently to the shop's own transactions; reply + upload proof
  (invoice/photo/CCTV/receipt), internal notes; no delete endpoint exists anywhere in the module.
- `server/src/lib/realtime.ts` + `realtimeBus.ts` — Socket.IO server with JWT-authed handshake,
  per-user/role/case rooms. `notify()` and `recordTimeline()` push live with zero changes needed
  at any of their ~30 existing call sites.
- `src/lib/socket.ts` — client hook; bell/badge wired into all 5 role layouts (Student, Accounts,
  Admin, Library, Shop), with a synthesized sound alert on Shop's dashboard.

### Phase 5 — Hardening
- Fixed a real bug found during testing: `notify()` was awaiting the Gmail API call
  synchronously, blocking every reply/refund response for however long Gmail took (2–5s in this
  environment). Now fire-and-forget.
- Fixed a real authorization gap: Library staff could view/reply to **any** dispute in the
  system, not just ones forwarded to them. Added a `libraryCanAccess()` check (current status is
  `WaitingForLibrary`, or was at some point, per `DisputeStatusHistory`) to `detail`, `reply`,
  and `recommend`.
- Rate limiting added to every staff write action across all 4 staff route files
  (`staffDisputeActionLimiter`, shared via `shared.ts`).
- Full `git diff` review confirming every touch to `server/src/index.ts` and
  `server/prisma/schema.prisma` is additive (new lines, or a pre-existing line expanded with new
  fields) — never a deleted/rewritten line of existing logic.

---

## 5. Verification Performed

Everything below was checked against the **real running app**, not just `tsc`:

- **Live browser sessions** (Playwright) drove the actual UI for every role: student raise →
  Accounts reply/internal-note/refund → Admin override/approve → Library recommend → Shop reply.
- **Live Socket.IO delivery confirmed** with two independent browser sessions: an Accounts reply
  updated the student's bell badge with zero page reload (~5s, matching this dev environment's
  database round-trip latency).
- **Refund correctness confirmed via direct database queries** after live UI actions — wallet
  balance incremented by exactly the refund amount, `Refund.status` → `Processed` with a real
  reversal `Transaction`, dispute status → `Refunded`, and timeline/status-history row counts
  matched the action sequence exactly.
- **Authorization fix verified**: a Library account was confirmed to get `403` on
  `detail`/`reply`/`recommend` for a case never forwarded to Library, both before (`200`, the bug)
  and after (`403`, the fix) the change, against a freshly restarted server.
- **Regression test on an existing feature**: drove the real Wallet Transfer UI between two
  seeded students (not a script-created transaction) — balances moved correctly
  (৳2,000→৳1,750 sender, ৳500→৳750 recipient), and the new audit-context fields (`receiverId`,
  `deviceInfo`, `balanceBefore/After`) were captured correctly on the real `Transaction` row.
- Report generation verified for all 3 formats (CSV, `.xlsx`, `.pdf`) — real files fetched back
  with correct content-types and non-trivial byte sizes.
- `tsc --noEmit` (backend) and `tsc -b` (frontend, the actual `npm run build` step) both clean at
  every phase checkpoint and at the end.
- `prisma validate` clean after every schema change.

---

## 6. New Dependencies

**Backend** (`server/package.json`): `socket.io`, `exceljs`.
**Frontend** (`package.json`): `socket.io-client`.

No new environment variables are required — the Socket.IO server reuses the same `JWT_SECRET`
and CORS policy the REST API already uses (Bearer-token-only, no cookies, open origin).

---

## 7. Deliberate Gaps (agreed upfront, not oversights)

- **No real antivirus engine.** `fileValidation.ts` does real magic-byte sniffing, extension
  allowlisting, and a pluggable async scan hook — but nothing is provisioned to actually scan for
  malware yet. `DisputeAttachment.scanStatus` stays `pending` until a real engine is wired in.
- **Food Payment / Food Subscription are schema-extensible only.** Neither feature exists
  anywhere in the app; no food-ordering system was built.
- **No separate "Download Tax Invoice" feature.** This system has no distinct tax-invoice concept
  from the existing payment receipt, so a redundant, identical-content button wasn't added.
- **Dispute attachments are served via the existing unauthenticated `/uploads` static route** —
  same pattern as the app's existing receipts and profile pictures (URLs are effectively
  unguessable — a `cuid` dispute ID plus a timestamp+random filename — but not access-controlled
  by a real auth check). This matches the codebase's existing design, not a new regression.

---

## 8. Repository Map (new/changed, this session)

```
server/prisma/schema.prisma        9 new models + additive columns
server/src/index.ts                Additive route mounts, audit-context capture, trust proxy,
                                    http.createServer swap for Socket.IO — no existing route body changed
server/src/lib/
  realtime.ts                      Socket.IO server
  disputes/
    caseNumber.ts                  Atomic case-number generator
    slaClock.ts                    SLA due-date math, freeze-aware
    refundLedger.ts                Guarded $transaction wallet refund / manual adjustment
    fileValidation.ts              Magic-byte validation + pluggable scan hook
    notify.ts                      Per-user notification writer (fire-and-forget email)
    realtimeBus.ts                 Neutral pub-sub so notify()/recordTimeline() can push live
server/src/routes/disputes/
  shared.ts                        Case-detail assembly, risk scoring, reports, timeline/status helpers
  student.ts / accounts.ts / admin.ts / library.ts / shop.ts   Per-role routes

src/lib/
  disputeApi.ts                    Typed client functions, all roles
  socket.ts                        Socket.IO client + useDisputeSocket/useDisputeRoom hooks
src/components/disputes/
  TransactionDetailCard.tsx        Expandable payment card
  DisputeWizard.tsx                3-step raise-dispute modal
src/pages/
  student/DisputesPage.tsx, DisputeDetailPage.tsx
  accounts/DisputesDashboardPage.tsx, DisputeCaseDetailPage.tsx, DisputeReportsPage.tsx
  admin/DisputeOversightPage.tsx, AdminDisputeDetailPage.tsx
  library/LibraryDisputesPage.tsx, LibraryDisputeDetailPage.tsx
  shop/ShopDisputesPage.tsx, ShopDisputeDetailPage.tsx
```

---

## 9. Commit

Committed as `aa4e1e5` on `main` and pushed to `origin/main`:

```
feat: add Financial Dispute & Case Management System
43 files changed, 6412 insertions(+), 139 deletions(-)
```
