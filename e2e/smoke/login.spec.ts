import { test } from '@playwright/test';
import { login } from '../helpers/auth';
import { getSeedData } from '../helpers/seedData';

// Regression guard on the core pre-existing login flow, for every role — including the 4 new
// roles this enhancement adds pages/nav entries for. Uses disposable E2E test accounts (see
// server/e2e-seed.mjs) rather than the real seeded demo accounts, whose emailVerified/status state
// is not guaranteed and must never be modified by an automated test.
test.describe('Smoke — login redirects each role to its own dashboard', () => {
  test('Admin Office', async ({ page }) => {
    const seed = getSeedData();
    await login(page, seed.admin.email, seed.password, '/admin');
  });

  test('Library', async ({ page }) => {
    const seed = getSeedData();
    await login(page, seed.library.email, seed.password, '/library');
  });

  test('Accounts Office', async ({ page }) => {
    const seed = getSeedData();
    await login(page, seed.accounts.email, seed.password, '/accounts');
  });

  test('Shop Staff', async ({ page }) => {
    const seed = getSeedData();
    await login(page, seed.shopStaff.email, seed.password, '/shop');
  });

  test('Student', async ({ page }) => {
    const seed = getSeedData();
    await login(page, seed.student.email, seed.password, '/student');
  });
});
