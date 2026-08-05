import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';
import { getSeedData } from './helpers/seedData';

// New feature: Outstanding-Due Reminder / Auto-Deduction / Late-Fine automation (Phase 3). Real
// elapsed time can't be simulated in a browser E2E test, so this verifies the *visible* UI
// surface of a due row already left in a post-automation state by the fixture seed (status Paid,
// autoDeductedAt set) — the state-machine timing itself (7-day reminder, 10-day deduct-or-notify,
// 11-day late fee, and idempotency across repeated runs) is covered by
// server/src/tests/reminderAutoDeduct.integration.test.ts against the real DB.
test('an auto-deducted due renders correctly as settled on the Accounts Student Financial Profile', async ({ page }) => {
  const seed = getSeedData();

  await login(page, seed.accounts.email, seed.password, '/accounts');
  await page.goto('/accounts/student-profile');
  await page.getByPlaceholder(/Search by Student ID, Name, or Email/i).fill(seed.student.studentId);
  await expect(page.getByText(seed.student.studentId)).toBeVisible({ timeout: 15000 });
  await page.getByText('E2E Test Student').click();

  await page.getByRole('tab', { name: 'Dues History' }).click();
  await expect(page.getByText('E2E Auto-Deducted Fine')).toBeVisible({ timeout: 15000 });
  // This disposable test student has exactly one dues-history record (the fixture above) — its
  // status badge renders "Paid", never "Pending", confirming an auto-deducted due never looks
  // like it's still owed.
  await expect(page.getByText('Paid', { exact: true })).toBeVisible();
  await expect(page.getByText('Pending', { exact: true })).toHaveCount(0);
});
