# QR Payment Fix — Session Summary

**Date:** 2026-07-30

## 1. Problem reported

Scanning the merchant QR and completing a payment on a phone showed success at the SSLCommerz
gateway, but:
- No success message appeared on the student dashboard.
- The transaction stayed "Pending" in the merchant database.

Phone screenshot showed the browser stuck on `localhost:4000` with "connection refused" after
payment.

## 2. Root cause

`server/src/index.ts` builds SSLCommerz's `success_url` / `fail_url` / `cancel_url` **and**
`ipn_url` from `process.env.BACKEND_URL`, falling back to `http://localhost:${PORT}` if unset.
Two different things break when that env var is missing or set to `localhost`:

1. **Browser redirect** — after paying, SSLCommerz sends the browser to `localhost`. On a phone,
   `localhost` means the phone itself → "connection refused." No success page ever renders.
2. **IPN (server-to-server) — the real bug** — this is what actually confirms a payment
   (`confirmSslPayment()` in `server/src/index.ts`). SSLCommerz's servers also received
   `ipn_url=http://localhost:.../api/payment/ipn`, which is unreachable from their side too. So
   the confirmation call never arrives, and the transaction row stays `Pending` forever — which is
   why it looked stuck "pending" in the merchant database.

This affected **both** the local dev environment and the live Render deployment — same root
cause, two separate places it was misconfigured.

## 3. Fixes applied

### Local dev environment
- `vite.config.ts` — added `server.host: true` so the Vite dev server is reachable from other
  devices on the LAN (needed for phone camera QR testing), not just `localhost`.
- Started a Cloudflare quick tunnel (`npx cloudflared tunnel --url http://localhost:4000`) to give
  the local backend a real public HTTPS URL that SSLCommerz's IPN can reach.
- Updated local `server/.env`:
  - `BACKEND_URL` → the Cloudflare tunnel URL (public, reachable by SSLCommerz).
  - `FRONTEND_URL` → the machine's LAN IP (`http://192.168.0.103:5173`, reachable by the phone
    browser).
- Restarted both the backend (`tsx watch`) and frontend (`vite`) dev servers to pick up the
  changes.

### Production (Render + Vercel)
- Confirmed live via direct `curl` to `https://cse-iv7l.onrender.com/api/payment/redirect` that
  Render's `FRONTEND_URL` was unset/wrong — it was redirecting to `localhost:5173` in production.
- User set `FRONTEND_URL=https://cse-mocha.vercel.app` and `BACKEND_URL=https://cse-iv7l.onrender.com`
  directly in the Render dashboard's Environment tab (Render auto-restarts on env var save).
- Re-tested the same redirect endpoint afterward — confirmed it now correctly points to the real
  Vercel frontend URL instead of `localhost`.
- Verified the live Vercel build already had `VITE_API_URL` correctly baked in
  (`https://cse-iv7l.onrender.com`), so no frontend rebuild was needed for that part.

## 4. Data reconciliation

Since local dev and production share the **same live Neon database**, five SSLCommerz
transactions were found stuck in `Pending` status. Each was checked directly against
SSLCommerz's real validator API (not guessed) before touching anything:

| Reference | Amount | Gateway status | Action |
|---|---|---|---|
| `SSL-MS6EBNY3-T2QR` | ৳500 | VALIDATED (real payment, matches the original bug report) | Reconciled |
| `SEM-MS69Y6G8-IEKW` | ৳45,500 | VALIDATED | Reconciled |
| `SSL-MS5R86OM-19I6` | ৳500 | VALIDATED | Reconciled |
| `SSL-MS5R5TNA-KZJR` | ৳1,000 | VALIDATED | Reconciled |
| `SSL-MS4EELCL-98DD` | ৳500 | PROCESSING (genuinely abandoned checkout, unrelated to this bug) | Left as-is |

Reconciliation was done by calling the app's own `/api/payment/ipn` endpoint per reference — the
same code path SSLCommerz itself would have triggered — so wallet balances, semester
fee/shop-item paid status, notifications, and confirmation emails were all applied exactly as a
live payment would, with no hand-written database edits. Confirmed afterward via direct DB query
that all 4 flipped to `Success` with correct `balanceBefore`/`balanceAfter` values.

## 5. Unrelated UI fix (during the same session)

Shop Panel's **Home** and **Sales Ledger** pages showed a `$` (lucide `DollarSign`) icon next to
BDT amounts, which read as USD. Replaced with a styled `৳` glyph in both files:
- `src/pages/shop/ShopHomePage.tsx`
- `src/pages/shop/ShopSalesLedgerPage.tsx`

## 6. Commits (all pushed to `origin/main`)

| Commit | Description |
|---|---|
| `ee38b93` | `fix(dev)`: bind Vite dev server to LAN so phones can reach it |
| `e47e258` | `refactor(fees)`: route semester fee payments through SSLCommerz only (pre-existing uncommitted change, reviewed and confirmed intentional with user before committing — removes in-app PIN/OTP gate and wallet-direct option for semester fees) |
| `245ba40` | `docs(shop)`: add merchant onboarding session summary and debug script |
| `d7e1053` | `fix(shop)`: replace dollar-sign icon with Taka glyph on revenue tiles |

## 7. Follow-ups / things to keep in mind

- The local Cloudflare tunnel URL is **temporary** — it dies when the `cloudflared` process stops
  and is not meant as a permanent solution. For future local phone-testing sessions, re-run the
  tunnel and update `server/.env`'s `BACKEND_URL` accordingly, or set up a persistent tunnel.
- `SemesterFeeModal.tsx`'s change (commit `e47e258`) removes PIN verification (previously required
  ≥ ৳3,000) and OTP verification (previously required ≥ ৳20,000) for semester fee payments,
  relying on SSLCommerz's own hosted checkout for authorization instead. This was pre-existing,
  uncommitted work from before this session — flagged to the user and confirmed intentional before
  committing, not something evaluated in depth here.
- `SSL-MS4EELCL-98DD` (৳500, `PROCESSING` at the gateway) remains genuinely unresolved — it's an
  abandoned sandbox checkout from 2026-07-28, unrelated to the bug fixed in this session.
