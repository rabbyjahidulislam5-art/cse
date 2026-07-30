# Library Module Enterprise Upgrade — Session Summary

**Date:** 2026-07-30
**Scope:** Bring the Library module up to the same enterprise-grade architecture as the Shop
module (real staff onboarding, permanent QR payments, atomic transaction integration) while
preserving the existing Library dashboard UI, routes, and manual fine workflow exactly as-is.
Committed as `ef4a445` on `main`, pushed to `origin/main`.

---

## 1. Why

Read through all existing project docs first (`MERCHANT_ONBOARDING_SUMMARY.md`,
`PRODUCTION_AUDIT_SUMMARY.md`, `EMAIL_OTP_FIX_SUMMARY.md`, `PAYMENTS_DASHBOARD_SUMMARY.md`, etc.)
as the primary reference before touching code. They confirmed the exact gap:

- `POST /admin/staff/manage`'s `create` action hashed the literal string `'changeme123'`
  (`data.password || 'changeme123'`) for every staff account — and the Admin "Add Staff" form
  never sent a `password` field at all, so **every** Library (and Accounts/Admin Office) account
  ever created this way got that same hardcoded password, with no email sent, no forced password
  change, and no email verification.
- Library had **zero** QR functionality of any kind — no permanent QR, no static QR, nothing.
- Library existed only as a `User.role = "Library"` string plus a flat `LibraryFine` table — no
  entity record to attach a QR/identity to, unlike Shop's `Shop` model with its `ownerId` FK.

Explicitly flagged as a known, unfixed gap in `MERCHANT_ONBOARDING_SUMMARY.md`'s own "not fixed"
list from the prior Shop onboarding session, which doubled as most of this session's checklist.

## 2. Decisions made with the user

- **Library QR model:** a **singleton** `Library` record shared by every Library Staff account —
  matches how the Library dashboard already works today (one shared fine queue, no per-staff data
  isolation), unlike Shop's 1:1 merchant ownership. Confirmed with the user before implementation.
- **Live testing:** approved to test end-to-end against the real shared Neon Postgres DB (this
  project has no separate dev database) and real Gmail send, using `mdj117157@gmail.com` as the
  test Library Staff account — mirrors how the Shop onboarding work was itself verified.
- **Settlement:** deliberately **not** extended to Library. `Settlement` models reconciling an
  external merchant's bank payout — doesn't apply to Library, since fine payments settle straight
  into the platform's own wallet/ledger, already fully audited via `LedgerEntry`/`AuditLog`.

## 3. What changed

### Backend
- **`server/prisma/schema.prisma`** — new `Library` model (id, name, status, qrToken,
  qrSignature, location, logoUrl, libraryCode, contactNumber, description, operatingHours). No
  changes to `Transaction`, `Settlement`, or `LibraryFine`.
- **`server/src/lib/libraryService.ts`** (new) — `parseLibraryQrPayload()` (mirrors
  `merchantService.ts`'s QR parsing for the `SMARTCAMPUS:LIBRARY:` prefix) and
  `ensureLibrarySingleton()`. Reuses `signQrToken`/`verifyQrSignature`/`generateTempPassword`/
  `isStrongPassword` directly from `merchantService.ts` rather than duplicating them.
- **`POST /admin/staff/manage`** — `create` action rewritten to mirror the Shop merchant
  onboarding pattern for every role it creates: real email-format validation, duplicate-email
  check, `generateTempPassword()` + bcrypt hash (the client-supplied-password fallback was 100%
  dead code and is now gone entirely), `mustChangePassword: true`, `emailVerified: false`, and a
  real credential email via `sendEmail()` (temp password only ever returned in the API response if
  the email genuinely failed to send — never logged).
- **`/auth/shop/send-verification-otp`** / **`/auth/shop/verify-email`** — role gate widened from
  `requireRole('Shop Staff')` to `requireRole('Shop Staff', 'Library')`; route paths and the
  `ShopEmailVerify` OTP purpose string kept unchanged for backward compatibility.
- **New Library QR + payment routes**: `POST /library/details`, `/library/regenerate-qr`,
  `/library/details/update`, `/library/validate-qr`, `/library/qr/create-payment`. The payment
  route only mints one ad-hoc `Pending` `LibraryFine` row for the amount the student enters — the
  frontend then calls the **existing, unmodified** `POST /payment/init` (`purpose: 'library_fine'`,
  `source: 'library'`), which already owned PIN/OTP threshold enforcement, the atomic
  `confirmSslPayment()` `$transaction` block, and the student's payment notification. Zero changes
  to that payment engine were needed.
- **`confirmSslPayment()`** — one additive hook: on any `library_fine` payment, `notifyRole
  ('Library', ...)` fans a real-time notification out to every Library Staff account (mirrors the
  existing shop-owner notify), since Library has no single owner to notify.

### Frontend (new files only, aside from `LibraryLayout.tsx`'s onboarding gate + one dropdown item)
- `src/pages/library/LibraryChangeTempPasswordPage.tsx`, `LibraryVerifyEmailPage.tsx`,
  `LibraryQrPage.tsx`, `LibraryProfilePage.tsx` — mirror the equivalent Shop pages.
- `src/components/LibraryLayout.tsx` — added the same forced-onboarding redirect gate
  `ShopLayout.tsx` has, plus "Payment QR Code" and "Profile" items in the existing dropdown menu.
  Nav bar, colors, and every existing page under `/library/*` are untouched.
- `src/pages/student/QrScannerPage.tsx` — extended with an additive Library branch (detected by
  QR payload prefix) so students have one scan entry point for either a Shop or a Library QR. The
  pre-existing Shop code path is unchanged inside its own branch.
- `src/pages/admin/StaffAccountsPage.tsx` — one-line placeholder-text fix (misleading
  `email@smartcampus.edu` example → `name@gmail.com`), no logic/layout change.

## 4. Bug found and fixed during live testing

`ensureLibrarySingleton()`'s original `findFirst()`-then-`create()` implementation had a classic
TOCTOU race: two near-simultaneous first-ever calls (e.g. the QR page and Profile page both
loading at once) could both see no row and both create one, producing two "singleton" `Library`
rows with the same timestamp. Since Postgres doesn't order rows without an explicit `ORDER BY`,
subsequent reads/writes non-deterministically hit either duplicate — confirmed live when a saved
Library Details form appeared to silently discard its own save. Fixed by pinning the row to a
fixed, well-known id (`'singleton-library'`) and using a single atomic `prisma.library.upsert()`
instead — the same fixed-id-upsert pattern this schema already uses for `SequenceCounter`. The two
duplicate rows already created during testing were consolidated by hand; going forward the race is
structurally impossible. Unit tests were updated to assert the upsert-on-fixed-id behavior,
including a concurrent-call test.

## 5. Verification performed

- `npx tsc --noEmit` clean on both `server/` and the frontend.
- `npx vitest run` — 65/65 backend tests passing, including 11 new `libraryService.test.ts` tests.
- Live, real end-to-end pass against the shared Neon DB:
  - Admin created a real Library Staff account (`mdj117157@gmail.com`) → real credential email
    confirmed received (not `changeme123`).
  - Logged in with the temp password → forced to `/library/change-password` (dashboard
    unreachable) → set a new password.
  - Forced to `/library/verify-email` → real OTP email received and entered → dashboard reachable.
  - `/library/qr` → singleton Library auto-provisioned with a real signed QR; Library Details
    edits on the new profile page persist correctly (after the race fix above).
  - As a student, validated the Library QR, entered ৳500, completed a real SSLCommerz sandbox
    checkout, and confirmed via direct DB inspection: `Transaction` → `Success` with correct
    `balanceBefore`/`balanceAfter`, `LibraryFine` → `Paid`, a matching `LedgerEntry`, three
    `AuditLog` rows (QR payment created, SSLCommerz initiated, SSLCommerz verified), and
    `Notification` rows delivered to both the student and every Library Staff account.
  - Regression-checked: the existing Shop QR validate/pay path, the existing manual Library fine
    assign/waive data and `/library/overview` aggregation, all still work unchanged.
- Not exercised live: the ≥৳3,000 PIN / ≥৳20,000 OTP payment thresholds for a Library payment
  specifically — low risk, since it's the exact same pre-existing, unmodified threshold-check code
  already proven against Shop/semester-fee payments; the new Library payment just adds another
  `source: 'library'` item into that same code path.
