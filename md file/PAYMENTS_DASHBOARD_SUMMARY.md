# Payments Dashboard & Dispute Integration — Work Summary

This document summarizes the work added in this session: a new Payments Dashboard, and
"Raise Dispute" wired into every payment surface where it was previously missing. It follows
the same format as `AUTH_WORK_SUMMARY.md`, `EMAIL_OTP_FIX_SUMMARY.md`, and
`DISPUTE_SYSTEM_SUMMARY.md` — a session record, not a design proposal.

---

## 1. What This Is

Before this session, the Financial Dispute system (`DISPUTE_SYSTEM_SUMMARY.md`) existed and
worked, but "Raise Dispute" was reachable from exactly one place: the Transaction Ledger. There
was also no single screen showing gateway payments grouped by status (Pending / Confirmed /
Cancelled) — the kind of view shown in the reference screenshot (a bank receipt with a
"Raise Dispute" button).

This session added:
1. A **Payments Dashboard** (`/student/payments`) — all gateway-routed payments (SSLCommerz
   fees/fines/top-ups, shop payments, bKash/Nagad/Rocket withdrawals) grouped into
   Pending / Confirmed / Cancelled / All tabs, with counts.
2. **"Raise Dispute"** added to every remaining place a payment completes or is reviewed:
   Receipt page, Payment Result page (post-SSLCommerz redirect), and the Transfer success
   screen.

Everything is additive — no existing route, schema field, or dispute-engine logic was rewritten,
only reused (`TransactionDetailCard`, `DisputeWizard`, the existing `/disputes/*` endpoints).

---

## 2. Why These Choices

| Decision | Reasoning |
|---|---|
| Reused `TransactionDetailCard` / `DisputeWizard` everywhere, built nothing new for dispute UI | Same component, same backend contract, already tested — a second implementation would just be a second thing to keep in sync. |
| Dashboard built on the existing `/transactions` endpoint, not a new endpoint | Extending it with `status` + `gatewayOnly` filters and `statusCounts` was a small additive change; a parallel endpoint would have duplicated the exact same query logic. |
| `gatewayOnly` excludes `gateway: 'Wallet'`, not just `gateway: null` | Wallet transfers are tagged `gateway: 'Wallet'` (not null) — a plain not-null check would have pulled internal transfers into a dashboard meant for external gateway payments (SSLCommerz, bKash, Nagad, Rocket). |
| No "Raise Dispute" button on Withdraw / Pay-Later success screens | Both create a transaction with `status: 'Pending'`, and the dispute backend already hard-rejects non-`Success` transactions (`400 Only completed payments can be disputed`). A button there would just be a guaranteed error. Those screens link to the Payments Dashboard / Dues page instead, where the dispute button appears automatically once the payment confirms. |
| `PaymentResultPage`'s dispute button uses the SSLCommerz reference directly as `transactionId` | Both `getTransactionDetail` and `createDispute` already resolve a transaction by either internal `id` OR `reference` — no extra lookup call needed. |

---

## 3. What Was Built

### Backend (`server/src/index.ts`, `POST /transactions`)
- Added `status` filter — accepts a single status or an array (e.g. `['Failed','Cancelled']`).
- Added `gatewayOnly` filter — real external gateways only, excludes internal `Wallet` transfers.
- Added `statusCounts` in the response — per-status counts computed independent of the active
  status filter, so dashboard tab badges stay accurate on every tab.
- Fixed a pre-existing gap: the endpoint's contract (`GetTransactionsOutputType`) declared
  `hasMore`, but the handler never actually returned it. Now computed correctly.

### Frontend — new page
- `src/pages/student/PaymentsDashboardPage.tsx` — Pending / Confirmed / Cancelled / All tabs,
  expandable rows reusing `TransactionDetailCard` + `DisputeWizard` (same pattern as
  `LedgerPage`). Routed at `/student/payments`; added to the nav bar (`StudentLayout.tsx`) and
  Home quick actions (`HomePage.tsx`).

### Frontend — "Raise Dispute" wired in
| Page | What was added |
|---|---|
| `ReceiptPage.tsx` | "Raise Dispute" button (the exact screen from the reference screenshot) |
| `PaymentResultPage.tsx` | "Raise Dispute" + "Payments Dashboard" links, shown on a successful SSLCommerz payment |
| `TransferPage.tsx` | "Raise Dispute" action on the transfer success screen |
| `WithdrawPage.tsx` | "Track in Payments Dashboard" link (Pending, not yet dispute-eligible) |
| `ShopDetailPage.tsx` (Pay Later) | "View in Dues" link (Pending, not yet dispute-eligible) |

---

## 4. Verification Performed

- `tsc --noEmit` (backend) — clean.
- `tsc -b` (frontend) — clean.
- `vite build` (real production build, not just type-checking) — succeeded.
- Did **not** run a live browser session in this environment (no seeded login credentials
  available here) — this is the one verification step still owed. Recommended manual click-through:
  Home → Payments; Dues/Shop → pay online → Payment Result → Raise Dispute; Ledger → a
  successful row → Receipt → Raise Dispute; Transfer → success screen → Raise Dispute.

---

## 5. Repository Map (new/changed, this session)

```
server/src/index.ts                        POST /transactions — additive status/gatewayOnly filters, statusCounts, hasMore fix
src/lib/api.ts                              GetTransactionsOutputType — added optional statusCounts
src/App.tsx                                 New route: /student/payments
src/components/StudentLayout.tsx            New nav item: Payments
src/pages/student/
  PaymentsDashboardPage.tsx                 New — Pending/Confirmed/Cancelled/All payment tabs
  HomePage.tsx                              New quick action: Payments
  ReceiptPage.tsx                           Raise Dispute button
  PaymentResultPage.tsx                     Raise Dispute + Payments Dashboard links
  TransferPage.tsx                          Raise Dispute on success screen
  WithdrawPage.tsx                          Track-in-dashboard link on success screen
  ShopDetailPage.tsx                        View-in-Dues link on Pay Later success screen
```

---

## 6. Commit

Committed as `d55ef42` on `main` (local only — not yet pushed to `origin/main`):

```
feat: add Payments Dashboard and integrate Raise Dispute across all payment flows
11 files changed, 252 insertions(+), 11 deletions(-)
```
