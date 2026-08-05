import { Page, expect } from '@playwright/test';

// Logs in through the in-app auth modal (auth-context.tsx renders it directly over the page when
// loginWithRedirect() is called — there is no dedicated /login route in this app) and waits for
// the post-login role redirect (LandingPage.tsx's useEffect sends each role to its own prefix).
export async function login(page: Page, email: string, password: string, expectedPathPrefix: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.getByPlaceholder(/std\.ewubd\.edu/i).fill(email);
  await page.getByPlaceholder(/Password or 6-digit Wallet PIN/i).fill(password);
  await page.getByRole('button', { name: /Sign In to Wallet/i }).click();
  await expect(page).toHaveURL(new RegExp(`${expectedPathPrefix}(/|$)`), { timeout: 20000 });
}
