import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';
import { getSeedData } from './helpers/seedData';

// New feature: Accounts unified Student Financial Profile (Phase 4). Accounts Office searches a
// student by Student ID and views the consolidated balance/outstanding/history/scholarships view.
test('Accounts Office searches a student and views their consolidated financial profile', async ({ page }) => {
  const seed = getSeedData();

  await login(page, seed.accounts.email, seed.password, '/accounts');
  await page.goto('/accounts/student-profile');

  await page.getByPlaceholder(/Search by Student ID, Name, or Email/i).fill(seed.student.studentId);
  await expect(page.getByText(seed.student.studentId)).toBeVisible({ timeout: 15000 });
  await page.getByText('E2E Test Student').click();

  await expect(page.getByText('Wallet Balance')).toBeVisible();
  await expect(page.getByText('Total Outstanding')).toBeVisible();
  await expect(page.getByText('Scholarship Credits')).toBeVisible();

  // Not asserting the exact seeded ৳50,000 figure — the scholarship-push spec credits this same
  // shared test student's wallet earlier in the run — just that a real balance renders.
  await expect(page.getByText(/৳\s*[\d,]+/).first()).toBeVisible();

  await page.getByRole('tab', { name: 'Transactions' }).click();
  await page.getByRole('tab', { name: 'Dues History' }).click();
  await page.getByRole('tab', { name: 'Scholarships' }).click();
});
