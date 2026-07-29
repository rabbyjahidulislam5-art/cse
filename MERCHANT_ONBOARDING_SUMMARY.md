# Merchant Onboarding (Shop → Real Authenticated User) — Session Summary

**Date:** 2026-07-29 → 2026-07-30
**Scope:** Phase 1 of turning `Shop` into a real, bank-grade authenticated merchant account
(enterprise merchant onboarding request), plus a scoped Phase 2 slice and a notification/email
wiring pass. Committed as `34ad575` on `main`, pushed to `origin/main`.

---

## 1. Why

The Shop Management module only ever created bare `Shop` records — no login, no owner, no real
identity. Confirmed at the start of this session:

- Every "Shop Staff" login resolved to `prisma.shop.findFirst({status:'Active'})` — the **same**
  shop for every merchant login, regardless of which shop they were supposed to own.
- `Shop.merchantId` was a display string, not a foreign key — **zero** structural link between a
  `Shop` and any `User` existed anywhere in the schema.
- `Shop.qrSignature` existed in the schema but was **never written or verified** — the merchant QR
  was forgeable in principle (only a plain `qrToken` string-equality check protected it).
- The QR-scan parsing logic itself had a live bug: the real QR encodes
  `SMARTCAMPUS:SHOP:{shopId}:{qrToken}`, but the validator tried `JSON.parse()` on it first, which
  fails, and fell back to treating the *entire composite string* as the token — meaning real
  merchant QR codes could never validate successfully in production. This was confirmed
  independently mid-session when a real QR scan on the live Vercel/Render deployment returned
  "Invalid QR Code" — expected, since the fix was local-only and not yet deployed at that point.
- Admin "Create Shop" and Admin "Create Staff" were two disconnected flows — creating a shop never
  created a login; creating staff never linked to a shop.
- Staff account creation (`/admin/staff/manage`) used a **hardcoded default password**
  (`'changeme123'`) with no forced-reset flag for *any* role (Shop, Library, or Accounts).

## 2. Decisions made with the user

- **Schema approach:** extend the existing shared platform tables (`User`, `Wallet`,
  `Notification`, `AuditLog`, `OtpCode`, `Settlement`) rather than build ~17 new parallel
  `Merchant*` tables as the original literal spec listed — matches how every other role already
  works, avoids two competing audit/notification systems.
- **Phase 1 cut:** merchant identity + auth + QR trust fix only. Payment flow (PIN → OTP → wallet
  deduction → ledger → notifications) was found to already work end-to-end for shop payments via
  the existing generic `/payment/init` — confirmed via code exploration, not touched.
- **DB push confirmed explicitly** before running against the live Neon database (no separate dev
  DB exists for this project — `DATABASE_URL` in `.env` is the same Neon instance used by
  Vercel/Render production).
- **Notification/email wiring** (session 2): every shop-facing event (payment received, settlement
  recorded) now also sends a real email to the merchant, not just an in-app row — closing a gap
  where the merchant side was completely silent on both. Admin does **not** get CC'd on every
  shop notification (would be spammy); instead the Admin Shop Management list now shows owner
  email/contact/verification-status inline.
- **Library/Accounts staff creation** has the *same* hardcoded-password gap as Shop did before
  this session — **flagged here, not fixed**. Confirmed with the user this is documentation-only
  for now, not in scope for this session.

## 3. What was built

### Schema (`server/prisma/schema.prisma`)
- `Shop.ownerId` — nullable unique FK → `User.id` (nullable so existing shops could be backfilled
  rather than requiring a hard cutover).
- `Shop.contactNumber`, `ownerName`, `description`, `operatingHours` — new optional fields.
- `User.mustChangePassword`, `User.emailVerified` — booleans, default `false`.
- Pushed to the live Neon DB with explicit user confirmation (`--accept-data-loss` accepted only
  because the only warning was the expected nullable-unique-constraint addition, not real data
  loss).

### Backend (`server/src/index.ts`, `server/src/lib/merchantService.ts`)
- **`/admin/shops/manage` `create` action** — now requires `ownerEmail` (rejects duplicates with
  409), optionally accepts `ownerName`/`contactNumber`. On create: generates a cryptographically
  random temp password (never stored or logged in plaintext, only bcrypt-hashed), creates the
  merchant `User` (`role: 'Shop Staff'`, `mustChangePassword: true`), creates their `Wallet`,
  generates and HMAC-signs the merchant QR, emails the credentials, writes an `AuditLog` row.
  Returns `emailDelivered: false` + the temp password *only* if the email actually failed to send,
  so the Admin can relay it manually — never logged anywhere.
- **`/shops/validate-qr`** — now parses all three QR payload shapes correctly (composite
  `SMARTCAMPUS:SHOP:{shopId}:{qrToken}` string, legacy JSON, bare token) and cryptographically
  verifies `qrSignature` (HMAC-SHA256) before accepting a scan. Mismatches are logged to
  `AuditLog` as a possible forgery attempt.
- **Fixed the "wrong shop" bug** — `/shop/dashboard`, `/shop/sales-ledger/report`,
  `/shop/regenerate-qr` now resolve the shop via `ownerId: req.user.id` instead of
  `findFirst({status:'Active'})`.
- **New `POST /auth/change-password`** — works for any authenticated user; skips the
  current-password check only when `mustChangePassword` is true (first-login flow), enforces real
  server-side password strength.
- **New `POST /auth/shop/send-verification-otp`** / **`POST /auth/shop/verify-email`** — reuse the
  existing OTP generate/verify pattern (6-digit, 5-min expiry, 5-attempt lock) for mandatory email
  verification after the forced password change.
- **`POST /auth/login`** — now returns `mustChangePassword`/`emailVerified` in the user payload.
- **Payment/settlement notifications** — `confirmSslPayment()` and the `settle` admin action now
  `notifyUser()` (in-app + real email) the shop owner; previously silent on the merchant side.
- **New `POST /shop/profile/update`** — shop-level fields only (description, hours, contact,
  location, logo); shop *name* stays admin-only, matching the original "subject to admin approval"
  requirement. Owner-level personal fields (phone/bio/profile picture) reuse the existing generic
  `/profile/update`.
- **`/shop/dashboard`** extended to return `owner` (profile fields) and `wallet` (real balance).
- **`/admin/shops`** extended to return `ownerEmail`, `ownerName`, `contactNumber`,
  `mustChangePassword`, `emailVerified` per shop.
- **Pure logic extracted to `lib/merchantService.ts`** (matches the existing
  `feeManagementService.ts` convention): `signQrToken`, `verifyQrSignature`,
  `generateTempPassword`, `isStrongPassword`, `parseQrPayload`, `nextOnboardingStep`. Unit tested
  in `server/src/tests/merchantService.test.ts` — 25 new tests (forgery rejection, cross-shop
  signature replay, malformed QR input, full onboarding state machine), **53/53 tests pass**
  across the whole backend suite.
- **`server/src/backfill-shop-owners.ts`** — one-off migration script (safe to re-run): links every
  pre-existing owner-less `Shop` to a merchant account (reusing an already-seeded unlinked
  `Shop Staff` account first, generating a fresh one otherwise) and signs every shop's QR (this
  field had never been populated for any shop before this session, including already-linked ones
  — a real gap that would have broken every live merchant QR after the signature-verification
  change if left unfixed). Already run against the live Neon DB; both pre-existing shops
  (`Campus Print Hub`, `Cafe`) are now correctly linked and signed.

### Frontend
- **`src/pages/admin/ShopManagementPage.tsx`** — Create Shop form collects Owner Email (required),
  Owner Name, Contact Number; shop list now shows owner email/contact and a
  "Pending first login" / "Email unverified" status badge per shop.
- **`src/pages/shop/ShopChangeTempPasswordPage.tsx`**, **`ShopVerifyEmailPage.tsx`** — new
  standalone routes (`/shop/change-password`, `/shop/verify-email`), outside `ShopLayout` (no nav
  chrome, cannot be skipped via back/forward navigation).
- **`src/components/ShopLayout.tsx`** — gates the dashboard: redirects to the change-password step
  if `mustChangePassword`, then to the verify-email step if `!emailVerified`, before any dashboard
  route renders.
- **`src/pages/shop/ShopProfilePage.tsx`** (new, Phase 2) — avatar upload, phone/bio edit, shop
  description/hours/contact/location edit, wallet PIN change (reuses existing `PinDialog`), real
  wallet balance display. Reachable via the account dropdown in `ShopLayout`.
- **`src/pages/shop/ShopHomePage.tsx`** — added a Wallet Balance stat tile.
- **`src/lib/auth-context.tsx`** — `AuthUser` extended with `mustChangePassword`/`emailVerified`;
  added `updateUser()` to patch the locally-cached session after these onboarding steps complete
  without a full re-login.

## 4. Verification performed

- Both `tsc` passes (frontend `tsc -b`, backend `tsc --noEmit`) clean throughout every change.
- Full backend vitest suite: **53/53 passing** (28 pre-existing + 25 new).
- **Live-tested against the real Neon database** (not just typechecked), via `curl` and via
  Playwright browser automation on `localhost:5173`/`:4000`:
  - Admin creates a shop with a real owner email → credential email genuinely sent via the Gmail
    API (confirmed received in a real inbox mid-session).
  - Merchant logs in with the temp password → immediately redirected to the forced
    change-password screen, dashboard unreachable.
  - Old temp password rejected after change; new password works.
  - Redirected to mandatory email-verify screen; wrong OTP rejected with attempts-remaining
    message; correct OTP (read from the real inbox by the user) accepted →
    `emailVerified` flips true → dashboard reachable.
  - Merchant's dashboard correctly resolves to *their own* shop (not the old `findFirst` bug).
  - Duplicate owner email on shop creation → `409`.
  - Real signed QR scan → `valid: true`; hand-tampered token on the same shop → `valid: false`.
  - Admin "Remove Shop" (soft delete) exercised live — shop flips to `Inactive`, merchant login
    unaffected, matches the "soft delete only" requirement.
  - All throwaway QA test data (shop, user, wallet, notifications, OTP rows) cleaned up after
    verification; no test artifacts left in the production database.
- Confirmed on the **live deployed Vercel app** that the pre-existing QR-parsing bug reproduces
  exactly as predicted (this was expected — the fix wasn't deployed yet at that point in the
  session).

## 5. What's NOT done (explicitly out of scope for this session)

- **Library/Accounts Office staff account creation** (`/admin/staff/manage`) still uses the
  hardcoded default password `'changeme123'` with no forced-reset flag — the exact same gap Shop
  had before this session. **Flagged, not fixed** — user confirmed documentation-only for now.
  The infrastructure to fix it already exists and is mostly reusable as-is:
  - `User.mustChangePassword`/`emailVerified` are generic `User` fields, not Shop-specific.
  - `POST /auth/change-password` already works for any authenticated user regardless of role.
  - `POST /auth/shop/send-verification-otp` / `verify-email` are currently hardcoded to
    `requireRole('Shop Staff')` — would need generalizing (or duplicating) for Library/Accounts.
  - Would need: real temp password generation in `/admin/staff/manage`'s `create` action (mirror
    the Shop creation branch), a forced-onboarding gate in `LibraryLayout.tsx`/`AccountsLayout.tsx`
    (mirror `ShopLayout.tsx`), and equivalent standalone change-password/verify-email pages (could
    likely be genericized rather than duplicated three times).
- **Phase 3–5 of the original roadmap** (from the plan file at
  `C:\Users\Victus\.claude\plans\pure-moseying-turtle.md`): expanded Admin merchant tools (Force
  Password Reset button, Merchant Login History, Merchant Analytics), dispute/refund polish
  specific to merchant-initiated actions, and a full Playwright QA sweep across the entire
  merchant lifecycle — deliberately deferred, not started.
- **Admin does not get emailed/CC'd on shop notifications** — deliberate choice (confirmed with
  user) to avoid inbox spam; Admin visibility is via the Shop Management list + existing Audit Log
  instead.

## 6. Files changed (commit `34ad575`)

```
server/prisma/schema.prisma
server/src/index.ts
server/src/lib/auth.ts
server/src/lib/merchantService.ts                 (new)
server/src/backfill-shop-owners.ts                (new)
server/src/tests/merchantService.test.ts          (new)
src/App.tsx
src/components/ShopLayout.tsx
src/lib/api.ts
src/lib/auth-context.tsx
src/pages/admin/ShopManagementPage.tsx
src/pages/shop/ShopChangeTempPasswordPage.tsx     (new)
src/pages/shop/ShopHomePage.tsx
src/pages/shop/ShopProfilePage.tsx                (new)
src/pages/shop/ShopVerifyEmailPage.tsx            (new)
```

Left untouched/uncommitted (pre-existing, not part of this work): `src/components/SemesterFeeModal.tsx`,
`server/check-student.mjs`.
