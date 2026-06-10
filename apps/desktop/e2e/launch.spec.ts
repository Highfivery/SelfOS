import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { createMasterKey, loadMasterKey } from '../src/main/crypto/masterKey';
import type { Encryptor } from '../src/main/secrets/secretStore';
import { savePerson } from '../src/main/people/peopleService';
import { setAccount } from '../src/main/people/accessService';

const MAIN = join(__dirname, '..', 'out', 'main', 'index.js');

// Matches the app's SELFOS_FAKE_SECRETS encryptor so seeded ciphertext is readable by the launched app.
const passthrough: Encryptor = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from(plain, 'utf8').toString('base64'),
  decrypt: (ciphertext) => Buffer.from(ciphertext, 'base64').toString('utf8'),
};

/** Seed an encrypted household (master key + owner + active person) so the app boots past setup. */
async function seedHousehold(
  userData: string,
  vault: string,
  ownerName = 'Tester',
): Promise<string> {
  await createMasterKey(userData, passthrough, vault);
  const key = await loadMasterKey(userData, passthrough);
  if (!key) throw new Error('seedHousehold: master key missing');
  const ownerId = 'owner-1';
  const now = new Date().toISOString();
  await savePerson(vault, key, {
    id: ownerId,
    schemaVersion: 1,
    displayName: ownerName,
    isSubject: true,
    tags: [],
    createdAt: now,
    updatedAt: now,
  });
  await setAccount(vault, key, { personId: ownerId, roleId: 'owner' });
  return ownerId;
}

// Deterministic AI: passthrough secret encryption (no keychain prompt) + offline Claude client.
function e2eEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.SELFOS_FAKE_SECRETS = '1';
  env.SELFOS_FAKE_CLAUDE = '1';
  return env;
}

// Each test uses an isolated --user-data-dir so device-local state is deterministic.
function launch(userDataDir: string): Promise<ElectronApplication> {
  return electron.launch({ args: [`--user-data-dir=${userDataDir}`, MAIN], env: e2eEnv() });
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

test('first run shows onboarding when no vault is configured', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'selfos-e2e-ud-'));
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await expect(w.getByRole('button', { name: /choose a folder/i })).toBeVisible();
    // No sidebar shell before a vault is chosen.
    await expect(w.getByRole('complementary')).toHaveCount(0);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test('boots straight to the shell when a valid vault is configured', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'selfos-e2e-ud-'));
  const vault = await mkdtemp(join(tmpdir(), 'selfos-e2e-vault-'));
  const now = new Date().toISOString();
  await writeJson(join(vault, '.selfos', 'meta.json'), {
    schemaVersion: 1,
    vaultId: 'e2e',
    createdAt: now,
    updatedAt: now,
  });
  await writeJson(join(vault, 'config', 'settings.json'), { schemaVersion: 1, values: {} });
  const ownerId = await seedHousehold(userData, vault);
  await writeJson(join(userData, 'state.json'), {
    schemaVersion: 1,
    vaultPath: vault,
    activePersonId: ownerId,
  });

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await expect(w.getByRole('complementary').getByText('SelfOS', { exact: true })).toBeVisible();
    await expect(w.getByRole('link', { name: 'Home' })).toBeVisible();
    await expect(w.getByRole('button', { name: /choose a folder/i })).toHaveCount(0);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('surfaces a sync conflict when a conflict copy exists in the vault', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'selfos-e2e-ud-'));
  const vault = await mkdtemp(join(tmpdir(), 'selfos-e2e-vault-'));
  const now = new Date().toISOString();
  await writeJson(join(vault, '.selfos', 'meta.json'), {
    schemaVersion: 1,
    vaultId: 'e2e',
    createdAt: now,
    updatedAt: now,
  });
  await writeJson(join(vault, 'config', 'settings.json'), { schemaVersion: 1, values: {} });
  const conflictOwnerId = await seedHousehold(userData, vault);
  await writeJson(join(userData, 'state.json'), {
    schemaVersion: 1,
    vaultPath: vault,
    activePersonId: conflictOwnerId,
  });
  await mkdir(join(vault, 'journal'), { recursive: true });
  await writeFile(join(vault, 'journal', 'note (conflicted copy 2026-06-09).md'), 'x', 'utf8');

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await expect(w.getByText(/sync conflict copy was found/i)).toBeVisible();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('first-time setup creates the owner and enters the app', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'selfos-e2e-ud-'));
  const vault = await mkdtemp(join(tmpdir(), 'selfos-e2e-vault-'));
  const now = new Date().toISOString();
  // A ready vault but no household yet → the setup gate should appear.
  await writeJson(join(vault, '.selfos', 'meta.json'), {
    schemaVersion: 1,
    vaultId: 'e2e',
    createdAt: now,
    updatedAt: now,
  });
  await writeJson(join(vault, 'config', 'settings.json'), { schemaVersion: 1, values: {} });
  await writeJson(join(userData, 'state.json'), { schemaVersion: 1, vaultPath: vault });

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await expect(w.getByRole('heading', { name: 'Create your profile' })).toBeVisible();
    await w.getByLabel('Your name').fill('Alex');
    await w.getByLabel('Super-admin passphrase').fill('hunter2');
    await w.getByLabel('Confirm passphrase').fill('hunter2');
    await w.getByRole('button', { name: /create profile/i }).click();

    // Recovery phrase shown once, then into the app as the owner.
    await expect(w.getByRole('heading', { name: 'Write this down' })).toBeVisible();
    await w.getByRole('button', { name: /saved it/i }).click();
    await expect(w.getByRole('link', { name: 'Home' })).toBeVisible();
    await expect(w.getByText('Signed in as Alex')).toBeVisible();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

async function seedReadyVault(
  settingsValues: Record<string, unknown> = {},
): Promise<{ userData: string; vault: string }> {
  const userData = await mkdtemp(join(tmpdir(), 'selfos-e2e-ud-'));
  const vault = await mkdtemp(join(tmpdir(), 'selfos-e2e-vault-'));
  const now = new Date().toISOString();
  await writeJson(join(vault, '.selfos', 'meta.json'), {
    schemaVersion: 1,
    vaultId: 'e2e',
    createdAt: now,
    updatedAt: now,
  });
  await writeJson(join(vault, 'config', 'settings.json'), {
    schemaVersion: 1,
    values: settingsValues,
  });
  const ownerId = await seedHousehold(userData, vault);
  await writeJson(join(userData, 'state.json'), {
    schemaVersion: 1,
    vaultPath: vault,
    activePersonId: ownerId,
  });
  return { userData, vault };
}

test('settings: changing the theme applies it and persists to the vault', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Home' }).waitFor();
    // The sidebar appearance toggle (only the toggle's "Dark" exists on the Home route).
    await w.getByRole('button', { name: 'Dark' }).click();
    await expect(w.locator('html')).toHaveAttribute('data-theme', 'dark');

    const settingsFile = join(vault, 'config', 'settings.json');
    await expect
      .poll(async () => {
        const parsed = JSON.parse(await readFile(settingsFile, 'utf8')) as {
          values: Record<string, unknown>;
        };
        return parsed.values['appearance.theme'];
      })
      .toBe('dark');
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('settings: a persisted dark theme is applied on boot', async () => {
  const { userData, vault } = await seedReadyVault({ 'appearance.theme': 'dark' });
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await expect(w.locator('html')).toHaveAttribute('data-theme', 'dark');
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('AI: enabling reveals key + model, saving a key and testing connects', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Settings' }).click();
    await w.getByRole('button', { name: 'AI' }).click();

    // Model + key controls are visible because AI is enabled.
    await expect(w.getByLabel('Claude API key')).toBeVisible();
    await expect(w.getByLabel('Model')).toBeVisible();

    // Save a (fake) key, then test the connection (offline fake client → success).
    await w.getByLabel('Claude API key').fill('sk-ant-e2e');
    await w.getByRole('button', { name: /save key/i }).click();
    await expect(w.getByText(/key is configured/i)).toBeVisible();

    await w.getByRole('button', { name: /test connection/i }).click();
    await expect(w.getByText('Connected')).toBeVisible();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('settings: every section renders content without horizontal overflow', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Settings' }).click();
    await w.getByRole('heading', { name: 'Settings' }).waitFor();

    // Visual guard: nothing should overflow the content area or the window horizontally.
    const noOverflow = (): Promise<boolean> =>
      w.evaluate(() => {
        const main = document.querySelector('main');
        const mainOk = !!main && main.scrollWidth <= main.clientWidth;
        const docOk = document.documentElement.scrollWidth <= window.innerWidth;
        return mainOk && docOk;
      });

    // Walk every section generically so new sections are covered automatically.
    const sectionButtons = w
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('button');
    const count = await sectionButtons.count();
    expect(count).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < count; i++) {
      await sectionButtons.nth(i).click();
      await w.waitForTimeout(50);
      expect(await noOverflow()).toBe(true);
    }

    // Content sanity on the sections that previously had bugs.
    await w.getByRole('button', { name: 'Vault' }).click();
    await expect(w.getByRole('button', { name: /reveal in file manager/i })).toBeVisible();
    await expect(w.getByText(vault, { exact: false })).toBeVisible(); // full path, wrapped

    await w.getByRole('button', { name: 'About' }).click();
    await expect(w.getByText(/not a substitute for professional care/i)).toBeVisible();
    const pkg = JSON.parse(await readFile(join(__dirname, '..', 'package.json'), 'utf8')) as {
      version: string;
    };
    await expect(w.getByText(pkg.version, { exact: false })).toBeVisible(); // app version, not Electron's
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});
