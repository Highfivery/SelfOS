import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { createMasterKey, loadMasterKey } from '../src/main/crypto/masterKey';
import type { Encryptor } from '../src/main/secrets/secretStore';
import { savePerson } from '../src/main/people/peopleService';
import { setAccount } from '../src/main/people/accessService';
import { hashPin } from '../src/main/people/pin';
import { recordUsage } from '../src/main/usage/usageStore';
import { setSecret } from '../src/main/secrets/secretStore';

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

test('people: add a person and link a relationship', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'People' }).click();

    // The seeded owner ("Tester") is already listed; add Jordan.
    await w.getByRole('button', { name: 'Add person' }).click();
    await w.getByLabel('Name').fill('Jordan');
    await w.getByRole('button', { name: 'Create' }).click();
    await expect(w.getByText('Jordan')).toBeVisible();

    // Open Jordan and link them to the owner (relationships live on the Relationships tab).
    await w.getByText('Jordan').click();
    await w.getByRole('button', { name: 'Relationships' }).click();
    await w.getByLabel('Related person').selectOption({ label: 'Tester' });
    await w.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(w.getByText(/Friend — Tester/)).toBeVisible();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('people: shared and private notes persist', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'People' }).click();
    await w.getByRole('button', { name: 'Tester Subject' }).click();
    await w.getByRole('button', { name: 'Notes' }).click();
    await w.getByLabel('Shared notes').fill('enjoys cycling');
    await w.getByLabel('Private notes').fill('processing a tough week');
    await w.getByRole('button', { name: 'Save' }).click();

    // Reopen and confirm both fields round-tripped through encryption.
    await w.getByRole('button', { name: 'Tester Subject' }).click();
    await w.getByRole('button', { name: 'Notes' }).click();
    await expect(w.getByLabel('Shared notes')).toHaveValue('enjoys cycling');
    await expect(w.getByLabel('Private notes')).toHaveValue('processing a tough week');
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('people: an admin sets a per-person budget on the Budget tab', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'People' }).click();
    await w.getByRole('button', { name: 'Tester Subject' }).click();
    await w.getByRole('button', { name: 'Budget', exact: true }).click();
    await w.getByLabel('Limit (USD)').fill('20');
    await w.getByRole('button', { name: 'Save budget' }).click();
    await expect(w.getByText('Saved.')).toBeVisible();

    // Reopen the Budget tab and confirm the value round-tripped.
    await w.getByRole('button', { name: 'Tester Subject' }).click();
    await w.getByRole('button', { name: 'Budget', exact: true }).click();
    await expect(w.getByLabel('Limit (USD)')).toHaveValue('20');
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('access: grant a login, switch person, and gate the People nav', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'People' }).click();

    // Add Jordan and grant them a member login (no PIN).
    await w.getByRole('button', { name: 'Add person' }).click();
    await w.getByLabel('Name').fill('Jordan');
    await w.getByRole('button', { name: 'Create' }).click();
    await w.getByText('Jordan').click();
    await w.getByRole('button', { name: 'Access' }).click();
    await w.getByRole('button', { name: 'Grant access' }).click();
    await expect(w.getByText(/can sign in/i)).toBeVisible();

    // Switch to Jordan via the "Who's here?" switcher.
    await w.getByRole('button', { name: /signed in as/i }).click();
    const dialog = w.getByRole('dialog', { name: /who.s here/i });
    await expect(dialog).toBeVisible();
    await dialog.getByText('Jordan').click();

    // Now signed in as Jordan (a member) → the People nav is gated away.
    await expect(w.getByRole('button', { name: 'Signed in as Jordan' })).toBeVisible();
    await expect(w.getByRole('link', { name: 'People' })).toHaveCount(0);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('super-admin: a hidden long-press on the version unlocks inspect mode', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Settings' }).click();
    await w.getByRole('button', { name: 'About' }).click();

    // Concealed entry: long-press the version number.
    await w.getByText(/^\d+\.\d+\.\d+$/).click({ delay: 700 });
    const dialog = w.getByRole('dialog', { name: 'Unlock' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Passphrase').fill('superpass');
    await dialog.getByRole('button', { name: 'Unlock' }).click();

    // Inspect mode is active — the (only-now-visible) super-admin badge appears.
    await expect(w.getByRole('button', { name: /super-admin/i })).toBeVisible();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('super-admin: inspect mode unlocks full budget/usage access for a non-admin', async () => {
  // Seed an owner + a member, with the MEMBER active and a usage event owned by the owner.
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
  await createMasterKey(userData, passthrough, vault);
  const key = await loadMasterKey(userData, passthrough);
  if (!key) throw new Error('super-admin e2e: master key missing');
  await savePerson(vault, key, {
    id: 'owner-1',
    schemaVersion: 1,
    displayName: 'Alex',
    isSubject: true,
    tags: [],
    createdAt: now,
    updatedAt: now,
  });
  await savePerson(vault, key, {
    id: 'member-1',
    schemaVersion: 1,
    displayName: 'Sam',
    isSubject: true,
    tags: [],
    createdAt: now,
    updatedAt: now,
  });
  await setAccount(vault, key, { personId: 'owner-1', roleId: 'owner' });
  await setAccount(vault, key, { personId: 'member-1', roleId: 'member' });
  await recordUsage(vault, key, {
    id: 'u1',
    schemaVersion: 1,
    type: 'chat',
    personId: 'owner-1',
    sessionId: 'c1',
    model: 'claude-sonnet-4-6',
    at: now,
    inputTokens: 1000,
    outputTokens: 500,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    costUsd: 3,
  });
  await writeJson(join(userData, 'state.json'), {
    schemaVersion: 1,
    vaultPath: vault,
    activePersonId: 'member-1',
    superAdminPassphraseHash: hashPin('superpass'),
  });

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    // As a member: no admin person picker, no People nav, no cost figure.
    await w.getByRole('link', { name: 'Usage' }).click();
    await expect(w.getByLabel('Whose usage')).toHaveCount(0);
    await expect(w.getByRole('link', { name: 'People' })).toHaveCount(0);
    await expect(w.getByRole('heading', { name: '$3.00' })).toHaveCount(0);

    // Unlock super-admin via the concealed long-press on the version.
    await w.getByRole('link', { name: 'Settings' }).click();
    await w.getByRole('button', { name: 'About' }).click();
    await w.getByText(/^\d+\.\d+\.\d+$/).click({ delay: 700 });
    const dialog = w.getByRole('dialog', { name: 'Unlock' });
    await dialog.getByLabel('Passphrase').fill('superpass');
    await dialog.getByRole('button', { name: 'Unlock' }).click();
    await expect(w.getByRole('button', { name: /super-admin/i })).toBeVisible();

    // Now main grants full access: cost is shown and the owner's usage appears (app scope allowed).
    await w.getByRole('link', { name: 'Usage' }).click();
    await expect(w.getByLabel('Whose usage')).toBeVisible();
    await expect(w.getByRole('heading', { name: '$3.00' })).toBeVisible();
    await expect(w.getByRole('heading', { name: 'By person' })).toBeVisible();
    await expect(w.getByRole('option', { name: 'Alex' })).toBeAttached();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('sessions: send a message, stream a reply, and show the usage header + crisis footer', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await setSecret(userData, passthrough, 'anthropic.apiKey', 'sk-ant-e2e');
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await expect(w.getByRole('button', { name: /AI usage/i })).toBeVisible(); // global usage ring (no cost shown)
    await w.getByRole('link', { name: 'Sessions' }).click();
    await w.getByLabel('Message').fill('I had a hard day');
    await w.getByRole('button', { name: 'Send' }).click();

    await expect(w.getByText(/hear you/i)).toBeVisible(); // offline fake reply
    await expect(w.getByText(/This session:/)).toHaveCount(0); // no cost in sessions
    await expect(w.getByRole('button', { name: /get help now/i })).toBeVisible(); // crisis footer

    // Rename the conversation.
    await w.getByRole('button', { name: /^Rename / }).click();
    const titleInput = w.getByLabel('Session title');
    await titleInput.fill('My week');
    await titleInput.press('Enter');
    await expect(w.getByText('My week')).toBeVisible();

    const overflow = await w.evaluate(() => {
      const main = document.querySelector('main');
      return main ? main.scrollWidth - main.clientWidth : 0;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('usage: the dashboard shows recorded usage and accepts a budget, without overflow', async () => {
  const { userData, vault } = await seedReadyVault();
  const key = await loadMasterKey(userData, passthrough);
  if (!key) throw new Error('usage e2e: master key missing');
  await recordUsage(vault, key, {
    id: 'u1',
    schemaVersion: 1,
    type: 'chat',
    personId: 'owner-1',
    sessionId: 'c1',
    model: 'claude-sonnet-4-6',
    at: new Date().toISOString(),
    inputTokens: 1000,
    outputTokens: 500,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0.12,
  });

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    // The usage ring shows for everyone (default $10/week budget); open its popover and follow the link.
    await w.getByRole('button', { name: /AI usage/i }).click();
    await expect(w.getByText(/% of your allowance/)).toBeVisible();
    await w.getByRole('button', { name: 'View usage details →' }).click();
    await expect(w.getByRole('heading', { name: 'Usage' })).toBeVisible();
    await expect(w.getByText('Coaching session')).toBeVisible(); // by-type breakdown
    await expect(w.getByRole('heading', { name: 'By person' })).toBeVisible(); // by-person (Everyone)

    // Drill into a single person via the picker.
    await w.getByLabel('Whose usage').selectOption('owner-1');
    await expect(w.getByText('Tester, this month')).toBeVisible();

    await w.getByLabel('Everyone (app) limit (USD)').fill('5');
    await w.getByRole('button', { name: 'Save' }).first().click();
    await expect(w.getByText(/\$5\.00/)).toBeVisible(); // app-cap progress reflects the limit (admin sees $)

    const overflow = await w.evaluate(() => {
      const main = document.querySelector('main');
      return main ? main.scrollWidth - main.clientWidth : 0;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('roles: the owner edits the role × capability matrix', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Roles' }).click();
    await expect(w.getByRole('heading', { name: 'Roles' })).toBeVisible();

    const memberManage = w.getByRole('switch', { name: 'Member: Manage people' });
    await expect(memberManage).not.toBeChecked();
    await memberManage.click();
    await expect(memberManage).toBeChecked();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('design: a Switch never shrinks in a flex row and its thumb stays on-track', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'People' }).click();
    // The seeded owner is a subject, so its Subject toggle renders in the "on" position.
    await w.getByRole('button', { name: 'Tester Subject' }).click();
    const toggle = w.getByRole('switch', { name: 'Has their own SelfOS experience' });
    await expect(toggle).toBeVisible();

    const geom = await toggle.evaluate((el) => {
      const track = el.getBoundingClientRect();
      const thumb = el.querySelector('span')!.getBoundingClientRect();
      return {
        flexShrink: getComputedStyle(el).flexShrink,
        trackWidth: track.width,
        leftGap: thumb.left - track.left,
        rightGap: track.right - thumb.right,
      };
    });

    expect(geom.flexShrink).toBe('0'); // the fix: fixed-size control must not shrink
    expect(geom.trackWidth).toBeGreaterThanOrEqual(38);
    expect(geom.leftGap).toBeGreaterThanOrEqual(2); // thumb not flush against either edge
    expect(geom.rightGap).toBeGreaterThanOrEqual(2);
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
    superAdminPassphraseHash: hashPin('superpass'),
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
    await w.getByRole('button', { name: 'AI', exact: true }).click();

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
