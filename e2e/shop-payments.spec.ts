import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';
import { getSeedData } from './helpers/seedData';

// New feature: Shop Completed/Outstanding payments split + filtering (Phase 6). The E2E fixture
// seeded one Success transaction (Completed) and one Pending PayLaterDue (Outstanding) for the
// test shop, so both tabs have real data to assert against.
test('Shop owner views Completed and Outstanding payment sections and filters by Student ID', async ({ page }) => {
  const seed = getSeedData();

  await login(page, seed.shopStaff.email, seed.password, '/shop');
  await page.goto('/shop/payments');

  await expect(page.getByText('E2E Test Completed Purchase')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/৳\s*150/)).toBeVisible();

  await page.getByRole('button', { name: 'Toggle filters' }).click();
  await page.getByPlaceholder('Student ID').fill(seed.student.studentId);
  await expect(page.getByText('E2E Test Completed Purchase')).toBeVisible({ timeout: 15000 });

  await page.getByPlaceholder('Student ID').fill('NO-SUCH-STUDENT-ID');
  await expect(page.getByText('No completed payments match this filter.')).toBeVisible({ timeout: 15000 });

  await page.getByRole('tab', { name: /Outstanding/i }).click();
  await expect(page.getByText('E2E Test Pay-Later Purchase')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/৳\s*250/)).toBeVisible();
  // No "mark settled" action should exist anywhere on the Outstanding tab — settlement authority
  // stays with Accounts Office / the automated deduction, never the shop.
  await expect(page.getByRole('button', { name: /mark settled/i })).toHaveCount(0);
});

test('Request Settlement CTA links to the existing settlement-request page', async ({ page }) => {
  const seed = getSeedData();
  await login(page, seed.shopStaff.email, seed.password, '/shop');
  await page.goto('/shop/payments');
  await page.getByRole('button', { name: /Request Settlement/i }).click();
  await expect(page).toHaveURL(/\/shop\/settlements/, { timeout: 15000 });
});
