# Authentication System — Work Summary

This document summarizes all work done on the Smart Campus authentication system in this session, in chronological order, including what was fixed, what was built, and what still requires action from you (dashboard configuration outside of code).

---

## 1. Fixed: Registration crash (`OtpCode_userId_fkey` violation)

**Symptom:** Clicking "Register Student" threw `Invalid prisma.otpCode.create() invocation: Foreign key constraint violated on the constraint: OtpCode_userId_fkey`.

**Root cause:** `register-otp` created an `OtpCode` row with a placeholder `userId: 'temp-registration'` — but no such user exists yet at that step (the account isn't created until after OTP verification), so the foreign key constraint failed.

**Fix:**
- `server/prisma/schema.prisma` — made `OtpCode.userId` nullable (`String?`), since registration OTPs aren't linked to a user yet.
- `server/src/index.ts` — `register-otp` no longer sets a fake `userId`.
- Schema change pushed live to the Neon database via `prisma db push`.

---

## 2. Added: Google Sign-In (real OAuth, restricted to `@std.ewubd.edu`)

- Backend: `POST /auth/google` — verifies the Google ID token server-side via `google-auth-library`, rejects unverified emails and anything outside `@std.ewubd.edu`, finds an existing user by verified email first (never creates a duplicate), auto-creates a new account if none exists, and links `googleId` to the account.
- Frontend: `@react-oauth/google`'s `GoogleLogin` button, added to both the Sign In and Create Account views, wrapped in `GoogleOAuthProvider` at the app root (`src/App.tsx`), gated so it's skipped safely (no crash) when `VITE_GOOGLE_CLIENT_ID` isn't present at build time.
- Schema additions: `User.authProvider` (`"password"` / `"google"`), `User.googleId` (nullable, unique).
- Env vars introduced: `GOOGLE_CLIENT_ID` (backend), `VITE_GOOGLE_CLIENT_ID` (frontend) — same value, added to `.env.example` files and local `.env` files.

**Your Google Cloud OAuth Client ID (already created):**
`468458804577-r4q1vj4aeupldl5sb47onokrb10svg4e.apps.googleusercontent.com`

**Still required from you (cannot be done from code):**
- Confirm `VITE_GOOGLE_CLIENT_ID` is saved in **Vercel → Project Settings → Environment Variables** (Production scope) and trigger a redeploy — Vite bakes this in at build time, so it only takes effect on a *fresh* build made after the variable is saved.
- Confirm `GOOGLE_CLIENT_ID` is saved in **Render → Environment** and redeploy.
- As of your last screenshot, the button still shows "Google Sign-In isn't configured yet" in production — this confirms the variable isn't live in the current Vercel build yet. This message is intentional, safe fallback code (not a bug) — it will disappear automatically the moment a real deployment has the variable.

---

## 3. Redesigned: Auth card UI

- Removed the old Sign In / Register Student tab switcher.
- **Sign In is now the default view**, with a "New to Smart Campus? Create an account" link leading to registration.
- Added a **Back arrow** (top-left of the auth card only) that steps back through the flow (registration → sign in, OTP step → previous step, forgot password → sign in). This button is local to the auth card component — it does not touch app/router navigation or any other page.
- Theme, spacing, and visual design kept consistent with the rest of the app (same glass-card style, same color tokens).

---

## 4. Login flow — final design: Password **or** Wallet PIN

After iterating on the login/PIN design per your explicit spec, the final behavior is:

- Login form: **EWU Email/Student ID** + a single **"Password or Wallet PIN"** field.
- Backend (`POST /auth/login`) accepts either credential: tries the account password first (bcrypt), and if that fails, tries it as a 4-digit Wallet PIN (only if one has been set). Either match logs the user in.
- New accounts log in with just their password until they choose to set a PIN.
- Wallet PIN is created/changed from **Wallet Settings** (`ProfilePage.tsx`) — unchanged, pre-existing feature, untouched by this work.
- Once a PIN exists, it and the password are fully interchangeable for login.
- Failed login always returns the same generic message: `"Invalid Password or Wallet PIN."`
- Google Sign-In authenticates in a single step (no separate PIN step) once the account's email/domain is verified.
- This UI was explicitly **not changed** in the later audit pass, per your instruction.

*(Earlier in this session a different design was implemented first — password AND PIN required together, with a mandatory PIN-setup gate right after signup — before you clarified the requirement. That version was fully replaced by the Password-or-PIN design above; nothing from the earlier version remains active.)*

---

## 5. Fixed: Render deploy failure (TypeScript build error)

**Symptom:** Render build failed with `Type 'string | null' is not assignable to type 'string | undefined'` in the password-reset route.

**Root cause:** A direct consequence of making `OtpCode.userId` nullable (fix #1) — `otp.userId` became `string | null`, but the password-reset route used it as a definitely-`string` value.

**Fix:** Added a null guard before using `otp.userId`. Verified with a clean `tsc` build matching Render's exact build command.

---

## 6. Fixed: `server/.env` was never actually loaded locally

**Discovered while testing Google Sign-In locally** — the app "worked" before only because `JWT_SECRET` has a hardcoded fallback and Prisma resolves `DATABASE_URL` internally on its own; every *other* env var (`GOOGLE_CLIENT_ID`, `SMTP_*`, etc.) was silently `undefined` in local dev.

**Fix:** Added `import 'dotenv/config'` as the first import in `server/src/index.ts`, and added `dotenv` as an explicit dependency. This only affects local development — Render injects environment variables directly into the container, so production was never affected by this particular gap.

---

## 7. Fixed: Registration OTP emails could silently fail

**Symptom you reported:** "Registration succeeds but no OTP email arrives."

**Root cause:** `sendEmail()` (`server/src/lib/email.ts`) caught every SMTP error internally and only logged it server-side — it never told the calling route. So `/auth/register-otp` always returned `{"success":true}` even when the email genuinely failed to send.

**Verified:** Your actual Gmail SMTP credentials work correctly — `transporter.verify()` succeeded and a real test send returned `250 OK` from Gmail. So the mechanism itself is sound; the bug was purely that failures were invisible.

**Fix:**
- `sendEmail()` now throws a descriptive error instead of swallowing it.
- Registration OTP, password-reset OTP, and the generic in-app OTP endpoint each catch that error, **delete the now-useless OTP row** (no dangling code the student never received), and return a clear `502` with the real failure reason instead of a false success.
- Purely informational emails (welcome email, payment/transfer receipts) remain best-effort by design — those don't block a critical flow and shouldn't fail the whole request.

**Still required from you:** Confirm `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` are all set correctly in **Render → Environment**. If they're missing or wrong there, registration OTP emails will now fail *loudly* with the exact reason instead of pretending to succeed — check that message if it still doesn't work after redeploying.

---

## 8. Fixed: Inconsistent CORS configuration

**Found during audit:** `cors({ origin: '*', credentials: true })` — this combination is invalid for browsers when a request actually sends credentials (cookies). This app is Bearer-token-only (JWT in the `Authorization` header, no cookies anywhere), so it was harmless in practice, but technically inconsistent.

**Fix:** Changed to `credentials: false` to match actual behavior.

---

## 9. Security note flagged (not a code change — needs your confirmation)

`JWT_SECRET` falls back to a hardcoded default string if the environment variable isn't set. That fallback value is visible in the public source code. **Please confirm `JWT_SECRET` is actually set to a real secret in Render's environment variables** — if it's missing, anyone could forge valid login tokens for any account.

---

## Summary — what's done vs. what's left

| Area | Status |
|---|---|
| Registration crash (FK constraint) | ✅ Fixed, verified against live database |
| Render build failure | ✅ Fixed, verified with exact build command |
| Password OR Wallet PIN login | ✅ Implemented and verified live |
| Google Sign-In — backend logic | ✅ Implemented and verified live |
| Google Sign-In — frontend rendering | ⏳ Code correct; needs `VITE_GOOGLE_CLIENT_ID` confirmed in Vercel + redeploy |
| Email OTP silent failure | ✅ Fixed — real errors now surfaced instead of hidden |
| Email OTP actually arriving in production | ⏳ Needs `SMTP_*` vars confirmed in Render |
| Local `.env` loading | ✅ Fixed |
| CORS configuration | ✅ Fixed |
| JWT secret strength | ⏳ Needs your confirmation in Render |

### Everything pushed to GitHub (`main` branch), commits this session, in order:
1. `11eca39` — Fix OTP signup FK crash, add Google Sign-In, require Wallet PIN at login (first design)
2. `8fa53c4` — Fix TS build error in forgot-password reset (nullable `userId`)
3. `1767551` — Simplify login to Password-or-PIN, drop forced PIN gate, streamline Google auth (final login design)
4. `3c01757` — Load `server/.env` explicitly via dotenv
5. `3ab9e51` — Stop silently swallowing email failures; fix inconsistent CORS config

### The only remaining actions are dashboard configuration, not code:
1. Vercel → confirm `VITE_GOOGLE_CLIENT_ID` is set → redeploy
2. Render → confirm `GOOGLE_CLIENT_ID` is set → redeploy
3. Render → confirm `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` are set correctly
4. Render → confirm `JWT_SECRET` is set to a real secret (not left blank)

I have no Vercel/Render dashboard or CLI access from this environment, so these four items need to be checked/set by you directly. Once done, share what you see (success, or any new error message) and I'll help verify or debug further.
