import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';
import { getSeedData } from '../helpers/seedData';

// Smoke regression guard on the core pre-existing dues page — full payment completion requires
// real Wallet PIN + email OTP verification, not practical to automate here (see wallet-topup.spec
// for the same reasoning). Confirms the page loads, renders every due-source tab, and shows the
// E2E fixture's own pay-later due — catching regressions without needing to complete a payment.
test('Student dues page loads with every source tab and shows a real outstanding due', async ({ page }) => {
  const seed = getSeedData();
  await login(page, seed.student.email, seed.password, '/student');

  await page.goto('/student/dues');
  for (const tab of ['Semester', 'Library', 'Admin', 'Pay Later']) {
    await expect(page.getByRole('tab', { name: tab })).toBeVisible({ timeout: 15000 });
  }

  await page.getByRole('tab', { name: 'Pay Later' }).click();
  await expect(page.getByText('E2E Test Pay-Later Purchase')).toBeVisible({ timeout: 15000 });
});
