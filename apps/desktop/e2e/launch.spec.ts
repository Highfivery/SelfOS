import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

/**
 * Launches the built Electron app and verifies the themed shell renders. Requires `electron-vite
 * build` to have produced `out/` first (the `e2e` script handles that).
 */
test('app launches and shows the calm home screen', async () => {
  const app = await electron.launch({
    args: [join(__dirname, '..', 'out', 'main', 'index.js')],
  });

  try {
    const window = await app.firstWindow();
    await expect(window.getByRole('heading', { name: /a calm space for yourself/i })).toBeVisible();
    // The sidebar brand (the aside has the implicit "complementary" role).
    await expect(
      window.getByRole('complementary').getByText('SelfOS', { exact: true }),
    ).toBeVisible();

    const theme = await window.locator('html').getAttribute('data-theme');
    expect(theme === 'light' || theme === 'dark').toBe(true);

    // Proves the preload → IPC → Zod-validation pipeline resolved end-to-end.
    await expect(window.getByTestId('boot-status')).toHaveText(/ready/i);
  } finally {
    await app.close();
  }
});
