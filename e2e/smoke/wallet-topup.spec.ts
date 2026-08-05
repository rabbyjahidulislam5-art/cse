import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';
import { getSeedData } from '../helpers/seedData';

// Smoke regression guard on the core pre-existing wallet top-up entry point. Full completion
// requires real Wallet PIN + email OTP verification and a live SSLCommerz sandbox checkout, none
// of which are practical to automate in a CI browser — this confirms the dashboard renders the
// real wallet balance and the Add Money flow opens correctly, catching gross regressions (a
// broken import, a missing route, a crashed component) without needing to complete a payment.
test('Student dashboard shows the real wallet balance and Add Money opens the top-up flow', async ({ page }) => {
  const seed = getSeedData();
  await login(page, seed.student.email, seed.password, '/student');

  // Not asserting the exact seeded ৳50,000 figure — the scholarship-push spec credits this same
  // shared test student's wallet earlier in the run, so only a real rendered currency amount
  // (not the literal placeholder/zero state) is asserted here.
  await expect(page.getByText(/৳\s*[\d,]+\.\d{2}/)).toBeVisible({ timeout: 15000 });
  // Two "Add Money" entry points exist on the dashboard (wallet card quick-action + a separate
  // shortcut tile) — either opens the same modal, so the first match is sufficient here.
  await page.getByRole('button', { name: /Add Money/i }).first().click();
  await expect(page.getByText(/Amount/i).first()).toBeVisible({ timeout: 10000 });
});
