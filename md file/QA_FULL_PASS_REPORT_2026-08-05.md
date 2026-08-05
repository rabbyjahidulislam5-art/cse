# Smart Campus Payment System — Full QA & Bug-Fix Pass Report

**Date:** 2026-08-05
**Scope:** A complete QA pass across the existing, stable EWU Smart Campus platform — fix the
reported dispute-visibility bug, verify the full notification flow (dashboard + email + OTP +
fee/scholarship), sweep for remaining small bugs/edge cases/responsiveness gaps, and produce two
Excel test-case workbooks (Fee Push, Scholarship Push) plus this report — without touching
architecture, design/theme, navigation, auth flow, schema (beyond this repo's own established
additive-only convention), API contracts, payment logic, notification logic, or business rules.

This document follows the same session-record format as the 18 prior `.md` files at the repo
root, all of which were read in full before any investigation began.

---

## 1. Scope & Method

Three parallel read-only investigations traced (a) the dispute message/notification pipeline end
to end across server and client, (b) the full notification/email pipeline (dashboard, email, OTP,
fee/scholarship push), and (c) the exact validation surface of Fee Push and Scholarship Push. Two
bugs were root-caused and precisely located before any code was touched. A Plan review then
sequenced the work: fix the two confirmed bugs first (lowest risk, already understood), then run a
**bounded** sweep — not a full re-audit — built from each prior session's own documented "not
tested" / "flagged, not touched" / "verified only by code inspection" items, since six prior
sessions already fully audited every dashboard and fixed ~35 bugs between them. Re-clicking
everything they already covered would have wasted time and risked "fixing" correct code; instead,
this pass explicitly targeted the gaps those sessions themselves named.

**Testing types covered:** Unit and Integration (full existing Vitest suite, 160 tests), System/
E2E (full existing Playwright suite, 13 specs, run headless via `@playwright/test`'s own browser —
see §4), Functional and API (live `curl`/JWT-authenticated calls against the real running
localhost backend and the real shared Neon dev database, for every fix and every sweep item),
Regression (full suite re-run after every change, not just once at the end), Validation (every Fee
Push/Scholarship Push rule, live-executed with real crafted CSV files — see the two workbooks),
Smoke (all 5 role logins, both core money-movement flows), Security/Auth (role-gate and
self-scoping checks, reviewed and spot-verified). **UAT-equivalent:** every fix and sweep finding
was exercised as a real staff/student would use it — real login, real file upload, real button
action via the API a real click ultimately calls — not just asserted in isolation.

**Environment note affecting verification:** the interactive browser-automation tool
(chrome-devtools/Playwright MCP) was unavailable this session (a pre-existing browser instance
held an exclusive lock this session could not safely resolve without risking an unrelated
process). Per explicit user direction, verification proceeded via direct API/DB calls plus static
code review for anything that would otherwise have needed a live visual click-through — this is
called out per-item below and in each workbook's Remarks column. Separately, the actual Playwright
**test runner** (`@playwright/test`, distinct from the interactive MCP tool) was still available
and used to re-run the full existing 13-spec E2E suite headlessly — this gave real, automated,
rendered-browser coverage across all 5 roles even without interactive access.

---

## 2. Bugs Found and Fixed This Pass

| # | Area | Bug | Fix | Severity | Verification |
|---|---|---|---|---|---|
| 1 | Dispute system (the user's reported issue) | `useDisputeRoom` — the Socket.IO hook built specifically to join a case's room and receive live message/status updates — had **zero call sites** anywhere in the frontend. Server-side emit (`recordTimeline()` → `dispute:timeline` on room `dispute:${id}`) was fully correct and already working; only the client subscription was missing. Net effect: a message/note submitted by one party never appeared in another party's already-open Admin/Accounts (or Student/Library/Shop) dispute detail page without a manual reload — exactly the reported symptom. | Added `useDisputeRoom(disputeId, () => load())` to all 5 dispute detail pages (`src/pages/{student,accounts,admin,library,shop}/*Dispute*DetailPage.tsx`), reusing each page's own existing `load()` refetch function. 2-line, purely additive diff per file. | **High** (this session's primary reported bug) | Live-verified with a real `socket.io-client` connection: joined the exact `dispute:<id>` room, fired a real HTTP reply via the actual API, and confirmed the `dispute:timeline` event arrived instantly. `tsc -b` clean; full backend suite unaffected (frontend-only change). |
| 2 | Fee Push notifications | Fee Push's push-execution route created only an in-transaction `Notification` DB row — no email, no realtime Socket.IO emit — unlike the near-identical Scholarship Push, which already did both. Students got no email and no instant bell-badge bump when a semester fee was imposed (only a 30s poll). | Mirrored Scholarship Push's exact pattern: collect `{studentId, amount, feeLabel, dueDate}` per item during the transaction, call `notifyUser()` (in-app + realtime + best-effort email) once **after** the transaction commits. Removed the old in-tx notification-create block so students aren't double-notified. | Medium | Pushed a real 2-student batch; confirmed via direct DB query exactly 1 `Notification` row per student (category=Fee, type=SemesterFeePushed, correct body/link), no duplicates. Targeted Fee Push suite (33 tests) + full suite (160/160) green before and after. |
| 3 | Fee Push due-date parsing | ExcelJS parses a date-formatted spreadsheet cell as a native JS `Date` object, not a string. `parseImportRows` blindly called `String(dateObj)` on it, producing a garbled `"Sun Aug 30 2026 00:00:00 GMT+0000 (Coordinated Universal Time)"` instead of a clean date — this then flowed into `FeeInvoice`, `SemesterFee`, and the new push notification untouched. `isValidCalendarDate()`'s fallback to `Date.parse()` meant this passed validation silently, so it went undetected until now. | Added a small `formatDueDateCell()` helper: formats a `Date` instance as `YYYY-MM-DD`, matching this codebase's own due-date convention, before falling through to the existing string handling. | Medium | Reproduced live against a real ExcelJS-generated date cell (confirmed `instanceof Date` on the raw parsed value) — before: garbled string; after: clean `"2026-08-30"`. Two real DB rows created earlier in this session (before the fix) retain the old garbled text as historical data, per this codebase's own established "don't retroactively rewrite past data" convention. |
| 4 | Fee Push & Scholarship Push concurrency | Neither push route had a claim-lock before its expensive multi-item transaction. Firing two near-simultaneous push requests on the same batch (double-click, or two staff acting at once) let both start their own `$transaction` against the same rows — reproduced live: **both** attempts failed with raw Prisma transaction errors (one hit the transaction timeout, the other "transaction already closed") instead of one succeeding and the other cleanly rejecting. Atomicity itself held (no corrupted/partial data), but the failure mode was messy and leaked internal error text. | Added an atomic claim (`updateMany` guarded on the exact pre-push status just read, flips to a transient `'Pushing'` status) before the transaction in both `routes/fees.ts` and `lib/scholarshipService.ts`; reverted on failure so a genuinely failed push is never stuck. A third-request-arrives-mid-push edge case (reading the transient status itself) is explicitly guarded against too. | **High** | Reproduced the original failure live (both concurrent requests 500'd), applied the fix, reproduced again — one request now succeeds, the other gets a clean `409 "This batch is already being pushed by another request."` DB-verified no corruption in either case. |
| 5 | Fee Push & Scholarship Push transaction timeout | A **solo, zero-concurrency** push of a full 20-item batch (the exact size of this app's own sample import file, `sample_20_students_fee.xlsx`) took ~36 seconds and exceeded the existing 30-second transaction timeout, aborting mid-loop with a raw error — this is the same bug class a prior session already fixed once (bumping the default 5s Prisma timeout to 30s), now recurring because per-item latency grew past the new ceiling too. | Bumped `{ timeout: 30000 }` → `{ timeout: 60000 }` in both `routes/fees.ts` and `lib/scholarshipService.ts` (Scholarship Push's identical constant bumped proactively for consistency, since it shares the exact batch-loop shape). | **Critical** (this app's own sample-size batch could not reliably push at all) | Reproduced live (36s, failed at the 30s ceiling), applied the fix, re-ran the exact same 20-item batch solo — completed in ~54s, safely under the new 60s budget. All 20 items/invoices confirmed correctly created via direct DB query. |
| 6 | Fee Push approval workflow | `validateApprovalWorkflowPermissions()`'s "full access" bypass checked for the literal role string `'Admin'`, but the real `User.role` value in this app is `'Admin Office'`. An Admin Office staff member could reach the endpoint (route-gated to allow both `'Accounts Office'` and `'Admin Office'`) and successfully `SUBMIT_FOR_REVIEW`, but was silently `403`'d on `APPROVE_BATCH`/`REJECT_BATCH` — a real authorization inconsistency between route-level and workflow-level access control. | Broadened the check to `userRole === 'Admin' || userRole === 'Admin Office'` and widened the function's type signature to match. | High | Reproduced live (`403 "Only Approver role can approve or reject fee push batches"` as a real Admin Office user), applied the fix, re-tested — `200 {"status":"Approved"}`. |
| 7 | Fee Push & Scholarship Push amount validation | The amount-parsing regex (`.replace(/[^0-9.]/g, '')`, identical in both `feeManagementService.ts` and `scholarshipService.ts`) stripped the minus sign from a negative input **before** the "Amount must be positive" check ever ran — e.g. `-500` silently became `500` and was accepted as a valid positive amount instead of being rejected. Discovered live while building the Fee/Scholarship Push test workbooks. | Changed the regex to `.replace(/[^0-9.-]/g, '')` in both files, preserving a leading minus sign so the existing `amount <= 0` check actually sees it. | **High** | Reproduced live in both features (`-500`/`-100` silently became `500`/`100`, status "Valid"), applied the fix, re-tested — both now correctly show the true negative value and reject with "Amount must be positive". |
| 8 | Admin/Library Waiver messages | Rejecting a disputed fine returned the message `"Waiver rejectd"` (a template-string typo: `` `Waiver ${action}d` `` → "reject" + "d" = "rejectd"). | Replaced the template with explicit `'Waiver approved'` / `'Waiver rejected'` strings. | Low | Reproduced live, fixed, re-tested — now returns `"Waiver rejected"`. |
| 9 | Responsiveness — Fee Push wizard | Both wide (7-column) tables on Steps 2 and 3 of the Fee Push wizard had `overflow-y-auto` only — no horizontal scroll guard — a real overflow risk at 320–390px mobile widths. | Changed both containers to `overflow-auto` (both axes). | Medium | Found and fixed via static Tailwind-class review (no live browser this session — see §1). Same minimal-class-change pattern as 4 prior responsive fixes already in this repo's history. |
| 10 | Responsiveness — Collection Analytics | The department breakdown list used a bare `grid-cols-5` with no responsive breakpoint at all (unlike the sibling `LibraryFinesPage.tsx`, which already correctly collapses at `md`) — a real overflow risk for long department names at narrow widths. | Hid the desktop header row below `md`, changed the row grid to `grid-cols-2 md:grid-cols-5`, and added inline mobile labels ("Students:", "Collected:", "Outstanding:") so information isn't lost when the header hides. | Medium | Found and fixed via static code review; `tsc -b` clean. |

**Bugs #3, #4, #5, #7 were not part of the original plan** — they were discovered live while
verifying Fixes #1/#2 and while building the two Excel workbooks with real test data, then
root-caused, fixed, and re-verified with the same rigor as the two planned fixes.

---

## 3. Test Cases Executed

Two Excel workbooks at the repo root, each with Test ID / Module / Preconditions / Test Steps /
Input Data / Expected Result / Actual Result / Status / Priority / Severity / Bug Reference /
Remarks columns, generated programmatically via `server/src/generate-qa-workbooks.ts` (uses
`exceljs`, matching this codebase's existing report-generation style in
`routes/disputes/shared.ts`) so the columns and structure are consistent and regenerable:

- **`Fee_Push_Testing.xlsx`** — 50 test cases. Status breakdown: 45 Pass, 5 Not Executed, **0
  Fail** (every bug found during this pass was fixed and re-verified before being recorded).
- **`Scholarship_Push_Testing.xlsx`** — 29 test cases. Status breakdown: 26 Pass, 3 Not Executed,
  **0 Fail**.

Every "Pass" row is one of: (a) live-executed this pass against the real running backend with a
real crafted CSV/API call, with the actual raw response recorded in the Actual Result column; (b)
verified by the existing, already-passing automated Vitest suite (cited by exact file name); or
(c) verified by direct code-path review where no live execution was possible or necessary
(security/authorization boundary checks that are unchanged, pre-existing behavior). Rows marked
**"Not Executed"** are honestly flagged as needing a real browser file-picker/drag-drop
interaction (wrong file extension, corrupt binary, oversized file, quoted-comma CSV edge cases,
.xlsx upload through the actual UI) — not fabricated as Pass, per this session's no-live-browser
constraint (§1).

---

## 4. Regression Verification

Run once as a baseline before any change, and again after every change:

| Gate | Before | After |
|---|---|---|
| Backend Vitest (`cd server && npm test`) | 160/160 passing | **160/160 passing** |
| Frontend typecheck (`npx tsc -b`) | clean | **clean** |
| Backend typecheck (`npx tsc --noEmit`) | clean | **clean** |
| Frontend production build (`npx vite build`) | — | **succeeded** (9.38s, all chunks emitted) |
| Playwright E2E suite (`npx playwright test`, 13 specs) | — | **13/13 passing** (1.8m), 5 role-login smokes + 2 core-flow smokes (dues payment, wallet top-up) + 5 golden-path feature specs, headless via the real `@playwright/test` browser (separate from the unavailable interactive MCP tool) |

Additionally, after each individual fix, the narrowest relevant suite was re-run immediately
(e.g. the 5 Fee Push test files after every Fee-Push-adjacent change; `scholarshipValidation.test.ts`
+ `scholarshipPushIntegration.test.ts` after the Scholarship Push changes) — this caught nothing
new beyond what's listed in §2, confirming each fix was correctly isolated.

**Live manual/API verification performed for every fix** (not just automated tests): a real
`socket.io-client` connection for the dispute fix; real batch pushes against the real Neon dev
database for the notification, concurrency, timeout, and due-date fixes; real login + real API
calls as Admin Office and Accounts Office for the approval-workflow and waiver-message fixes; real
crafted CSV uploads through the actual validate endpoints for the negative-amount fix and the bulk
of both Excel workbooks.

---

## 5. Responsiveness Findings

| Viewport / Area | Method | Result |
|---|---|---|
| Fee Push wizard (Steps 2 & 3 tables) | Static Tailwind-class review | **Fixed** — missing `overflow-x` on two 7-column tables (see §2 #9) |
| Scholarship Push wizard item list | Static Tailwind-class review | Already safe — `min-w-0`/`truncate`/`shrink-0` correctly used |
| Collection Analytics department list | Static Tailwind-class review | **Fixed** — bare `grid-cols-5` with no mobile collapse (see §2 #10) |
| 5-tab bottom nav (all 5 role layouts) | Static Tailwind-class review | Already safe — `flex justify-around` + short labels, well-built |
| Waivers "Reduce" dialog (live preview) | Static Tailwind-class review | Already safe — the shared `AlertDialogContent` component has `max-w-[calc(100%-2rem)]` built in at the design-system level, so every dialog in the app inherits viewport safety |
| Dispute detail pages (assumed "dual-panel" in the original plan) | Static code review | Corrected assumption — all 5 detail pages are actually single-column (`max-w-4xl`, vertically stacked), never at risk of a side-by-side collapse issue |
| LibraryFinesPage / StudentFinancialProfilePage / ShopPaymentsPage | Static Tailwind-class review | Already safe — consistent `grid-cols-2 sm:grid-cols-4` / `hidden md:grid` patterns already in place |

No live browser was available this session (§1) — all responsiveness work was done via careful
reading of the actual rendered Tailwind classes at each breakpoint, the same technique (and the
same minimal fix style: adding `overflow-auto`, a `md:` breakpoint, or `flex-wrap`) already used
by the 4 prior responsive fixes documented in this repo's history.

---

## 6. Remaining Known Issues (carried forward, not re-litigated this pass)

- **Gmail OAuth refresh token is expired** (`invalid_grant`, confirmed live via a real vitest run
  at the start of this session) — every real email send currently fails locally. This is an
  external credential issue, not a code bug; the user has confirmed they will refresh it
  themselves (`npx tsx src/get-gmail-token.ts <CLIENT_ID> <CLIENT_SECRET>`). In-app/dashboard
  notifications are fully decoupled from email and were confirmed working independently
  throughout this pass (DB row + realtime emit happen before the fire-and-forget email attempt).
  OTP-critical paths (registration, forgot-password) correctly fail loudly with a real `502` and a
  clear reason rather than lying about success — this is the intentional, already-correct behavior
  from a prior session's fix, reconfirmed live this pass, and will simply start working again once
  the token is refreshed.
- **Shop has no per-staff `ownerId` isolation gap** — flagged twice before in this repo's history
  as a known, deliberately-unfixed schema/product decision. Re-confirmed present, not touched
  (out of scope for a QA/bug-fix pass — would require a schema redesign decision).
- **Google Sign-In on localhost** — pre-existing, needs Google Cloud Console origin
  configuration, not fixable from code.
- **Forward/Refund action-panel text** goes only into the Dispute Audit Timeline, never as a
  Conversation message — confirmed intentional (per an earlier commit), not a bug, documented so
  it isn't rediscovered as a false positive in a future session.
- **Fee Push's Maker/Checker/Approver workflow has no wizard UI** — the backend fully supports it,
  but `FeeWizardPage.tsx` only covers the Maker steps; Checker/Approver actions are reachable only
  via direct API call today. This is an existing, pre-this-session gap, verified functional via
  API (see workbook rows FP-050–FP-053), not a bug fixed or introduced this pass.
- **File-picker-only edge cases** (wrong extension, corrupt binary, oversized file, quoted-comma
  CSV parsing, real `.xlsx` upload through the UI, browser back/forward visual click-through) —
  honestly marked "Not Executed" in both workbooks; these need a real browser interaction this
  session's tooling could not provide (§1).

---

## 7. Confirmation — Nothing Existing Was Broken

- Full backend Vitest suite: **160/160 passing**, identical count before and after every change in
  this pass — no existing test was modified, skipped, or weakened to make this true.
- Full Playwright E2E suite: **13/13 passing** — every pre-existing golden-path and smoke spec
  (5 role logins, dues payment, wallet top-up, library fine visibility, reminder/auto-deduct,
  scholarship push, shop payments, student financial profile) still passes unchanged.
- Both `tsc` passes (frontend `tsc -b`, backend `tsc --noEmit`) clean throughout every phase, not
  just at the end.
- Frontend production build (`vite build`) succeeds.
- Every fix in §2 is additive or a narrowly-scoped correction to a specific broken/inconsistent
  code path (a missing hook subscription, a missing notification call, a parsing regex, a claim
  lock, a timeout constant, a role-string comparison, a template-string typo, two CSS classes) —
  no existing route body, schema field, business rule, design/theme choice, or working feature was
  rewritten, removed, or redesigned.
- No database schema change was made this pass (the transient `'Pushing'` batch-status value is a
  plain string value on an already-`String`-typed column, matching this repo's own "status fields
  are String, not enum" convention — no migration needed, and confirmed via code search to have no
  frontend dependency that could be broken by it).

---

## 8. Files Changed This Pass

```
Backend:
  server/src/routes/fees.ts                 Fix 2 (notification), concurrency claim-lock, 60s timeout
  server/src/lib/feeManagementService.ts     Due-date cell formatting, negative-amount regex,
                                              Admin Office role-string fix
  server/src/lib/scholarshipService.ts       Concurrency claim-lock, 60s timeout, negative-amount regex
  server/src/index.ts                        Waiver approve/reject message typo fix
  server/src/generate-qa-workbooks.ts        New — generates the two QA workbooks

Frontend:
  src/pages/student/DisputeDetailPage.tsx           Fix 1 — useDisputeRoom wired in
  src/pages/accounts/DisputeCaseDetailPage.tsx       Fix 1 — useDisputeRoom wired in
  src/pages/admin/AdminDisputeDetailPage.tsx         Fix 1 — useDisputeRoom wired in
  src/pages/library/LibraryDisputeDetailPage.tsx     Fix 1 — useDisputeRoom wired in
  src/pages/shop/ShopDisputeDetailPage.tsx           Fix 1 — useDisputeRoom wired in
  src/pages/accounts/FeeWizardPage.tsx               Responsive table overflow fix
  src/pages/accounts/CollectionAnalyticsPage.tsx     Responsive grid collapse fix

Deliverables (repo root):
  Fee_Push_Testing.xlsx
  Scholarship_Push_Testing.xlsx
  QA_FULL_PASS_REPORT_2026-08-05.md (this file)
```

Nothing in this pass has been committed to git — all changes are local working-tree edits pending
explicit user instruction to commit, matching this repo's own established convention.
