# Enterprise Audit & Multi-Tab Isolation — Work Summary

This document summarizes two related pieces of work done in this session: a full-app production
audit across all 5 dashboards, and a fix for cross-tab session isolation. It follows the same
format as `AUTH_WORK_SUMMARY.md`, `DISPUTE_SYSTEM_SUMMARY.md`, and `PRODUCTION_AUDIT_SUMMARY.md` —
a session record, not a design proposal.

---

## Part 1 — Enterprise Production Audit

Read all existing summary docs (`AUTH_WORK_SUMMARY.md`, `DISPUTE_SYSTEM_SUMMARY.md`,
`EMAIL_OTP_FIX_SUMMARY.md`, `PAYMENTS_DASHBOARD_SUMMARY.md`, `PRODUCTION_AUDIT_SUMMARY.md`,
`PROJECT_DEPLOYMENT_SUMMARY.md`, `QA_SWEEP_SUMMARY.md`) to establish what had already been fixed
across prior sessions, then did a fresh pass: static code audit, config fixes, and a live
Playwright sweep of all 40+ routes across Student, Admin, Library, Accounts, and Shop dashboards
using real seeded logins.

### Fixed

| # | Issue | Fix |
|---|---|---|
| 1 | No `vercel.json` existed — any refresh or direct URL hit on a nested route (e.g. `/admin/disputes`) returned Vercel's raw 404 on every dashboard | Added `vercel.json` with a SPA rewrite (all non-asset paths → `index.html`), immutable long-cache on hashed assets, no-cache on `index.html` (prevents a stale open tab from referencing a deleted bundle after a redeploy) |
| 2 | No global session-expiry handling — an expired/invalid JWT surfaced as scattered per-page fetch errors instead of a clean logout | `src/lib/api.ts` now calls a registered handler on any 401, which logs the tab out and drops it to the login card |
| 3 | `JWT_SECRET` silently falls back to a hardcoded string (visible in public source) with no signal if the real env var is missing | Added a loud, non-blocking startup warning in `server/src/index.ts` |
| 4 | 13 search/filter inputs across the app had no accessible label (flagged in an earlier audit, never fixed) | Added `aria-label` matching each input's placeholder |
| 5 | Cross-role layout guards (Admin/Accounts/Shop/Library) let the wrong-role dashboard's children mount and fire their data fetch (403) before the redirect landed, flashing a "Failed to load overview" error toast | Guard now blocks render until the role check passes |
| 6 | `StudentLayout` had **no role guard at all** — any staff account navigating to `/student` would fetch and render using their own (non-student) account's data | Added the same guard pattern as the other 4 layouts |

### Flagged, not touched (needs a product decision, not a code guess)

- **Shop model has no owner/staff link.** Every shop-staff route does
  `prisma.shop.findFirst({ status: 'Active' })` — the first active shop in the whole table. Fine
  with 1 shop, breaks the moment a 2nd exists (staff sees each other's live QR/ledger). Fixing this
  means adding an `ownerId` column and being told which staff account owns which shop — guessing
  wrong grants one shop's staff access to another shop's data, which is worse than the current gap.
- Google Sign-In still fails on `localhost` (OAuth client not configured for that origin) —
  pre-existing, needs Google Cloud Console access, not fixable from code.
- Dead `SMTP_*` vars in `server/.env` — untouched, it's a local secrets file.
- Not exercised this session: real SSLCommerz money movement, mobile/responsive viewports, refund
  flow, a full semester-fee SSLCommerz payment. This pass was a static/live-nav audit — no live
  sandbox transaction was run.

### Verification

`tsc -b` (frontend) and `tsc --noEmit` (backend) both clean. `vite build` succeeds. Live Playwright
sweep of all routes across all 5 roles: zero console errors on any page.

---

## Part 2 — Multi-Tab Session Isolation

### The problem, as reported

"Logging in, logging out, navigating to another page, or changing dashboards in one browser tab
automatically changes every other open tab." Expected: each tab keeps its own independent route,
history, and UI state (like Gmail/Facebook/banking apps), while authentication for the *same*
account is allowed to be shared.

### Root cause

Route/history/modal state was never actually shared — `BrowserRouter` is natively per-tab, and no
`BroadcastChannel`, `storage` listener, or state-sync library existed anywhere in the codebase.

The real cause was one level down: **the HTTP credential itself.** Four separate places read
`localStorage.getItem('auth_token')` fresh on every call:

- `src/lib/api.ts` — every REST call
- `src/lib/disputeApi.ts` — every dispute-module call (separate client, same pattern)
- `src/lib/socket.ts` — every socket (re)connect
- `src/lib/auth-context.tsx` — initial mount only

`localStorage` is shared by every tab of the same origin. So a login, logout, or account switch in
one tab immediately changed which account *every other open tab* authenticated as on its very next
request — the tab's own UI kept showing its own route, but the data coming back (and the identity
enforcing role guards) started belonging to a different account. That's what looked like "tab B's
dashboard changed."

### The fix

**`src/lib/auth-token.ts`** (new) — the single source of truth each tab uses for outgoing
requests. A module-level in-memory token, captured once from `localStorage` at load (so a new tab
opened while already logged in still inherits the session, same as Gmail), and after that changed
only by this tab's own explicit auth actions or the controlled listener below — never by a live
`localStorage` read on every request.

`api.ts`, `disputeApi.ts`, and `socket.ts` were all switched to read from this instead of
`localStorage` directly.

**`auth-context.tsx`** — added the one deliberate, controlled cross-tab hook (a `storage` event
listener), which only ever does one of three things:

1. **Same account logs out elsewhere** (the token removed matches this tab's own account, checked
   via `e.oldValue`) → this tab's session actually ended, so it propagates — the same way
   Gmail/Facebook/banking apps end every open tab's session when you sign out of one.
2. **A different account logs in elsewhere** → ignored entirely. This tab keeps its own session,
   route, and in-progress workflow untouched — this is the specific behavior that was broken
   before.
3. **The same account's token changes elsewhere** (re-login, refresh) → adopted silently, since
   it's still the same person's session, not an identity switch.

Every login/logout/register/reset-password code path in `auth-context.tsx` was updated to keep the
in-memory token in sync with `localStorage`.

**Adjacent bug fixed in the same code path:** `handleLogin` only called the token setter when
"Remember Me" was checked, but React state (`user`/`token`) was set unconditionally — with
Remember Me unchecked, the tab's own subsequent API calls would have had no token at all. Now the
in-memory token is always set; "Remember Me" only controls whether it's *persisted* to
`localStorage` for a future new tab/restart.

### Verification

Live-tested with two real, simultaneously open browser tabs (Playwright), using a `window` marker
to rule out Chrome discarding a backgrounded tab (which reloads it from scratch and is expected,
unavoidable behavior for *any* localStorage-based multi-tab auth — indistinguishable from a fresh
page load, and not something to fix without abandoning shared-auth-across-tabs entirely):

- Tab A on `/student/ledger`, Tab B opened fresh on `/student/disputes` — inherited the shared
  login automatically, both tabs independent.
- Tab B logs into a **different** account (Admin) — Tab A's marker survived (proving no reload
  happened) and it stayed on `/student/ledger` as Student, completely unaffected.
- Tab B (same account as Tab A) **logs out** — Tab A correctly dropped to the login card.

`tsc -b`, `tsc --noEmit`, and `vite build` all clean after the change. A normal single-tab
login → navigate → logout flow was re-verified working after all changes.

### Repository map (new/changed, this session)

```
vercel.json                          New — SPA rewrite + cache headers
src/lib/auth-token.ts                New — per-tab in-memory auth token, single source of truth
src/lib/api.ts                       Read from auth-token.ts instead of localStorage; 401 → session-expiry handler
src/lib/disputeApi.ts                Same
src/lib/socket.ts                    Same, for socket (re)connect
src/lib/auth-context.tsx             In-memory token kept in sync on every login/logout path;
                                      controlled cross-tab storage listener; Remember-Me token fix
server/src/index.ts                  Loud JWT_SECRET fallback warning at startup
src/components/*Layout.tsx           Cross-role guards now block render before mount (all 5 layouts)
13 page/component files              aria-label added to unlabeled search inputs
```
