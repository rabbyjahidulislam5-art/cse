import { test, expect } from '@playwright/test';
import { login } from './helpers/auth';
import { getSeedData } from './helpers/seedData';

// New feature: Library Fine -> Accounts Office visibility (Phase 2). Library staff assigns a fine
// to the E2E test student; Accounts Office must see it on /accounts/library-fines immediately —
// this is the literal "must automatically be recorded in the Accounts Department" requirement.
test('Library assigns a fine and Accounts Office sees it recorded immediately', async ({ browser }) => {
  const seed = getSeedData();
  const fineLabel = `E2E Overdue Fine ${Date.now()}`;

  const libraryContext = await browser.newContext();
  const libraryPage = await libraryContext.newPage();
  await login(libraryPage, seed.library.email, seed.password, '/library');

  await libraryPage.goto('/library/fines/assign');
  await libraryPage.getByPlaceholder('Search student...').fill(seed.student.studentId);
  await libraryPage.getByPlaceholder('Search student...').press('Enter');
  await expect(libraryPage.getByText(seed.student.studentId)).toBeVisible({ timeout: 15000 });
  await libraryPage.getByText(seed.student.studentId).click();

  await libraryPage.getByRole('combobox').click();
  await libraryPage.getByRole('option', { name: 'Late Return' }).click();
  await libraryPage.getByPlaceholder('0').fill('150');
  await libraryPage.locator('input[type="date"]').fill('2026-12-31');
  await libraryPage.getByPlaceholder(/Late Return —/).fill(fineLabel);
  await libraryPage.getByRole('button', { name: /Assign Fine/i }).click();
  await expect(libraryPage.getByText(/assigned/i)).toBeVisible({ timeout: 15000 });
  await libraryContext.close();

  const accountsContext = await browser.newContext();
  const accountsPage = await accountsContext.newPage();
  await login(accountsPage, seed.accounts.email, seed.password, '/accounts');

  await accountsPage.goto('/accounts/library-fines');
  await accountsPage.getByPlaceholder(/Search by student, fine type/i).fill(seed.student.studentId);
  await expect(accountsPage.getByText(fineLabel)).toBeVisible({ timeout: 15000 });
  await accountsContext.close();
});
