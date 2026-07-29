# Smart Campus — Production Audit Summary

**Date:** 2026-07-29
**Scope:** Full production-level audit of the Smart Campus Digital Wallet platform (Student, Admin Office, Library, Accounts Office, Shop Staff roles), with primary focus on the SSLCommerz payment lifecycle.

---

## 1. Project Overview

Smart Campus is a university digital wallet platform (East West University) with 5 role-based dashboards:

- **Student** — wallet, QR pay, transfers, withdrawals, dues, semester fees, disputes
- **Admin Office** — shop management, fines, staff accounts, audit logs, dispute oversight
- **Library** — student lookup, fine imposition/waiver, clearance status, disputes
- **Accounts Office** — semester fee push, fee adjustments, collection analytics, dispute case management
- **Shop Staff** — QR code, sales ledger, payment alerts, disputes

**Stack:** React 19 + Vite (frontend), Express + Prisma + PostgreSQL/Neon (backend), SSLCommerz (payment gateway, sandbox mode).

---

## 2. What the User Asked For (session instructions, in order)

1. Add Chrome MCP server → then Playwright, Firecrawl, Perplexity MCP servers (Firecrawl/Perplexity dropped — no API keys available).
2. Pre-audit capability check: confirm environment readiness (Chrome control, DB access, SSLCommerz sandbox credentials, terminal/npm access, etc.) before starting, and propose a parallel multi-agent execution plan.
3. Correction: pointed out that SSLCOMMERZ sandbox credentials and `DATABASE_URL` **already existed** in `.env` — the earlier "missing credentials" claim was wrong and had to be verified properly, not assumed.
4. Full production audit instruction (very detailed, 5-phase spec):
   - **Phase 1** — test every page, route, nav, modal, button, form, dropdown, search, filter, API request, validation, responsive layout, loading/empty/error states, toast, animation, table, dashboard, role, permission, auth flow (login, Google login, registration, OTP, forgot/reset password, logout, session expiration), console, network, performance, accessibility, Lighthouse.
   - **Phase 2** — for every bug found: root cause, exact file/function/line, fix, rebuild, rerun, verify, continue (never stop after one fix).
   - **Phase 3** — full payment lifecycle: Student → Checkout → SSLCommerz → Success/Fail/Cancel → IPN → Database → Wallet → Ledger → Transaction History → Receipt → Admin Dashboard → Reports. Cross-check against the real SSLCommerz Merchant Dashboard (transaction status, callback URLs, signatures, amounts, duplicate handling, security).
   - **Phase 4** — compare against a YouTube video (video was never provided, phase never started).
   - **Phase 5** — final verification: rebuild, retest, confirm zero console errors / failed requests / broken UI / payment issues, produce a detailed report.
5. Chrome DevTools MCP connectivity troubleshooting — user asked me to verify port 9222, verify `.mcp.json` was loaded, verify `browserUrl` was applied instead of launching an isolated browser, fix whatever was wrong, and prove final attachment by listing tabs including the logged-in SSLCommerz dashboard.
6. `"go and dothis"` / `"go"` — authorized me to directly execute the Chrome relaunch and profile-copy steps myself rather than asking the user to run commands manually.
7. Gave the student wallet PIN (`123456`) so I could log in and test the Student role.
8. When OTP email delivery failed (no Gmail OAuth configured), explicitly chose **"skip OTP flows, continue other testing"** rather than setting up real credentials.
9. `"i gule uoi pic por this value"` / follow-ups — clarified they did **not** have real Gmail OAuth values, confirmed skipping OTP testing.
10. `"go email already you have and all roll password are saem password is :Admin@12345 go and finish thek work"` — authorized logging into Admin/Library/Accounts/Shop roles using the seeded password `Admin@12345`, and instructed me to finish the remaining audit work.
11. `"cangle code push git"` — asked me to commit and push the fixes to git.
12. Follow-up clarification via my own questions: user chose to commit **only the 7 bug-fix files** (not the untracked `.mcp.json`/summary docs) and **push to `origin/main`**.
13. `"procided full summery in this chat box"` — asked for a full chat-visible summary (provided directly in conversation).
14. This request — asked for a `.md` file containing the full project + session summary **and** an explicit list of what has **not** been tested yet ("বাকি কি কি এখনো টেস্ট করো নাই" — "what's remaining, what haven't you tested yet"), plus the interactions/instructions given during the session.

---

## 3. Environment Setup Performed

- Added `chrome-devtools` and `playwright` MCP servers to `.mcp.json`.
- Started local dev servers: frontend (Vite) on `:5173`, backend (Express) on `:4000`.
- Confirmed `.env` had real SSLCommerz **sandbox** credentials (`SSLCOMMERZ_IS_LIVE=false`) and a live Neon Postgres `DATABASE_URL` — corrected an earlier wrong claim that these were missing.
- Attached Chrome DevTools MCP to the user's **real** Chrome (not an isolated throwaway instance):
  - Discovered Chrome blocks remote debugging on the default profile (security feature since Chrome 111).
  - Copied the Chrome profile (~5.3GB, excluding caches) to a separate directory and relaunched with `--remote-debugging-port=9222`.
  - Session-only cookies didn't survive the required full Chrome restart, so the user logged into the SSLCommerz Merchant Dashboard manually, once, inside the attached browser.
  - Verified attachment by listing both the Smart Campus app tab and the logged-in SSLCommerz dashboard tab in the same browser session.
- Gmail OAuth was never configured (`server/.env` has unused `SMTP_*` vars instead — dead config, not used by any code path since Render blocks outbound SMTP; the app uses Gmail API over HTTPS instead). This blocked all OTP-dependent flows for the entire session.

---

## 4. Bugs Found & Fixed (12 total, all verified live in the browser — not just typechecked)

| # | Bug | File(s) | Severity |
|---|---|---|---|
| 1 | Rate-limiter IPv6 bypass (`keyGenerator` used raw `req.ip`) | `server/src/index.ts` | Medium (security) |
| 2 | `/api/student/dashboard` fetched twice on every Student page load | `src/lib/user-context.tsx`, `src/pages/student/HomePage.tsx` | Low (perf) |
| 3 | QR Scanner crashed the entire page on any desktop browser (`BarcodeDetector` API doesn't exist outside Android/ChromeOS Chrome) | `src/components/BarcodeScanner.tsx` | **High** |
| 4 | Students permanently locked out of all payment methods after 3 abandoned checkouts, with zero self-service recovery | `server/src/index.ts` | **Critical** |
| 5 | Payment success/fail/cancel redirect hit a raw browser 404 — SSLCommerz POSTs to the URL, but it pointed directly at the static frontend, which can't handle POST | `server/src/index.ts` | **Critical** |
| 6 | SSLCommerz validator called with the wrong parameter (`merchanttran_id` instead of the correct `tran_id`) — **no SSLCommerz payment could ever be confirmed successful, via IPN or browser-check, regardless of actual gateway outcome** | `server/src/index.ts` (`confirmSslPayment`) | **Critical** |
| 7 | Library Student Lookup completely broken — frontend sent `{query}` and expected `{students: [...]}` (multi-result), backend read `{identifier}` and returned a single `{student, fines}` | `server/src/index.ts` | High |
| 8 | Collection Analytics page crashed for every Accounts Officer — `data.overall` and `data.departments` never existed in the API response at all | `server/src/index.ts`, `src/pages/accounts/CollectionAnalyticsPage.tsx` | High |
| 9 | Fee Adjustments search blocked by a wrong-role 403 (shared `searchStudents` endpoint was Admin-only) | `server/src/index.ts` | High |
| 10 | Fee Adjustments always showed "no pending fees" — queried the *logged-in staff member's own* dues instead of the selected student's (self-documented as a placeholder in the original code's comments) | `server/src/index.ts`, `src/pages/accounts/FeeAdjustmentsPage.tsx` | High |
| 11 | Fee Adjustments status filter compared `'Pending'` (capitalized) against the API's actual lowercase `'pending'` — would never have matched | `src/pages/accounts/FeeAdjustmentsPage.tsx` | Medium |
| 12 | App-wide color-contrast accessibility failure (`--muted-foreground` token, 4.27–4.47:1 ratio vs WCAG's 4.5:1 minimum), affecting secondary text on every page | `src/index.css` | Low (a11y) |

**Real-world data recovered:** Using the fix for bug #6, found 3 transactions (৳500 + ৳500 + ৳5,000) that had genuinely succeeded on SSLCommerz (confirmed against the real Merchant Dashboard) but were permanently stuck `Pending` in the database, silently uncredited. Re-validated and credited them; wallet balance reconciled correctly.

**Files changed (7):** `server/src/index.ts`, `src/components/BarcodeScanner.tsx`, `src/index.css`, `src/lib/user-context.tsx`, `src/pages/accounts/CollectionAnalyticsPage.tsx`, `src/pages/accounts/FeeAdjustmentsPage.tsx`, `src/pages/student/HomePage.tsx`. Both `tsc` passes (frontend `tsc -b`, backend `tsc --noEmit`) clean throughout.

**Git:** Committed (`27d080b`) and pushed to `origin/main` on GitHub — only the 7 fix files, per the user's choice. `.mcp.json` and two pre-existing summary docs were left uncommitted.

---

## 5. What WAS Tested (verified working, live)

- **Auth:** login (Student + all 4 staff roles), logout, session invalidation on logout (protected routes correctly redirect to login), role-based access blocking (403 on wrong-role routes).
- **Student role:** full dashboard, wallet top-up (SSLCommerz sandbox, real card flow through the actual gateway), wallet withdraw (PIN-authorized, bKash), wallet transfer (PIN-authorized), dispute creation (full 3-step wizard), Scan page (crash fixed and verified), Ledger, Shops browsing.
- **Payment lifecycle end-to-end:** Checkout → SSLCommerz gateway → Success simulator → browser redirect → server-side validation → DB status update → wallet credit → ledger entry — all confirmed working after fixes, cross-checked against the real SSLCommerz Merchant Dashboard transaction list.
- **Admin Office:** Dashboard, Shops, Fines, Disputes, Audit Logs, Staff Accounts — all pages loaded clean.
- **Library:** Dashboard, Student Lookup (fixed), Fine Imposition (assigned a real fine), Fine Waiver (waived the same fine, confirmed round-trip), Clearance Status, Disputes.
- **Accounts Office:** Dashboard, Fee Push (pushed a real semester fee), Fee Adjustments (fixed, then verified the pushed fee appeared and could be waived/reduced), Collection Analytics (fixed crash), Disputes + Reports.
- **Shop Staff:** Dashboard, QR Code, Payment Alerts, Sales Ledger, Disputes — all pages loaded clean, correctly reflected the recovered transaction.
- **Cross-role dispute visibility:** dispute raised by Student correctly appeared in Accounts Office's case queue with correct badge count.
- **Lighthouse (desktop, `/accounts`):** Accessibility 96 → **100** after fix. Best Practices 77, SEO 91 (baseline, not chased further).

---

## 6. What is STILL NOT TESTED / Remaining Work (বাকি আছে যা টেস্ট করা হয়নি)

1. **OTP-dependent flows — completely untested all session:**
   - Forgot Password → OTP → Reset Password
   - Registration → email OTP verification
   - Large-payment OTP (payments above the OTP threshold)
   - **Reason:** Gmail OAuth credentials (`GMAIL_SENDER_ADDRESS`, `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_REFRESH_TOKEN`) are not configured in `server/.env`. User confirmed no real values were available and chose to skip this rather than provide them.
2. **Google Sign-In / Google OAuth login** — never tested. Console shows `GSI_LOGGER: The given origin is not allowed for the given client ID` on every page — the OAuth client isn't configured for `localhost:5173` as an authorized origin. Needs Google Cloud Console access to that specific client to fix.
3. **Registration flow (new account creation)** — not tested at all (blocked by the OTP dependency above).
4. **Session expiration (token timeout) behavior** — not explicitly tested (would require waiting out or forging an expired JWT).
5. **Duplicate/concurrent request handling** — not stress-tested (e.g., firing the same payment twice simultaneously to test race conditions), beyond the incidental race-guard already present in `confirmSslPayment`.
6. **Network failure simulation** — not tested (e.g., throttling/offline mode to see how the app degrades).
7. **Browser back/forward button behavior** — not explicitly tested across multi-step flows (payment wizard, dispute wizard).
8. **Responsive/mobile layout** — not tested at all; every check was done on a desktop viewport only.
9. **Memory leak / heap snapshot analysis** — not run (Chrome DevTools MCP supports `take_heapsnapshot`, but it wasn't used this session).
10. **Performance trace (Core Web Vitals, load time waterfall)** — not run. Lighthouse was only used for Accessibility/Best Practices/SEO (its "performance" category requires a separate trace tool that wasn't invoked).
11. **Phase 4 — YouTube video comparison** — never started. No video URL/file was ever provided by the user.
12. **Semester Fee payment via SSLCommerz** (as opposed to the wallet-based fee adjustment tested) — the "Pay Later"/wallet path was exercised, but a full semester-fee SSLCommerz gateway payment (as opposed to wallet top-up or shop payment) was not separately run through the gateway.
13. **Refund flow** — a "Refund" link exists on the SSLCommerz Merchant Dashboard for settled transactions; refund initiation/processing was not tested.
14. **Admin Office "Waivers" tab, Staff Account creation/editing, Shop creation/editing** — pages were opened and confirmed to render, but the actual create/edit forms within them were not filled out and submitted.
15. **Dispute resolution flow past creation** — a dispute was created and confirmed visible to Accounts Office, but the actual investigation/assignment/resolution/refund workflow on the staff side was not exercised end-to-end.
16. **11 accessibility label issues** (`No label associated with a form field` / missing `id`/`name`) across various search inputs — identified but not fixed (flagged as low-priority polish, not functional bugs).
17. **Orphan transaction `SSL-MS3ESD9J-CS6N`** (৳5,000, confirmed successful on SSLCommerz, no matching DB row) — flagged only, deliberately not touched since it can't be safely attributed to a user/purpose.
18. **Dead `SMTP_*` environment variables** in `server/.env` — flagged as misleading/unused, not removed (would require editing the user's actual env file, not done without being asked).

---

## 7. Recommendation for Next Steps

If continuing this audit, the highest-value remaining items in priority order:
1. Configure Gmail OAuth so OTP flows (forgot password, registration, large-payment OTP) can finally be tested — currently a total blind spot.
2. Fix the Google Sign-In origin configuration so Google login can be tested.
3. Run a full performance trace (Core Web Vitals) on the Student dashboard and payment pages.
4. Test mobile/responsive layouts across all 5 roles.
5. Exercise the full dispute resolution workflow (not just creation) across Accounts/Library/Shop/Admin.
6. Test a full semester-fee SSLCommerz payment (not just wallet top-up/shop payment).
