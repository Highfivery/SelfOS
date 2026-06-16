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
  buildContext,
  createInvite,
  getAccessConfig,
  getPerson,
  listPeople,
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
  listQuestionnaires,
  readCustomIntimacyTopics,
  saveQuestionnaire,
  submitResponse,
} from '@selfos/core/questionnaires';
import { getIntakeSession } from '@selfos/core/intake';
import { listInsightsForPerson, saveInsight, summarizeForContext } from '@selfos/core/insights';
import { listDreams, saveAnalysis, saveDream } from '@selfos/core/dreams';
import { saveConversation } from '@selfos/core/conversations';

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

/**
 * Mark a person's onboarding as already complete (18-personal-onboarding §3.1). Members are hard-gated into
 * onboarding until their portrait is generated, so tests that exercise OTHER member features seed this so the
 * member isn't gated — reflecting that in reality they'd have onboarded first.
 */
async function seedCompletedIntake(
  fs: ReturnType<typeof createNodeFileSystem>,
  key: Uint8Array,
  personId: string,
): Promise<void> {
  await writeEncryptedJson(
    fs,
    `people/${personId}/intake/session.enc`,
    {
      id: `intake-${personId}`,
      schemaVersion: 1,
      personId,
      status: 'complete',
      sections: [],
      startedAt: 'now',
      updatedAt: 'now',
      completedAt: 'now',
    },
    key,
  );
}

/** Complete onboarding for a person created at runtime (found by display name), so the Member gate releases. */
async function completeIntakeFor(
  vault: string,
  userData: string,
  displayName: string,
): Promise<void> {
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('completeIntakeFor: master key missing');
  const person = (await listPeople(fs, key)).find((p) => p.displayName === displayName);
  if (!person) throw new Error(`completeIntakeFor: ${displayName} not found`);
  await seedCompletedIntake(fs, key, person.id);
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
  env.SELFOS_FAKE_IMAGE = '1'; // deterministic tiny-PNG image client (no OpenAI network)
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

/** Recursively find the first file with `name` under `dir` (used to assert encrypted blobs on disk). */
async function findFileNamed(dir: string, name: string): Promise<string | null> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = await findFileNamed(full, name);
      if (found) return found;
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
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
    await expect(w.getByRole('banner').getByRole('link', { name: 'SelfOS' })).toBeVisible();
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

test('people: the merged Notes field persists with a share lock (15 §4.3)', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'People' }).click();
    await w.getByRole('button', { name: 'Tester Subject' }).click();
    await w.getByRole('button', { name: 'Notes' }).click();
    await w.getByLabel('Notes', { exact: true }).fill('enjoys cycling');
    // Lock the notes to this person only via the per-field ShareToggle.
    await w.getByRole('button', { name: /Notes: shared/i }).click();
    await w.getByRole('button', { name: 'Save' }).click();

    // Reopen and confirm the merged field + the lock round-tripped through encryption.
    await w.getByRole('button', { name: 'Tester Subject' }).click();
    await w.getByRole('button', { name: 'Notes' }).click();
    await expect(w.getByLabel('Notes', { exact: true })).toHaveValue('enjoys cycling');
    await expect(w.getByRole('button', { name: /Notes: private/i })).toBeVisible();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('people: a Subject has no About tab; a contact keeps only the visual fields (18 §14.6)', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'People' }).click();
    // A Subject's profile is owned by onboarding → no About tab at all.
    await w.getByRole('button', { name: 'Tester Subject' }).click();
    await expect(w.getByRole('button', { name: 'About', exact: true })).toHaveCount(0);

    // A non-Subject contact's About tab keeps ONLY the visual dream-image fields.
    await w.getByRole('button', { name: 'Add person' }).click();
    await w.getByLabel('Name').fill('Sam');
    await w.getByRole('button', { name: 'About', exact: true }).click();
    await w.getByLabel('Gender', { exact: true }).selectOption('Non-binary');
    await w.getByLabel('Appearance', { exact: true }).fill('tall, curly hair');
    await w.getByLabel('Ethnicity', { exact: true }).fill('Korean');
    // The trimmed + onboarding-owned fields are gone from the People editor.
    await expect(w.getByLabel('Occupation', { exact: true })).toHaveCount(0);
    await expect(w.getByLabel('Relationship status', { exact: true })).toHaveCount(0);
    await expect(w.getByLabel('Health notes', { exact: true })).toHaveCount(0);
    await w.getByRole('button', { name: 'Create' }).click();

    // Reopen the contact and confirm the three fields round-tripped through the encrypted profile.
    await w.getByRole('button', { name: 'Sam' }).click();
    await w.getByRole('button', { name: 'About', exact: true }).click();
    await expect(w.getByLabel('Gender', { exact: true })).toHaveValue('Non-binary');
    await expect(w.getByLabel('Appearance', { exact: true })).toHaveValue('tall, curly hair');
    await expect(w.getByLabel('Ethnicity', { exact: true })).toHaveValue('Korean');
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('shareability: a locked field never reaches a related person’s assembled context (15 §8)', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'People' }).click();

    // Add Robin (a contact, related to the subject Tester); give them a SHARED ethnicity + a LOCKED appearance.
    await w.getByRole('button', { name: 'Add person' }).click();
    await w.getByLabel('Name').fill('Robin');
    await w.getByRole('button', { name: 'Create' }).click();
    await w.getByText('Robin').click();
    await w.getByRole('button', { name: 'About', exact: true }).click();
    await w.getByLabel('Ethnicity', { exact: true }).fill('SHARED-KOREAN');
    await w.getByLabel('Appearance', { exact: true }).fill('LOCKED-FEATURE');
    await w.getByRole('button', { name: /Appearance: shared/i }).click(); // lock it
    await w.getByRole('button', { name: 'Save' }).click();

    // Relate Robin to the subject so Robin's SHARED data flows into the subject's context.
    await w.getByText('Robin').click();
    await w.getByRole('button', { name: 'Relationships' }).click();
    await w.getByLabel('Related person').selectOption({ label: 'Tester' });
    await w.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(w.getByText(/Friend — Tester/)).toBeVisible();

    // Decrypt + assemble the subject's coaching context and assert the boundary holds.
    const secrets = createNodeSecretStore(userData, passthrough);
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(secrets);
    if (!key) throw new Error('master key missing');
    const context = await buildContext(fs, key, 'owner-1');
    expect(context).toContain('SHARED-KOREAN'); // a shared field reaches the related person's block
    expect(context).not.toContain('LOCKED-FEATURE'); // a LOCKED field never does

    // The reworked About editor (every field + its ShareToggle + the bulk control) fits at phone width.
    // Robin's editor is already open (on Relationships); just resize and switch to the About tab.
    await w.setViewportSize({ width: 390, height: 780 });
    await w.getByRole('button', { name: 'About', exact: true }).click();
    await expect(w.getByRole('button', { name: 'Lock all' })).toBeVisible();
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
    // Mark Jordan onboarded before switching, so the Member onboarding gate doesn't take over (18 §3.1).
    await completeIntakeFor(vault, userData, 'Jordan');

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

    // Rename the conversation (via the per-session kebab — no standalone icon buttons).
    await w
      .getByRole('complementary', { name: 'Conversations' })
      .getByRole('button', { name: /Session options for/ })
      .first()
      .click();
    await w.getByRole('menuitem', { name: 'Rename' }).click();
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
    await w
      .getByRole('complementary', { name: 'Conversations' })
      .getByRole('button', { name: /Session options for/ })
      .first()
      .click();
    await w.getByRole('menuitem', { name: 'Rename' }).click();
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
    // Mark Jordan onboarded before switching, so the Member onboarding gate doesn't take over (18 §3.1).
    await completeIntakeFor(vault, userData, 'Jordan');

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

test('sessions: complete + summarize feeds a later session; status filter + reopen (09 §14)', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Sessions' }).click();
    await w.getByLabel('Message').fill('I had a hard day at work');
    await w.getByRole('button', { name: 'Send' }).click();
    await expect(w.getByText(/hear you/i).first()).toBeVisible();

    // A fresh session is in progress; the owner (admin) sees the per-session $ with the admin-only badge.
    await expect(w.locator('[data-status="inProgress"]').first()).toBeVisible();
    await expect(w.getByText('Admin only').first()).toBeVisible();

    // Complete & summarize from the per-item menu → the wrap-up card appears inline.
    await w
      .getByRole('complementary', { name: 'Conversations' })
      .getByRole('button', { name: /Session options for/ })
      .first()
      .click();
    await w.getByRole('menuitem', { name: 'Complete & summarize' }).click();
    await expect(w.getByRole('heading', { name: 'Session summary' })).toBeVisible();
    await expect(w.getByText(/calmer note/i)).toBeVisible();
    await expect(w.getByText('Goal: Take a short walk before bed')).toBeVisible();
    await expect(w.getByRole('button', { name: /View in Memory/i })).toBeVisible();

    // The auto-approved Session Insight feeds the subject's own assembled coaching context.
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('summarize e2e: master key missing');
    const insights = await listInsightsForPerson(fs, key, 'owner-1');
    expect(insights.some((i) => i.source === 'session')).toBe(true);
    const context = await buildContext(fs, key, 'owner-1');
    expect(context).toContain('Take a short walk before bed');

    // The status filter (a Select) narrows the list: the now-complete session shows under Complete.
    const openRow = w.getByRole('button', { name: 'I had a hard day at work', exact: true });
    const statusFilter = w.getByRole('combobox', { name: 'Filter sessions by status' });
    await statusFilter.selectOption('complete');
    await expect(openRow).toBeVisible();
    await statusFilter.selectOption('inProgress');
    await expect(openRow).toHaveCount(0);

    // Reopening (a new turn) flips it back to in progress — it leaves the Complete filter.
    await statusFilter.selectOption('all');
    await openRow.click();
    await w.getByLabel('Message').fill('actually, one more thing');
    await w.getByRole('button', { name: 'Send' }).click();
    await expect(w.getByText(/hear you/i).first()).toBeVisible();
    await statusFilter.selectOption('complete');
    await expect(openRow).toHaveCount(0);

    await w.setViewportSize({ width: 390, height: 780 });
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

test('guided sessions: start a guided exercise → steered reply → complete & summarize; intimacy gated; suggestions (16)', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Sessions' }).click();

    // The launcher is the start state: framing + the grouped catalog.
    await expect(w.getByText('What do you want to work through?')).toBeVisible();
    await expect(w.getByText('Reflective & therapy-informed')).toBeVisible();

    // The Intimacy group is gated behind a one-time 18+ ack (§8.3): expand it, the cards are hidden.
    await w.getByText('Intimacy & connection').click();
    await expect(w.getByRole('button', { name: /Start Sensate Focus/ })).toHaveCount(0);
    await w.getByRole('button', { name: /18 or older/i }).click();
    await expect(w.getByRole('button', { name: /Start Sensate Focus/ }).first()).toBeVisible();

    // Start a structured exercise (Thought Record) → the static opener seeds + the stepper appears.
    await w
      .getByRole('button', { name: /Start Thought Record/ })
      .first()
      .click();
    await expect(w.getByText(/work through a Thought Record/i)).toBeVisible();
    await expect(w.getByText('Situation', { exact: true })).toBeVisible(); // the stepper's first step

    // A steered turn streams a reply.
    await w.getByLabel('Message').fill('Here is the situation that upset me');
    await w.getByRole('button', { name: 'Send' }).click();
    await expect(w.getByText(/hear you/i).first()).toBeVisible();

    // Complete & summarize → the wrap-up card; the Insight notes the exercise + feeds later context.
    await w
      .getByRole('complementary', { name: 'Conversations' })
      .getByRole('button', { name: /Session options for/ })
      .first()
      .click();
    await w.getByRole('menuitem', { name: 'Complete & summarize' }).click();
    await expect(w.getByRole('heading', { name: 'Session summary' })).toBeVisible();

    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('guided e2e: master key missing');
    const insights = await listInsightsForPerson(fs, key, 'owner-1');
    const session = insights.find((i) => i.source === 'session');
    expect(session?.provenance.guideId).toBe('cbt-thought-record');
    expect(session?.facts.some((f) => f.text === 'Exercise: Thought Record (CBT)')).toBe(true);
    const context = await buildContext(fs, key, 'owner-1');
    expect(context).toContain('Take a short walk before bed');

    // Back to the launcher → explicit-first-tap suggestions (no silent spend) generate catalog picks.
    await w.getByRole('button', { name: 'New session' }).click();
    await w.getByRole('button', { name: /get personalized suggestions/i }).click();
    await expect(w.getByText('A grounding place to start.')).toBeVisible();

    // No horizontal overflow at phone width — AND no INNER horizontal scrollbar anywhere (a filter/toolbar
    // that scrolls-x is a UX failure the `main`-only guard misses; see the guided-sessions polish pass).
    await w.setViewportSize({ width: 390, height: 780 });
    const noInnerScrollbars = await w.evaluate(() => {
      const offenders: string[] = [];
      document.querySelectorAll('*').forEach((el) => {
        const ox = getComputedStyle(el).overflowX;
        if (el.scrollWidth - el.clientWidth > 1 && (ox === 'auto' || ox === 'scroll')) {
          offenders.push(`${el.tagName}.${el.className}`);
        }
      });
      const main = document.querySelector('main');
      return { offenders, mainOverflow: main ? main.scrollWidth - main.clientWidth : 0 };
    });
    expect(noInnerScrollbars.offenders).toEqual([]);
    expect(noInnerScrollbars.mainOverflow).toBeLessThanOrEqual(1);
    // The desktop sidebar is narrow too — re-check there's no horizontal scrollbar at a small desktop width.
    await w.setViewportSize({ width: 900, height: 800 });
    const desktopOffenders = await w.evaluate(() => {
      const offenders: string[] = [];
      document.querySelectorAll('*').forEach((el) => {
        const ox = getComputedStyle(el).overflowX;
        if (el.scrollWidth - el.clientWidth > 1 && (ox === 'auto' || ox === 'scroll')) {
          offenders.push(`${el.tagName}.${el.className}`);
        }
      });
      return offenders;
    });
    expect(desktopOffenders).toEqual([]);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('sessions: a member sees a usage bar with no $; memory-off blocks summarizing (09 §14.3/§3.4)', async () => {
  // Memory off + auto-summarize default off; a non-admin member runs a session.
  const { userData, vault } = await seedReadyVault({
    'ai.enabled': true,
    'sessions.memoryEnabled': false,
  });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();

    // Grant a member (Jordan, no PIN) and switch to them.
    await w.getByRole('link', { name: 'People' }).click();
    await w.getByRole('button', { name: 'Add person' }).click();
    await w.getByLabel('Name').fill('Jordan');
    await w.getByRole('button', { name: 'Create' }).click();
    await w.getByText('Jordan').click();
    await w.getByRole('button', { name: 'Access' }).click();
    await w.getByRole('button', { name: 'Grant access' }).click();
    await expect(w.getByText(/can sign in/i)).toBeVisible();
    // Mark Jordan onboarded before switching, so the Member onboarding gate doesn't take over (18 §3.1).
    await completeIntakeFor(vault, userData, 'Jordan');
    await w.getByRole('button', { name: /signed in as/i }).click();
    await w.getByRole('menuitem', { name: 'Switch person' }).click();
    await w
      .getByRole('dialog', { name: /who.s here/i })
      .getByText('Jordan')
      .click();
    await expect(w.getByRole('button', { name: 'Signed in as Jordan' })).toBeVisible();

    await w.getByRole('link', { name: 'Sessions' }).click();
    await w.getByLabel('Message').fill('a member session');
    await w.getByRole('button', { name: 'Send' }).click();
    await expect(w.getByText(/hear you/i).first()).toBeVisible();

    // A member NEVER sees a dollar figure — only a budget-relative bar.
    await expect(w.getByText('Admin only')).toHaveCount(0);
    await expect(w.getByText(/\$/)).toHaveCount(0);
    await expect(w.getByRole('img', { name: /period allowance/i }).first()).toBeVisible();

    // With session memory off, completing is allowed but NO summarize affordance is offered — neither the
    // "Complete & summarize" menu item nor an inline "Summarize this session" button (no dead-end spend).
    await w
      .getByRole('complementary', { name: 'Conversations' })
      .getByRole('button', { name: /Session options for/ })
      .first()
      .click();
    await expect(w.getByRole('menuitem', { name: 'Complete & summarize' })).toHaveCount(0);
    await w.getByRole('menuitem', { name: 'Mark complete' }).click();
    await expect(w.locator('[data-status="complete"]').first()).toBeVisible();
    await expect(w.getByRole('button', { name: /Summarize this session/ })).toHaveCount(0);

    // No session Insight is produced for anyone while memory is off.
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('memory-off e2e: master key missing');
    for (const personId of ['owner-1']) {
      const insights = await listInsightsForPerson(fs, key, personId);
      expect(insights.some((i) => i.source === 'session')).toBe(false);
    }
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

/**
 * Open the builder for a new questionnaire via the recipient-first start step (08 §17.3). Picks the first
 * household person (the seeded owner "Tester") by default; pass `compat` for the two-participant exception.
 */
async function startNewQuestionnaire(w: Page, opts: { compat?: boolean } = {}): Promise<void> {
  await w.getByRole('button', { name: 'New' }).click();
  if (opts.compat) {
    // Compat is recipient-first too (§17.12-B): pick the person you're compared with (excludes you).
    await w.getByLabel('This questionnaire is for').selectOption('compatibility');
    await w.getByLabel('Compare you with').selectOption({ index: 1 });
  } else {
    await w.getByLabel('Who is this for?').selectOption({ index: 1 });
  }
  await w.getByRole('button', { name: 'Continue' }).click();
  await expect(w.getByLabel('Title')).toBeVisible();
}

test('questionnaires: author a single-choice questionnaire, validate, persist, no overflow', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Questionnaires' }).click();
    await expect(w.getByRole('heading', { name: 'Questionnaires' })).toBeVisible();
    await expect(w.getByText(/no questionnaires yet/i)).toBeVisible();

    // Build a questionnaire with one single-choice question and three options.
    await startNewQuestionnaire(w);
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
    await w.getByRole('button', { name: 'Create draft' }).click();

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
    await startNewQuestionnaire(w);
    await w.getByLabel('Title').fill('Date-night check-in');

    // A custom type the user names — it becomes the selected type and persists for next time.
    await w.getByRole('button', { name: 'New type' }).click();
    await w.getByLabel('New type name').fill('Date night');
    await w.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(w.getByLabel('Type', { exact: true })).toHaveValue('Date night');

    // A custom type can't carry sensitivity (§15.2) — the picker is hidden and the value is standard.
    await expect(w.getByLabel('Sensitivity')).toHaveCount(0);

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
    await w.getByRole('button', { name: 'Create draft' }).click();
    await expect(w.getByText('2 questions')).toBeVisible();

    // Reopen and confirm everything round-tripped through the encrypted vault.
    await w.getByRole('button', { name: /Date-night check-in/ }).click();
    await expect(w.getByLabel('Type', { exact: true })).toHaveValue('Date night');
    await expect(w.getByLabel('Sensitivity')).toHaveCount(0);
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
    await startNewQuestionnaire(w);
    await w.getByLabel('Title').fill('Dry run');
    await w.getByLabel('Question 1', { exact: true }).fill('How are you feeling?');
    await w.getByLabel('Answer type').selectOption({ label: 'Rating' });

    // Switch to Preview — the answering form + crisis footer render exactly as the recipient sees them.
    await w.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(w.getByText(/exactly what your recipient sees/i)).toBeVisible();
    await expect(w.getByRole('button', { name: /get help now/i })).toBeVisible();

    // Finish is gated on the required (and untouched) rating — a required scale slider isn't auto-seeded,
    // so it stays unanswered until moved.
    await w.getByRole('button', { name: 'Finish' }).click();
    await expect(w.getByText(/answer the 1 required question to finish/i)).toBeVisible();

    // Answer it on the 1→5 slider, then Finish confirms the dry run saved nothing.
    await w.getByRole('slider', { name: 'How are you feeling?' }).fill('4');
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

test('questionnaires: General default + intimacy-only sensitivity + live inline preview (08 §15)', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Questionnaires' }).click();
    await startNewQuestionnaire(w);

    // §15.1: a new questionnaire defaults to General, which can't carry sensitivity (§15.2) — no picker.
    await expect(w.getByLabel('Type', { exact: true })).toHaveValue('general');
    await expect(w.getByLabel('Sensitivity')).toHaveCount(0);

    await w.getByLabel('Title').fill('Check-in');
    await w.getByLabel('Question 1', { exact: true }).fill('How are you, really?');
    await w.getByLabel('Answer type').selectOption({ label: 'Rating' });

    // §15.5: the edited question's inline preview is expanded and renders the real answering control —
    // a 1→5 rating slider. (The "Hide preview" toggle confirms the inline preview panel is present.)
    await expect(w.getByRole('button', { name: 'Hide preview' })).toBeVisible();
    await expect(w.getByRole('slider', { name: 'How are you, really?' })).toBeVisible();

    // …and it matches the full Preview render (the same shared @selfos/answering renderer).
    await w.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(w.getByRole('slider', { name: 'How are you, really?' })).toBeVisible();
    await w.getByRole('button', { name: 'Edit', exact: true }).click();

    // §15.2: switching to Intimacy reveals the picker with intimacy tiers only (no Standard), and the
    // author note. It seeds Intimacy — General.
    await w.getByLabel('Type', { exact: true }).selectOption('intimacy');
    await expect(w.getByLabel('Sensitivity')).toHaveValue('intimacyGeneral');
    await expect(w.getByLabel('Sensitivity').getByRole('option', { name: 'Standard' })).toHaveCount(
      0,
    );
    await w.getByLabel('Sensitivity').selectOption('explicit');
    await expect(w.getByText(/date of birth and consent/i)).toBeVisible();

    // Save → reopen: the intimacy type + escalated tier round-trip through the encrypted vault.
    await w.getByRole('button', { name: 'Create draft' }).click();
    await w.getByRole('button', { name: /Check-in/ }).click();
    await expect(w.getByLabel('Type', { exact: true })).toHaveValue('intimacy');
    await expect(w.getByLabel('Sensitivity')).toHaveValue('explicit');

    // No horizontal overflow at phone width — page-level AND no inner horizontal scrollbar anywhere.
    await w.setViewportSize({ width: 390, height: 780 });
    const offenders = await w.evaluate(() => {
      const bad: string[] = [];
      document.querySelectorAll('*').forEach((el) => {
        const ox = getComputedStyle(el).overflowX;
        if (el.scrollWidth - el.clientWidth > 1 && (ox === 'auto' || ox === 'scroll')) {
          bad.push(el.className?.toString?.() ?? el.tagName);
        }
      });
      const main = document.querySelector('main');
      return { bad, mainOverflow: main ? main.scrollWidth - main.clientWidth : 0 };
    });
    expect(offenders.bad).toEqual([]);
    expect(offenders.mainOverflow).toBeLessThanOrEqual(1);
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
    await startNewQuestionnaire(w);
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

    await w.getByRole('button', { name: 'Create draft' }).click();

    // Reopen: the alt text round-tripped through the encrypted vault and the image still loads.
    // (The editor thumbnail AND the open inline preview both render it, so scope to the first.)
    await w.getByRole('button', { name: /Photo prompt/ }).click();
    await expect(w.getByLabel('Image description (alt text)')).toHaveValue('A test image');
    await expect(w.getByRole('img', { name: 'A test image' }).first()).toBeVisible();

    // It also renders in the recipient-facing preview.
    await w.getByRole('button', { name: 'Preview', exact: true }).click();
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
    await startNewQuestionnaire(w);
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
    await startNewQuestionnaire(w);
    // The "Draft with AI" panel is ready; expanding it reveals the brief + Generate (no author toggle, §15.4).
    await w.getByRole('button', { name: /draft with ai/i }).click();
    await expect(w.getByRole('button', { name: /generate questions/i })).toBeVisible();
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
    await startNewQuestionnaire(w);
    await w.getByLabel('Title').fill('Weekly check-in');
    await w.getByLabel('Question 1', { exact: true }).fill('How are we doing?');

    // §16.3 two-step: Save the draft first (Send only appears on a saved questionnaire), then Send.
    await w.getByRole('button', { name: 'Create draft' }).click();
    await expect(w.getByRole('button', { name: 'Send' })).toBeVisible();

    // Send it. The recipient is BOUND (to Tester, the self check-in picked at the start step, §17.3) — the
    // send panel confirms it, no recipient picker. Private is the default privacy mode.
    await w.getByRole('button', { name: 'Send' }).click();
    await expect(w.getByText(/This goes to/)).toContainText('Tester');
    await expect(w.getByRole('button', { name: 'Private' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
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

    // Author a one-question questionnaire bound to an EXTERNAL recipient (chosen first, §17.3) and send it
    // via the relay.
    await w.getByRole('link', { name: 'Questionnaires' }).click();
    await w.getByRole('button', { name: 'New' }).click();
    await w.getByLabel('Recipient').selectOption('external');
    await w.getByLabel('Their name').fill('Alex');
    await w.getByRole('button', { name: 'Continue' }).click();
    await w.getByLabel('Title').fill('Outside view');
    await w.getByLabel('Question 1', { exact: true }).fill('How do I come across?');
    // §16.3: save the draft, then Send (Send only appears once saved).
    await w.getByRole('button', { name: 'Create draft' }).click();
    await w.getByRole('button', { name: 'Send' }).click();

    // The recipient (Alex) is bound — the send panel goes straight to the relay flow (no name re-entry).
    await expect(w.getByRole('heading', { name: /Send to Alex/i })).toBeVisible();
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
    await startNewQuestionnaire(w);
    await w.getByLabel('Title').fill('Weekly check-in');
    await w.getByLabel('Question 1', { exact: true }).fill('How are we doing?');

    // §16.3: save the draft first, then Send it to the bound recipient (self), switching Private → Standard.
    await w.getByRole('button', { name: 'Create draft' }).click();
    await w.getByRole('button', { name: 'Send' }).click();
    await w.getByRole('button', { name: 'Standard' }).click();
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
    await startNewQuestionnaire(w);
    await w.getByLabel('Title').fill('Mood check');
    await w.getByLabel('Question 1', { exact: true }).fill('How connected do you feel?');
    await w.getByLabel('Answer type').selectOption({ label: 'Rating' });

    // Send it to self twice (a re-ask), answering each with a different rating.
    const sendToSelf = async (): Promise<void> => {
      await w.getByRole('button', { name: 'Send' }).click();
      await w.getByRole('button', { name: 'Standard' }).click();
      await w.getByRole('button', { name: 'Send' }).last().click();
      await w.getByRole('button', { name: 'Done' }).click();
    };
    // §16.3: save the draft so Send appears, send once; then re-open the saved questionnaire and re-ask.
    await w.getByRole('button', { name: 'Create draft' }).click();
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

test('compatibility contextOnly (§16.2): no report; each participant’s own coach is enriched, no cross-exposure', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
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
  // A contextOnly compatibility questionnaire, sent to two OTHERS, both answered.
  const q = await saveQuestionnaire(
    fs,
    key,
    {
      title: 'Closeness check',
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
      compatibility: { enabled: true, visibility: 'contextOnly' },
    },
    'owner-1',
  );
  const variant = (label: string) =>
    q.questions.map((c) => ({ ...c, canonicalId: 'c1', prompt: `${label}: ${c.prompt}` }));
  const groupId = await createCompatibilitySend(fs, key, {
    questionnaireId: q.id,
    senderPersonId: 'owner-1',
    visibility: 'contextOnly',
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
    await w.getByRole('button', { name: /Closeness check/ }).click();
    await w.getByRole('button', { name: 'Results' }).click();

    // Context-only: NO report is offered — the sender updates each coach instead.
    await expect(w.getByText(/no report is produced/i)).toBeVisible();
    await expect(w.getByRole('button', { name: /Generate alignment/ })).toHaveCount(0);
    await w.getByRole('button', { name: /Update both coaches/ }).click();
    await expect(w.getByText(/Both coaches updated/i)).toBeVisible();

    // Decrypt the vault: NO alignment report exists; each participant has their OWN auto-approved,
    // own-context-only Insight (subject = themselves), and the sender is NOT a subject.
    expect(await getAlignmentReport(fs, key, groupId)).toBeNull();
    const alex = (await listInsightsForPerson(fs, key, 'alex-1')).find(
      (i) => i.provenance.compatibilityGroupId === groupId,
    );
    const bri = (await listInsightsForPerson(fs, key, 'bri-1')).find(
      (i) => i.provenance.compatibilityGroupId === groupId,
    );
    expect(alex?.subjectPersonId).toBe('alex-1');
    expect(alex?.approved).toBe(true);
    expect(alex?.facts.every((f) => f.shareable === false)).toBe(true);
    expect(bri?.subjectPersonId).toBe('bri-1');
    expect(
      (await listInsightsForPerson(fs, key, 'owner-1')).some(
        (i) => i.provenance.compatibilityGroupId === groupId,
      ),
    ).toBe(false);

    // Each participant's OWN coaching context is enriched by their own distilled insight (the facts are
    // own-context-only, so they never broadcast to anyone else — the no-cross-exposure guarantee is proven
    // structurally in the unit/bridge tests).
    const alexContext = await summarizeForContext(fs, key, 'alex-1', []);
    const briContext = await summarizeForContext(fs, key, 'bri-1', []);
    expect(alexContext).toContain('steady connection');
    expect(briContext).toContain('steady connection');
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('compatibility (§17.12-B): you + the bound recipient, no participant picker at send', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('expected a master key');
  const now = new Date().toISOString();
  await savePerson(fs, key, {
    id: 'angel-1',
    schemaVersion: 1,
    displayName: 'Angel',
    isSubject: true,
    tags: [],
    createdAt: now,
    updatedAt: now,
  });

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Questionnaires' }).click();
    // Compatibility binds the one recipient (Angel) at the start step — the comparison is you + them (§17.12-B).
    await startNewQuestionnaire(w, { compat: true });
    await expect(w.getByText(/For:/)).toContainText('Compatibility — you + Angel');
    await w.getByLabel('Title').fill('Sexy time');
    await w.getByLabel('Question 1', { exact: true }).fill('How connected do you feel?');

    // §16.3: save first, then Send → the compat send panel has NO participant picker (§17.12-B).
    await w.getByRole('button', { name: 'Create draft' }).click();
    await w.getByRole('button', { name: 'Send' }).click();
    await expect(w.getByText(/compares/i)).toContainText('Angel');
    expect(await w.getByLabel("Who's being compared?").count()).toBe(0);
    expect(await w.getByLabel('Someone else').count()).toBe(0);
    // The recipient's disclosure names the sender as the other participant (the honesty guard).
    await expect(w.getByText(/Angel will be told/i)).toBeVisible();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('recipient-bound (§17.3): a questionnaire is bound to one recipient, chosen first; Duplicate re-targets', async () => {
  const { userData, vault } = await seedReadyVault();
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('expected a master key');
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();

    // A second household person to re-target the duplicate to.
    await w.getByRole('link', { name: 'People' }).click();
    await w.getByRole('button', { name: 'Add person' }).click();
    await w.getByLabel('Name').fill('Robin');
    await w.getByRole('button', { name: 'Create' }).click();
    await expect(w.getByText('Robin')).toBeVisible();

    // New → the recipient-first start step.
    await w.getByRole('link', { name: 'Questionnaires' }).click();
    await w.getByRole('button', { name: 'New' }).click();
    await expect(w.getByLabel('This questionnaire is for')).toBeVisible();

    // The start step has no horizontal overflow at phone width (Selects fill the width, never scroll-x).
    await w.setViewportSize({ width: 390, height: 800 });
    await w.waitForTimeout(150);
    const startOverflow = await w.evaluate(() => {
      let bad = 0;
      document.querySelectorAll('main *').forEach((el) => {
        const ox = getComputedStyle(el).overflowX;
        if (el.scrollWidth - el.clientWidth > 1 && (ox === 'auto' || ox === 'scroll')) bad += 1;
      });
      return bad;
    });
    expect(startOverflow).toBe(0);
    await w.setViewportSize({ width: 1200, height: 800 });

    // Bind to Tester → author → save.
    await w.getByLabel('Who is this for?').selectOption({ label: 'Tester (you)' });
    await w.getByRole('button', { name: 'Continue' }).click();
    await expect(w.getByText(/For:/)).toContainText('Tester');
    await w.getByLabel('Title').fill('Just for Tester');
    await w.getByLabel('Question 1', { exact: true }).fill('What do you need more of?');
    await w.getByRole('button', { name: 'Create draft' }).click();
    await expect(w.getByText(/Saved\./)).toBeVisible();

    // Decrypt the def: the recipient is persisted as the bound household person.
    const tester = (await listPeople(fs, key)).find((p) => p.displayName === 'Tester');
    const robin = (await listPeople(fs, key)).find((p) => p.displayName === 'Robin');
    let defs = await listQuestionnaires(fs, key);
    const original = defs.find((d) => d.title === 'Just for Tester');
    expect(original?.recipient).toEqual({ kind: 'person', personId: tester?.id });

    // Duplicate → start step → re-target to Robin → the questions clone, title gains "(copy)".
    await w.getByRole('button', { name: 'Duplicate' }).click();
    await w.getByLabel('Who is this for?').selectOption({ label: 'Robin' });
    await w.getByRole('button', { name: 'Continue' }).click();
    await expect(w.getByLabel('Title')).toHaveValue('Just for Tester (copy)');
    await expect(w.getByText(/For:/)).toContainText('Robin');
    await expect(w.getByLabel('Question 1', { exact: true })).toHaveValue(
      'What do you need more of?',
    );
    await w.getByRole('button', { name: 'Create draft' }).click();
    await expect(w.getByText(/Saved\./)).toBeVisible();

    // Decrypt: the duplicate is a SEPARATE def bound to Robin with the cloned question.
    defs = await listQuestionnaires(fs, key);
    const copy = defs.find((d) => d.title === 'Just for Tester (copy)');
    expect(copy?.id).not.toBe(original?.id);
    expect(copy?.recipient).toEqual({ kind: 'person', personId: robin?.id });
    expect(copy?.questions[0]?.prompt).toBe('What do you need more of?');
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('authoring (§16.4): AI draft fills the empty title; Save→Send is a two-step (no Send until saved)', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Questionnaires' }).click();
    await startNewQuestionnaire(w);

    // §16.3: a brand-new draft offers "Create draft", NOT Send.
    await expect(w.getByRole('button', { name: 'Create draft' })).toBeVisible();
    await expect(w.getByRole('button', { name: 'Send' })).toHaveCount(0);
    await w.getByLabel('Question 1', { exact: true }).fill('How are we doing?');

    // §16.4: Title sits below "Draft with AI"; an AI draft fills the empty title. (noWaitAfter: the
    // Generate click flips the button to a transient "Drafting…" state Playwright would otherwise wait on.)
    await w.getByRole('button', { name: /Draft with AI/ }).click();
    await w.getByRole('button', { name: /Generate questions/ }).click({ noWaitAfter: true });
    await expect(w.getByLabel('Title')).toHaveValue('A gentle weekly check-in');

    // §16.3: Save keeps you here (now "Edit questionnaire") and only then offers Send.
    await w.getByRole('button', { name: 'Create draft' }).click();
    await expect(w.getByRole('heading', { name: 'Edit questionnaire' })).toBeVisible();
    await expect(w.getByText(/Saved\. You can send it now/i)).toBeVisible();
    await expect(w.getByRole('button', { name: 'Send' })).toBeVisible();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('intimacy topics (§16.5a): the owner manages custom topics in Settings + an inline builder add, persisted', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('expected a master key');

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();

    // Settings → Questionnaires → the admin-only "Intimacy topics (18+)" surface → add a custom activity.
    await w.getByRole('link', { name: 'Settings' }).click();
    await w.getByRole('button', { name: 'Questionnaires' }).click();
    await expect(w.getByText('Intimacy topics (18+)')).toBeVisible();
    await expect(w.getByText(/18\+ only/i)).toBeVisible();
    await w.getByLabel('Add an activity').fill('Wax play');
    await w.getByRole('button', { name: 'Add' }).first().click();
    await expect(w.getByText('Wax play')).toBeVisible();

    // It persisted to the plain prefs file (no master key needed to read it).
    await expect
      .poll(async () => (await readCustomIntimacyTopics(fs)).activities)
      .toContain('Wax play');

    // The inline builder add (owner) writes to the SAME shared list: author an intimacy/unfiltered
    // questionnaire and add a fantasy from the AI panel.
    await w.getByRole('link', { name: 'Questionnaires' }).click();
    await startNewQuestionnaire(w);
    await w.getByLabel('Type', { exact: true }).selectOption('intimacy');
    await w.getByLabel('Sensitivity').selectOption('unfiltered');
    await w.getByRole('button', { name: /Draft with AI/ }).click();
    await w.getByLabel('Topic kind').selectOption('fantasies');
    await w.getByLabel('New topic').fill('Pirate roleplay');
    await w.getByRole('button', { name: 'Add topic' }).click();
    await expect(w.getByText(/Added .Pirate roleplay./)).toBeVisible();
    await expect
      .poll(async () => (await readCustomIntimacyTopics(fs)).fantasies)
      .toContain('Pirate roleplay');

    // No inner horizontal scrollbar on the new Settings control or the inline add at phone width.
    await w.setViewportSize({ width: 390, height: 800 });
    await w.waitForTimeout(150);
    const offenders = await w.evaluate(
      () =>
        [...document.querySelectorAll('main *')].filter((el) => {
          const s = getComputedStyle(el);
          return (
            (s.overflowX === 'auto' || s.overflowX === 'scroll') &&
            el.scrollWidth - el.clientWidth > 1
          );
        }).length,
    );
    expect(offenders).toBe(0);
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
    // Keep it a private journal entry (15-shareability §3.2) — informsContext defaults on, toggle it off.
    await w.getByRole('switch', { name: 'Let this dream inform coaching context' }).click();
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
    // The informsContext switch round-tripped off through the encrypted vault.
    await expect(
      w.getByRole('switch', { name: 'Let this dream inform coaching context' }),
    ).toHaveAttribute('aria-checked', 'false');

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

test('dreams: visualize a dream — sensitive warning, generate, encrypted round-trip, regenerate, delete', async () => {
  const { userData, vault } = await seedReadyVault({
    'ai.enabled': true,
    'dreams.imageGenerationEnabled': true,
  });
  const secrets = createNodeSecretStore(userData, passthrough);
  await secrets.set('anthropic.apiKey', 'sk-ant-e2e');
  await secrets.set('openai.apiKey', 'sk-openai-e2e');
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Dreams' }).click();
    await w.getByRole('button', { name: 'Log a dream' }).click();
    await w.getByLabel('What happened?').fill('A bright surreal place of open doors.');
    await w.getByLabel('Title (optional)').fill('Visualize me');
    await w.getByLabel('Sensitivity').selectOption({ label: 'Explicit' });
    await w.getByRole('button', { name: 'Save' }).click();

    // Reopen the saved dream → the image panel sits on the detail.
    await w.getByRole('button', { name: /Visualize me/ }).click();

    // Pick an expanded, family-grouped preset (beyond the original four) for this image.
    await w.getByRole('combobox', { name: 'Style' }).selectOption({ label: 'Watercolor' });

    // A non-standard tier warns before sending to OpenAI; Continue proceeds.
    await w.getByRole('button', { name: /visualize this dream/i }).click();
    await expect(w.getByText(/this is a sensitive dream/i)).toBeVisible();
    await w.getByRole('button', { name: 'Continue' }).click();
    await expect(w.getByRole('img')).toBeVisible();

    // The chosen preset is stamped onto the dream's image descriptor on disk.
    const key = await loadMasterKey(secrets);
    if (!key) throw new Error('master key missing');
    const fs = createNodeFileSystem(vault);
    const dreams = await listDreams(fs, key, 'owner-1');
    expect(dreams[0]?.image?.style).toBe('watercolor');

    // The image is stored ENCRYPTED at rest (image.enc is an AES-GCM envelope, not the raw PNG).
    const imgPath = await findFileNamed(vault, 'image.enc');
    expect(imgPath).not.toBeNull();
    const envelope = JSON.parse(await readFile(imgPath as string, 'utf8')) as {
      alg: string;
      data: string;
    };
    expect(envelope.alg).toBe('aes-256-gcm');
    expect(envelope.data).not.toContain('iVBORw0KG'); // the fake PNG's base64 header — never in ciphertext

    // Regenerate replaces it (a confirm, then the new image).
    await w.getByRole('button', { name: 'Regenerate' }).click();
    await w.getByRole('button', { name: 'Regenerate' }).click();
    await expect(w.getByRole('img')).toBeVisible();

    // Delete clears it back to the entry state.
    await w.getByRole('button', { name: 'Delete image' }).click();
    await w.getByRole('button', { name: 'Delete image' }).click();
    await expect(w.getByRole('button', { name: /visualize this dream/i })).toBeVisible();
    await expect(await findFileNamed(vault, 'image.enc')).toBeNull();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('dreams: export an image to a file + share it; the recipient sees it in "Shared with you"', async () => {
  const { userData, vault } = await seedReadyVault({
    'ai.enabled': true,
    'dreams.imageGenerationEnabled': true,
  });
  const secrets = createNodeSecretStore(userData, passthrough);
  await secrets.set('anthropic.apiKey', 'sk-ant-e2e');
  await secrets.set('openai.apiKey', 'sk-openai-e2e');

  // Seed a related household partner who can sign in (member, pinless).
  const key = await loadMasterKey(secrets);
  if (!key) throw new Error('share e2e: master key missing');
  const fs = createNodeFileSystem(vault);
  const now = new Date().toISOString();
  await savePerson(fs, key, {
    id: 'partner-1',
    schemaVersion: 1,
    displayName: 'Partner',
    isSubject: true,
    tags: [],
    createdAt: now,
    updatedAt: now,
  });
  await saveRelationship(fs, key, {
    id: 'rel-1',
    schemaVersion: 1,
    fromPersonId: 'owner-1',
    toPersonId: 'partner-1',
    type: 'partner',
    createdAt: now,
    updatedAt: now,
  });
  await setAccount(fs, key, { personId: 'partner-1', roleId: 'member' });
  await seedCompletedIntake(fs, key, 'partner-1'); // already onboarded, so the Member gate doesn't apply

  const saveDir = await mkdtemp(join(tmpdir(), 'selfos-e2e-export-'));
  process.env['SELFOS_FAKE_SAVE_DIR'] = saveDir;
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Dreams' }).click();
    await w.getByRole('button', { name: 'Log a dream' }).click();
    await w.getByLabel('What happened?').fill('A field of light.');
    await w.getByLabel('Title (optional)').fill('Shareable dream');
    await w.getByRole('button', { name: 'Save' }).click();
    await w.getByRole('button', { name: /Shareable dream/ }).click();
    await w.getByRole('button', { name: /visualize this dream/i }).click();
    await expect(w.getByRole('img')).toBeVisible();

    // Export → a real DECRYPTED file lands outside the vault (PNG magic bytes, not ciphertext).
    await w.getByRole('button', { name: /save image/i }).click();
    await expect(w.getByText(/leaves the encrypted vault/i)).toBeVisible();
    const exported = await findFileNamed(saveDir, 'dream-image.png');
    expect(exported).not.toBeNull();
    const head = [...(await readFile(exported as string)).subarray(0, 4)];
    expect(head).toEqual([0x89, 0x50, 0x4e, 0x47]);

    // Share with the partner.
    await w.getByRole('button', { name: 'Share', exact: true }).click();
    await w.getByRole('switch', { name: /share this image with partner/i }).click();

    // Switch to the partner → the image appears in their "Shared with you" gallery.
    await w.getByRole('button', { name: /signed in as/i }).click();
    await w.getByRole('menuitem', { name: 'Switch person' }).click();
    await w
      .getByRole('dialog', { name: /who.s here/i })
      .getByText('Partner')
      .click();
    await expect(w.getByRole('button', { name: 'Signed in as Partner' })).toBeVisible();
    await w.getByRole('link', { name: 'Dreams' }).click();
    await expect(w.getByText('Shared with you')).toBeVisible();
    await expect(w.getByText(/from tester/i)).toBeVisible();
  } finally {
    delete process.env['SELFOS_FAKE_SAVE_DIR'];
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
    await rm(saveDir, { recursive: true, force: true });
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

test('dreams: enabling image generation reveals the model, style, and admin-only OpenAI key', async () => {
  const { userData, vault } = await seedReadyVault({ 'dreams.imageGenerationEnabled': true });
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Settings' }).click();
    await w.getByRole('button', { name: 'Dreams', exact: true }).click();

    // Consent on → the model, style, style notes, and OpenAI key controls are revealed.
    await expect(w.getByLabel('Image model')).toBeVisible();
    await expect(w.getByLabel('Default image style')).toBeVisible();
    await expect(w.getByLabel('Style notes (optional)')).toBeVisible();
    await expect(w.getByLabel('OpenAI API key')).toBeVisible();

    // The image model + key are admin-only — marked so admins know normal users don't see them.
    await expect(w.getByText('Admin only').first()).toBeVisible();

    // The expanded, family-grouped presets are available (an option beyond the original four).
    await w.getByLabel('Default image style').selectOption({ label: 'Gouache' });
    // The free-text style notes (§15.2) persist through the new textarea control.
    await w.getByLabel('Style notes (optional)').fill('muted earth tones, golden-hour light');

    const settingsFile = join(vault, 'config', 'settings.json');
    await expect
      .poll(async () => {
        const parsed = JSON.parse(await readFile(settingsFile, 'utf8')) as {
          values: Record<string, unknown>;
        };
        return [parsed.values['dreams.imageStyle'], parsed.values['dreams.imageStyleNotes']];
      })
      .toEqual(['gouache', 'muted earth tones, golden-hour light']);

    // The OpenAI key is write-only — saving it reports configured (the value never returns to the renderer).
    await w.getByLabel('OpenAI API key').fill('sk-openai-e2e');
    await w.getByRole('button', { name: /save key/i }).click();
    await expect(w.getByText(/key is configured/i)).toBeVisible();

    // At phone width the expanded select + the multiline notes textarea fit — the content area and the
    // document don't overflow horizontally. (The Settings section nav is an intentional horizontal pill
    // scroller, so this mirrors the section-sweep guard rather than flagging that by-design scroller.)
    await w.setViewportSize({ width: 390, height: 780 });
    await w.waitForTimeout(50);
    const overflow = await w.evaluate(() => {
      const main = document.querySelector('main');
      const mainOverflow = main ? main.scrollWidth - main.clientWidth : 0;
      const docOverflow = document.documentElement.scrollWidth - window.innerWidth;
      return Math.max(mainOverflow, docOverflow);
    });
    expect(overflow).toBeLessThanOrEqual(1);
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

    // Content sanity on the sections that previously had bugs. (`exact` so it doesn't also match the
    // titlebar "Vault: all synced" sync chip.)
    await w.getByRole('button', { name: 'Vault', exact: true }).click();
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
  await seedCompletedIntake(fs, key, 'wife-1'); // already onboarded, so the Member gate doesn't apply post-join
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
  await seedCompletedIntake(fs, key, 'wife-1'); // already onboarded, so the Member gate doesn't apply post-join
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
        await startNewQuestionnaire(w); // open the builder (detail pane)
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
        await w.getByRole('button', { name: 'Preview', exact: true }).click();
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
        expect(await noOverflow()).toBe(true); // the person tabs scroll, not overflow
        // A Subject has no About tab (owned by onboarding); check the Notes tab's layout instead.
        await w.getByRole('button', { name: 'Notes' }).click();
        await w.waitForTimeout(120);
        expect(await noOverflow()).toBe(true);
        // exact: the ShareToggle aria-labels contain "people you relate to" (a substring of "People").
        await w.getByRole('button', { name: 'People', exact: true }).click(); // back to the list
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

test('design: the AppHeader titlebar controls share a height + vertical alignment', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await expect(w.getByRole('link', { name: 'Home', exact: true })).toBeVisible();
    // Open the usage ring so it's mounted (it only renders with a person budget — always true here).
    await expect(w.getByRole('button', { name: /AI usage/i })).toBeVisible();
    const geo = await w.evaluate(() => {
      const rect = (sel: string): { top: number; height: number } | null => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), height: Math.round(r.height) };
      };
      return {
        sync: rect('button[aria-label^="Vault:"]'),
        ring: rect('button[aria-label*="AI usage"]'),
        appearance: rect('button[aria-label^="Appearance"]'),
        account: rect('button[aria-label^="Signed in as"]'),
      };
    });
    const items = [geo.sync, geo.ring, geo.appearance, geo.account];
    for (const item of items) expect(item).not.toBeNull();
    const tops = items.map((i) => i?.top ?? -1);
    const heights = items.map((i) => i?.height ?? -1);
    // The whole right cluster (sync chip · usage · appearance · account) shares a top edge + height
    // (≤1px tolerance) — they all render through the one TitlebarControl primitive.
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

// macOS-only: the traffic lights are inset within the custom titlebar and the brand must start to
// their right (reserved by --titlebar-traffic-width), never overlapping them.
(process.platform === 'darwin' ? test : test.skip)(
  'design (macOS): the brand clears the traffic-light inset and the usage dropdown links to /usage',
  async () => {
    const { userData, vault } = await seedReadyVault();
    const app = await launch(userData);
    try {
      const w = await app.firstWindow();
      const brandLink = w.getByRole('banner').getByRole('link', { name: 'SelfOS' });
      await expect(brandLink).toBeVisible();

      // The brand's left edge clears the reserved traffic-light inset (≈80px) so it never overlaps
      // the macOS traffic lights (which occupy ~72px from the window's left edge).
      const brandLeft = await brandLink.evaluate((el) =>
        Math.round(el.getBoundingClientRect().left),
      );
      expect(brandLeft).toBeGreaterThanOrEqual(72);

      // The enriched usage dropdown opens and links through to the full Usage page.
      await w.getByRole('button', { name: /AI usage/i }).click();
      await expect(w.getByRole('dialog', { name: 'AI usage' })).toBeVisible();
      await w.getByRole('button', { name: 'View usage details →' }).click();
      await expect(w.getByRole('heading', { name: 'Usage' })).toBeVisible();
    } finally {
      await app.close();
      await rm(userData, { recursive: true, force: true });
      await rm(vault, { recursive: true, force: true });
    }
  },
);

test('design: the brand collapses to the tile-only mark at phone width (no wordmark)', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    const brandLink = w.getByRole('banner').getByRole('link', { name: 'SelfOS' });
    await expect(brandLink).toBeVisible();
    // At desktop width the wordmark text is visible…
    await expect(brandLink.getByText('SelfOS')).toBeVisible();

    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.setMinimumSize(360, 480);
        win.setSize(390, 800);
      }
    });
    await w.waitForTimeout(150);
    // …but below --bp-sm only the tile shows; the link keeps its accessible name.
    await expect(brandLink.getByText('SelfOS')).toBeHidden();
    await expect(brandLink).toBeVisible();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('vault: Change vault unlinks the current vault, routes to onboarding, and leaves data intact + re-linkable', async () => {
  const { userData, vault } = await seedReadyVault();
  const recoveryBefore = await readFile(join(vault, 'config', 'recovery.enc'));

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    // Boots straight into the shell (signed in as the seeded owner).
    await expect(w.getByRole('banner').getByRole('link', { name: 'SelfOS' })).toBeVisible();

    // Settings → Vault → Change vault… → confirm.
    await w.getByRole('link', { name: 'Settings' }).click();
    await w.getByRole('button', { name: 'Vault', exact: true }).click();
    await w.getByRole('button', { name: /change vault/i }).click();
    const dialog = w.getByRole('dialog', { name: 'Change vault' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/recovery phrase/i)).toBeVisible();

    // The dialog fits at phone width (no horizontal overflow on the panel).
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.setMinimumSize(360, 480);
        win.setSize(390, 800);
      }
    });
    await w.waitForTimeout(150);
    const dialogOverflow = await w.evaluate(() => {
      const panel = document.querySelector('[role="dialog"]');
      return panel ? panel.scrollWidth - panel.clientWidth : 0;
    });
    expect(dialogOverflow).toBeLessThanOrEqual(1);

    await dialog.getByRole('button', { name: 'Continue' }).click();

    // Lands on the onboarding "Choose a folder" screen — no shell.
    await expect(w.getByRole('button', { name: /choose a folder/i })).toBeVisible();
    await expect(w.getByRole('complementary')).toHaveCount(0);
  } finally {
    await app.close();
  }

  // No data loss: the old vault's recovery bundle is byte-identical; the device forgot the vault path.
  const recoveryAfter = await readFile(join(vault, 'config', 'recovery.enc'));
  expect(recoveryAfter.equals(recoveryBefore)).toBe(true);
  const state = JSON.parse(await readFile(join(userData, 'state.json'), 'utf8')) as {
    vaultPath: string | null;
  };
  expect(state.vaultPath).toBeNull();

  // Re-link proof: re-point the device at the same vault and relaunch. Because the master key was
  // cleared, the initialized vault now routes to the recovery-phrase UnlockScreen — intact + re-openable.
  await writeJson(join(userData, 'state.json'), { schemaVersion: 1, vaultPath: vault });
  const app2 = await launch(userData);
  try {
    const w2 = await app2.firstWindow();
    await expect(w2.getByRole('heading', { name: 'This vault is already set up' })).toBeVisible();
    await expect(w2.getByLabel('Recovery phrase')).toBeVisible();
  } finally {
    await app2.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('vault: the VaultError screen offers a key-safe "Use a different vault" → onboarding', async () => {
  // Boot with a recorded vault path that doesn't exist → the boot gate lands on VaultError.
  const userData = await mkdtemp(join(tmpdir(), 'selfos-e2e-ud-'));
  const missing = join(tmpdir(), 'selfos-e2e-gone-does-not-exist');
  await writeJson(join(userData, 'state.json'), { schemaVersion: 1, vaultPath: missing });

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await expect(w.getByRole('heading', { name: /isn’t reachable/i })).toBeVisible();

    // The error screen fits at phone width (no horizontal overflow).
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.setMinimumSize(360, 480);
        win.setSize(390, 800);
      }
    });
    await w.waitForTimeout(150);
    // Boot screens render outside `main`, so check the page itself for horizontal overflow.
    const overflow = await w.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    // "Use a different vault" routes through unlink (clears the pointer) → onboarding, never a stale
    // re-point. Retry stays as-is (re-checks the same folder).
    await w.getByRole('button', { name: /use a different vault/i }).click();
    await expect(w.getByRole('button', { name: /choose a folder/i })).toBeVisible();
  } finally {
    await app.close();
  }

  // The device pointer was cleared (a clean detach), so a relaunch boots to onboarding, not the error.
  const state = JSON.parse(await readFile(join(userData, 'state.json'), 'utf8')) as {
    vaultPath: string | null;
  };
  expect(state.vaultPath).toBeNull();
  await rm(userData, { recursive: true, force: true });
});

/** Seed a ready vault for the active owner, then return fs/key so a test can add per-person data. */
async function seedHomeVault(settingsValues: Record<string, unknown> = {}): Promise<{
  userData: string;
  vault: string;
  fs: ReturnType<typeof createNodeFileSystem>;
  key: Uint8Array;
}> {
  const { userData, vault } = await seedReadyVault(settingsValues);
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('seedHomeVault: master key missing');
  return { userData, vault, fs, key };
}

test('home: a brand-new person sees the getting-started state', async () => {
  const { userData, vault } = await seedHomeVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await expect(w.getByRole('heading', { name: /welcome to selfos/i })).toBeVisible();
    await expect(w.getByRole('button', { name: /start a session/i })).toBeVisible();
    // No real cards yet, but the crisis affordance is always present (§7).
    await expect(w.getByRole('heading', { name: /pick up where you left off/i })).toHaveCount(0);
    await expect(w.getByRole('button', { name: /get help now/i })).toBeVisible();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('home: a seeded person sees the cards, links into them, and fits at 390px', async () => {
  const { userData, vault, fs, key } = await seedHomeVault();
  const now = new Date().toISOString();

  // Two open sessions (one in-progress, one on-hold) + one completed (must NOT show in Continue).
  await saveConversation(fs, key, {
    id: 'c1',
    schemaVersion: 1,
    personId: 'owner-1',
    title: 'A hard week',
    status: 'inProgress',
    messages: [{ role: 'user', content: 'hi', ts: now }],
    createdAt: now,
    updatedAt: now,
  });
  await saveConversation(fs, key, {
    id: 'c2',
    schemaVersion: 1,
    personId: 'owner-1',
    title: 'On the back burner',
    status: 'onHold',
    messages: [],
    createdAt: now,
    updatedAt: now,
  });
  await saveConversation(fs, key, {
    id: 'c3',
    schemaVersion: 1,
    personId: 'owner-1',
    title: 'Wrapped up',
    status: 'complete',
    messages: [],
    createdAt: now,
    updatedAt: now,
  });

  // Two approved session insights with mood → the wellbeing trend (needs ≥2) + the memory card.
  for (const [i, valence] of [-0.4, 0.5].entries()) {
    await saveInsight(fs, key, {
      id: `ins-${i}`,
      schemaVersion: 1,
      source: 'session',
      subjectPersonId: 'owner-1',
      summary: `Reflected on a tough patch (${i})`,
      facts: [],
      metrics: { moodValence: valence, moodEnergy: 0.1 },
      confidence: 'medium',
      approved: true,
      provenance: { conversationId: `c${i + 1}`, at: `2026-06-0${i + 1}T00:00:00.000Z` },
      createdAt: now,
      updatedAt: `2026-06-0${i + 1}T00:00:00.000Z`,
    });
  }

  // A dream → the recent-dreams card.
  await saveDream(fs, key, {
    id: 'd1',
    schemaVersion: 1,
    personId: 'owner-1',
    title: 'The shifting city',
    narrative: 'I was wandering through a city that kept rearranging itself.',
    lucid: false,
    nightmare: false,
    tags: [],
    people: [],
    sensitivity: 'standard',
    status: 'captured',
    createdAt: now,
    updatedAt: now,
  });

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await expect(w.getByRole('heading', { name: /tester/i, level: 1 })).toBeVisible();

    // Continue card — the two open sessions, not the completed one.
    await expect(w.getByRole('heading', { name: /pick up where you left off/i })).toBeVisible();
    await expect(w.getByText('A hard week')).toBeVisible();
    await expect(w.getByText('On the back burner')).toBeVisible();
    await expect(w.getByText('Wrapped up')).toHaveCount(0);

    // Wellbeing, dreams, memory all render.
    await expect(w.getByRole('heading', { name: 'Wellbeing' })).toBeVisible();
    await expect(w.getByRole('heading', { name: 'Recent dreams' })).toBeVisible();
    await expect(w.getByText('The shifting city')).toBeVisible();
    await expect(w.getByRole('heading', { name: /what the coach knows/i })).toBeVisible();

    // 390px: no horizontal overflow anywhere (page-level AND no inner scrollbar).
    await w.setViewportSize({ width: 390, height: 780 });
    const offenders = await w.evaluate(() => {
      const bad: string[] = [];
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const ox = getComputedStyle(el).overflowX;
        if (el.scrollWidth - el.clientWidth > 1 && (ox === 'auto' || ox === 'scroll')) {
          bad.push(el.className || el.tagName);
        }
      }
      const main = document.querySelector('main');
      return { bad, mainOverflow: main ? main.scrollWidth - main.clientWidth : 0 };
    });
    expect(offenders.bad).toEqual([]);
    expect(offenders.mainOverflow).toBeLessThanOrEqual(1);

    // The Resume action opens the session in Sessions.
    await w.setViewportSize({ width: 1100, height: 800 });
    await w.getByRole('button', { name: 'Resume' }).first().click();
    await expect(w).toHaveURL(/#\/sessions$/);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('onboarding: nudge → turn fills a field → skip intimacy → portrait feeds context → owner sees restricted facts (18)', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  // Seed an in-progress intake with the middle sections already skipped, so the flow is deterministic:
  // do `basics` (fills a field), then reach `intimacy` (the 18+ gate), then finish.
  {
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('onboarding e2e: master key missing');
    const order = [
      'basics',
      'life-now',
      'family',
      'story',
      'health',
      'weighs',
      'relationships',
      'values',
      'want',
      'intimacy',
    ];
    await writeEncryptedJson(
      fs,
      'people/owner-1/intake/session.enc',
      {
        id: 'intake-flow',
        schemaVersion: 1,
        personId: 'owner-1',
        status: 'inProgress',
        sections: order.map((id) => ({
          id,
          status: id === 'basics' || id === 'intimacy' ? 'notStarted' : 'skipped',
          restricted: id === 'weighs' || id === 'intimacy',
          messages: [],
          answers: {},
        })),
        startedAt: 'now',
        updatedAt: 'now',
      },
      key,
    );
  }
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Home' }).waitFor();

    // The Home nudge (§3.1) prompts the person to continue onboarding.
    await w.getByRole('link', { name: 'Home' }).click();
    await w.getByRole('button', { name: /Start onboarding|Continue onboarding/ }).click();

    // The basics section is a structured FORM; a form answer fills the owner-only profile (no AI).
    await expect(w.getByRole('heading', { name: 'The basics' })).toBeVisible();
    await w.getByLabel('What do you do for work?').fill('nurse');
    await w.getByLabel('How would you describe how you look?').fill('tall, curly hair');
    // A structured label+date entry (the new dateList control) → Person.importantDates.
    await w.getByRole('button', { name: '+ Add a date' }).click();
    await w.getByLabel('Any important dates to remember? — label 1').fill('Anniversary');
    await w.getByLabel('Any important dates to remember? — date 1').fill('2014-06-21');
    await w.getByRole('button', { name: /Continue/ }).click();

    // Core done → the invited grid offers the deeper sections. Opening intimacy shows the shared 18+ gate.
    await w.getByRole('button', { name: /Intimacy & sexuality/ }).click();
    await expect(w.getByRole('button', { name: /18 or older/ })).toBeVisible();
    await w.getByRole('button', { name: 'Skip this section' }).click();

    // Generate the portrait → a confirm modal (encourages adding more) → it releases the gate (§14.2/§15)
    // and feeds the person's own context.
    await w.getByRole('button', { name: /See my portrait/ }).click();
    await w.getByRole('button', { name: 'Generate my portrait' }).click();
    await expect(w.getByText(/come to understand about you/)).toBeVisible();

    // Decrypt the vault: the direct answer filled the owner-only profile, and the portrait + its restricted
    // fact feed the person's OWN coaching context (restricted facts are own-context-only, never redacted there).
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('onboarding e2e: master key missing');
    await expect
      .poll(async () => (await getIntakeSession(fs, key, 'owner-1'))?.status)
      .toBe('complete');
    const filled = await getPerson(fs, key, 'owner-1');
    expect(filled?.occupation).toBe('nurse');
    expect(filled?.appearanceDescription).toBe('tall, curly hair'); // new basics field
    expect(filled?.importantDates).toEqual([{ label: 'Anniversary', date: '2014-06-21' }]); // dateList
    const context = await buildContext(fs, key, 'owner-1');
    expect(context).toContain('thoughtful and steady'); // the portrait summary feeds own context
    expect(context).toContain('grief'); // a restricted fact still feeds the person's OWN coaching

    // The Owner is the full-access role → sees both the portrait summary AND the restricted ('grief')
    // fact directly in Memory, marked "sensitive" (a member would get the restricted fact redacted, §8.4).
    await w.getByRole('link', { name: 'Memory' }).click();
    await expect(w.getByText(/thoughtful and steady/)).toBeVisible();
    await expect(w.getByText(/Carries grief/)).toBeVisible();
    await expect(w.getByText('sensitive').first()).toBeVisible();

    // No horizontal overflow (page or inner controls) at phone width on the onboarding flow.
    await w.getByRole('link', { name: /Onboarding/ }).click();
    await w.setViewportSize({ width: 390, height: 780 });
    const guard = await w.evaluate(() => {
      const offenders: string[] = [];
      document.querySelectorAll('*').forEach((el) => {
        const ox = getComputedStyle(el).overflowX;
        if (el.scrollWidth - el.clientWidth > 1 && (ox === 'auto' || ox === 'scroll')) {
          offenders.push(`${el.tagName}.${String(el.className)}`);
        }
      });
      const main = document.querySelector('main');
      return { offenders, mainOverflow: main ? main.scrollWidth - main.clientWidth : 0 };
    });
    expect(guard.offenders).toEqual([]);
    expect(guard.mainOverflow).toBeLessThanOrEqual(1);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('onboarding: resumes mid-intake to the saved transcript (18 §3.1)', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  // Seed an in-progress intake with one section already underway.
  {
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('resume e2e: master key missing');
    await writeEncryptedJson(
      fs,
      'people/owner-1/intake/session.enc',
      {
        id: 'intake-resume',
        schemaVersion: 1,
        personId: 'owner-1',
        status: 'inProgress',
        // Core sections done so the overview shows the invited grid; a form section ('family') has an
        // in-progress "Tell me more" go-deeper transcript that should resume on open.
        sections: [
          { id: 'basics', status: 'complete', restricted: false, messages: [], answers: {} },
          { id: 'life-now', status: 'skipped', restricted: false, messages: [], answers: {} },
          { id: 'values', status: 'skipped', restricted: false, messages: [], answers: {} },
          { id: 'want', status: 'skipped', restricted: false, messages: [], answers: {} },
          {
            id: 'family',
            status: 'inProgress',
            restricted: false,
            messages: [
              { role: 'user', content: 'My name is Sam.', ts: 'now' },
              { role: 'assistant', content: 'Lovely to meet you, Sam.', ts: 'now' },
            ],
            answers: {},
          },
        ],
        startedAt: 'now',
        updatedAt: 'now',
      },
      key,
    );
  }
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: /Onboarding/ }).click();
    // Open the in-progress section from the "Go deeper" grid → its go-deeper transcript auto-expands.
    await w.getByRole('button', { name: /Family & upbringing/ }).click();
    await expect(w.getByText('My name is Sam.')).toBeVisible();
    await expect(w.getByText('Lovely to meet you, Sam.')).toBeVisible();
    // Reloading returns to the same section (device-local), not back to the core flow: reopening
    // Onboarding lands directly on Family & upbringing (its transcript) without re-clicking the grid card.
    await w.reload();
    await w.getByRole('link', { name: /Onboarding/ }).click();
    await expect(w.getByText('My name is Sam.')).toBeVisible();
    await expect(w.getByRole('button', { name: /^Back$/ })).toBeVisible();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

// Guard: a grouped form section must render EVERY question to the bottom (no group collapsed by default) and
// always show the section-level "Tell me more" go-deeper above Continue/Skip. This is the regression that kept
// recurring — a collapsed accordion silently hid the last group's questions at the end of the section.
test('onboarding: a grouped form section shows every group + the go-deeper (nothing collapsed)', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  {
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('grouped-form e2e: master key missing');
    // Core resolved so the invited grid is reachable; Relationships (a grouped form) is the section under test.
    await writeEncryptedJson(
      fs,
      'people/owner-1/intake/session.enc',
      {
        id: 'intake-grouped',
        schemaVersion: 1,
        personId: 'owner-1',
        status: 'inProgress',
        sections: ['basics', 'life-now', 'values', 'want', 'relationships'].map((id) => ({
          id,
          status: id === 'relationships' ? 'notStarted' : 'skipped',
          restricted: false,
          messages: [],
          answers: {},
        })),
        startedAt: 'now',
        updatedAt: 'now',
      },
      key,
    );
  }
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: /Onboarding/ }).click();
    await w.getByRole('button', { name: /Relationships/ }).click();

    // A question in the FIRST group is visible (open)...
    await expect(w.getByText('Your relationship deal-breakers')).toBeVisible();
    // ...AND a question in the LAST group ('Your circle') is visible too — i.e. no group is collapsed.
    await expect(w.getByText('How lonely do you feel?')).toBeVisible();
    // The section-level go-deeper sits at the end of every form section.
    await expect(w.getByRole('button', { name: /Tell me more/ })).toBeVisible();
    // Belt-and-braces: assert no accordion <details> is collapsed (every group open by default).
    const collapsed = await w.evaluate(
      () => [...document.querySelectorAll('details')].filter((d) => !d.open).length,
    );
    expect(collapsed).toBe(0);

    // The "Go deeper" section navigator is ALSO present at the bottom of an opened section (not only on the
    // core steps), so the person can jump STRAIGHT to another section without going Back first (18 §3.1).
    await expect(w.getByRole('heading', { name: 'Go deeper' })).toBeVisible();
    await w.getByRole('button', { name: /Health & wellbeing/ }).click();
    await expect(w.getByText('How well do you sleep?')).toBeVisible();
    // And from Health, the navigator is still there to jump onward (e.g. back to Relationships).
    await expect(w.getByRole('heading', { name: 'Go deeper' })).toBeVisible();
    await w.getByRole('button', { name: /Relationships/ }).click();
    await expect(w.getByText('Your relationship deal-breakers')).toBeVisible();

    // Progress is shown (a bar in the header + the Go deeper block) and each card carries an answered count.
    await expect(w.getByText(/Your progress/).first()).toBeVisible();
    await expect(w.getByText(/of \d+ answered/).first()).toBeVisible();
    // Finishing a section marks it done in the grid: the card flips from "Add" to "Update".
    await w.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(w.getByText('Update', { exact: true }).first()).toBeVisible();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

// Guard: conditional intimacy questions must REVEAL right under the question that gates them (18 §14.5) — this
// is the regression where penis/vulva specifics were buried in a far-down group and never seemed to appear.
test('onboarding: intimacy conditionals reveal under their trigger (penis/vulva/dirty talk)', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  {
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('intimacy e2e: master key missing');
    // Core resolved so the invited grid (with the Intimacy card) is reachable.
    await writeEncryptedJson(
      fs,
      'people/owner-1/intake/session.enc',
      {
        id: 'intake-intimacy',
        schemaVersion: 1,
        personId: 'owner-1',
        status: 'inProgress',
        sections: ['basics', 'life-now', 'values', 'want', 'intimacy'].map((id) => ({
          id,
          status: id === 'intimacy' ? 'notStarted' : 'skipped',
          restricted: id === 'intimacy',
          messages: [],
          answers: {},
        })),
        startedAt: 'now',
        updatedAt: 'now',
      },
      key,
    );
  }
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: /Onboarding/ }).click();
    await w.getByRole('button', { name: /Intimacy & sexuality/ }).click();
    // Pass the 18+ gate into the questions.
    await w.getByRole('button', { name: /18 or older/ }).click();
    await expect(w.getByText('Who are you drawn to?')).toBeVisible();

    // Penis length/girth are HIDDEN until "attracted to a penis" is Yes, then REVEAL.
    await expect(w.getByText('Penis length you’re drawn to')).toHaveCount(0);
    await w
      .getByRole('radiogroup', { name: 'Are you attracted to partners with a penis?' })
      .getByRole('radio', { name: 'Yes' })
      .click();
    await expect(w.getByText('Penis length you’re drawn to')).toBeVisible();
    await expect(w.getByText('Penis girth you like')).toBeVisible();

    // Only vulva-relevant specifics are gated on the vulva question — breast preference is a general body
    // preference and stays visible regardless (it must NOT be tied to "attracted to a vulva").
    await expect(w.getByText('Breast size you’re drawn to on a partner')).toBeVisible();
    await expect(w.getByText('Labia you’re drawn to on a partner')).toHaveCount(0);
    await w
      .getByRole('radiogroup', { name: 'Are you attracted to partners with a vulva?' })
      .getByRole('radio', { name: 'Yes' })
      .click();
    await expect(w.getByText('Labia you’re drawn to on a partner')).toBeVisible();
    await expect(w.getByText('Anything you love about a partner’s clit?')).toBeVisible();

    // Dirty-talk follow-ups hide when "Not for me", show otherwise.
    await w
      .getByRole('radiogroup', { name: 'How do you feel about dirty talk?' })
      .getByRole('radio', { name: 'Not for me' })
      .click();
    await expect(w.getByText('Dirty talk — things you love to hear')).toHaveCount(0);
    await w
      .getByRole('radiogroup', { name: 'How do you feel about dirty talk?' })
      .getByRole('radio', { name: 'Love it' })
      .click();
    await expect(w.getByText('Dirty talk — things you love to hear')).toBeVisible();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('onboarding: living-with-children auto-fills Children, and a substance reveals its frequency', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  {
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('autofill e2e: master key missing');
    await writeEncryptedJson(
      fs,
      'people/owner-1/intake/session.enc',
      {
        id: 'intake-autofill',
        schemaVersion: 1,
        personId: 'owner-1',
        status: 'inProgress',
        sections: ['basics', 'life-now', 'values', 'want'].map((id) => ({
          id,
          status: id === 'want' ? 'notStarted' : 'skipped',
          restricted: false,
          messages: [],
          answers: {},
        })),
        startedAt: 'now',
        updatedAt: 'now',
      },
      key,
    );
  }
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: /Onboarding/ }).click();

    // "Your life now": picking "Children" in who-you-live-with auto-selects the Children question.
    await w.getByRole('button', { name: /Your life now/ }).click();
    const children = w.getByRole('radiogroup', { name: 'Children' });
    await expect(children.getByRole('radio', { name: 'Have young kids' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await w
      .getByRole('group', { name: 'Who do you live with?' })
      .getByRole('button', { name: 'Children' })
      .click();
    await expect(children.getByRole('radio', { name: 'Have young kids' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // "Health & wellbeing": a per-substance frequency reveals only once that substance is selected.
    await w.getByRole('button', { name: /Health & wellbeing/ }).click();
    await expect(w.getByText('Cannabis — how often?')).toHaveCount(0);
    await w
      .getByRole('group', { name: 'Which recreational substances do you use, if any?' })
      .getByRole('button', { name: 'Cannabis / weed' })
      .click();
    await expect(w.getByText('Cannabis — how often?')).toBeVisible();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('onboarding: a Member is hard-gated into onboarding until they finish (18 §3.1)', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  // Seed a Member + a short, mostly-skipped intake, and make them the active person.
  {
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('gate e2e: master key missing');
    const now = new Date().toISOString();
    await savePerson(fs, key, {
      id: 'member-1',
      schemaVersion: 1,
      displayName: 'Mara',
      isSubject: true,
      tags: [],
      createdAt: now,
      updatedAt: now,
    });
    await setAccount(fs, key, { personId: 'member-1', roleId: 'member' });
    const order = [
      'basics',
      'life-now',
      'family',
      'story',
      'health',
      'weighs',
      'relationships',
      'values',
      'want',
      'intimacy',
    ];
    await writeEncryptedJson(
      fs,
      'people/member-1/intake/session.enc',
      {
        id: 'intake-member',
        schemaVersion: 1,
        personId: 'member-1',
        status: 'inProgress',
        sections: order.map((id) => ({
          id,
          status: id === 'basics' ? 'notStarted' : 'skipped',
          restricted: id === 'weighs' || id === 'intimacy',
          messages: [],
          answers: {},
        })),
        startedAt: now,
        updatedAt: now,
      },
      key,
    );
  }
  // Point the device at the Member as the active person.
  await writeJson(join(userData, 'state.json'), {
    schemaVersion: 1,
    vaultPath: vault,
    activePersonId: 'member-1',
    superAdminPassphraseHash: await hashPin('superpass'),
  });
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    // Hard gate: onboarding takes over the whole app — no sidebar nav to any other screen.
    await expect(w.getByRole('heading', { name: /Getting to know you/ })).toBeVisible();
    await expect(w.getByRole('link', { name: 'Home' })).toHaveCount(0);
    await expect(w.getByRole('link', { name: 'Sessions' })).toHaveCount(0);
    // But it's not a dead-end — the crisis resources are always present.
    await expect(w.getByRole('button', { name: /get help now/i })).toBeVisible();

    // And not a trap: the gated Member can switch accounts straight from the onboarding screen (not only
    // the titlebar menu) — the in-screen "Switch person" opens the account switcher.
    await w.getByRole('button', { name: 'Switch person' }).click();
    await expect(w.getByRole('dialog', { name: /Who.s here/ })).toBeVisible();
    await w.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(w.getByRole('dialog', { name: /Who.s here/ })).toHaveCount(0);

    // Finish: complete the open core form, then generate the portrait → the gate releases.
    await expect(w.getByRole('heading', { name: 'The basics' })).toBeVisible();
    await w.getByLabel('What do you do for work?').fill('nurse');
    await w.getByRole('button', { name: /Continue/ }).click();
    await w.getByRole('button', { name: /See my portrait/ }).click();
    await w.getByRole('button', { name: 'Generate my portrait' }).click();

    // Gate released: the portrait shows AND the app nav is now available.
    await expect(w.getByText(/come to understand about you/)).toBeVisible();
    await expect(w.getByRole('link', { name: 'Home' })).toBeVisible();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});
