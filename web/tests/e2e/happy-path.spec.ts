import { test, expect } from '@playwright/test';

test.skip(
  ({ browserName }) => browserName !== 'chromium',
  'chromium only',
);

test('login page renders', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByText('Sign in with Google')).toBeVisible();
});
