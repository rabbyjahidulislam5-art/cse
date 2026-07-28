# OTP Email Delivery Fix — Full Summary

This document summarizes the investigation and fix for OTP emails failing to deliver in production on Render, in chronological order.

---

## 1. The problem

Render logs showed every OTP email (registration, forgot-password) failing:

```
[Email] SMTP transporter setup FAILED at startup: Connection timeout
Error: Connection timeout
code: 'ETIMEDOUT'
command: 'CONN'
```

Requests to `register-otp` / `forgot-password/otp` were exceeding the 6-second response budget and ultimately failing in the background, meaning students never received their verification codes.

---

## 2. Investigation

Checked, in order, ruling each out with evidence rather than assumption:

| Area | Finding |
|---|---|
| Env var loading / dotenv order | Correct — `dotenv/config` was the first import; all `SMTP_*` vars loaded as expected. |
| `SMTP_HOST` exact value, `SMTP_PORT` parsed as number, `secure = port===465` | All correct in code. |
| `transporter.verify()` / error logging | Already implemented and firing correctly — the log message *was* this diagnostic working as designed. |
| DNS resolution / IPv4 vs IPv6 | A prior session had already found and fixed a real bug here: Nodemailer 9's internal resolver picks IPv4 **or** IPv6 at random regardless of the `family` option. Fixed by resolving the hostname to a literal IPv4 address ourselves (`dns.promises.lookup`) and handing Nodemailer that literal IP. |
| Port 465 vs 587 | Tried both (587+`family:4`, then 465 with the IPv4 pin above). Both failed identically. |
| Credentials / Gmail App Password | Independently verified working from a local machine in an earlier session (`transporter.verify()` succeeded, a real send returned `250 OK`). |
| Nodemailer version, TLS config | Current version (9.0.3); irrelevant anyway since the failure happens *before* TLS negotiation. |

**Key diagnostic signal:** the error's `command: 'CONN'` means the failure is at the raw TCP handshake stage — before EHLO, TLS, or AUTH. Two structurally different fixes (family forcing, then literal-IP pinning) both hit this identical wall, which rules out every application-level cause above.

### Root cause, confirmed

Searched Render's own changelog and community docs directly rather than relying on assumption:

> **Render's free-tier web services block all outbound traffic to SMTP ports 25, 465, and 587**, effective September 26, 2025.
> — [render.com/changelog/free-web-services-will-no-longer-allow-outbound-traffic-to-smtp-ports](https://render.com/changelog/free-web-services-will-no-longer-allow-outbound-traffic-to-smtp-ports)

Confirmed the project's Render service is on the **Free** plan. This is an infrastructure-level firewall rule enforced before a packet ever reaches Gmail — no Nodemailer configuration, DNS fix, retry logic, or timeout adjustment can open a port the platform itself drops. Render's own stated fix is upgrading to a paid instance type.

---

## 3. Options considered

| Option | Outcome |
|---|---|
| Switch to Resend (HTTP API provider) | Implemented first, then explicitly rejected — the user wanted to keep using their own Gmail account, not a third-party provider, and Resend's sandbox mode previously couldn't deliver to real `@std.ewubd.edu` students without a verified domain (the same limitation that caused an earlier revert, before this session). |
| Upgrade Render to a paid plan | Would fully restore raw SMTP with zero code changes — declined; staying on the free tier was a hard requirement. |
| **Gmail API over OAuth2/HTTPS** | **Chosen.** Still the user's real Gmail account, no third-party provider, sends over HTTPS (443) which Render's free tier does not block. Not literally SMTP (which is impossible on this plan at any port), but the closest possible thing to "Gmail SMTP" that can actually work here. |

---

## 4. The fix

Replaced Nodemailer/SMTP entirely with Gmail's REST API (`gmail.googleapis.com`), authenticated via OAuth2 refresh token instead of an SMTP app password.

### Files changed
- **`server/src/lib/email.ts`** — rewritten. Uses `google-auth-library`'s `OAuth2Client` (already a dependency, previously only used for Google Sign-In) to refresh an access token, then POSTs a base64url-encoded MIME message to `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send`. `sendEmail(to, subject, body)` keeps its exact original signature and throw-on-failure contract — **no changes needed anywhere else in the app** (OTP logic, database, auth, frontend all untouched). Logs each stage (`oauth-token-refresh`, `gmail-api-send`) separately with timing.
- **`server/src/get-gmail-token.ts`** (new) — one-time local script. Runs a tiny loopback HTTP server, opens the Google OAuth consent URL, captures the callback, exchanges the code for a refresh token, and independently re-verifies that the refresh token alone can mint a fresh access token. Not deployed, not imported by `index.ts`.
- **`server/package.json`** — removed `nodemailer`, `@types/nodemailer`, and `resend`. No new dependency was needed (reused `google-auth-library`).
- **`server/.env.example`** — replaced `SMTP_*`/`RESEND_*` with the 4 Gmail OAuth vars below.
- **`server/src/index.ts`** — one stale comment corrected (referenced Resend from an earlier iteration); no logic changes.

Committed as `26a8ad2` on `main` and pushed, triggering Render's auto-deploy.

### Render environment variables

**Deleted:**
```
SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, RESEND_API_KEY, RESEND_FROM_EMAIL
```

**Added:**
```
GMAIL_SENDER_ADDRESS=your-email@gmail.com
GMAIL_OAUTH_CLIENT_ID=your-google-oauth-client-id
GMAIL_OAUTH_CLIENT_SECRET=your-google-oauth-client-secret
GMAIL_OAUTH_REFRESH_TOKEN=your-google-oauth-refresh-token
```

(Client ID/secret came from a new Google Cloud OAuth 2.0 "Desktop app" credential with the Gmail API enabled; the refresh token was generated by running `get-gmail-token.ts` once and completing the consent flow in a browser.)

---

## 5. Verification

**Local, before deploying:** ran the actual `sendEmail()` function directly with the real credentials against 4 different email formats used across the app (registration OTP, forgot-password OTP, generic OTP, and a transfer notification exercising non-ASCII subject encoding via the ৳ symbol). All 4 delivered with real Gmail API message IDs; OAuth token refresh cached correctly (0ms on repeat calls).

**Production, after deploying:**
- `GET /health` → confirmed the service was up post-deploy.
- `POST /auth/forgot-password/otp` with `{"identifier":"2023-2-60-053@std.ewubd.edu"}` against the live Render URL → `200 {"success":true,...}` in **2.6 seconds** (vs. the old behavior of always exceeding the 6-second budget and ultimately failing).
- **Inbox confirmed by the user**: the OTP email was actually received.

---

## 6. Remaining notes

- This uses Gmail's HTTPS API, not literal SMTP protocol — SMTP itself is not possible on Render's free tier at any port with any code, which is why the transport had to change. It is still exclusively the same real Gmail account, with no third-party email provider involved.
- If the OAuth refresh token is ever revoked (e.g., via [myaccount.google.com/permissions](https://myaccount.google.com/permissions)), rerun `npx tsx src/get-gmail-token.ts <CLIENT_ID> <CLIENT_SECRET>` locally to mint a new one and update `GMAIL_OAUTH_REFRESH_TOKEN` on Render.
- The Google Cloud OAuth consent screen is presumably still in "Testing" publish status — tokens for test users/apps in that state can expire after 7 days of inactivity in some configurations; if sends start failing after a long idle period, check this first before assuming a new bug.
