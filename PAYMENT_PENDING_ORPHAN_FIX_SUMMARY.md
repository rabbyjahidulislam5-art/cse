# Payment Flow — Orphaned Pending Transactions, SSLCommerz Redirect Hardening & Mobile OTP Fix

**Date:** 2026-07-31

**Scope:** Fixed the root cause of "Too many pending payments. Complete or cancel existing ones
first." appearing right after Wallet PIN + Email OTP verification in the Add Money flow, hardened
SSLCommerz session-creation and redirect handling so a payment can never be left silently
`Pending` forever, and fixed the Email OTP modal's 6-digit input boxes overflowing outside the
dialog on narrow mobile viewports. Also re-pointed a dead dev-environment Cloudflare tunnel that
was independently breaking phone-based testing.

---

## 1. Root cause

Read through `server/src/index.ts`'s SSLCommerz payment routes and the frontend PIN/OTP/redirect
components before making any change (no guessing). Found four distinct, compounding gaps:

1. **Orphaned `Pending` rows.** `/payment/init` and the SSLCommerz branch of `/semester-fees/pay`
   both created a `Transaction` row with `status:'Pending'` *before* calling SSLCommerz's
   session-init API. If that `fetch()` call threw (network error/timeout) or `response.json()`
   threw (bad response), execution skipped the existing "mark Failed" handling and fell straight
   to the route's outer `catch` block, which returned a 500 but never touched the Transaction row
   — it stayed `Pending` forever. A few of these silently accumulated; the next attempt tripped
   the "≥3 pending" gate.
2. **No orphan expiry.** The existing 30-minute window (`PENDING_TXN_ABANDON_WINDOW_MS`) only
   *excluded* old Pending rows from the "≥3" count — it never mutated them. No cron, no
   `expiresAt` column, no `/payment/cancel` endpoint existed anywhere in the repo.
3. **No client-side redirect-failure recovery.** All 6 places doing
   `window.location.href = res.gatewayUrl` fired-and-forgot the navigation, with no way to tell
   the backend "the redirect never actually happened, please cancel this."
4. **Mobile OTP overflow.** `OtpDialog.tsx` rendered 6 fixed 48×56px boxes in a non-wrapping flex
   row needing ≥338px of content width — overflowing the modal on any phone narrower than ~400px,
   exactly as shown in the reported screenshot.

`confirmSslPayment()` (the shared IPN/browser-validate confirmation function) already correctly
mapped SUCCESS/FAIL/CANCEL to `Success`/`Failed`/`Cancelled` — that part was untouched except to
add expiry for the "callback never arrives at all" case.

---

## 2. Backend changes (`server/src/index.ts`)

- **`initiateSslCheckout()`** — new shared helper extracted from the duplicated
  fetch-SSLCommerz-init logic in both routes. Wraps the gateway call in its own `try/catch`; on
  *any* failure (network throw, non-`SUCCESS` status, or a `SUCCESS` status with a missing
  `GatewayPageURL` — a gap that existed even in the "success" path) it marks the transaction
  `Failed` and returns a clean `{ok:false, status, message}` instead of throwing, so a route-level
  500 can no longer skip cleanup.
- **`PENDING_TXN_TTL_MS` (8 minutes)** — new constant, kept alongside the existing 30-minute
  `PENDING_TXN_ABANDON_WINDOW_MS` (now a belt-and-suspenders safety net). Both `/payment/init` and
  `/semester-fees/pay` now run an `updateMany` that actively flips the caller's own stale Pending
  SSLCommerz rows to `Cancelled` before counting — self-healing on every new attempt, no cron
  needed.
- **`confirmSslPayment()`** — its two previously-inert "inconclusive" branches (validator
  unreachable; gateway status neither VALID nor FAILED/CANCELLED) now also check the TTL and
  expire the row to `Cancelled` if it's past due, instead of returning `pending` forever. The
  genuine `VALID`/`FAILED`/`CANCELLED` branches are untouched and evaluated first, so a real late
  confirmation is unaffected as long as it arrives before the TTL branch runs (accepted,
  documented edge case — not fully solved, flagged in code).
- **New `POST /payment/cancel`** — auth-protected, one atomic `updateMany` filtered on
  `reference + userId + status:'Pending'`, so it can structurally never downgrade an
  already-`Success` row. Deliberately excluded from `blockIfFinanciallyRestricted` and
  `paymentInitLimiter` — cancelling a payment that never completed must stay available even to a
  financially-restricted student.

## 3. Frontend changes

- **`src/lib/payment-redirect.ts`** (new) — `redirectToPaymentGateway(gatewayUrl, transactionRef,
  onFail)`. Navigates via `window.location.href`, arming `pagehide`/`visibilitychange` listeners
  plus a ~3.5s timeout; if the tab is still visible when the timeout fires (browser silently
  blocked the redirect), it calls the new `cancelPayment` API and `onFail()` instead of leaving an
  orphaned Pending row. If `gatewayUrl` itself is missing, it cancels immediately.
- **`cancelPayment`** added to `src/lib/api.ts`.
- Wired into all 6 SSLCommerz redirect call sites: `AddMoneyModal.tsx`, `SemesterFeeModal.tsx`,
  `DuesPage.tsx`, `QrScannerPage.tsx` (both branches), `ShopDetailPage.tsx` — each with an
  `onFail` matching that file's existing error-toast/loading-reset pattern.
- **`OtpDialog.tsx`** — the 6-digit box row changed from a fixed-width flex row (`w-12 h-14`,
  `gap-2.5`) to a fluid `grid grid-cols-6` with `w-full max-w-12 min-w-0` per box, so the row
  width is always derived from the modal's actual available space and can never overflow. Dialog
  padding changed to `p-5 sm:p-6` for a little extra room on the smallest screens. Font size,
  colors, and all other styling left untouched (visual design requirement). Since every
  PIN+OTP+payment flow shares this one component, the fix applies everywhere automatically.

## 4. Dev-environment fix (unrelated to the code, found during live retest)

While retesting on a phone, hit `DNS_PROBE_FINISHED_NXDOMAIN` after selecting Nagad at the
SSLCommerz sandbox. Root cause: `server/.env`'s `BACKEND_URL` still pointed at a dead Cloudflare
quick-tunnel URL from an earlier session (no tunnel process was even running), so SSLCommerz's
return redirect *and* its server-to-server IPN couldn't reach the backend at all —
`FRONTEND_URL`'s LAN IP was also stale (machine's actual IP had changed). Fixed by starting a
fresh `cloudflared` quick tunnel, updating both URLs in `server/.env`, and restarting the backend.
This is dev/testing infrastructure, not a code change — production already reads these correctly
from Render/Vercel env vars per an earlier session.

---

## 5. Files changed

| File | Change |
|---|---|
| `server/src/index.ts` | `initiateSslCheckout()` helper; `PENDING_TXN_TTL_MS` + active self-cancel in both SSLCommerz-initiating routes; TTL-expiry in `confirmSslPayment`'s inconclusive branches; new `POST /payment/cancel` |
| `src/lib/api.ts` | Added `cancelPayment` |
| `src/lib/payment-redirect.ts` | New — `redirectToPaymentGateway` |
| `src/components/AddMoneyModal.tsx` | Uses `redirectToPaymentGateway` |
| `src/components/SemesterFeeModal.tsx` | Uses `redirectToPaymentGateway` |
| `src/pages/student/DuesPage.tsx` | Uses `redirectToPaymentGateway` |
| `src/pages/student/QrScannerPage.tsx` | Uses `redirectToPaymentGateway` (both branches) |
| `src/pages/student/ShopDetailPage.tsx` | Uses `redirectToPaymentGateway` |
| `src/components/OtpDialog.tsx` | Responsive grid for the 6-digit box row + mobile padding |

## 6. Verification performed

- **Backend type check**: `tsc --noEmit` — 0 errors.
- **Frontend build**: `tsc -b && vite build` — clean, new `payment-redirect` chunk bundled
  correctly alongside `OtpDialog`/`PinDialog`.
- **Backend regression suite**: `vitest run` — **105/105 tests passing**, no regressions.
- **Live browser walkthrough** (Chrome DevTools automation, logged in as the real test student
  `2023-2-60-053`): reproduced the exact reported screen sequence (Amount → Payment Summary &
  Confirmation → Wallet PIN) at a 375×812 mobile viewport to confirm the fixed flow renders
  correctly.
- **Live phone retest**: after the tunnel/env fix, confirmed the SSLCommerz sandbox flow
  (including Nagad method selection) no longer dead-ends on an unreachable host.

## 7. Known accepted trade-off (documented in code, not fully solved)

If a browser-triggered `/payment/validate` call expires a row via the new TTL path right as the
*real* IPN is about to arrive with a genuine late success, `confirmSslPayment`'s existing
early-return for `Cancelled` rows would report it as already-failed rather than completing it.
Mitigated by keeping the TTL generous (8 minutes, versus SSLCommerz sessions that typically expire
in 5–15 minutes themselves) — every attempt still leaves a `PaymentCallback` row for manual
reconciliation if this is ever reported. A fuller fix (letting a genuine late IPN "resurrect" a
TTL-cancelled row) was intentionally deferred as a bigger behavioral change outside this pass's
scope.
