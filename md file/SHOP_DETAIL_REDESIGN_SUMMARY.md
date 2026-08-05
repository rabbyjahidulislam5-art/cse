# Student Shop Details Page — QR Removal & Info Panel Redesign

**Date:** 2026-07-30

## 1. Task

Redesign the right-side information section of the Student → Shop Details page
(`/student/shops/:shopId`). Remove the static QR preview card ("Scan this QR at the counter or
tap below to pay") since QR scanning always happens physically at the shop counter, and replace
it with a professional, dynamically-populated **Shop Information** panel. Keep Pay Online / Pay
Later fully functional, just repositioned.

## 2. Investigation findings

- The QR box was **purely decorative** — a static `QrCode` icon, not a real generated code. A real
  signed `qrToken`/`qrSignature` already exists server-side and is used elsewhere (merchant's own
  QR page), but was never rendered here.
- The `Shop` Prisma model already stores `description`, `operatingHours`, `contactNumber`, and
  `ownerName` — all editable by the merchant via their profile page (`ShopProfilePage.tsx` →
  `updateShopProfile`) — but the `/shops/detail` backend handler was silently dropping all four
  fields before they reached the student page (hand-picked only 9 of the row's fields after an
  unfiltered `findUnique`).
- No structured building/floor/room fields or "operating days" field exist in the schema — only a
  single free-text `location` string and a single free-text `operatingHours` string. Not treated as
  a gap to fix; the panel shows what's actually stored.
- No banner-image field distinct from `logoUrl` exists either; left as-is.

## 3. Changes made

### Backend (`server/src/index.ts`)
`/shops/detail` now:
- Includes the shop's `owner` relation (`select: { email, fullName }`).
- Returns `description`, `operatingHours`, `contactNumber`, `ownerName` (falls back to
  `owner.fullName`), and `ownerEmail` (`owner.email`) in the response — no schema change needed,
  these fields already existed on the row that was already being fetched.

### Frontend types (`src/lib/api.ts`)
Extended `GetShopDetailOutputType['shop']` with the five new fields above.

### Frontend page (`src/pages/student/ShopDetailPage.tsx`)
- Removed the QR placeholder card entirely.
- Added a reusable `InfoRow` component (icon tile + label + value, matching the existing
  `ReadOnlyField` pattern from `ShopProfilePage.tsx`) with a **"Not provided"** italic fallback for
  empty fields.
- Added a **Shop Information** card listing: About (description), Location, Contact Number,
  Email, Operating Hours, Owner/Manager.
- Iterated on Pay Online / Pay Later placement per user feedback, in three passes:
  1. First redesign: buttons moved to a full-width row spanning below both columns.
  2. Feedback: buttons looked disconnected from the shop — moved into the right column, stacked
     under the new Shop Information card.
  3. Final feedback: buttons should instead sit under the **shop identity card** (left column,
     the "Playwright QA Test Shop" box) — Pay Online first, Pay Later directly beneath it. This is
     the final, shipped layout: left column = shop identity card + stacked Pay Online/Pay Later;
     right column = Shop Information panel only.
- No changes to payment logic — `setPayMode`/`setPayStep`, PIN/OTP thresholds
  (`PIN_REQUIRED_THRESHOLD`/`OTP_REQUIRED_THRESHOLD`), and the SSLCommerz vs. Pay Later branching
  were untouched throughout all three passes.

## 4. Verification

- `npx tsc -b` (frontend) — clean on every pass.
- `npx tsc --noEmit` (backend) — clean.
- `npm run build` (production Vite build) — succeeded on every pass.
- No test suite exists in this repo (no `test` script, no Playwright/Jest config found), so the
  above were the relevant checks. All three layout passes were pure JSX/container restructuring
  with no handler or state logic touched, keeping regression risk low.

## 5. Commits (all pushed to `origin/main`, confirmed with user before each push)

| Commit | Description |
|---|---|
| `980f5b4` | `feat(student)`: replace shop QR preview with dynamic Shop Information panel |
| `3ec1171` | `fix(student)`: pair Pay Online/Pay Later buttons with Shop Information card |
| `3266c76` | `fix(student)`: stack Pay Online/Pay Later under the shop identity card (final layout) |

## 6. Follow-ups / things to keep in mind

- `category` and `name` remain admin-managed and are not shown as editable anywhere on the student
  or merchant side — the Shop Information panel correctly treats them as read-only display data.
- If a real scannable QR is ever wanted back on this page, `shop.qrToken` is already returned by
  `/shops/detail` and encoded elsewhere as `SMARTCAMPUS:SHOP:{shopId}:{qrToken}` — it was
  intentionally left out per this task's requirement, not because the data is unavailable.
- If "building/floor/room" or "operating days" ever need to be structured fields instead of free
  text, that's a schema change (new Prisma fields + migration + backend `select`/response update +
  merchant profile form update) against the live Neon DB, not just a frontend change.
