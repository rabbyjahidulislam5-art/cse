# Smart Campus — Full QA Sweep Summary

**Date:** 2026-07-29
**Scope:** End-to-end functional testing of every dashboard (Student, Admin, Accounts, Library, Shop) using real data entered through the live UI, backed by direct database verification — not just visual checks.

---

## What was done

1. Committed all pending work, then pushed every fix as its own commit (10 commits total this session).
2. Logged into all five roles and clicked through every page.
3. Entered **real values** into every action form (amounts, dates, reasons, student IDs, staff accounts, shop details) and verified the result in the database, not just the UI toast.
4. Ran real money through **SSLCommerz sandbox** (Add Money, shop payments, refunds) to confirm the actual payment gateway integration works, not just the app-side bookkeeping.
5. Tested the forgot-password OTP flow end-to-end using the real OTP pulled from the database.
6. Verified every CSV/Excel/PDF export button across the app.

---

## Bugs found and fixed (10 total)

| # | Area | Bug | Fix |
|---|------|-----|-----|
| 1 | Admin Dashboard | "Total Shops" counter showed active/suspended as 0 despite shops existing — backend never returned those fields | Added `activeShops`/`suspendedShops` to `/admin/overview` |
| 2 | Accounts Dashboard | Collection Rate, Total Assigned/Paid/Students all showed 0 despite real paid fees — backend used old field names, frontend expected new ones | Backend now returns both old and new field names |
| 3 | Shop Dashboard | "Total Revenue" (all-time) was paired with *today's* transaction count, so 2 real payments displayed as "1 transactions" | Added a proper all-time `totalCount` field |
| 4 | Dispute Refunds | "Refund to Original Payment" never actually called SSLCommerz — silently logged a note instead of moving money through the gateway | Built real `callSslCommerzRefund()`, wired into a new `processOriginalPaymentRefund()`. First attempt hit the wrong endpoint (404); fixed against SSLCommerz's own Node SDK source, then verified against the sandbox with a real `refund_ref_id` returned |
| 5 | Password Reset | "Update Password & Sign In" button reset the password but never signed the user in — dropped them at an empty login form | Now chains a real login call after a successful reset |
| 6 | Every Export Button | CSV/Excel/PDF downloads silently failed on **both mobile and desktop** — `window.open(url)` was called *after* an `await`, which browsers' popup blockers silently kill since it's no longer inside the trusted click-gesture window | Replaced all 8 occurrences with a shared `triggerDownload()` helper that clicks a real `<a>` element instead |
| 7 | Library Dashboard | "Fines Outstanding" always showed 0 despite a pending fine sitting in the same page's "Recent Fines" list — same field-name mismatch pattern as #1/#2 | Added `totalFinesOutstanding`, `fineAmount`, `studentsPendingClearance` to `/library/overview` |
| 8 | Library Fine Waiver | "Reduce" button was completely non-functional — always fully waived the fine at its original amount, silently discarding the requested reduced amount, while reporting success | Backend now branches on `action` and actually updates the amount for `reduce` |
| 9 | Accounts Fee Adjustments | "Waive" button did nothing to the database — frontend never sent the `newStatus` field the backend needed — but the UI optimistically removed the fee from the list anyway, so staff would believe it worked when the fee was still Pending | Frontend now sends `newStatus: 'Waived'`; also fixed `/accounts/analytics` miscounting waived fees as still outstanding |
| 10 | Admin Shop Management | Suspend / Activate / Remove buttons all returned "Unknown action" — backend never handled those action names at all | Added `suspend`/`activate` handling (and mapped `remove` to the existing deactivate path) |
| 11 | Admin Staff Accounts | Edit / Suspend / Activate all crashed with a raw Prisma error (`id: undefined`) — backend read `userId`, frontend always sent `staffId` | Backend now reads `staffId` (with `userId` kept as fallback) |
| 12 | Shop QR Code | "Regenerate" button cleared the QR code to blank instead of showing the new one — backend returned `qrToken`, frontend read `res.newQrToken` (always undefined) | Fixed frontend to read the correct field |

---

## Verified working correctly (no bugs)

- Student wallet: Add Money (real SSLCommerz payment), Withdraw (real bKash payout request), Scan & Pay / shop payment
- Profile: PIN/password change, profile picture upload
- Forgot-password OTP flow (after fix #5)
- Financial dispute → refund → SSLCommerz flow end-to-end (after fix #4)
- Library: Fine Imposition, Student Lookup
- Accounts: Semester Fee Push
- Admin: disciplinary Fines page, shop settlement recording
- Shop: QR copy-to-clipboard, sales ledger

---

## Known limitation flagged, not fixed

**Shops are not linked to specific staff accounts in the schema.** Every shop-facing endpoint (`/shop/dashboard`, `/shop/qr`, `/shop/sales-ledger`) just queries `prisma.shop.findFirst({ where: { status: 'Active' } })` — the first active shop in the whole table, with no ownership relation. This never surfaced with only one shop in the system; it broke immediately when a second shop was created during Admin testing (the Shop Staff account started managing the wrong shop's QR code and ledger). Cleaned up by suspending the test shop rather than attempting a schema/ownership redesign, since that's a product decision, not a bug fix.

---

## Commits (newest first)

```
03de07d fix: Regenerate QR button cleared the QR code instead of replacing it
7ed9994 fix: Edit/Suspend/Activate staff all crashed with a Prisma error
7a7f2ce fix: Suspend/Activate/Remove shop buttons all returned "Unknown action"
1a1a34c fix: Fee Adjustments' Waive button silently did nothing to the DB
c8c93e4 fix: library dashboard stats and non-functional fine reduction
1147566 fix: every CSV/Excel/PDF download silently failing on mobile and desktop
bd401c9 fix: actually auto sign-in after password reset
6db1bce feat: make Refund-to-Original-Payment actually call SSLCommerz
8c167d2 fix: repair broken stat counters found via full dashboard QA sweep
be976a8 feat: add notifications system, exports, and dashboard summaries
```

All commits are pushed to `origin/main`.
