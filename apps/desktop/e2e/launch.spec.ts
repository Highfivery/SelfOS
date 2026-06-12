import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { createMasterKey, loadMasterKey } from '@selfos/core/crypto';
import type { Encryptor } from '../src/main/secrets/encryptor';
import { createNodeFileSystem } from '../src/main/host/nodeFileSystem';
import { createNodeSecretStore } from '../src/main/host/nodeSecretStore';
import {
  createInvite,
  getAccessConfig,
  savePerson,
  saveRelationship,
  setAccount,
} from '@selfos/core/people';
import { hashPin } from '@selfos/core/crypto';
import { recordUsage } from '@selfos/core/usage';
import { writeEncryptedJson } from '@selfos/core/vault';
import {
  createCompatibilitySend,
  getAlignmentReport,
  getResponse,
  listAssignments,
  saveQuestionnaire,
  submitResponse,
} from '@selfos/core/questionnaires';
import { listInsightsForPerson, summarizeForContext } from '@selfos/core/insights';
import { saveAnalysis, saveDream } from '@selfos/core/dreams';

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
  const secrets = createNodeSecretStore(userData, passthrough);
  const fs = createNodeFileSystem(vault);
  await createMasterKey(secrets, fs);
  const key = await loadMasterKey(secrets);
  if (!key) throw new Error('seedHousehold: master key missing');
  const ownerId = 'owner-1';
  const now = new Date().toISOString();
  await savePerson(fs, key, {
    id: ownerId,
    schemaVersion: 1,
    displayName: ownerName,
    isSubject: true,
    tags: [],
    createdAt: now,
    updatedAt: now,
  });
  await setAccount(fs, key, { personId: ownerId, roleId: 'owner' });
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
  env.SELFOS_FAKE_RELAY = '1'; // deterministic in-memory relay (no Cloudflare account/network)
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

/**
 * Drive the concealed super-admin entry: a pointer-hold on the version number (a 600ms timer in
 * customRows.tsx). Dispatching pointerdown/up directly on the element is deterministic — it always
 * hits the handler regardless of mouse position — unlike `click({ delay })` or mouse-positioned holds,
 * which don't reliably drive a custom pointer-hold gesture under Electron timing.
 */
async function longPressVersion(w: Page): Promise<void> {
  const version = w.getByText(/^\d+\.\d+\.\d+$/);
  await version.dispatchEvent('pointerdown');
  await w.waitForTimeout(750); // exceed the 600ms hold threshold so the unlock prompt opens
  await version.dispatchEvent('pointerup');
  await expect(w.getByRole('dialog', { name: 'Unlock' })).toBeVisible();
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
    await w.getByLabel('Your PIN').fill('1234'); // owner PIN is required (10-multi-device-vault §3.2)
    await w.getByLabel('Confirm PIN').fill('1234');
    await w.getByRole('button', { name: /create profile/i }).click();

    // Recovery phrase shown once, then into the app as the owner.
    await expect(w.getByRole('heading', { name: 'Write this down' })).toBeVisible();
    await w.getByRole('button', { name: /saved it/i }).click();
    await expect(w.getByRole('link', { name: 'Home' })).toBeVisible();
    await expect(w.getByRole('button', { name: 'Signed in as Alex' })).toBeVisible();

    // The owner now has a PIN: locking and re-picking them prompts for it (not an instant resume).
    await w.getByRole('button', { name: 'Signed in as Alex' }).click();
    await w.getByRole('menuitem', { name: 'Lock' }).click();
    await w.getByRole('dialog', { name: 'Locked' }).getByText('Alex').click();
    await expect(w.getByLabel('PIN for Alex')).toBeVisible();
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
    await expect(w.getByText('Admin only')).toBeVisible(); // admin-only marker on the Budget tab
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

    // Switch to Jordan via the TopBar account menu → "Switch person".
    await w.getByRole('button', { name: /signed in as/i }).click();
    await w.getByRole('menuitem', { name: 'Switch person' }).click();
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
    await longPressVersion(w);
    const dialog = w.getByRole('dialog', { name: 'Unlock' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Passphrase').fill('superpass');
    await dialog.getByRole('button', { name: 'Unlock' }).click();

    // Inspect mode is active — the (only-now-visible) super-admin badge appears in the account area.
    await expect(w.getByText('Super-admin')).toBeVisible();

    // The legacy device-local hash was migrated into the vault on unlock (10-multi-device-vault §6.4),
    // so the super-admin secret is now one-per-directory and works on any device that opens this vault.
    await expect(readFile(join(vault, 'config', 'superadmin.enc'), 'utf8')).resolves.toContain(
      'alg',
    );
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
  const secrets = createNodeSecretStore(userData, passthrough);
  const fs = createNodeFileSystem(vault);
  await createMasterKey(secrets, fs);
  const key = await loadMasterKey(secrets);
  if (!key) throw new Error('super-admin e2e: master key missing');
  await savePerson(fs, key, {
    id: 'owner-1',
    schemaVersion: 1,
    displayName: 'Alex',
    isSubject: true,
    tags: [],
    createdAt: now,
    updatedAt: now,
  });
  await savePerson(fs, key, {
    id: 'member-1',
    schemaVersion: 1,
    displayName: 'Sam',
    isSubject: true,
    tags: [],
    createdAt: now,
    updatedAt: now,
  });
  await setAccount(fs, key, { personId: 'owner-1', roleId: 'owner' });
  await setAccount(fs, key, { personId: 'member-1', roleId: 'member' });
  await recordUsage(fs, key, {
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
    superAdminPassphraseHash: await hashPin('superpass'),
  });

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    // As a member: no admin person picker, no People nav, no cost figure.
    await w.getByRole('link', { name: 'Usage' }).click();
    await expect(w.getByLabel('Whose usage')).toHaveCount(0);
    await expect(w.getByRole('link', { name: 'People' })).toHaveCount(0);
    await expect(w.getByRole('heading', { name: '$3.00' })).toHaveCount(0);
    await expect(w.getByText('Admin only')).toHaveCount(0); // no admin markers for a normal user

    // Unlock super-admin via the concealed long-press on the version.
    await w.getByRole('link', { name: 'Settings' }).click();
    await w.getByRole('button', { name: 'About' }).click();
    await longPressVersion(w);
    const dialog = w.getByRole('dialog', { name: 'Unlock' });
    await dialog.getByLabel('Passphrase').fill('superpass');
    await dialog.getByRole('button', { name: 'Unlock' }).click();
    await expect(w.getByText('Super-admin')).toBeVisible();

    // Now main grants full access: cost is shown and the owner's usage appears (app scope allowed).
    await w.getByRole('link', { name: 'Usage' }).click();
    await expect(w.getByLabel('Whose usage')).toBeVisible();
    await expect(w.getByText('Admin only').first()).toBeVisible(); // markers appear once elevated
    await expect(w.getByRole('heading', { name: '$3.00' })).toBeVisible();
    await expect(w.getByRole('heading', { name: 'By person' })).toBeVisible();
    await expect(w.getByRole('option', { name: 'Alex' })).toBeAttached();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('owner: a vault persisted before newer capabilities still grants full budget/usage access', async () => {
  // Reproduces a real vault created before `budgets.manage` existed: access.enc has an Owner role
  // whose stored capability map lacks it. The Owner must still get full access (roleAllows owner rule).
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
  const secrets = createNodeSecretStore(userData, passthrough);
  const fs = createNodeFileSystem(vault);
  await createMasterKey(secrets, fs);
  const key = await loadMasterKey(secrets);
  if (!key) throw new Error('owner e2e: master key missing');
  await savePerson(fs, key, {
    id: 'owner-1',
    schemaVersion: 1,
    displayName: 'Alex',
    isSubject: true,
    tags: [],
    createdAt: now,
    updatedAt: now,
  });
  // Stale Owner role — note: NO budgets.manage, as a pre-Metering-3 vault.
  await writeEncryptedJson(
    fs,
    'config/access.enc',
    {
      schemaVersion: 1,
      roles: [
        {
          id: 'owner',
          name: 'Owner',
          builtin: true,
          capabilities: {
            'people.manage': true,
            'people.viewOthers': true,
            'relationships.manage': true,
            'settings.manage': true,
            'users.manage': true,
            'roles.manage': true,
            'sessions.own': true,
          },
        },
      ],
      accounts: [{ personId: 'owner-1', roleId: 'owner' }],
    },
    key,
  );
  await recordUsage(fs, key, {
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
    costUsd: 2,
  });
  await writeJson(join(userData, 'state.json'), {
    schemaVersion: 1,
    vaultPath: vault,
    activePersonId: 'owner-1',
    superAdminPassphraseHash: await hashPin('superpass'),
  });

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    // Full usage access: the admin picker, the cost figure, and the by-person breakdown.
    await w.getByRole('link', { name: 'Usage' }).click();
    await expect(w.getByLabel('Whose usage')).toBeVisible();
    await expect(w.getByRole('heading', { name: '$2.00' })).toBeVisible();
    await expect(w.getByRole('heading', { name: 'By person' })).toBeVisible();

    // Full budget-config access: set the owner's budget on the person page.
    await w.getByRole('link', { name: 'People' }).click();
    await w.getByRole('button', { name: 'Alex Subject' }).click();
    await w.getByRole('button', { name: 'Budget', exact: true }).click();
    await w.getByLabel('Limit (USD)').fill('15');
    await w.getByRole('button', { name: 'Save budget' }).click();
    await expect(w.getByText('Saved.')).toBeVisible();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('sessions: send a message, stream a reply, and show the usage header + crisis footer', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await expect(w.getByRole('button', { name: /AI usage/i })).toBeVisible(); // global usage ring (no cost shown)
    await w.getByRole('link', { name: 'Sessions' }).click();
    await w.getByLabel('Message').fill('I had a hard day');
    await w.getByRole('button', { name: 'Send' }).click();

    // `.first()` tolerates the brief stream→persist handoff where the streaming bubble and the saved
    // message both match.
    await expect(w.getByText(/hear you/i).first()).toBeVisible(); // offline fake reply
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

test('sessions: switching accounts immediately clears the previous person’s sessions', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();

    // Owner creates a session and renames it to a recognizable marker.
    await w.getByRole('link', { name: 'Sessions' }).click();
    await w.getByLabel('Message').fill('owner private note');
    await w.getByRole('button', { name: 'Send' }).click();
    await expect(w.getByText(/hear you/i).first()).toBeVisible();
    await w.getByRole('button', { name: /^Rename / }).click();
    const title = w.getByLabel('Session title');
    await title.fill('OWNER-ONLY SESSION');
    await title.press('Enter');
    await expect(w.getByText('OWNER-ONLY SESSION')).toBeVisible();

    // Grant a member (Jordan, no PIN).
    await w.getByRole('link', { name: 'People' }).click();
    await w.getByRole('button', { name: 'Add person' }).click();
    await w.getByLabel('Name').fill('Jordan');
    await w.getByRole('button', { name: 'Create' }).click();
    await w.getByText('Jordan').click();
    await w.getByRole('button', { name: 'Access' }).click();
    await w.getByRole('button', { name: 'Grant access' }).click();
    await expect(w.getByText(/can sign in/i)).toBeVisible();

    // Back on the Sessions screen as the owner — the owner's session is there.
    await w.getByRole('link', { name: 'Sessions' }).click();
    await expect(w.getByText('OWNER-ONLY SESSION')).toBeVisible();

    // Switch to Jordan WHILE on Sessions (the screen stays mounted — this is the bug's trigger).
    await w.getByRole('button', { name: /signed in as/i }).click();
    await w.getByRole('menuitem', { name: 'Switch person' }).click();
    await w
      .getByRole('dialog', { name: /who.s here/i })
      .getByText('Jordan')
      .click();
    await expect(w.getByRole('button', { name: 'Signed in as Jordan' })).toBeVisible();

    // Jordan must NOT see the owner's session — it used to linger until a later reload.
    await expect(w.getByText('OWNER-ONLY SESSION')).toHaveCount(0);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('usage: the dashboard shows recorded usage and accepts a budget, without overflow', async () => {
  const { userData, vault } = await seedReadyVault();
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('usage e2e: master key missing');
  await recordUsage(createNodeFileSystem(vault), key, {
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

test('questionnaires: author a single-choice questionnaire, validate, persist, no overflow', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Questionnaires' }).click();
    await expect(w.getByRole('heading', { name: 'Questionnaires' })).toBeVisible();
    await expect(w.getByText(/no questionnaires yet/i)).toBeVisible();

    // Build a questionnaire with one single-choice question and three options.
    await w.getByRole('button', { name: 'New' }).click();
    await w.getByLabel('Title').fill('Weekly check-in');
    await w.getByLabel('Question 1', { exact: true }).fill('How satisfied are you?');
    await w.getByLabel('Answer type').selectOption({ label: 'Single choice' });
    await w.getByLabel('Option 1', { exact: true }).fill('Very');
    await w.getByLabel('Option 2', { exact: true }).fill('Somewhat');
    await w.getByRole('button', { name: 'Add option' }).click();
    await w.getByLabel('Option 3', { exact: true }).fill('Not at all');

    // Validation should pass, then save.
    await w.getByRole('button', { name: 'Check' }).click();
    await expect(w.getByText(/ready to send/i)).toBeVisible();
    await w.getByRole('button', { name: 'Create' }).click();

    // The new questionnaire shows in the list with its question count.
    await expect(w.getByRole('button', { name: /Weekly check-in/ })).toBeVisible();
    await expect(w.getByText('1 question')).toBeVisible();

    // Reopen and confirm the title + options round-tripped through the encrypted vault.
    await w.getByRole('button', { name: /Weekly check-in/ }).click();
    await expect(w.getByLabel('Title')).toHaveValue('Weekly check-in');
    await expect(w.getByLabel('Option 1', { exact: true })).toHaveValue('Very');
    await expect(w.getByLabel('Option 3', { exact: true })).toHaveValue('Not at all');

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

test('questionnaires: custom type, sensitivity, matrix + branching round-trip', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Questionnaires' }).click();
    await w.getByRole('button', { name: 'New' }).click();
    await w.getByLabel('Title').fill('Date-night check-in');

    // A custom type the user names — it becomes the selected type and persists for next time.
    await w.getByRole('button', { name: 'New type' }).click();
    await w.getByLabel('New type name').fill('Date night');
    await w.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(w.getByLabel('Type', { exact: true })).toHaveValue('Date night');

    // A sensitive tier shows the author note (the actual gates apply at send time).
    await w.getByLabel('Sensitivity').selectOption('explicit');
    await expect(w.getByText(/date of birth and consent/i)).toBeVisible();

    // Q1: single choice (a valid branch trigger).
    await w.getByLabel('Question 1', { exact: true }).fill('Are you partnered?');
    await w.getByLabel('Answer type').selectOption({ label: 'Single choice' });
    await w.getByLabel('Option 1', { exact: true }).fill('Yes');
    await w.getByLabel('Option 2', { exact: true }).fill('No');

    // Q2: a matrix question that only shows when Q1 = Yes.
    await w.getByRole('button', { name: 'Add question' }).click();
    await w.getByLabel('Question 2', { exact: true }).fill('Rate these together');
    await w.getByLabel('Answer type').nth(1).selectOption({ label: 'Matrix (rows on one scale)' });
    await w.getByLabel('Row 1', { exact: true }).fill('Trust');
    await w.getByLabel('Row 2', { exact: true }).fill('Fun');
    await w.getByLabel('Only show this question').selectOption({ index: 1 });
    await w.getByLabel('…equals').selectOption('Yes');

    // Validate, then save.
    await w.getByRole('button', { name: 'Check' }).click();
    await expect(w.getByText(/ready to send/i)).toBeVisible();
    await w.getByRole('button', { name: 'Create' }).click();
    await expect(w.getByText('2 questions')).toBeVisible();

    // Reopen and confirm everything round-tripped through the encrypted vault.
    await w.getByRole('button', { name: /Date-night check-in/ }).click();
    await expect(w.getByLabel('Type', { exact: true })).toHaveValue('Date night');
    await expect(w.getByLabel('Sensitivity')).toHaveValue('explicit');
    await expect(w.getByLabel('Row 1', { exact: true })).toHaveValue('Trust');
    await expect(w.getByLabel('…equals')).toHaveValue('Yes');

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

test('questionnaires: preview / test-on-self renders the form, gates Finish, saves nothing', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Questionnaires' }).click();
    await w.getByRole('button', { name: 'New' }).click();
    await w.getByLabel('Title').fill('Dry run');
    await w.getByLabel('Question 1', { exact: true }).fill('How are you feeling?');
    await w.getByLabel('Answer type').selectOption({ label: 'Rating' });

    // Switch to Preview — the answering form + crisis footer render exactly as the recipient sees them.
    await w.getByRole('button', { name: 'Preview' }).click();
    await expect(w.getByText(/exactly what your recipient sees/i)).toBeVisible();
    await expect(w.getByRole('button', { name: /get help now/i })).toBeVisible();

    // Finish is gated on the required (and unanswered) rating.
    await w.getByRole('button', { name: 'Finish' }).click();
    await expect(w.getByText(/answer the 1 required question to finish/i)).toBeVisible();

    // Answer it on the 1→5 scale, then Finish confirms the dry run saved nothing.
    await w.getByRole('radio', { name: '4', exact: true }).click();
    await w.getByRole('button', { name: 'Finish' }).click();
    await expect(w.getByText(/nothing you entered was saved/i)).toBeVisible();

    // Nothing was persisted — the list still shows no saved questionnaire for this draft.
    await expect(w.getByRole('button', { name: /Dry run/ })).toHaveCount(0);

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

test('questionnaires: attach an encrypted image, require alt, round-trip + show in preview', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Questionnaires' }).click();
    await w.getByRole('button', { name: 'New' }).click();
    await w.getByLabel('Title').fill('Photo prompt');
    await w.getByLabel('Question 1', { exact: true }).fill('What stands out?');

    // Attach a real (tiny) PNG through the hidden file input.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    await w.locator('input[type="file"]').setInputFiles({
      name: 'shot.png',
      mimeType: 'image/png',
      buffer: png,
    });
    await expect(w.getByLabel('Image description (alt text)')).toBeVisible();

    // Accessibility: Check flags the missing alt text, then clears once it's provided.
    await w.getByRole('button', { name: 'Check' }).click();
    await expect(w.getByText(/needs a description \(alt text\)/i)).toBeVisible();
    await w.getByLabel('Image description (alt text)').fill('A test image');
    await w.getByRole('button', { name: 'Check' }).click();
    await expect(w.getByText(/ready to send/i)).toBeVisible();

    await w.getByRole('button', { name: 'Create' }).click();

    // Reopen: the alt text round-tripped through the encrypted vault and the image still loads.
    await w.getByRole('button', { name: /Photo prompt/ }).click();
    await expect(w.getByLabel('Image description (alt text)')).toHaveValue('A test image');
    await expect(w.getByRole('img', { name: 'A test image' })).toBeVisible();

    // It also renders in the recipient-facing preview.
    await w.getByRole('button', { name: 'Preview' }).click();
    await expect(w.getByRole('img', { name: 'A test image' })).toBeVisible();

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

test('questionnaires: AI draft + Suggested surfaces show calm enable-AI states', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Questionnaires' }).click();

    // Builder: with AI off, the "Draft with AI" panel prompts to enable it (never an error).
    await w.getByRole('button', { name: 'New' }).click();
    await expect(w.getByText(/turn on ai in settings to draft questions/i)).toBeVisible();

    // Suggested (gap-finder) opens its own surface with the same calm state.
    await w.getByRole('button', { name: 'Suggested' }).click();
    await expect(w.getByRole('heading', { name: /suggested for you/i })).toBeVisible();
    await expect(w.getByText(/turn on ai in settings to get suggestions/i)).toBeVisible();

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

test('questionnaires: the AI draft panel + Suggested surface fit at phone width', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    // Configure a (fake) key so the AI surfaces become ready (not the calm enable state).
    await w.getByRole('link', { name: 'Settings' }).click();
    await w.getByRole('button', { name: 'AI', exact: true }).click();
    await w.getByLabel('Claude API key').fill('sk-ant-e2e');
    await w.getByRole('button', { name: /save key/i }).click();
    await expect(w.getByText(/key is configured/i)).toBeVisible();

    const resize = (width: number): Promise<void> =>
      app.evaluate(async ({ BrowserWindow }, w2) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) {
          win.setMinimumSize(360, 480);
          win.setSize(w2, 800);
        }
      }, width);
    const overflow = (): Promise<number> =>
      w.evaluate(() => {
        const inner = document.querySelector('main > div');
        return inner ? inner.scrollWidth - inner.clientWidth : 0;
      });

    // Navigate + open each surface at desktop width (the nav is a hidden drawer on phones), then
    // shrink to 390px just to measure that the rendered surface fits.
    await w.getByRole('link', { name: 'Questionnaires' }).click();
    await w.getByRole('button', { name: 'New' }).click();
    // The "Draft with AI" panel is ready; expanding it shows the context toggles (a flex row).
    await w.getByRole('button', { name: /draft with ai/i }).click();
    await expect(w.getByText('Use my information')).toBeVisible();
    await resize(390);
    await w.waitForTimeout(150);
    expect(await overflow()).toBeLessThanOrEqual(1);

    // The Suggested (gap-finder) surface also fits — switch back to desktop to reach the list button.
    await resize(1100);
    await w.getByRole('button', { name: 'Suggested' }).click();
    await expect(w.getByRole('button', { name: /suggest questionnaires/i })).toBeVisible();
    await resize(390);
    await w.waitForTimeout(150);
    expect(await overflow()).toBeLessThanOrEqual(1);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('memory: the Insights surface shows its empty state + crisis affordance', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Memory' }).click();
    await expect(w.getByRole('heading', { name: 'Memory' })).toBeVisible();
    // No analyzed answers yet (the live producer wires up with the Inbox, §13.5).
    await expect(w.getByText(/nothing here yet/i)).toBeVisible();
    // The not-medical line + crisis affordance are always present on this surface.
    await expect(w.getByText(/not medical care/i)).toBeVisible();
    await expect(w.getByRole('button', { name: /get help now/i })).toBeVisible();

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

test('inbox: send a questionnaire, answer it, submit, and round-trip through the encrypted vault', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();

    // Author a one-question questionnaire.
    await w.getByRole('link', { name: 'Questionnaires' }).click();
    await w.getByRole('button', { name: 'New' }).click();
    await w.getByLabel('Title').fill('Weekly check-in');
    await w.getByLabel('Question 1', { exact: true }).fill('How are we doing?');

    // Send it (to self — a valid self check-in). Private is the default privacy mode.
    await w.getByRole('button', { name: 'Send' }).click();
    await expect(w.getByRole('heading', { name: /Send .Weekly check-in/ })).toBeVisible();
    await expect(w.getByRole('button', { name: 'Private' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await w.getByLabel('Send to').selectOption({ label: 'Tester' });
    await w.getByRole('button', { name: 'Send' }).last().click();
    await expect(w.getByText(/Sent to Tester/)).toBeVisible();
    await w.getByRole('button', { name: 'Done' }).click();

    // It arrives in the recipient's (here, the same person's) Inbox, flagged New.
    await w.getByRole('link', { name: /Inbox/ }).click();
    await expect(w.getByRole('heading', { name: 'Inbox' })).toBeVisible();
    await expect(w.getByText('New')).toBeVisible();
    await w.getByRole('button', { name: /Weekly check-in/ }).click();

    // The answer pane shows the Private promise + the always-present crisis affordance.
    await expect(w.getByText(/won’t see your individual responses/i)).toBeVisible();
    await expect(w.getByRole('button', { name: /get help now/i })).toBeVisible();

    // Answer and submit; the row then reads Submitted.
    await w.getByLabel('How are we doing?').fill('Doing great');
    await w.getByRole('button', { name: 'Submit' }).click();
    await expect(w.getByText('Submitted')).toBeVisible();

    // No horizontal overflow on the Inbox.
    const overflow = await w.evaluate(() => {
      const main = document.querySelector('main');
      return main ? main.scrollWidth - main.clientWidth : 0;
    });
    expect(overflow).toBeLessThanOrEqual(1);

    // The answer round-tripped through the encrypted vault (a ResponseSet was written + the
    // assignment is locked at submitted) — proving the full IPC → core → at-rest path.
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('expected a master key');
    const assignments = await listAssignments(fs, key);
    expect(assignments).toHaveLength(1);
    const assignment = assignments[0];
    if (!assignment) throw new Error('expected an assignment');
    expect(assignment.status).toBe('submitted');
    expect(assignment.privacy).toBe('private');
    const response = await getResponse(fs, key, assignment.id);
    expect(response?.answers[0]?.value).toBe('Doing great');
    expect(response?.submittedAt).toBeTruthy();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('relay: connect a household relay, then mint an external link + PIN, no overflow', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();

    // Admin connects the relay (fake Cloudflare) in Settings → Relay.
    await w.getByRole('link', { name: 'Settings' }).click();
    await w.getByRole('button', { name: 'Relay' }).click();
    await expect(w.getByText('Admin only')).toBeVisible(); // the admin-only marker on the panel
    await w.getByLabel(/cloudflare account id/i).fill('acct-123');
    await w.getByLabel(/cloudflare api token/i).fill('cf-token');
    await w.getByRole('button', { name: /connect & deploy/i }).click();
    await expect(w.getByText(/relay connected at/i)).toBeVisible();
    await expect(w.getByText(/\.workers\.dev/i)).toBeVisible();

    // Author a one-question questionnaire and send it externally via the relay.
    await w.getByRole('link', { name: 'Questionnaires' }).click();
    await w.getByRole('button', { name: 'New' }).click();
    await w.getByLabel('Title').fill('Outside view');
    await w.getByLabel('Question 1', { exact: true }).fill('How do I come across?');
    await w.getByRole('button', { name: 'Send' }).click();

    await w.getByRole('button', { name: 'Someone else (link)' }).click();
    await w.getByLabel(/their name/i).fill('Alex');
    await w.getByRole('button', { name: /create link/i }).click();

    // The link (a workers.dev URL with the content key in the fragment) + a 6-digit PIN are shown once.
    await expect(w.getByText(/share this link/i)).toBeVisible();
    const link = await w.getByLabel('Secure link').inputValue();
    expect(link).toMatch(/\.workers\.dev\/q\/[0-9a-f]+#k=/);
    const pin = await w.getByLabel('PIN', { exact: true }).inputValue();
    expect(pin).toMatch(/^\d{6}$/);

    // No horizontal overflow on the delivery surface at phone width.
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.setSize(390, 800);
    });
    await w.waitForTimeout(150);
    const overflow = await w.evaluate(() => {
      const main = document.querySelector('main');
      return main ? main.scrollWidth - main.clientWidth : 0;
    });
    expect(overflow).toBeLessThanOrEqual(1);

    // The relay assignment landed in the encrypted vault (channel relay + relay key material).
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('expected a master key');
    const assignments = await listAssignments(fs, key);
    expect(assignments.some((a) => a.channel === 'relay' && a.relay?.token)).toBe(true);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('results: a Standard response surfaces the raw answers in the sender’s Results view', async () => {
  const { userData, vault } = await seedReadyVault(); // AI off → analysis is gated behind a calm prompt
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();

    // Author a one-question questionnaire.
    await w.getByRole('link', { name: 'Questionnaires' }).click();
    await w.getByRole('button', { name: 'New' }).click();
    await w.getByLabel('Title').fill('Weekly check-in');
    await w.getByLabel('Question 1', { exact: true }).fill('How are we doing?');

    // Send it to self, switching the privacy mode from the default Private to Standard.
    await w.getByRole('button', { name: 'Send' }).click();
    await w.getByRole('button', { name: 'Standard' }).click();
    await w.getByLabel('Send to').selectOption({ label: 'Tester' });
    await w.getByRole('button', { name: 'Send' }).last().click();
    await expect(w.getByText(/Sent to Tester/)).toBeVisible();
    await w.getByRole('button', { name: 'Done' }).click();

    // Answer + submit it from the Inbox.
    await w.getByRole('link', { name: /Inbox/ }).click();
    await w.getByRole('button', { name: /Weekly check-in/ }).click();
    await w.getByLabel('How are we doing?').fill('Doing great');
    await w.getByRole('button', { name: 'Submit' }).click();
    await expect(w.getByText('Submitted')).toBeVisible();

    // Open the questionnaire's Results tab — a Standard send shows the raw answers.
    await w.getByRole('link', { name: 'Questionnaires' }).click();
    await w.getByRole('button', { name: /Weekly check-in/ }).click();
    await w.getByRole('button', { name: 'Results' }).click();
    await expect(w.getByText('How are we doing?')).toBeVisible();
    await expect(w.getByText('Doing great')).toBeVisible();
    // AI is off, so analysis is offered via a calm Settings prompt (no dead Analyze button).
    await expect(w.getByText(/turn on ai/i)).toBeVisible();

    // No horizontal overflow at desktop or phone width.
    const overflow = (): Promise<number> =>
      w.evaluate(() => {
        const main = document.querySelector('main');
        return main ? main.scrollWidth - main.clientWidth : 0;
      });
    expect(await overflow()).toBeLessThanOrEqual(1);
    await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.setMinimumSize(360, 480);
        win.setSize(390, 800);
      }
    });
    await w.waitForTimeout(150);
    expect(await overflow()).toBeLessThanOrEqual(1);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('results: re-asks chart a trend, a send deletes, and the questionnaire purges', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();

    // Author a one-question rating questionnaire.
    await w.getByRole('link', { name: 'Questionnaires' }).click();
    await w.getByRole('button', { name: 'New' }).click();
    await w.getByLabel('Title').fill('Mood check');
    await w.getByLabel('Question 1', { exact: true }).fill('How connected do you feel?');
    await w.getByLabel('Answer type').selectOption({ label: 'Rating' });

    // Send it to self twice (a re-ask), answering each with a different rating.
    const sendToSelf = async (): Promise<void> => {
      await w.getByRole('button', { name: 'Send' }).click();
      await w.getByRole('button', { name: 'Standard' }).click();
      await w.getByLabel('Send to').selectOption({ label: 'Tester' });
      await w.getByRole('button', { name: 'Send' }).last().click();
      await w.getByRole('button', { name: 'Done' }).click();
    };
    await sendToSelf();
    await w.getByRole('button', { name: /Mood check/ }).click();
    await sendToSelf();

    // Answer both from the Inbox with ratings 2 then 5. Pick the still-unanswered "New" item, waiting
    // for the list to settle after each submit (else the just-submitted row is still briefly "New").
    await w.getByRole('link', { name: /Inbox/ }).click();
    const ratings = ['2', '5'];
    for (let i = 0; i < ratings.length; i++) {
      const newItems = w.getByRole('button', { name: /Mood check/ }).filter({ hasText: 'New' });
      await expect(newItems).toHaveCount(ratings.length - i);
      await newItems.first().click();
      await w.getByRole('radio', { name: ratings[i] }).click();
      await w.getByRole('button', { name: 'Submit', exact: true }).click();
    }

    // Results: both sends + a Trends chart for the rating question.
    await w.getByRole('link', { name: 'Questionnaires' }).click();
    await w.getByRole('button', { name: /Mood check/ }).click();
    await w.getByRole('button', { name: 'Results' }).click();
    await expect(w.getByRole('heading', { name: 'Trends' })).toBeVisible();
    await expect(w.getByRole('img', { name: /trend over time/i })).toBeVisible();

    // Delete one send — confirm inline, then it's gone (one card remains).
    expect(await w.getByRole('button', { name: /Delete this send/ }).count()).toBe(2);
    await w
      .getByRole('button', { name: /Delete this send/ })
      .first()
      .click();
    await w.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(w.getByRole('button', { name: /Delete this send/ })).toHaveCount(1);

    // Delete the whole questionnaire — confirm purge, back to an empty list.
    await w.getByRole('button', { name: 'Edit' }).click();
    await w.getByRole('button', { name: 'Delete questionnaire' }).click();
    await w.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(w.getByRole('button', { name: /Mood check/ })).toHaveCount(0);
    await expect(w.getByText(/no questionnaires yet/i)).toBeVisible();
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

test('compatibility: align two answered variants into a report + draft Insight, no overflow', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');

  // Seed an answered compatibility group: two people, a compat questionnaire, two paired sends each
  // submitted. This drives the sender's compat Results surface (align + report) without the UI
  // account-switching dance (the full dual-send + answer paths are covered by the coreBridge test).
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('expected a master key');
  const now = new Date().toISOString();
  for (const [id, name] of [
    ['alex-1', 'Alex'],
    ['bri-1', 'Bri'],
  ]) {
    await savePerson(fs, key, {
      id: id!,
      schemaVersion: 1,
      displayName: name!,
      isSubject: true,
      tags: [],
      createdAt: now,
      updatedAt: now,
    });
  }
  const q = await saveQuestionnaire(
    fs,
    key,
    {
      title: 'Compatibility check',
      type: 'role-feedback',
      sensitivity: 'standard',
      questions: [
        {
          id: 'c1',
          canonicalId: 'c1',
          type: 'rating',
          prompt: 'How connected do you feel?',
          required: true,
          scale: { min: 1, max: 5 },
        },
      ],
      compatibility: { enabled: true, visibility: 'sharedReport' },
    },
    'owner-1',
  );
  const variant = (label: string) =>
    q.questions.map((c) => ({ ...c, canonicalId: 'c1', prompt: `${label}: ${c.prompt}` }));
  const groupId = await createCompatibilitySend(fs, key, {
    questionnaireId: q.id,
    senderPersonId: 'owner-1',
    visibility: 'sharedReport',
    recipients: [
      { personId: 'alex-1', questions: variant('Alex') },
      { personId: 'bri-1', questions: variant('Bri') },
    ],
  });
  const members = (await listAssignments(fs, key)).filter(
    (a) => a.compatibilityGroupId === groupId,
  );
  await submitResponse(fs, key, {
    assignmentId: members[0]!.id,
    answers: [{ questionId: 'c1', value: 4 }],
  });
  await submitResponse(fs, key, {
    assignmentId: members[1]!.id,
    answers: [{ questionId: 'c1', value: 2 }],
  });

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Questionnaires' }).click();
    await w.getByRole('button', { name: /Compatibility check/ }).click();
    await w.getByRole('button', { name: 'Results' }).click();

    // The compat Results surface shows the paired group as "Both answered" and offers to align.
    await expect(w.getByText('Both answered')).toBeVisible();
    await w.getByRole('button', { name: /Generate alignment/ }).click();

    // The (offline fake) alignment returns a report → its summary + the "review in Memory" Insight link.
    await expect(w.getByText(/largely aligned/i)).toBeVisible();
    await expect(w.getByText(/Review it in Memory/)).toBeVisible();

    // The report + a draft Insight (subject = the sender) round-tripped through the encrypted vault.
    expect((await getAlignmentReport(fs, key, groupId))?.summary).toContain('aligned');
    const insights = await listInsightsForPerson(fs, key, 'owner-1');
    expect(insights.some((i) => i.provenance.compatibilityGroupId === groupId)).toBe(true);

    // No horizontal overflow at desktop or phone width.
    const overflow = (): Promise<number> =>
      w.evaluate(() => {
        const main = document.querySelector('main');
        return main ? main.scrollWidth - main.clientWidth : 0;
      });
    expect(await overflow()).toBeLessThanOrEqual(1);
    await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.setMinimumSize(360, 480);
        win.setSize(390, 800);
      }
    });
    await w.waitForTimeout(150);
    expect(await overflow()).toBeLessThanOrEqual(1);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('audit: super-admin sees the raw-access audit surface (empty until a reveal)', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Settings' }).click();
    await w.getByRole('button', { name: 'About' }).click();
    await longPressVersion(w);
    const dialog = w.getByRole('dialog', { name: 'Unlock' });
    await dialog.getByLabel('Passphrase').fill('superpass');
    await dialog.getByRole('button', { name: 'Unlock' }).click();
    await expect(w.getByText('Super-admin')).toBeVisible();

    // The Audit nav entry appears only in super-admin mode; the surface shows its empty state.
    await w.getByRole('link', { name: 'Raw-access audit' }).click();
    await expect(w.getByRole('heading', { name: 'Raw-access audit' })).toBeVisible();
    await expect(w.getByText('No raw answers have ever been revealed.')).toBeVisible();

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

test('dreams: log a dream, persist through the encrypted vault, reopen, no overflow', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Dreams' }).click();
    await expect(w.getByRole('heading', { name: 'Dreams' })).toBeVisible();
    await expect(w.getByText(/no dreams yet/i)).toBeVisible();

    // Capture: narrative-first, plus a couple of optional fields.
    await w.getByRole('button', { name: 'Log a dream' }).click();
    await w
      .getByLabel('What happened?')
      .fill('I was back in my childhood house, rooms rearranging.');
    await w.getByLabel('Title (optional)').fill('The rearranging house');
    await w.getByRole('switch', { name: 'Lucid dream' }).click();
    await w.getByLabel('Waking mood').selectOption({ label: 'Good' });
    await w.getByLabel('Vividness').selectOption('5');
    await w.getByRole('button', { name: 'Save' }).click();

    // It appears in the journal.
    await expect(w.getByRole('button', { name: /The rearranging house/ })).toBeVisible();

    // Reopen → the fields round-tripped through the encrypted vault.
    await w.getByRole('button', { name: /The rearranging house/ }).click();
    await expect(w.getByLabel('Title (optional)')).toHaveValue('The rearranging house');
    await expect(w.getByLabel('What happened?')).toHaveValue(
      'I was back in my childhood house, rooms rearranging.',
    );
    await expect(w.getByLabel('Vividness')).toHaveValue('5');
    await expect(w.getByRole('switch', { name: 'Lucid dream' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

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

test('dreams: link a household person to a dream and round-trip the link, no overflow', async () => {
  const { userData, vault } = await seedReadyVault();
  // Seed a second household person the dreamer can link from the People graph (12 §3.1).
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('seed: master key missing');
  const now = new Date().toISOString();
  await savePerson(fs, key, {
    id: 'p-sam',
    schemaVersion: 1,
    displayName: 'Sam',
    isSubject: true,
    tags: [],
    publicNotes: 'a close friend',
    createdAt: now,
    updatedAt: now,
  });

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Dreams' }).click();
    await w.getByRole('button', { name: 'Log a dream' }).click();
    await w.getByLabel('What happened?').fill('Sam and I were walking by the sea.');
    await w.getByLabel('Title (optional)').fill('Walking with Sam');

    // Link Sam → a "linked" chip appears (carrying a personId, not a free name).
    await w.getByLabel('Link a person you know').selectOption({ label: 'Sam' });
    await expect(w.getByText('linked')).toBeVisible();
    // A free name alongside the link — both chip styles coexist.
    await w.getByPlaceholder(/add a name/i).fill('a stranger');
    await w.getByPlaceholder(/add a name/i).press('Enter');
    await expect(w.getByRole('button', { name: 'Remove a stranger' })).toBeVisible();
    await w.getByRole('button', { name: 'Save' }).click();

    // Reopen → the link round-tripped through the encrypted vault. The stored personId resolves back to
    // the household name "Sam" (the Remove control's label) and still reads as a linked chip.
    await w.getByRole('button', { name: /Walking with Sam/ }).click();
    await expect(w.getByRole('button', { name: 'Remove Sam' })).toBeVisible();
    await expect(w.getByText('linked')).toBeVisible();

    // The composer (incl. the picker) fits at phone width.
    await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.setMinimumSize(360, 480);
        win.setSize(390, 800);
      }
    });
    await w.waitForTimeout(200);
    const noOverflow = await w.evaluate(() => {
      const fits = (el: Element | null | undefined): boolean =>
        !el || el.scrollWidth <= el.clientWidth + 1;
      const main = document.querySelector('main');
      const inner = main?.querySelector(':scope > div');
      return fits(main) && fits(inner);
    });
    expect(noOverflow).toBe(true);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('dreams: analyze → synthesize → edit → approve feeds the coach; the transcript stays out of Sessions', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();

    // Capture a dream.
    await w.getByRole('link', { name: 'Dreams' }).click();
    await w.getByRole('button', { name: 'Log a dream' }).click();
    await w
      .getByLabel('What happened?')
      .fill('I was back in my childhood house, rooms rearranging.');
    await w.getByLabel('Title (optional)').fill('The rearranging house');
    await w.getByRole('button', { name: 'Save' }).click();

    // Enter the in-pane analysis surface.
    await w.getByRole('button', { name: /The rearranging house/ }).click();
    await w.getByRole('button', { name: 'Analyze this dream' }).click();
    await expect(w.getByRole('heading', { name: 'Dream analysis' })).toBeVisible();

    // A guided turn streams the reflective reply.
    await w.getByLabel('Message').fill('It felt unsettling but oddly familiar.');
    await w.getByRole('button', { name: 'Send' }).click();
    await expect(w.getByText(/hear you/i).first()).toBeVisible();

    // Synthesize → the structured card.
    await w.getByRole('button', { name: 'Create analysis' }).click();
    await expect(w.getByRole('heading', { name: 'Your dream analysis' })).toBeVisible();
    await expect(w.getByText(/shifting rooms and open skies/i)).toBeVisible();

    // Edit a section (read-first → Edit toggle → Save).
    await w.getByRole('button', { name: 'Edit' }).click();
    await w.getByLabel('Summary').fill('My own retelling of the dream.');
    await w.getByRole('button', { name: 'Save changes' }).click();
    await expect(w.getByText('My own retelling of the dream.')).toBeVisible();

    // The analysis surface fits at phone width (no horizontal overflow).
    await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.setMinimumSize(360, 480);
        win.setSize(390, 800);
      }
    });
    await w.waitForTimeout(200);
    const noOverflow = await w.evaluate(() => {
      const fits = (el: Element | null | undefined): boolean =>
        !el || el.scrollWidth <= el.clientWidth + 1;
      const main = document.querySelector('main');
      const inner = main?.querySelector(':scope > div');
      return fits(main) && fits(inner);
    });
    expect(noOverflow).toBe(true);
    await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.setSize(1200, 800);
    });
    await w.waitForTimeout(150);

    // Approve → the badge; the dream Insight now feeds the coach.
    await w.getByRole('button', { name: /add to my coaching context/i }).click();
    await expect(w.getByText(/in your coaching context/i)).toBeVisible();

    // Proof of grounding: the approved dream Insight is what buildContext feeds the coach. Read it
    // straight from the encrypted vault (the system prompt itself isn't observable in the UI).
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('master key missing');
    await expect
      .poll(async () => {
        const insights = await listInsightsForPerson(fs, key, 'owner-1');
        return insights.some((insight) => insight.source === 'dream');
      })
      .toBe(true);
    const grounding = await summarizeForContext(fs, key, 'owner-1', []);
    expect(grounding).toContain('My own retelling of the dream.');

    // The dream's guided transcript NEVER appears in the Sessions list (it lives under the dream).
    await w.getByRole('link', { name: 'Sessions' }).click();
    await expect(w.getByText('The rearranging house')).toHaveCount(0);
    // Sessions remains its own independent surface.
    await w.getByLabel('Message').fill('A fresh, unrelated session.');
    await w.getByRole('button', { name: 'Send' }).click();
    await expect(w.getByText(/hear you/i).first()).toBeVisible();
    await expect(w.getByText('The rearranging house')).toHaveCount(0);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('dreams: the Patterns screen charts seeded dreams, nudges on recurring nightmares, approves a narrative', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');

  // Seed dreams straight into the encrypted vault: 3 recent nightmares (→ the nudge) + one analyzed
  // dream with structured tags (→ the charts) — faster + more deterministic than logging via the UI.
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('seed: master key missing');
  const at = new Date().toISOString();
  for (let i = 0; i < 3; i++) {
    await saveDream(fs, key, {
      id: `nm${i}`,
      schemaVersion: 1,
      personId: 'owner-1',
      narrative: `A storm at sea (${i}).`,
      lucid: false,
      nightmare: true,
      tags: [],
      people: [],
      sensitivity: 'standard',
      status: 'captured',
      createdAt: at,
      updatedAt: at,
    });
  }
  await saveDream(fs, key, {
    id: 'd-analyzed',
    schemaVersion: 1,
    personId: 'owner-1',
    narrative: 'I was back in my childhood house, rooms rearranging.',
    lucid: true,
    nightmare: false,
    tags: [],
    people: [{ name: 'Mara' }],
    sensitivity: 'standard',
    status: 'analyzed',
    analysisId: 'a1',
    createdAt: at,
    updatedAt: at,
  });
  await saveAnalysis(fs, key, {
    id: 'a1',
    schemaVersion: 1,
    dreamId: 'd-analyzed',
    personId: 'owner-1',
    summary: 'A dream of a shifting house.',
    emotionalLandscape: '',
    wakingLifeConnections: '',
    notableImages: '',
    reflectiveQuestions: [],
    tags: {
      emotions: ['unease'],
      symbols: ['house'],
      settings: [],
      themes: ['change'],
      people: ['Mara'],
    },
    edited: false,
    generatedAt: at,
    updatedAt: at,
  });

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Dreams' }).click();
    await w.getByRole('button', { name: 'Patterns' }).click();
    await expect(w.getByRole('heading', { name: 'Dream patterns' })).toBeVisible();

    // Deterministic charts render from the seeded data (no AI needed).
    await expect(w.getByText('house')).toBeVisible(); // a recurring symbol
    await expect(w.getByText('Mara')).toBeVisible(); // a person who appears
    await expect(w.getByText(/3 of 4/)).toBeVisible(); // nightmares of total

    // The recurring-nightmare nudge fires (3 nightmares within the window).
    await expect(w.getByText(/recurring nightmares can be worth talking through/i)).toBeVisible();

    // Generate the on-demand AI narrative → approve it into the coaching context.
    await w.getByRole('button', { name: 'Generate a reflection' }).click();
    await expect(w.getByText(/hear you/i)).toBeVisible(); // the offline fake reflection
    await w.getByRole('button', { name: /add to my coaching context/i }).click();
    await expect(w.getByText(/in your coaching context/i)).toBeVisible();

    // The chart grid fits at phone width with no horizontal overflow.
    await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.setMinimumSize(360, 480);
        win.setSize(390, 800);
      }
    });
    await w.waitForTimeout(200);
    const noOverflow = await w.evaluate(() => {
      const fits = (el: Element | null | undefined): boolean =>
        !el || el.scrollWidth <= el.clientWidth + 1;
      const main = document.querySelector('main');
      const inner = main?.querySelector(':scope > div');
      return fits(main) && fits(inner);
    });
    expect(noOverflow).toBe(true);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('dreams: share an approved insight fact into a related person’s coaching context', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');

  // Seed a related person (Partner) + an owner↔partner relationship so there's someone to share with.
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('seed: master key missing');
  const at = new Date().toISOString();
  await savePerson(fs, key, {
    id: 'p2',
    schemaVersion: 1,
    displayName: 'Partner',
    isSubject: true,
    tags: [],
    createdAt: at,
    updatedAt: at,
  });
  await saveRelationship(fs, key, {
    id: 'r1',
    schemaVersion: 1,
    fromPersonId: 'owner-1',
    toPersonId: 'p2',
    type: 'partner',
    createdAt: at,
    updatedAt: at,
  });

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();

    // Capture → analyze → approve.
    await w.getByRole('link', { name: 'Dreams' }).click();
    await w.getByRole('button', { name: 'Log a dream' }).click();
    await w.getByLabel('What happened?').fill('A dream about my partner and our home.');
    await w.getByLabel('Title (optional)').fill('Our home');
    await w.getByRole('button', { name: 'Save' }).click();
    await w.getByRole('button', { name: /Our home/ }).click();
    await w.getByRole('button', { name: 'Analyze this dream' }).click();
    await w.getByRole('button', { name: 'Create analysis' }).click();
    await expect(w.getByRole('heading', { name: 'Your dream analysis' })).toBeVisible();
    await w.getByRole('button', { name: /add to my coaching context/i }).click();
    await expect(w.getByText(/in your coaching context/i)).toBeVisible();

    // The share controls appear; share the first fact with Partner (the only switches on this surface).
    await expect(w.getByText('Share with someone in your life')).toBeVisible();
    await w.getByRole('switch').first().click();

    // From the vault: the fact is now targeted at Partner AND reaches THEIR coaching grounding.
    await expect
      .poll(async () => {
        const insights = await listInsightsForPerson(fs, key, 'owner-1');
        return insights
          .flatMap((insight) => insight.facts)
          .some((fact) => (fact.shareableWith ?? []).includes('p2'));
      })
      .toBe(true);
    const partnerCtx = await summarizeForContext(fs, key, 'p2', [
      { id: 'owner-1', displayName: 'Tester' },
    ]);
    expect(partnerCtx).toContain('Perhaps something at home feels like it is changing.');

    // The share surface fits at phone width.
    await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.setMinimumSize(360, 480);
        win.setSize(390, 800);
      }
    });
    await w.waitForTimeout(200);
    const noOverflow = await w.evaluate(() => {
      const fits = (el: Element | null | undefined): boolean =>
        !el || el.scrollWidth <= el.clientWidth + 1;
      const main = document.querySelector('main');
      const inner = main?.querySelector(':scope > div');
      return fits(main) && fits(inner);
    });
    expect(noOverflow).toBe(true);
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
    superAdminPassphraseHash: await hashPin('superpass'),
  });
  return { userData, vault };
}

test('settings: changing the theme applies it and persists to the vault', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Home' }).waitFor();
    // Open the compact top-bar appearance menu and pick Dark.
    await w.getByRole('button', { name: /Appearance/ }).click();
    await w.getByRole('menuitemradio', { name: 'Dark' }).click();
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

test('shell: locking from the account menu gates the app, and resuming returns to it', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await expect(w.getByRole('link', { name: 'Home' })).toBeVisible();

    // Lock from the TopBar account menu.
    await w.getByRole('button', { name: /signed in as/i }).click();
    await w.getByRole('menuitem', { name: 'Lock' }).click();

    // The full-screen lock gate covers the app.
    const lock = w.getByRole('dialog', { name: 'Locked' });
    await expect(lock).toBeVisible();
    await expect(w.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

    // Resume as the PIN-less owner → back in the app.
    await lock.getByText('Tester').click();
    await expect(w.getByRole('dialog', { name: 'Locked' })).toHaveCount(0);
    await expect(w.getByRole('link', { name: 'Home' })).toBeVisible();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('multi-device: a second device unlocks an initialized vault without re-keying or a second owner', async () => {
  // 10-multi-device-vault Slice 1 — the headline scenario. "Device A" initializes the vault; we
  // capture the recovery phrase and the exact recovery.enc bytes so we can prove they're untouched.
  const vault = await mkdtemp(join(tmpdir(), 'selfos-e2e-vault-'));
  const now = new Date().toISOString();
  await writeJson(join(vault, '.selfos', 'meta.json'), {
    schemaVersion: 1,
    vaultId: 'e2e',
    createdAt: now,
    updatedAt: now,
  });
  await writeJson(join(vault, 'config', 'settings.json'), { schemaVersion: 1, values: {} });

  const deviceA = await mkdtemp(join(tmpdir(), 'selfos-e2e-ud-'));
  const fs = createNodeFileSystem(vault);
  const { recoveryPhrase } = await createMasterKey(createNodeSecretStore(deviceA, passthrough), fs);
  const key = await loadMasterKey(createNodeSecretStore(deviceA, passthrough));
  if (!key) throw new Error('seed: master key missing');
  await savePerson(fs, key, {
    id: 'owner-1',
    schemaVersion: 1,
    displayName: 'Tester',
    isSubject: true,
    tags: [],
    createdAt: now,
    updatedAt: now,
  });
  await setAccount(fs, key, { personId: 'owner-1', roleId: 'owner' });
  const recoveryBefore = await readFile(join(vault, 'config', 'recovery.enc'), 'utf8');

  // "Device B": a fresh user-data dir pointed at the SAME vault — no master key, no active person.
  const deviceB = await mkdtemp(join(tmpdir(), 'selfos-e2e-ud-'));
  await writeJson(join(deviceB, 'state.json'), { schemaVersion: 1, vaultPath: vault });

  const app = await launch(deviceB);
  try {
    const w = await app.firstWindow();

    // Initialized vault + no device key ⇒ Unlock, NOT Setup. This is the data-loss bug, fixed.
    await expect(w.getByRole('heading', { name: 'This vault is already set up' })).toBeVisible();
    await expect(w.getByText('Create your profile')).toHaveCount(0);

    // Join with the recovery phrase ⇒ the person picker (this device has no active person yet).
    await w.getByLabel('Recovery phrase').fill(recoveryPhrase);
    await w.getByRole('button', { name: 'Unlock' }).click();
    await expect(w.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

    // Resume as the existing owner ⇒ the shared data is right there.
    await w.getByRole('dialog', { name: 'Locked' }).getByText('Tester').click();
    await expect(w.getByRole('link', { name: 'Home' })).toBeVisible();
  } finally {
    await app.close();
  }

  // The vault was never re-keyed (recovery.enc byte-identical) and no second owner was minted.
  expect(await readFile(join(vault, 'config', 'recovery.enc'), 'utf8')).toBe(recoveryBefore);
  const access = await getAccessConfig(fs, key);
  expect(access.accounts.filter((account) => account.roleId === 'owner')).toHaveLength(1);

  await rm(deviceA, { recursive: true, force: true });
  await rm(deviceB, { recursive: true, force: true });
  await rm(vault, { recursive: true, force: true });
});

test('multi-device: an interrupted setup (key + recovery.enc, no owner) is finished without re-keying', async () => {
  // 10-multi-device-vault §3.1 / §7: a crash mid-first-run leaves a master key + recovery.enc but no
  // owner. The gate routes to Setup to FINISH it (not a dead-end picker), and Setup must not re-key.
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

  // Master key + recovery.enc exist (createMasterKey ran), but no owner was ever created.
  await createMasterKey(createNodeSecretStore(userData, passthrough), createNodeFileSystem(vault));
  const recoveryBefore = await readFile(join(vault, 'config', 'recovery.enc'), 'utf8');
  await writeJson(join(userData, 'state.json'), { schemaVersion: 1, vaultPath: vault });

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await expect(w.getByRole('heading', { name: 'Create your profile' })).toBeVisible();
    await w.getByLabel('Your name').fill('Tester');
    await w.getByLabel('Super-admin passphrase').fill('superpass');
    await w.getByLabel('Confirm passphrase').fill('superpass');
    await w.getByLabel('Your PIN').fill('1234');
    await w.getByLabel('Confirm PIN').fill('1234');
    await w.getByRole('button', { name: 'Create profile' }).click();
    // Resuming issues no new recovery phrase, so we land straight in the app.
    await expect(w.getByRole('link', { name: 'Home' })).toBeVisible();
  } finally {
    await app.close();
  }

  // The existing key was finished-with, never regenerated.
  expect(await readFile(join(vault, 'config', 'recovery.enc'), 'utf8')).toBe(recoveryBefore);
  await rm(userData, { recursive: true, force: true });
  await rm(vault, { recursive: true, force: true });
});

test('invites: a member redeems a code on a new device, sets their own PIN, and joins member-only', async () => {
  // 10-multi-device-vault §5.4 — the owner→member round trip. "Device A" seeds the vault with an owner
  // + a PIN-less member and creates an invite for the member; capture the code.
  const vault = await mkdtemp(join(tmpdir(), 'selfos-e2e-vault-'));
  const now = new Date().toISOString();
  await writeJson(join(vault, '.selfos', 'meta.json'), {
    schemaVersion: 1,
    vaultId: 'e2e',
    createdAt: now,
    updatedAt: now,
  });
  await writeJson(join(vault, 'config', 'settings.json'), { schemaVersion: 1, values: {} });

  const deviceA = await mkdtemp(join(tmpdir(), 'selfos-e2e-ud-'));
  const fs = createNodeFileSystem(vault);
  await createMasterKey(createNodeSecretStore(deviceA, passthrough), fs);
  const key = await loadMasterKey(createNodeSecretStore(deviceA, passthrough));
  if (!key) throw new Error('seed: master key missing');
  const person = (id: string, displayName: string): Parameters<typeof savePerson>[2] => ({
    id,
    schemaVersion: 1,
    displayName,
    isSubject: true,
    tags: [],
    createdAt: now,
    updatedAt: now,
  });
  await savePerson(fs, key, person('owner-1', 'You'));
  await setAccount(fs, key, { personId: 'owner-1', roleId: 'owner', pin: '9999' });
  await savePerson(fs, key, person('wife-1', 'Wife'));
  await setAccount(fs, key, { personId: 'wife-1', roleId: 'member' }); // no PIN — she sets it on redeem
  const { code } = await createInvite(fs, key, 'wife-1', Date.now());

  // "Device B" (the wife's): a fresh user-data dir on the same vault, with no master key.
  const deviceB = await mkdtemp(join(tmpdir(), 'selfos-e2e-ud-'));
  await writeJson(join(deviceB, 'state.json'), { schemaVersion: 1, vaultPath: vault });

  const app = await launch(deviceB);
  try {
    const w = await app.firstWindow();
    await expect(w.getByRole('heading', { name: 'This vault is already set up' })).toBeVisible();

    // Switch to the invite flow, enter the code, then set her own PIN.
    await w.getByRole('button', { name: /have an invite code/i }).click();
    await w.getByLabel('Invite code').fill(code);
    await w.getByRole('button', { name: 'Continue' }).click();
    await expect(w.getByRole('heading', { name: 'Set your PIN' })).toBeVisible();
    await w.getByLabel('Your PIN').fill('1234');
    await w.getByLabel('Confirm PIN').fill('1234');
    await w.getByRole('button', { name: 'Finish' }).click();

    // She's in as herself, member-only (no People/Roles admin nav for a member).
    await expect(w.getByRole('link', { name: 'Home' })).toBeVisible();
    await expect(w.getByRole('button', { name: 'Signed in as Wife' })).toBeVisible();
    await expect(w.getByRole('link', { name: 'People' })).toHaveCount(0);
  } finally {
    await app.close();
  }

  // Her account now carries a PIN, and the invite was consumed (single-use).
  const account = (await getAccessConfig(fs, key)).accounts.find((a) => a.personId === 'wife-1');
  expect(account?.pinHash).toBeTruthy();
  const remaining = (await readdir(join(vault, 'config', 'invites')).catch(() => [])).filter((f) =>
    f.endsWith('.enc'),
  );
  expect(remaining).toHaveLength(0);

  await rm(deviceA, { recursive: true, force: true });
  await rm(deviceB, { recursive: true, force: true });
  await rm(vault, { recursive: true, force: true });
});

test('invites: a redeem interrupted before the PIN resumes on next boot (no open access)', async () => {
  // 10-multi-device-vault §5.4 / §7 — the unhappy path: a crash between redeem and finish must NOT
  // leave a PIN-less member anyone can sign in as. Seed owner + member + an invite for the member.
  const vault = await mkdtemp(join(tmpdir(), 'selfos-e2e-vault-'));
  const now = new Date().toISOString();
  await writeJson(join(vault, '.selfos', 'meta.json'), {
    schemaVersion: 1,
    vaultId: 'e2e',
    createdAt: now,
    updatedAt: now,
  });
  await writeJson(join(vault, 'config', 'settings.json'), { schemaVersion: 1, values: {} });
  const deviceA = await mkdtemp(join(tmpdir(), 'selfos-e2e-ud-'));
  const fs = createNodeFileSystem(vault);
  await createMasterKey(createNodeSecretStore(deviceA, passthrough), fs);
  const key = await loadMasterKey(createNodeSecretStore(deviceA, passthrough));
  if (!key) throw new Error('seed: master key missing');
  const seedPerson = (id: string, displayName: string): Parameters<typeof savePerson>[2] => ({
    id,
    schemaVersion: 1,
    displayName,
    isSubject: true,
    tags: [],
    createdAt: now,
    updatedAt: now,
  });
  await savePerson(fs, key, seedPerson('owner-1', 'You'));
  await setAccount(fs, key, { personId: 'owner-1', roleId: 'owner', pin: '9999' });
  await savePerson(fs, key, seedPerson('wife-1', 'Wife'));
  await setAccount(fs, key, { personId: 'wife-1', roleId: 'member' });
  const { code } = await createInvite(fs, key, 'wife-1', Date.now());

  const deviceB = await mkdtemp(join(tmpdir(), 'selfos-e2e-ud-'));
  await writeJson(join(deviceB, 'state.json'), { schemaVersion: 1, vaultPath: vault });

  const noOverflow = (w: Page): Promise<boolean> =>
    w.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  // First launch: redeem the code, reach the PIN step at phone width (no overflow), then quit early.
  let app = await launch(deviceB);
  try {
    const w = await app.firstWindow();
    await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.setMinimumSize(360, 480);
        win.setSize(390, 800);
      }
    });
    await w.getByRole('button', { name: /have an invite code/i }).click();
    await w.waitForTimeout(150);
    expect(await noOverflow(w)).toBe(true); // invite-code step
    await w.getByLabel('Invite code').fill(code);
    await w.getByRole('button', { name: 'Continue' }).click();
    await expect(w.getByRole('heading', { name: 'Set your PIN' })).toBeVisible();
    expect(await noOverflow(w)).toBe(true); // set-PIN step
  } finally {
    await app.close(); // crash mid-join — the PIN was never set
  }

  // Relaunch: resume the PIN step (the key is on disk + invite consumed) — NOT the open person picker.
  app = await launch(deviceB);
  try {
    const w = await app.firstWindow();
    await expect(w.getByRole('heading', { name: 'Set your PIN' })).toBeVisible();
    await expect(w.getByRole('heading', { name: 'Welcome back' })).toHaveCount(0);
    await w.getByLabel('Your PIN').fill('1234');
    await w.getByLabel('Confirm PIN').fill('1234');
    await w.getByRole('button', { name: 'Finish' }).click();
    await expect(w.getByRole('link', { name: 'Home' })).toBeVisible();
  } finally {
    await app.close();
  }

  // The member's account ended up with a PIN — the guarantee held across the interruption.
  const account = (await getAccessConfig(fs, key)).accounts.find((a) => a.personId === 'wife-1');
  expect(account?.pinHash).toBeTruthy();

  await rm(deviceA, { recursive: true, force: true });
  await rm(deviceB, { recursive: true, force: true });
  await rm(vault, { recursive: true, force: true });
});

test('shell: collapsing the sidebar to a rail persists across relaunch', async () => {
  const { userData, vault } = await seedReadyVault();

  let app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await expect(w.getByRole('link', { name: 'Home' })).toBeVisible();
    expect((await w.locator('aside').boundingBox())?.width ?? 0).toBeGreaterThan(180);

    await w.getByRole('button', { name: 'Collapse sidebar' }).click();
    await expect(w.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
    // Poll past the width transition until it settles to the icon rail.
    await expect
      .poll(async () => (await w.locator('aside').boundingBox())?.width ?? 999)
      .toBeLessThan(120);
    await w.waitForTimeout(250); // let the device-local write flush before relaunch
  } finally {
    await app.close();
  }

  app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await expect(w.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
    await expect
      .poll(async () => (await w.locator('aside').boundingBox())?.width ?? 999)
      .toBeLessThan(120); // still collapsed on next launch
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('responsive: at a phone width the nav is a drawer and no screen overflows horizontally', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await expect(w.getByRole('link', { name: 'Home' })).toBeVisible();

    // Shrink the window to a phone width (below the per-window minimum, which we lower for the test).
    await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.setMinimumSize(360, 480);
        win.setSize(390, 800);
      }
    });
    await w.waitForTimeout(200);

    // The nav collapsed into a hamburger-opened drawer; the rail collapse toggle is gone on mobile.
    const hamburger = w.getByRole('button', { name: 'Open navigation' });
    await expect(hamburger).toBeVisible();
    await expect(w.getByRole('button', { name: /Collapse sidebar|Expand sidebar/ })).toHaveCount(0);

    const noOverflow = (): Promise<boolean> =>
      w.evaluate(() => {
        const fits = (el: Element | null | undefined): boolean =>
          !el || el.scrollWidth <= el.clientWidth + 1;
        const main = document.querySelector('main');
        // The real scroll container is main's content div — check it too, so an inner two-pane
        // layout that overflows (clipped by main's overflow:hidden) is still caught.
        const inner = main?.querySelector(':scope > div');
        const docOk = document.documentElement.scrollWidth <= window.innerWidth + 1;
        return fits(main) && fits(inner) && docOk;
      });

    // Walk every primary screen via the drawer; open the People editor too (it's a second pane that
    // must stack on mobile). Assert nothing overflows horizontally anywhere.
    for (const name of [
      'Sessions',
      'Inbox',
      'Questionnaires',
      'Memory',
      'Dreams',
      'People',
      'Roles',
      'Usage',
      'Settings',
      'Home',
    ]) {
      await hamburger.click();
      await w.getByRole('link', { name }).click(); // selecting a nav item closes the drawer
      await w.waitForTimeout(150);
      expect(await noOverflow()).toBe(true);
      if (name === 'Questionnaires') {
        await w.getByRole('button', { name: 'New' }).click(); // open the builder (detail pane)
        await w.waitForTimeout(150);
        expect(await noOverflow()).toBe(true); // the builder stacks on mobile, doesn't overflow
        // The follow-up authoring editors must also fit at phone width:
        await w.getByRole('button', { name: 'New type' }).click(); // inline add-type row + meta row
        await w.getByLabel('Answer type').selectOption({ label: 'Matrix (rows on one scale)' });
        await w.waitForTimeout(120);
        expect(await noOverflow()).toBe(true); // metaRow + matrix rows/scale don't overflow
        // Branch editor: a second question conditioned on a discrete first question.
        await w.getByLabel('Answer type').selectOption({ label: 'Single choice' });
        await w.getByLabel('Option 1', { exact: true }).fill('A');
        await w.getByLabel('Option 2', { exact: true }).fill('B');
        await w.getByRole('button', { name: 'Add question' }).click();
        await w.getByLabel('Only show this question').selectOption({ index: 1 });
        await w.waitForTimeout(120);
        expect(await noOverflow()).toBe(true); // the branch row wraps, no overflow
        // The preview / answering form (matrix scale, branch-aware) must also fit at phone width.
        await w.getByRole('button', { name: 'Preview' }).click();
        await w.waitForTimeout(120);
        expect(await noOverflow()).toBe(true);
        await w.getByRole('button', { name: 'Questionnaires' }).click(); // back to the list
      }
      if (name === 'Dreams') {
        await w.getByRole('button', { name: 'Log a dream' }).click(); // open the composer (detail pane)
        await w.waitForTimeout(150);
        expect(await noOverflow()).toBe(true);
        await w.getByLabel('What happened?').fill('A short dream.');
        await w.waitForTimeout(80);
        expect(await noOverflow()).toBe(true); // the optional-details grid stacks on mobile
        await w.getByRole('button', { name: 'Dreams' }).click(); // back to the list
      }
      if (name === 'People') {
        await w.getByRole('button', { name: 'Tester Subject' }).click(); // open the editor (detail)
        await w.waitForTimeout(150);
        expect(await noOverflow()).toBe(true); // the 5 person tabs scroll, not overflow
        await w.getByRole('button', { name: 'People' }).click(); // back to the list
      }
      if (name === 'Roles') {
        // The role cards must STACK (one column), not sit in a scrolling row — assert two role
        // headings share a left edge, which only holds when the grid has collapsed to 1 column.
        const ownerBox = await w.getByRole('heading', { name: 'Owner' }).boundingBox();
        const memberBox = await w.getByRole('heading', { name: 'Member' }).boundingBox();
        expect(ownerBox).not.toBeNull();
        expect(memberBox).not.toBeNull();
        expect(Math.abs((ownerBox?.x ?? 0) - (memberBox?.x ?? 0))).toBeLessThanOrEqual(1);
      }
      if (name === 'Settings') {
        // The section nav becomes a horizontal pill row (it scrolls); each section's stacked fields
        // must not overflow — this is the bug the phone screenshots showed (one-word-per-line).
        const sectionButtons = w
          .getByRole('navigation', { name: 'Settings sections' })
          .getByRole('button');
        const sectionCount = await sectionButtons.count();
        expect(sectionCount).toBeGreaterThanOrEqual(3);
        for (let i = 0; i < sectionCount; i++) {
          await sectionButtons.nth(i).click();
          await w.waitForTimeout(50);
          expect(await noOverflow()).toBe(true);
        }
      }
    }

    // The drawer opens over the content and a scrim appears; selecting closes it again.
    await hamburger.click();
    await expect(w.getByRole('button', { name: 'Close navigation' })).toBeVisible(); // scrim
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('design: the TopBar controls share a height and vertical alignment', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await expect(w.getByRole('link', { name: 'Home' })).toBeVisible();
    const geo = await w.evaluate(() => {
      const rect = (sel: string): { top: number; height: number } | null => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), height: Math.round(r.height) };
      };
      return {
        appearance: rect('button[aria-label^="Appearance"]'),
        ring: rect('button[aria-label*="AI usage"]'),
        account: rect('button[aria-label^="Signed in as"]'),
      };
    });
    const items = [geo.appearance, geo.ring, geo.account];
    for (const item of items) expect(item).not.toBeNull();
    const tops = items.map((i) => i?.top ?? -1);
    const heights = items.map((i) => i?.height ?? -1);
    // The appearance toggle, usage ring, and account control must share a top edge + height
    // (≤1px tolerance) — guards against the vertical-misalignment regression.
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});
