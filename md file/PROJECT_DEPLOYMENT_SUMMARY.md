# EWU Smart Campus — Full Project & Deployment Summary

This document is a complete, single-source summary of the project: what it is, where every part
of it is deployed, and everything that has been built or fixed so far. It consolidates the
history spread across `AUTH_WORK_SUMMARY.md`, `EMAIL_OTP_FIX_SUMMARY.md`, and the full git commit
log into one place.

---

## 1. What This Project Is

**EWU Smart Campus** is a full-stack campus wallet & payments platform for East West University
students, restricted to `@std.ewubd.edu` accounts. It replaces cash/manual handling for:

- Student digital wallet + peer-to-peer money transfer
- Semester fee, library fine, and admin fine payments
- On-campus shop purchases (QR-code based) and "pay later" dues
- Library clearance / fine management (Library staff role)
- Fee pushing & collection analytics (Accounts staff role)
- Shop management, staff accounts, audit logs (Admin role)

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript + Vite, Tailwind CSS, Radix UI, Framer Motion, React Router |
| Backend | Node.js + Express 5 + TypeScript |
| Database | PostgreSQL, via Prisma ORM |
| Auth | JWT (Bearer token) + bcrypt (password/PIN) + Google OAuth2 (`google-auth-library`) |
| Payments | SSLCommerz (Bangladesh payment gateway) |
| Email | Gmail REST API over OAuth2 (not SMTP) |
| PDF receipts | `pdfkit` |

---

## 3. Deployment Topology — Where Everything Actually Runs

```
 Student / Staff Browser
         |
         v
 ┌───────────────────┐        ┌────────────────────────┐
 │  Vercel (Frontend) │  --->  │  Render (Backend API)  │
 │  Vite/React build  │  API   │  Express + Prisma       │
 └───────────────────┘  calls └────────────┬────────────┘
                                            |
                    ┌───────────────────────┼───────────────────────┐
                    v                       v                       v
             ┌─────────────┐        ┌──────────────┐        ┌──────────────┐
             │ Neon         │        │ SSLCommerz    │        │ Gmail API     │
             │ PostgreSQL   │        │ Payment       │        │ (OAuth2/HTTPS)│
             │ (serverless) │        │ Gateway       │        │ OTP + emails  │
             └─────────────┘        └──────────────┘        └──────────────┘
```

- **Frontend** — deployed on **Vercel**. Built with `vite build`; reads `VITE_API_URL` (points at
  the Render backend) and `VITE_GOOGLE_CLIENT_ID` (Google OAuth) at **build time** — changing
  either requires a fresh Vercel deploy, not just a dashboard save.
- **Backend** — deployed on **Render**, currently on the **Free** web-service tier. Build command
  runs `npm run build:server` (installs deps, `prisma generate`, `tsc`); start command runs
  `node server/dist/index.js`. Root `package.json` has a `start` script specifically so Render's
  default Node detection works from the repo root.
- **Database** — **Neon** (serverless Postgres), connected via `DATABASE_URL`. Schema is managed
  with Prisma (`prisma db push` used for schema changes so far; `prisma migrate deploy` script
  also exists for a formal migration workflow).
- **Payment gateway** — **SSLCommerz**, used for every real money movement into the platform
  (see §6.6).
- **Email** — **Gmail API** (the project owner's real Gmail account), authenticated via OAuth2
  refresh token, used for OTP codes and transactional emails. Not standard SMTP — see §6.5 for why.

---

## 4. Application Modules (by role)

| Role | Pages | Purpose |
|---|---|---|
| Student | Home, Dues, Ledger, Notifications, Profile, QR Scanner, Receipt, Shops, Shop Detail, Transfer, Payment Result | Wallet balance, pay dues/fines, shop QR payments, P2P transfer, transaction history, receipts |
| Admin | Home, Audit Logs, Fines, Shop Management, Staff Accounts | Platform-wide oversight, fine issuance, shop & staff management |
| Library | Home, Student Lookup, Fine Imposition, Fine Waiver, Clearance Status | Library fine workflow, clearance checks |
| Accounts | Home, Collection Analytics, Fee Adjustments, Semester Fee Push | Pushing semester fees to students, adjusting fees, viewing collection analytics |
| Shop (staff) | Home, QR Page, Sales Ledger, Notifications | Accept QR payments, view sales, manage shop-side notifications |

## 5. Database Schema (Prisma models)

`User`, `Wallet`, `Transaction`, `PaymentCallback` (SSLCommerz IPN audit trail), `Shop`,
`Settlement` (manual shop payout bookkeeping), `SemesterFee`, `LibraryFine`, `AdminFine`,
`PayLaterDue`, `OtpCode`, `AuditLog`. All financial actions write to `Transaction`, and every
SSLCommerz callback is separately logged in `PaymentCallback` regardless of outcome, for
reconciliation.

---

## 6. Major Work Completed (chronological)

### 6.1 Initial build & first deploy fixes
- Full-stack scaffold committed (`f7260ea`).
- Admin/Staff DB seed script added for Neon (`8f2919c`).
- Root `start` script added so Render could detect and run the backend from repo root (`017d864`).
- Fixed a `SyntaxError: Unexpected token <` bug by adding a safe JSON-parsing wrapper around
  fetch responses on the frontend, so a non-JSON error page (e.g. an HTML 404) fails with a
  readable message instead of a cryptic parse crash (`c3f4923`).
- Improved diagnostic messaging when the frontend can't reach the backend URL on Vercel
  (`0b86c2a`).
- Mounted Express routes on both `/api` and `/` with a JSON 404 fallback handler, so misrouted
  requests return structured errors instead of Express's default HTML error page (`cf7c718`).

### 6.2 Authentication system overhaul
Full detail in `AUTH_WORK_SUMMARY.md`. Summary:
- **Fixed a registration crash** — `register-otp` was creating an `OtpCode` row with a fake
  `userId` before the user existed, violating a foreign-key constraint. Fixed by making
  `OtpCode.userId` nullable (registration OTPs aren't linked to a user yet).
- **Added real Google Sign-In** — backend verifies the Google ID token server-side, restricted to
  `@std.ewubd.edu`, matches or auto-creates the account, links `googleId`. Frontend uses
  `@react-oauth/google`, gated so it fails safely if the client ID isn't configured.
- **Redesigned the auth card UI** — Sign In is now the default view (registration is a secondary
  link), added a back-arrow flow, kept the existing visual theme.
- **Finalized login design**: a single **Password or Wallet PIN** field — the backend tries the
  password first, then falls back to treating the input as a 4-digit PIN if one is set. Both are
  fully interchangeable once a PIN exists.
- **Fixed a Render TypeScript build failure** caused by the nullable `OtpCode.userId` change
  (added a null guard in the password-reset route).
- **Fixed local `.env` never being loaded** — `dotenv/config` wasn't imported, so every env var
  except `DATABASE_URL`/`JWT_SECRET` was silently undefined locally (production on Render was
  unaffected, since Render injects env vars directly).
- **Fixed silently-failing OTP emails** — `sendEmail()` used to swallow SMTP errors and always
  report success. Now it throws on failure, the calling route deletes the now-useless OTP row,
  and returns a real `502` with the actual reason instead of a false "success".
- **Fixed inconsistent CORS config** — `origin: '*'` combined with `credentials: true` is invalid
  for browsers; changed to `credentials: false` since the app is Bearer-token-only (no cookies).

### 6.3 Login/PIN UX iteration
`1767551` — simplified the login flow to Password-or-PIN and removed an earlier, more restrictive
design that had required both a password **and** a PIN together with a forced PIN-setup gate
right after signup. That earlier design was fully replaced; nothing from it remains active.

### 6.4 Email delivery — three iterations to find a working setup
Full investigation detail in `EMAIL_OTP_FIX_SUMMARY.md`. Summary:

1. **Attempt 1 — Resend** (`f81f8f0`): switched from Gmail SMTP to Resend (HTTP email API).
   Rejected/reverted — Resend's sandbox mode couldn't deliver to real `@std.ewubd.edu` inboxes
   without a verified sending domain, and the owner wanted to keep using their own Gmail account
   rather than a third-party provider. Also fixed a crash when `RESEND_API_KEY` was unset
   (`ca4fdf2`) before reverting entirely back to Gmail SMTP (`4042ccb`).
2. **Attempt 2 — fix Gmail SMTP directly** (`38f1b2f`): found and fixed a real Nodemailer 9 bug
   where its internal DNS resolver picks IPv4 or IPv6 at random regardless of configuration —
   fixed by resolving the SMTP hostname to a literal IPv4 address first. Emails still failed with
   `ETIMEDOUT` / `command: 'CONN'` (failure at the raw TCP handshake, before Gmail is even
   reached).
3. **Root cause found**: Render's **free-tier web services block all outbound traffic to SMTP
   ports 25, 465, and 587** (a platform policy effective since September 2025). No application
   code, DNS fix, or timeout change can work around a port block enforced by the hosting
   platform itself.
4. **Final fix — Gmail API over OAuth2/HTTPS** (`26a8ad2`): replaced Nodemailer/SMTP entirely
   with Gmail's REST API (`gmail.googleapis.com`), authenticated via an OAuth2 refresh token, sent
   over HTTPS (port 443, which Render's free tier does *not* block). Still the same real Gmail
   account — no third-party email provider. `sendEmail()`'s function signature and throw-on-error
   contract were kept identical, so no other part of the app needed to change.
   - Verified locally (4 different email types sent successfully with real Gmail message IDs).
   - Verified in production: `POST /auth/forgot-password/otp` returned success in ~2.6 seconds
     (previously always exceeded the 6-second budget and failed), and the OTP email was confirmed
     received in the actual inbox.

### 6.5 Unified SSLCommerz payment architecture (latest, `33c86e5`)
The largest single change to date — replaced ad-hoc wallet top-up/withdraw with one consistent
payment system:
- **Every payment type** (semester fees, library/admin fines, shop purchases, pay-later dues,
  batch/mass payment) now routes through a single SSLCommerz checkout flow.
- **Server-to-server IPN webhook verification** — payments are confirmed by SSLCommerz calling
  the backend directly, not by trusting the browser's return redirect (which can be spoofed or
  interrupted).
- **Wallet Top Up and Withdraw removed entirely.** P2P Transfer between students is kept, since
  SSLCommerz has no peer-to-peer payment mechanism.
- **Tiered payment authorization**, enforced server-side: PIN required for payments ≥ Tk 3,000;
  PIN + OTP required for payments ≥ Tk 20,000.
- **PIN policy upgraded** to 6 digits going forward, while staying backward-compatible with
  existing 4-digit PINs already set by users.
- **Shared `PaymentConfirmModal`** component added for a consistent confirmation UX across all
  payment types; the old `AddMoneyDialog` was deleted.
- **Rate limiting** added on payment endpoints.
- **IP-address audit logging** added on every sensitive write — several admin routes previously
  logged nothing.
- **Manual shop settlement ledger** (`Settlement` model) added — SSLCommerz doesn't expose real
  bank disbursement data, so Admin Office reconciliation (shop paid out or not) is deliberately
  tracked as manual bookkeeping, append-only.
- **Working PDF receipts** — fixed along the way.
- **Two pre-existing bugs fixed incidentally**: the shop dashboard's revenue stat always showed 0
  due to a field-name mismatch, and the receipt page's download button 404'd due to passing the
  wrong transaction identifier.
- **Role-based authorization added to all Admin/Library/Accounts/Shop-staff routes** — previously
  these accepted *any* authenticated account regardless of role, which was a real access-control
  gap.

---

## 7. Environment Variables (names only — actual values live in Vercel/Render dashboards and local, git-ignored `.env` files)

**Frontend (Vercel), from `.env.example`:**
```
VITE_API_URL              # points at the Render backend, e.g. https://your-app.onrender.com/api
VITE_GOOGLE_CLIENT_ID     # Google OAuth client ID (public value, safe to expose)
```

**Backend (Render), from `server/.env.example`:**
```
DATABASE_URL                  # Neon Postgres connection string
JWT_SECRET                    # must be set to a real random secret in production
GOOGLE_CLIENT_ID              # Google OAuth client ID (server-side verification)
SSLCOMMERZ_STORE_ID
SSLCOMMERZ_STORE_PASSWORD
SSLCOMMERZ_IS_LIVE            # false = sandbox, true = live transactions
GMAIL_SENDER_ADDRESS
GMAIL_OAUTH_CLIENT_ID
GMAIL_OAUTH_CLIENT_SECRET
GMAIL_OAUTH_REFRESH_TOKEN
FRONTEND_URL
BACKEND_URL
PORT
```

Both `.env` (root) and `server/.env` are correctly excluded via `.gitignore` and are not committed.

---

## 8. Outstanding Items — Need Dashboard Action, Not Code

These were flagged during the auth work and may still need confirming:

1. **Vercel** → confirm `VITE_GOOGLE_CLIENT_ID` is set (Production scope) → redeploy so the build
   actually bakes it in.
2. **Render** → confirm `GOOGLE_CLIENT_ID` is set → redeploy.
3. **Render** → confirm `JWT_SECRET` is set to a real secret. The code has a hardcoded fallback
   string used only if the env var is missing — if that fallback is what's live in production,
   anyone could forge valid login tokens.
4. **SSLCommerz** → confirm store ID/password and `SSLCOMMERZ_IS_LIVE` are set correctly for
   whichever mode (sandbox vs. live) is intended.
5. **Gmail OAuth refresh token** → if it's ever revoked (via
   [myaccount.google.com/permissions](https://myaccount.google.com/permissions)) or expires from
   long inactivity (possible if the Google Cloud OAuth consent screen is still in "Testing"
   status), rerun `npx tsx src/get-gmail-token.ts <CLIENT_ID> <CLIENT_SECRET>` locally to mint a
   new one and update it on Render.

---

## 9. Security Note — Please Action

`EMAIL_OTP_FIX_SUMMARY.md` (in the project root) currently contains the **real, live**
`GMAIL_OAUTH_CLIENT_SECRET` and `GMAIL_OAUTH_REFRESH_TOKEN` values in plaintext. It is currently
untracked (not yet committed to git), but if it's ever added/committed or the file is shared, it
would leak working credentials to your Gmail account. Recommended:
- Remove the real secret values from that file (replace with placeholders), and/or
- Rotate the Gmail OAuth client secret and refresh token in Google Cloud Console if the file has
  already been shared anywhere, then update Render's environment variables with the new values.

This new summary file deliberately lists environment variable **names only**, not values, to avoid
repeating that exposure.

---

## 10. Repository Map (top level)

```
/                        Frontend (Vite + React), deployed to Vercel
  src/pages/              Route pages, grouped by role (student, admin, library, accounts, shop)
  src/components/         Shared UI + feature components (dialogs, layouts, cards)
  src/lib/                api.ts (backend client), auth-context, user-context, utils
  src/api/                Leftover generated scaffold files (from an unused "zite" SDK import
                           tool) — git-ignored, not part of the live app; the real API layer is
                           the Express backend below.
server/                  Backend (Express + TypeScript), deployed to Render
  src/index.ts             All API routes (~1,880 lines): auth, wallet, payments, admin,
                            library, accounts, shop
  src/lib/                 auth.ts (JWT/PIN helpers), email.ts (Gmail API), prisma.ts (client)
  src/get-gmail-token.ts   One-time local script to mint a Gmail OAuth refresh token
  src/seed-admin.ts        Seeds initial Admin/Staff accounts into Neon
  prisma/schema.prisma     Full database schema (see §5)
```

---

## 11. Commit Timeline (most recent first)

| Commit | Change |
|---|---|
| `33c86e5` | Unified SSLCommerz payment architecture, tiered PIN/OTP auth, role-based route auth |
| `26a8ad2` | Gmail API (OAuth2/HTTPS) replaces SMTP — Render free tier blocks SMTP ports |
| `38f1b2f` | Fix Nodemailer random IPv4/IPv6 selection; try SMTP port 465 |
| `4042ccb` | Revert email delivery from Resend back to Gmail SMTP |
| `ca4fdf2` | Fix server crash when `RESEND_API_KEY` is unset |
| `f81f8f0` | (Temporary) Replace Gmail SMTP with Resend |
| `a9e1bc4` | Fix OTP email latency (30–60s → ~2–3s); always-render Google button |
| `3ab9e51` | Stop silently swallowing email failures; fix inconsistent CORS config |
| `3c01757` | Load `server/.env` explicitly via dotenv |
| `1767551` | Simplify login to Password-or-PIN, drop forced PIN gate |
| `8fa53c4` | Fix TS build error after making `OtpCode.userId` nullable |
| `11eca39` | Fix OTP signup FK crash, add Google Sign-In, PIN-at-login (first design) |
| `311c775` | Cleanup temp script |
| `cf7c718` | Mount routes on `/api` and `/` with JSON 404 fallback |
| `0b86c2a` | Improve API connection diagnostics when backend URL missing on Vercel |
| `c3f4923` | Fix "Unexpected token <" via safe JSON fetch handler |
| `8f2919c` | Add Admin/Staff seed script for Neon |
| `017d864` | Add root `start` script for Render backend deploy |
| `f7260ea` | Initial commit — full-stack app scaffold |

---

*Generated as a consolidated reference. Source detail remains in `AUTH_WORK_SUMMARY.md` and
`EMAIL_OTP_FIX_SUMMARY.md` for the authentication and email work specifically.*
