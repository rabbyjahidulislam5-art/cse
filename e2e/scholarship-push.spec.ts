import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';
import { getSeedData } from './helpers/seedData';

// New feature: Scholarship Push module (Phase 5). Lives under Accounts Office (same dashboard as
// Fee Push) — Accounts Office pushes scholarships to students, not Admin Office. Accounts Office
// uploads a CSV, validates, reviews, and executes the push — the E2E test student's wallet is
// actually credited (verified rigorously at the DB level by scholarshipPushIntegration.test.ts;
// this test covers the UI flow end-to-end).
test('Accounts Office uploads a scholarship CSV and pushes it, crediting the matched student', async ({ page }) => {
  const seed = getSeedData();
  const csv = `Student ID,Student Name,Email,Amount,Remark\n${seed.student.studentId},E2E Test Student,${seed.student.email},5000,E2E Test Scholarship\n`;

  await login(page, seed.accounts.email, seed.password, '/accounts');
  await page.goto('/accounts/scholarship-push');

  await page.locator('input[type="file"]').setInputFiles({
    name: 'e2e-scholarship.csv', mimeType: 'text/csv', buffer: Buffer.from(csv),
  });
  await page.getByRole('button', { name: /Validate File/i }).click();

  await expect(page.getByText('Valid')).toBeVisible({ timeout: 15000 });
  // "Total Amount" summary tile and the single item row both show ৳5,000 with one row uploaded.
  await expect(page.getByText(/৳\s*5,000/).first()).toBeVisible();

  await page.getByRole('button', { name: /^Continue/i }).click();
  await expect(page.getByText(/Ready to push 1 scholarship credit/i)).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: /Execute Scholarship Push/i }).click();
  await expect(page.getByText('Scholarship Push Complete')).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/1 student\(s\) credited/i)).toBeVisible();
});
