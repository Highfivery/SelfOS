import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
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
  listRelationships,
  savePerson,
  saveRelationship,
  setAccount,
} from '@selfos/core/people';
import { getGoal, saveGoal } from '@selfos/core/goals';
import { hashPin } from '@selfos/core/crypto';
import { queryUsage, recordUsage } from '@selfos/core/usage';
import { readEncryptedJson, writeEncryptedJson } from '@selfos/core/vault';
import {
  createAssignment,
  createCompatibilitySend,
  getAlignmentReport,
  getAssignmentSnapshot,
  getResponse,
  listAssignments,
  listQuestionnaires,
  listSavedSuggestions,
  readCustomIntimacyTopics,
  saveQuestionnaire,
  submitResponse,
} from '@selfos/core/questionnaires';
import { getIntakeSession, intakeCatalogSnapshot } from '@selfos/core/intake';
import {
  getInsight,
  listInsightsForPerson,
  saveInsight,
  summarizeForContext,
} from '@selfos/core/insights';
import { listDreams, saveAnalysis, saveDream } from '@selfos/core/dreams';
import {
  conversationAttachmentsDir,
  getConversationAttachment,
  listConversations,
  saveConversation,
} from '@selfos/core/conversations';
import { listChallenges } from '@selfos/core/challenges';
import { listProfileSuggestions } from '@selfos/core/profile';

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

/**
 * Seed a member (person + member login + completed onboarding) with an approved onboarding-portrait Insight
 * carrying a private fact — the fixture for the cross-user Memory scoping guard (spec 20 §1.1/§10).
 */
async function seedMemberWithPortrait(
  vault: string,
  userData: string,
  id: string,
  name: string,
  secretFact: string,
): Promise<void> {
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('seedMemberWithPortrait: master key missing');
  const now = new Date().toISOString();
  await savePerson(fs, key, {
    id,
    schemaVersion: 1,
    displayName: name,
    isSubject: true,
    tags: [],
    createdAt: now,
    updatedAt: now,
  });
  await setAccount(fs, key, { personId: id, roleId: 'member' });
  await seedCompletedIntake(fs, key, id);
  await saveInsight(fs, key, {
    id: `intake-${id}`,
    schemaVersion: 1,
    source: 'intake',
    subjectPersonId: id,
    summary: `${name}'s onboarding portrait`,
    facts: [{ id: 'f1', text: secretFact, shareable: false }],
    confidence: 'medium',
    categories: [],
    approved: true,
    provenance: { intakeSection: 'your-story', at: now },
    createdAt: now,
    updatedAt: now,
  });
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

/** Seed a pending profile-freshness suggestion for a subject (the `profile-freshness` notification source). */
async function seedProfileSuggestion(
  vault: string,
  userData: string,
  personId: string,
  id: string,
): Promise<void> {
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('seedProfileSuggestion: master key missing');
  const now = new Date().toISOString();
  await writeEncryptedJson(
    fs,
    `people/${personId}/profile-suggestions/${id}.enc`,
    {
      id,
      schemaVersion: 1,
      subjectPersonId: personId,
      kind: 'field',
      field: 'occupation',
      observed: 'nurse',
      rationale: 'A recent session mentioned a new job.',
      sourceInsightId: 'insight-1',
      sourceKind: 'session',
      restricted: false,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    },
    key,
  );
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
  // Deterministic update check (no real GitHub call) — default reports an OLD version so the launch check
  // is a no-op (up to date, no notification). Update tests override SELFOS_FAKE_UPDATE per launch (36 §10).
  env.SELFOS_FAKE_UPDATE = '0.0.0';
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

/** A valid RGB PNG built from scratch (Electron's `createImageBitmap` rejects some hand-picked 1×1 blobs). */
function makePng(width = 8, height = 8): Buffer {
  const crc32 = (buf: Buffer): number => {
    let c = ~0;
    for (let i = 0; i < buf.length; i += 1) {
      c ^= buf[i]!;
      for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([len, typed, crc]);
  };
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 180)]); // filter 0 + grey pixels
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
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
    // Scope to the in-content banner — the same text now also appears in a notification toast (spec 35).
    await expect(w.getByRole('main').getByText(/sync conflict copy was found/i)).toBeVisible();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('notifications: bell + center surface conflicts and freshness; an action navigates; dismiss sticks; no overflow (35)', async () => {
  const { userData, vault } = await seedReadyVault();
  await mkdir(join(vault, 'journal'), { recursive: true });
  await writeFile(join(vault, 'journal', 'note (conflicted copy 2026-06-09).md'), 'x', 'utf8');
  await seedProfileSuggestion(vault, userData, 'owner-1', 'sugg-1');

  let app = await launch(userData);
  try {
    const w = await app.firstWindow();
    // 1 conflict + 1 freshness = 2 unread.
    await expect(w.getByRole('button', { name: 'Notifications, 2 unread' })).toBeVisible();

    // Go off Home first so the freshness action (→ Home) is observable.
    await w.getByRole('link', { name: 'Usage' }).click();
    await expect.poll(() => w.evaluate(() => window.location.hash)).toContain('/usage');

    // Open the center: both kinds show. Scope to the center menu — the same text also appears in a toast.
    await w.getByRole('button', { name: /^Notifications/ }).click();
    const center = w.getByRole('menu', { name: 'Notifications' });
    await expect(center.getByText('Sync conflicts found')).toBeVisible();
    const freshnessRow = center
      .getByRole('menuitem')
      .filter({ hasText: 'Profile updates to review' });
    await expect(freshnessRow).toBeVisible();

    // The freshness action navigates to Home and closes the center.
    await freshnessRow.getByRole('button', { name: 'View' }).click();
    await expect.poll(() => w.evaluate(() => window.location.hash)).toBe('#/');
    await expect(w.getByRole('menu', { name: 'Notifications' })).toHaveCount(0); // center closed

    // Reopen and dismiss the sync-conflict row.
    await w.getByRole('button', { name: /^Notifications/ }).click();
    await center
      .getByRole('menuitem')
      .filter({ hasText: 'Sync conflicts found' })
      .getByRole('button', { name: 'Dismiss notification' })
      .click();
    await expect(center.getByText('Sync conflicts found')).toHaveCount(0);
  } finally {
    await app.close();
  }

  // Relaunch: the dismissed conflict stays dismissed; the still-pending freshness item remains.
  app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('button', { name: /^Notifications/ }).click();
    const center = w.getByRole('menu', { name: 'Notifications' });
    await expect(center.getByText('Profile updates to review')).toBeVisible();
    await expect(center.getByText('Sync conflicts found')).toHaveCount(0);

    // ~360px: the center scrolls vertically only — never a horizontal scrollbar (CLAUDE.md §12).
    await w.setViewportSize({ width: 360, height: 780 });
    const offenders = await w.evaluate(() => {
      const bad: string[] = [];
      document.querySelectorAll('*').forEach((el) => {
        const ox = getComputedStyle(el).overflowX;
        if (el.scrollWidth - el.clientWidth > 1 && (ox === 'auto' || ox === 'scroll')) {
          bad.push(`${el.tagName}.${el.className}`);
        }
      });
      return bad;
    });
    expect(offenders).toEqual([]);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('onboarding attention (55): a completed profile with a NEW section surfaces the card, nav dot + bell; dismiss persists', async () => {
  const { userData, vault } = await seedReadyVault();
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('onboarding-attention e2e: master key missing');
  const now = new Date().toISOString();
  // Simulate: the owner finished onboarding BEFORE the 'work-money' section existed — the completion snapshot
  // omits it, so it reads as GENUINELY new (an app update added it). It's not-yet-started with unanswered
  // questions → the "new" branch (55) flags it, without nagging about any deep section already known.
  const snap = intakeCatalogSnapshot();
  await writeEncryptedJson(
    fs,
    'people/owner-1/intake/session.enc',
    {
      id: 'intake-owner-1',
      schemaVersion: 1,
      personId: 'owner-1',
      status: 'complete',
      sections: [
        { id: 'work-money', status: 'notStarted', restricted: false, messages: [], answers: {} },
      ],
      knownSectionIds: snap.sectionIds.filter((id) => id !== 'work-money'),
      knownQuestionKeys: snap.questionKeys.filter((k) => !k.startsWith('work-money.')),
      startedAt: now,
      updatedAt: now,
      completedAt: now,
    },
    key,
  );

  let app = await launch(userData);
  try {
    const w = await app.firstWindow();
    // 1) Home card.
    await expect(w.getByRole('heading', { name: /more things to tell SelfOS/i })).toBeVisible();
    await expect(w.getByRole('button', { name: /continue onboarding/i })).toBeVisible();
    // 2) Nav dot — conveyed via the aria-label so it's never color-only (§9).
    await expect(w.getByRole('link', { name: 'Onboarding, questions to answer' })).toBeVisible();
    // 3) Bell: exactly one unread onboarding notification (no update/conflict/freshness seeded).
    await expect(w.getByRole('button', { name: 'Notifications, 1 unread' })).toBeVisible();
    await w.getByRole('button', { name: /^Notifications/ }).click();
    const center = w.getByRole('menu', { name: 'Notifications' });
    await center
      .getByRole('menuitem')
      .filter({ hasText: 'More of your profile to fill in' })
      .getByRole('button', { name: 'Dismiss notification' })
      .click();
    await expect(center.getByText('More of your profile to fill in')).toHaveCount(0);

    // ~360px: the Home attention card renders with no horizontal overflow / inner scrollbar.
    await w.setViewportSize({ width: 360, height: 800 });
    const overflow = await w.evaluate(() => {
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
    expect(overflow.offenders).toEqual([]);
    expect(overflow.mainOverflow).toBeLessThanOrEqual(1);
  } finally {
    await app.close();
  }

  // Relaunch: the Home card + nav dot persist (live state), but the dismissed bell stays quiet (onIncrease,
  // device-local, per-person) until MORE appears.
  app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await expect(w.getByRole('heading', { name: /more things to tell SelfOS/i })).toBeVisible();
    await expect(w.getByRole('button', { name: /Notifications, \d+ unread/ })).toHaveCount(0);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('notifications: are per-person — a member does not see the owner’s freshness item (35)', async () => {
  const { userData, vault } = await seedReadyVault();
  await seedProfileSuggestion(vault, userData, 'owner-1', 'sugg-1');
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    // The owner sees their freshness notification.
    await expect(w.getByRole('button', { name: 'Notifications, 1 unread' })).toBeVisible();

    // Create + grant a member (Jordan), onboarded so the member gate doesn't take over (18 §3.1).
    await w.getByRole('link', { name: 'People' }).click();
    await w.getByRole('button', { name: 'Add person' }).click();
    await w.getByLabel('Name').fill('Jordan');
    await w.getByRole('button', { name: 'Create' }).click();
    await w.getByText('Jordan').click();
    await w.getByRole('button', { name: 'Access' }).click();
    await w.getByRole('button', { name: 'Grant access' }).click();
    await expect(w.getByText(/can sign in/i)).toBeVisible();
    await completeIntakeFor(vault, userData, 'Jordan');

    // Switch to Jordan (owner → member is PIN-free).
    await w.getByRole('button', { name: /signed in as/i }).click();
    await w.getByRole('menuitem', { name: 'Switch person' }).click();
    await w
      .getByRole('dialog', { name: /who.s here/i })
      .getByText('Jordan')
      .click();
    await expect(w.getByRole('button', { name: 'Signed in as Jordan' })).toBeVisible();

    // Jordan sees no notifications — the owner's freshness item is absent (per-person, device-local).
    await expect(w.getByRole('button', { name: 'Notifications, 1 unread' })).toHaveCount(0);
    await w.getByRole('button', { name: 'Notifications' }).click();
    await expect(w.getByText('You’re all caught up.')).toBeVisible();
    await expect(w.getByText('Profile updates to review')).toHaveCount(0);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('update awareness: a launch check finds a newer version → notification + working "Open" external action; dismiss persists (36)', async () => {
  const { userData, vault } = await seedReadyVault();
  // SELFOS_FAKE_UPDATE reports a far-newer version, so the launch check raises the update notification.
  let app = await electron.launch({
    args: [`--user-data-dir=${userData}`, MAIN],
    env: { ...e2eEnv(), SELFOS_FAKE_UPDATE: '9.9.9' },
  });
  try {
    const w = await app.firstWindow();
    // The update is unread → the bell badges it, and (warning severity) a sticky toast appears.
    await expect(w.getByRole('button', { name: 'Notifications, 1 unread' })).toBeVisible();
    await expect(w.getByText('SelfOS 9.9.9 is available').first()).toBeVisible();

    // Record external opens in the MAIN process (the renderer's "Open" → shell.openExternal).
    await app.evaluate(({ shell }) => {
      const recorder = globalThis as unknown as { __opened: string[] };
      recorder.__opened = [];
      shell.openExternal = (url: string): Promise<void> => {
        recorder.__opened.push(url);
        return Promise.resolve();
      };
    });

    // Open the center, find the update row, and trigger its external "Open" action.
    await w.getByRole('button', { name: /^Notifications/ }).click();
    const center = w.getByRole('menu', { name: 'Notifications' });
    const row = center.getByRole('menuitem').filter({ hasText: 'SelfOS 9.9.9 is available' });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Open' }).click();
    const opened = await app.evaluate(
      () => (globalThis as unknown as { __opened: string[] }).__opened,
    );
    expect(opened).toEqual(['https://github.com/Highfivery/SelfOS/releases/tag/v9.9.9']);

    // Dismiss it.
    await w.getByRole('button', { name: /^Notifications/ }).click();
    await center
      .getByRole('menuitem')
      .filter({ hasText: 'SelfOS 9.9.9 is available' })
      .getByRole('button', { name: 'Dismiss notification' })
      .click();
    await expect(center.getByText('SelfOS 9.9.9 is available')).toHaveCount(0);
  } finally {
    await app.close();
  }

  // Relaunch (still 9.9.9): the same version stays dismissed (app-global, device-local).
  app = await electron.launch({
    args: [`--user-data-dir=${userData}`, MAIN],
    env: { ...e2eEnv(), SELFOS_FAKE_UPDATE: '9.9.9' },
  });
  try {
    const w = await app.firstWindow();
    await w.getByRole('button', { name: 'Notifications', exact: true }).click();
    const center = w.getByRole('menu', { name: 'Notifications' });
    await expect(center.getByText('SelfOS 9.9.9 is available')).toHaveCount(0);

    // ~360px: the center scrolls vertically only — never a horizontal scrollbar (CLAUDE.md §12).
    await w.setViewportSize({ width: 360, height: 780 });
    const countOffenders = (): Promise<string[]> =>
      w.evaluate(() => {
        const bad: string[] = [];
        document.querySelectorAll('*').forEach((el) => {
          const ox = getComputedStyle(el).overflowX;
          if (el.scrollWidth - el.clientWidth > 1 && (ox === 'auto' || ox === 'scroll')) {
            bad.push(`${el.tagName}.${el.className}`);
          }
        });
        return bad;
      });
    expect(await countOffenders()).toEqual([]);

    // The Settings → About control's "available" state (Check + View release buttons) also fits at 360px.
    // Close the center, then navigate at desktop width (the nav is a hidden drawer at phone width).
    await w.keyboard.press('Escape');
    await expect(w.getByRole('menu', { name: 'Notifications' })).toHaveCount(0);
    await w.setViewportSize({ width: 1024, height: 780 });
    await w.getByRole('link', { name: 'Settings' }).click();
    await w.getByRole('button', { name: 'About', exact: true }).click();
    await expect(w.getByText(/update available: v9\.9\.9/i)).toBeVisible();
    await expect(w.getByRole('button', { name: 'View release' })).toBeVisible();
    // The two-button row wraps rather than overflowing `main` (the section nav's own pill-row scroll is
    // intentional, so check `main`/doc width, not the generic element scan — matching the settings guard,
    // which runs at 390px — the standard Settings phone width).
    await w.setViewportSize({ width: 390, height: 780 });
    const aboutFits = await w.evaluate(() => {
      const main = document.querySelector('main');
      return (
        !!main &&
        main.scrollWidth <= main.clientWidth &&
        document.documentElement.scrollWidth <= window.innerWidth
      );
    });
    expect(aboutFits).toBe(true);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('update awareness: the manual About check shows up-to-date, and a calm error when offline (36)', async () => {
  const { userData, vault } = await seedReadyVault();
  // Default env reports an OLD version → up to date.
  let app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Settings' }).click();
    await w.getByRole('button', { name: 'About', exact: true }).click();
    await w.getByRole('button', { name: 'Check for updates' }).click();
    await expect(w.getByText(/up to date/i)).toBeVisible();
    // No update notification was raised (we're current).
    await expect(w.getByRole('button', { name: /Notifications, \d+ unread/ })).toHaveCount(0);
  } finally {
    await app.close();
  }

  // Relaunch with the check forced to fail → the calm "couldn't check" state (no toast).
  app = await electron.launch({
    args: [`--user-data-dir=${userData}`, MAIN],
    env: { ...e2eEnv(), SELFOS_FAKE_UPDATE: 'error' },
  });
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Settings' }).click();
    await w.getByRole('button', { name: 'About', exact: true }).click();
    await w.getByRole('button', { name: 'Check for updates' }).click();
    await expect(w.getByText(/couldn’t check right now/i)).toBeVisible();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('proactive coaching: the Coaching setting is per-person, member-reachable, persists; no overflow (40)', async () => {
  const { userData, vault } = await seedReadyVault();
  await seedMemberWithPortrait(vault, userData, 'mara-1', 'Mara', 'a private fact');
  const app = await launch(userData);
  const label = { exact: true };
  try {
    const w = await app.firstWindow();

    // Owner → Settings → the member-visible Coaching section → defaults to gentle → choose Active.
    await w.getByRole('link', { name: 'Settings' }).click();
    await w.getByRole('button', { name: 'Coaching', exact: true }).click();
    await expect(w.getByLabel('How proactive your coach is', label)).toHaveValue('gentle');
    await w.getByLabel('How proactive your coach is', label).selectOption('active');

    // Read-after-write through the live bridge: leaving + returning re-fetches the persisted (decrypted)
    // value, so this confirms the write actually landed in the vault — no file-flush race.
    await w.getByRole('link', { name: 'Home' }).click();
    await w.getByRole('link', { name: 'Settings' }).click();
    await w.getByRole('button', { name: 'Coaching', exact: true }).click();
    await expect(w.getByLabel('How proactive your coach is', label)).toHaveValue('active');

    // No horizontal overflow at phone width while the control renders.
    await w.setViewportSize({ width: 390, height: 780 });
    const fits = await w.evaluate(() => {
      const main = document.querySelector('main');
      return (
        !!main &&
        main.scrollWidth <= main.clientWidth &&
        document.documentElement.scrollWidth <= window.innerWidth
      );
    });
    expect(fits).toBe(true);
    await w.setViewportSize({ width: 1024, height: 780 });

    // Switch to the member — they can reach Coaching (per-person) but NOT the admin-only Sessions section.
    await w.getByRole('button', { name: /signed in as/i }).click();
    await w.getByRole('menuitem', { name: 'Switch person' }).click();
    await w
      .getByRole('dialog', { name: /who.s here/i })
      .getByRole('button', { name: 'Mara' })
      .click();
    await expect(w.getByRole('button', { name: 'Signed in as Mara' })).toBeVisible();
    await w.getByRole('link', { name: 'Settings' }).click();
    await expect(w.getByRole('button', { name: 'Coaching', exact: true })).toBeVisible();
    await expect(w.getByRole('button', { name: 'Sessions', exact: true })).toHaveCount(0); // admin-only

    // The member tunes their OWN coach (default gentle, independent of the owner's 'active').
    await w.getByRole('button', { name: 'Coaching', exact: true }).click();
    await expect(w.getByLabel('How proactive your coach is', label)).toHaveValue('gentle');
    await w.getByLabel('How proactive your coach is', label).selectOption('off');
    await w.getByRole('link', { name: 'Home' }).click(); // leave + return to flush the write
    await w.getByRole('link', { name: 'Settings' }).click();
    await w.getByRole('button', { name: 'Coaching', exact: true }).click();
    await expect(w.getByLabel('How proactive your coach is', label)).toHaveValue('off');
  } finally {
    await app.close();
  }

  // Decrypt the vault: the owner kept 'active', the member chose 'off' — per-person isolation.
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  expect(await readEncryptedJson(fs, 'people/owner-1/coaching/prefs.enc', key!)).toMatchObject({
    proactivity: 'active',
  });
  expect(await readEncryptedJson(fs, 'people/mara-1/coaching/prefs.enc', key!)).toMatchObject({
    proactivity: 'off',
  });
  await rm(userData, { recursive: true, force: true });
  await rm(vault, { recursive: true, force: true });
});

test('proactive coaching: recurring distress surfaces a supportive, resources-first banner on Home (40 §3.5)', async () => {
  const { userData, vault } = await seedReadyVault();
  // Seed two recent crisis-flagged session insights for the owner (the deterministic ≥2-in-14-days signal).
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('master key missing');
  const recent = (n: number): string =>
    new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
  for (const [id, days] of [
    ['cr1', 1],
    ['cr2', 4],
  ] as const) {
    await saveInsight(fs, key, {
      id,
      schemaVersion: 1,
      source: 'session',
      subjectPersonId: 'owner-1',
      summary: 'A heavy session',
      facts: [],
      confidence: 'medium',
      categories: [],
      approved: true,
      crisisFlag: true,
      provenance: { conversationId: id, at: recent(days) },
      createdAt: recent(days),
      updatedAt: recent(days),
    });
  }
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    // Home is the default route — the supportive banner leads with real resources, never a metric/alarm.
    await expect(w.getByText(/carrying a lot/i)).toBeVisible();
    await expect(w.getByText('988')).toBeVisible();
    // It is NOT a dismissible notification (no bell item, no dismiss control on the banner).
    await expect(w.getByRole('button', { name: /dismiss/i })).toHaveCount(0);
    // The always-present crisis footer is also there.
    await expect(w.getByRole('button', { name: /get help now/i })).toBeVisible();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('proactive coaching: the synthesis card shows the cached observation and seeds a session (40 §3.3)', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('master key missing');
  const at = new Date().toISOString();
  // Two approved insights so the card isn't self-hidden, but below gentle's auto threshold (3) so the
  // launch cadence stays a no-op — the pre-seeded cached observation is what we assert.
  for (const id of ['s1', 's2']) {
    await saveInsight(fs, key, {
      id,
      schemaVersion: 1,
      source: 'session',
      subjectPersonId: 'owner-1',
      summary: `reflected on ${id}`,
      facts: [{ id: `${id}f`, text: `a fact ${id}`, shareable: false }],
      confidence: 'medium',
      categories: ['Relationships'],
      approved: true,
      provenance: { conversationId: id, at },
      createdAt: at,
      updatedAt: at,
    });
  }
  const observation =
    'Connection keeps surfacing across your recent dreams and last week’s session.';
  await writeEncryptedJson(
    fs,
    'people/owner-1/coaching/synthesis.enc',
    {
      schemaVersion: 1,
      subjectPersonId: 'owner-1',
      observation,
      sources: ['sessions', 'dreams'],
      lifeArea: 'Relationships',
      computedAt: at,
    },
    key,
  );
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    // Home surfaces the cross-feature observation as a gentle, non-clinical nudge.
    await expect(w.getByRole('heading', { name: /something i.m noticing/i })).toBeVisible();
    // Scope to the card (main) — the observation also appears in the coaching-synthesis toast (role=status).
    await expect(w.getByRole('main').getByText(/connection keeps surfacing/i)).toBeVisible();
    // Polish guard (§9): the proactive cards reflow with no horizontal overflow at phone width.
    await w.setViewportSize({ width: 360, height: 780 });
    const offenders = await w.evaluate(() => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll('main *'))) {
        if (el.scrollWidth > el.clientWidth + 1) {
          const cs = getComputedStyle(el);
          out.push(
            `${el.tagName}.${el.className} sw=${el.scrollWidth} cw=${el.clientWidth} ox=${cs.overflowX}`,
          );
        }
      }
      return out;
    });
    expect(offenders).toEqual([]);
    await w.setViewportSize({ width: 1024, height: 780 });
    // "Talk it through" seeds a session prefilled with the observation (the §3.3 seed-handoff).
    await w.getByRole('button', { name: /talk it through/i }).click();
    await expect(w.getByLabel('Message')).toHaveValue(observation);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('proactive coaching: a stale goal surfaces a nudge + Home card; Mark done closes it (40 §3.2)', async () => {
  const { userData, vault } = await seedReadyVault();
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('master key missing');
  const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(); // 40 days → stale (>21)
  await saveGoal(fs, key, {
    id: 'g1',
    schemaVersion: 1,
    subjectPersonId: 'owner-1',
    text: 'finish the side project',
    status: 'open',
    provenance: { conversationId: 'c0', at: old },
    createdAt: old,
    updatedAt: old,
    lastTouchedAt: old,
  });
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    // The Home "For you" goal recommendation surfaces the stale goal with the calm actions (scoped to main,
    // not the notification body / toast that also names the goal).
    await expect(w.getByRole('heading', { name: /a goal worth a check-in/i })).toBeVisible();
    await expect(w.getByRole('main').getByText(/finish the side project/i)).toBeVisible();
    // The 3-action row wraps rather than overflowing at phone width (§9).
    await w.setViewportSize({ width: 360, height: 780 });
    const offenders = await w.evaluate(() => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll('main *'))) {
        if (el.scrollWidth > el.clientWidth + 1) {
          out.push(`${el.tagName}.${el.className} sw=${el.scrollWidth} cw=${el.clientWidth}`);
        }
      }
      return out;
    });
    expect(offenders).toEqual([]);
    await w.setViewportSize({ width: 1024, height: 780 });
    // …and the same signal is a (non-spammy) notification.
    await expect(w.getByRole('button', { name: /Notifications, \d+ unread/ })).toBeVisible();
    await w.getByRole('button', { name: /^Notifications/ }).click();
    await expect(
      w.getByRole('menu', { name: 'Notifications' }).getByText(/a goal worth a check-in/i),
    ).toBeVisible();
    await w.keyboard.press('Escape');

    // Mark done closes the goal → the card drops away (acting un-stales/closes it).
    await w.getByRole('button', { name: 'Mark done' }).click();
    await expect(w.getByRole('heading', { name: /a goal worth a check-in/i })).toHaveCount(0);
  } finally {
    await app.close();
  }

  // Decrypt: the goal is now done (the nudge can never return for it).
  const goal = await getGoal(fs, key, 'owner-1', 'g1');
  expect(goal?.status).toBe('done');
  await rm(userData, { recursive: true, force: true });
  await rm(vault, { recursive: true, force: true });
});

/** Seed two approved session insights (distinct life-areas → momentum "explored 2 areas" + a Memory card). */
async function seedTwoAreas(
  fs: ReturnType<typeof createNodeFileSystem>,
  key: Uint8Array,
): Promise<void> {
  const at = new Date().toISOString();
  const areas = ['Relationships', 'Work & purpose'];
  for (let i = 0; i < 2; i += 1) {
    await saveInsight(fs, key, {
      id: `area-${i}`,
      schemaVersion: 1,
      source: 'session',
      subjectPersonId: 'owner-1',
      summary: `reflected (${i})`,
      facts: [],
      metrics: { moodValence: i === 0 ? -0.2 : 0.3, moodEnergy: 0.1 },
      confidence: 'medium',
      categories: [areas[i] as string],
      approved: true,
      provenance: { conversationId: `area-${i}`, at },
      createdAt: at,
      updatedAt: at,
    });
  }
}

test('home (53): the "For you" zone ranks recommendations, reflects momentum, dismisses, and sits above the status grid; 360px clean', async () => {
  const { userData, vault } = await seedReadyVault();
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('master key missing');
  const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(); // stale (>21 days)
  await saveGoal(fs, key, {
    id: 'g1',
    schemaVersion: 1,
    subjectPersonId: 'owner-1',
    text: 'finish the memoir',
    status: 'open',
    provenance: { conversationId: 'c0', at: old },
    createdAt: old,
    updatedAt: old,
    lastTouchedAt: old,
  });
  await seedTwoAreas(fs, key);
  // A profile self-assessment already taken, so the `take-a-test` invite is satisfied and this test stays
  // focused on the goal + guided ranking (53 Slice B adds take-a-test, covered by its own test).
  await writeEncryptedJson(
    fs,
    'people/owner-1/tests/r-bigfive.enc',
    {
      id: 'r-bigfive',
      schemaVersion: 1,
      testId: 'bigfive-ipip-120',
      testVersion: 1,
      subjectPersonId: 'owner-1',
      answers: [],
      scores: [],
      takenAt: old,
      createdAt: old,
      updatedAt: old,
    },
    key,
  );

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();

    // The focal "For you" zone (a labelled region) ranks the relevant next steps for this person.
    const forYou = w.getByRole('region', { name: 'For you' });
    await expect(forYou).toBeVisible();
    await expect(forYou.getByRole('heading', { name: /a goal worth a check-in/i })).toBeVisible();
    await expect(forYou.getByRole('heading', { name: /try a guided session/i })).toBeVisible();
    // Each recommendation carries a person-specific REASON (not just a generic CTA).
    await expect(forYou.getByText(/finish the memoir/i)).toBeVisible();

    // Gentle momentum reflection in the header — what positively happened, never a streak/target.
    await expect(w.getByText(/you’ve explored 2 areas of yourself/i)).toBeVisible();

    // The status overview grid (where you ARE) sits below the actionable zone, distinct from it.
    await expect(w.getByRole('heading', { name: 'Wellbeing' })).toBeVisible();
    await expect(w.getByRole('heading', { name: /what the coach knows/i })).toBeVisible();

    // Dismiss ("Not now") suppresses a recommendation calmly; the guided one stays.
    await forYou.getByRole('button', { name: /a goal worth a check-in.*for now/i }).click();
    await expect(forYou.getByRole('heading', { name: /a goal worth a check-in/i })).toHaveCount(0);
    await expect(forYou.getByRole('heading', { name: /try a guided session/i })).toBeVisible();

    // 360px: the full surface renders with NO horizontal overflow — not page-level, not an inner scrollbar.
    await w.setViewportSize({ width: 360, height: 800 });
    const overflow = await w.evaluate(() => {
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
    expect(overflow.offenders).toEqual([]);
    expect(overflow.mainOverflow).toBeLessThanOrEqual(1);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('home (53): proactivity OFF hides the "For you" zone + momentum, but the status grid stays', async () => {
  const { userData, vault } = await seedReadyVault();
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('master key missing');
  // Per-person calm Home: proactivity off ⇒ no pushes.
  await writeEncryptedJson(
    fs,
    'people/owner-1/coaching/prefs.enc',
    { schemaVersion: 1, proactivity: 'off' },
    key,
  );
  const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  await saveGoal(fs, key, {
    id: 'g1',
    schemaVersion: 1,
    subjectPersonId: 'owner-1',
    text: 'finish the memoir',
    status: 'open',
    provenance: { conversationId: 'c0', at: old },
    createdAt: old,
    updatedAt: old,
    lastTouchedAt: old,
  });
  await seedTwoAreas(fs, key);

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    // Wait for the page to settle on a real card, then assert the encouragement zone is absent.
    await expect(w.getByRole('heading', { name: 'Wellbeing' })).toBeVisible(); // a status card (not a push)
    await expect(w.getByRole('region', { name: 'For you' })).toHaveCount(0);
    await expect(w.getByText(/you’ve explored/i)).toHaveCount(0); // no momentum push
    await expect(w.getByRole('heading', { name: /a goal worth a check-in/i })).toHaveCount(0);
    // The status grid is unaffected — it reflects existing data, it isn't a nudge.
    await expect(w.getByRole('heading', { name: /what the coach knows/i })).toBeVisible();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('home (53 Slice B): self-assessment / wellbeing / intimacy recommendations surface (50/51/48); the 18+ one only after the ack', async () => {
  const { userData, vault } = await seedReadyVault();
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('master key missing');

  // `active` proactivity → the cap fits all three Slice-B recommendations alongside the others.
  await writeEncryptedJson(
    fs,
    'people/owner-1/coaching/prefs.enc',
    { schemaVersion: 1, proactivity: 'active' },
    key,
  );
  // Not a brand-new person (so the "For you" zone is shown, not getting-started).
  await seedTwoAreas(fs, key);

  // A mood check-in that has gone quiet (>14 days) → the gentle wellbeing-checkin invite (51).
  const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  await writeEncryptedJson(
    fs,
    'people/owner-1/tests/r-phq9.enc',
    {
      id: 'r-phq9',
      schemaVersion: 1,
      testId: 'phq9',
      testVersion: 1,
      subjectPersonId: 'owner-1',
      answers: [],
      scores: [],
      takenAt: old,
      createdAt: old,
      updatedAt: old,
    },
    key,
  );
  // An intimacy-group self-assessment taken → the intimacy-exercise engagement signal (48) — but it is
  // adult-gated, so it must NOT surface until the per-person 18+ ack exists.
  await writeEncryptedJson(
    fs,
    'people/owner-1/tests/r-kink.enc',
    {
      id: 'r-kink',
      schemaVersion: 1,
      testId: 'kink-interests',
      testVersion: 1,
      subjectPersonId: 'owner-1',
      answers: [],
      scores: [],
      takenAt: old,
      createdAt: old,
      updatedAt: old,
    },
    key,
  );

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    const forYou = w.getByRole('region', { name: 'For you' });
    await expect(forYou).toBeVisible();

    // take-a-test fires (no personality/relationships profile taken) + wellbeing-checkin fires (overdue).
    await expect(
      forYou.getByRole('heading', { name: /discover how you see yourself/i }),
    ).toBeVisible();
    await expect(forYou.getByRole('heading', { name: /a gentle check-in/i })).toBeVisible();

    // The intimacy exercise is 18+-gated → withheld even though the intimacy profile exists (no premature
    // exposure; the gate is the boundary, 48 §8). Without the ack, an intimacy test is also not in the
    // adult-filtered catalog, so the candidate never forms.
    await expect(
      forYou.getByRole('heading', { name: /build on your intimacy profile/i }),
    ).toHaveCount(0);

    // The take-a-test primary action routes into the You hub.
    await forYou.getByRole('button', { name: /take a quick assessment/i }).click();
    await expect(w.getByRole('heading', { name: /you — how you see yourself/i })).toBeVisible();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('home (53 Slice B): the intimacy exercise surfaces once the 18+ ack is given (48)', async () => {
  const { userData, vault } = await seedReadyVault();
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('master key missing');

  await writeEncryptedJson(
    fs,
    'people/owner-1/coaching/prefs.enc',
    { schemaVersion: 1, proactivity: 'active' },
    key,
  );
  // The shared per-person 18+ ack (16 §8.3 / 48) — without it the intimacy test is withheld + filtered.
  await writeEncryptedJson(
    fs,
    'people/owner-1/guidance/prefs.enc',
    { schemaVersion: 1, adultAcknowledged: true },
    key,
  );
  await seedTwoAreas(fs, key);
  const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  await writeEncryptedJson(
    fs,
    'people/owner-1/tests/r-kink.enc',
    {
      id: 'r-kink',
      schemaVersion: 1,
      testId: 'kink-interests',
      testVersion: 1,
      subjectPersonId: 'owner-1',
      answers: [],
      scores: [],
      takenAt: old,
      createdAt: old,
      updatedAt: old,
    },
    key,
  );

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    const forYou = w.getByRole('region', { name: 'For you' });
    await expect(forYou).toBeVisible();
    // Now acked + an intimacy profile taken → the gentle, invitation-only exercise card appears.
    await expect(
      forYou.getByRole('heading', { name: /build on your intimacy profile/i }),
    ).toBeVisible();

    // 360px: the full surface renders with no horizontal overflow / inner scrollbar.
    await w.setViewportSize({ width: 360, height: 800 });
    const overflow = await w.evaluate(() => {
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
    expect(overflow.offenders).toEqual([]);
    expect(overflow.mainOverflow).toBeLessThanOrEqual(1);
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

test('route guards: a non-owner cannot reach an owner-only route by switching person or a typed hash', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();

    // Create + grant a member login (Jordan), onboarded so the Member gate doesn't take over (18 §3.1).
    await w.getByRole('link', { name: 'People' }).click();
    await w.getByRole('button', { name: 'Add person' }).click();
    await w.getByLabel('Name').fill('Jordan');
    await w.getByRole('button', { name: 'Create' }).click();
    await w.getByText('Jordan').click();
    await w.getByRole('button', { name: 'Access' }).click();
    await w.getByRole('button', { name: 'Grant access' }).click();
    await expect(w.getByText(/can sign in/i)).toBeVisible();
    await completeIntakeFor(vault, userData, 'Jordan');

    // The Owner is sitting on the owner-only Roles screen.
    await w.getByRole('link', { name: 'Roles' }).click();
    await expect(w.getByRole('heading', { name: 'Roles', level: 2 })).toBeVisible();
    await expect.poll(() => w.evaluate(() => window.location.hash)).toBe('#/roles');

    // Switch to Jordan (a Member) WHILE on /roles → silently redirected to Home; the route is unrendered.
    await w.getByRole('button', { name: /signed in as/i }).click();
    await w.getByRole('menuitem', { name: 'Switch person' }).click();
    const dialog = w.getByRole('dialog', { name: /who.s here/i });
    await expect(dialog).toBeVisible();
    await dialog.getByText('Jordan').click();

    await expect(w.getByRole('button', { name: 'Signed in as Jordan' })).toBeVisible();
    await expect.poll(() => w.evaluate(() => window.location.hash)).toBe('#/');
    await expect(w.getByRole('heading', { name: 'Roles', level: 2 })).toHaveCount(0);
    // The nav-link gating still holds too (defense in depth).
    await expect(w.getByRole('link', { name: 'Roles' })).toHaveCount(0);

    // A typed hash to another owner-only route (#/people) is also bounced to Home.
    await w.evaluate(() => {
      window.location.hash = '#/people';
    });
    await expect.poll(() => w.evaluate(() => window.location.hash)).toBe('#/');
    await expect(w.getByRole('heading', { name: 'People', level: 2 })).toHaveCount(0);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('route guards: the Owner still reaches owner-only routes (positive case)', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();

    await w.getByRole('link', { name: 'Roles' }).click();
    await expect(w.getByRole('heading', { name: 'Roles', level: 2 })).toBeVisible();

    // A typed hash resolves for a capable person (the guard is transparent when allowed).
    await w.evaluate(() => {
      window.location.hash = '#/people';
    });
    await expect.poll(() => w.evaluate(() => window.location.hash)).toBe('#/people');
    await expect(w.getByRole('heading', { name: 'People', level: 2 })).toBeVisible();

    // An unknown hash (a typo, or an unreachable route) lands on Home, not a blank content area.
    await w.evaluate(() => {
      window.location.hash = '#/does-not-exist';
    });
    await expect.poll(() => w.evaluate(() => window.location.hash)).toBe('#/');
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

    // The composer clears the INSTANT you hit send (05 §3) — the message lives in the thread, not lingering
    // in a disabled field while the coach replies.
    await expect(w.getByLabel('Message')).toHaveValue('');

    // `.first()` tolerates the brief stream→persist handoff where the streaming bubble and the saved
    // message both match.
    await expect(w.getByText(/hear you/i).first()).toBeVisible(); // offline fake reply
    // The reply renders as Markdown (34): the fake's list + bold become real <li>/<strong>, no raw `**`.
    await expect(w.locator('main li', { hasText: 'Name' }).first()).toBeVisible();
    await expect(w.locator('main strong', { hasText: 'one' }).first()).toBeVisible();
    await expect(w.getByText('**one**')).toHaveCount(0);
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

    // The free-form turn ran the topic classifier (28 §13.2) — a metered `session.topic` event is recorded
    // alongside the chat event in the real built app (the offline fake returns no areas, so it's a no-narrow
    // classification, but the seam — classify + meter, fail-open — runs end to end).
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('sessions e2e: master key missing');
    await expect
      .poll(
        async () =>
          (
            await queryUsage(fs, key, {
              from: '2026-01-01',
              to: '2027-01-01',
              personId: 'owner-1',
              type: 'session.topic',
            })
          ).length,
      )
      .toBeGreaterThanOrEqual(1);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('sessions (05 §4.1): an empty reply surfaces an error + a working "Try again", never silent', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  // SELFOS_FAKE_CHAT_EMPTY makes the FIRST chat reply come back empty (as adaptive-thinking starvation would);
  // the retry then gets a normal reply.
  const app = await electron.launch({
    args: [`--user-data-dir=${userData}`, MAIN],
    env: { ...e2eEnv(), SELFOS_FAKE_CHAT_EMPTY: '1' },
  });
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Sessions' }).click();
    await w.getByLabel('Message').fill('A long, hard message about my week');
    await w.getByRole('button', { name: 'Send' }).click();

    // NOT silent: the empty reply becomes an honest error, the user's message stays on screen, Try again shows.
    await expect(w.getByText(/came back empty/i)).toBeVisible();
    await expect(w.getByText('A long, hard message about my week').first()).toBeVisible();
    const retry = w.getByRole('button', { name: 'Try again' });
    await expect(retry).toBeVisible();

    // Retry re-runs the SAME turn (no re-typing) → the coach replies → the error clears.
    await retry.click();
    await expect(w.getByText(/hear you/i).first()).toBeVisible();
    await expect(w.getByText(/came back empty/i)).toHaveCount(0);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('sessions (05 §4.1): re-opening a session that ended on the user’s message offers a working "Try again"', async () => {
  // The reported case: a prior turn never got a reply, so the transcript ends on the user's message. Re-opening
  // it must not be a dead end — a gentle prompt + a Try again that gets a reply (no duplicate of the message).
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('reopen-retry e2e: master key missing');
  const now = new Date().toISOString();
  await saveConversation(fs, key, {
    id: 'stuck-1',
    schemaVersion: 1,
    personId: 'owner-1',
    title: 'Feeling distant',
    status: 'inProgress',
    messages: [{ role: 'user', content: 'I have been feeling distant lately', ts: now }],
    createdAt: now,
    updatedAt: now,
  });

  const app = await electron.launch({ args: [`--user-data-dir=${userData}`, MAIN], env: e2eEnv() });
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Sessions' }).click();
    await w.getByRole('button', { name: 'Feeling distant', exact: true }).click();

    // The un-answered message is visible + a gentle "not answered yet" prompt + Try again (no live error needed).
    await expect(w.getByText('I have been feeling distant lately').first()).toBeVisible();
    await expect(w.getByText(/hasn’t been answered yet/i)).toBeVisible();
    await w.getByRole('button', { name: 'Try again' }).click();

    // The coach replies to the existing transcript; the prompt clears.
    await expect(w.getByText(/hear you/i).first()).toBeVisible();
    await expect(w.getByText(/hasn’t been answered yet/i)).toHaveCount(0);

    // Decrypt: the user's message wasn't duplicated — exactly [user, assistant].
    const convo = (await listConversations(fs, key, 'owner-1')).find((c) => c.id === 'stuck-1');
    expect(convo?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('sessions (05 §4.1): a LEGACY session that dead-ended on a blank assistant reply still recovers', async () => {
  // The user's actual case: a session created BEFORE the fail-safe shipped. The old code persisted an empty
  // `{ role: 'assistant', content: '' }` bubble on an empty reply, so the transcript ends on that ghost, not
  // the user's message — and the first fix (retry only when last === 'user') did nothing for it.
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('legacy-ghost e2e: master key missing');
  const now = new Date().toISOString();
  await saveConversation(fs, key, {
    id: 'ghost-1',
    schemaVersion: 1,
    personId: 'owner-1',
    title: 'Ghosted before the fix',
    status: 'inProgress',
    messages: [
      { role: 'user', content: 'Everything has felt off lately', ts: now },
      { role: 'assistant', content: '', ts: now }, // the pre-fix blank-reply ghost
    ],
    createdAt: now,
    updatedAt: now,
  });

  const app = await electron.launch({ args: [`--user-data-dir=${userData}`, MAIN], env: e2eEnv() });
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Sessions' }).click();
    await w.getByRole('button', { name: 'Ghosted before the fix', exact: true }).click();

    // The user's message shows, the ghost is treated as "no reply yet" → a gentle prompt + a working retry.
    await expect(w.getByText('Everything has felt off lately').first()).toBeVisible();
    await expect(w.getByText(/hasn’t been answered yet/i)).toBeVisible();
    await w.getByRole('button', { name: 'Try again' }).click();
    await expect(w.getByText(/hear you/i).first()).toBeVisible();
    await expect(w.getByText(/hasn’t been answered yet/i)).toHaveCount(0);

    // Decrypt: the blank ghost was stripped; the transcript is a clean [user, assistant] pair, not duplicated.
    const convo = (await listConversations(fs, key, 'owner-1')).find((c) => c.id === 'ghost-1');
    expect(convo?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(convo?.messages[1]?.content.trim()).not.toBe('');
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('sessions: attach an image → encrypted on disk → thumbnail + lightbox + export → delete purges (45)', async () => {
  const saveDir = await mkdtemp(join(tmpdir(), 'selfos-save-'));
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  const app = await electron.launch({
    args: [`--user-data-dir=${userData}`, MAIN],
    env: { ...e2eEnv(), SELFOS_FAKE_SAVE_DIR: saveDir },
  });
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Sessions' }).click();

    // Attach a real PNG through the composer's hidden file input → a pending thumbnail.
    await w.locator('input[type="file"]').setInputFiles({
      name: 'screenshot.png',
      mimeType: 'image/png',
      buffer: makePng(),
    });
    await expect(w.getByRole('img', { name: 'Attached image 1' })).toBeVisible();

    await w.getByLabel('Message').fill('what do you make of this?');
    await w.getByRole('button', { name: 'Send' }).click();
    await expect(w.getByText(/hear you/i).first()).toBeVisible(); // offline fake reply

    // The user bubble shows the attachment as an interactive thumbnail.
    const thumb = w.getByRole('button', { name: 'Attached image' }).first();
    await expect(thumb).toBeVisible();

    // On disk: the attachment is an AES-GCM envelope (not the raw PNG), and it decrypts back to PNG bytes.
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('attachments e2e: master key missing');
    const convos = await listConversations(fs, key, 'owner-1');
    const conv = convos[0];
    const ref = conv?.messages.find((m) => m.role === 'user')?.attachments?.[0];
    if (!conv || !ref) throw new Error('attachments e2e: stored attachment ref missing');
    const onDisk = await fs.read(ref.path);
    expect(new TextDecoder().decode(onDisk!)).toContain('aes-256-gcm');
    const decrypted = await getConversationAttachment(fs, key, ref.path);
    expect(decrypted?.slice(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47])); // PNG magic

    // Lightbox opens; "Save image" exports a file OUTSIDE the vault; Esc closes.
    await thumb.click();
    await expect(w.getByRole('dialog')).toBeVisible();
    await w.getByRole('button', { name: 'Save image' }).click();
    await expect.poll(async () => (await readdir(saveDir)).length).toBeGreaterThanOrEqual(1);
    await w.keyboard.press('Escape');
    await expect(w.getByRole('dialog')).toHaveCount(0);

    // Delete the conversation → the sibling attachments folder is purged (no orphaned media).
    await w
      .getByRole('complementary', { name: 'Conversations' })
      .getByRole('button', { name: /Session options for/ })
      .first()
      .click();
    await w.getByRole('menuitem', { name: 'Delete' }).click();
    await expect
      .poll(async () => fs.list(conversationAttachmentsDir('owner-1', conv.id)))
      .toEqual([]);

    // Mobile-width: no horizontal overflow on the composer + thumbnail grid.
    await w.setViewportSize({ width: 390, height: 800 });
    const overflow = await w.evaluate(() => {
      const main = document.querySelector('main');
      return main ? main.scrollWidth - main.clientWidth : 0;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
    await rm(saveDir, { recursive: true, force: true });
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

test('sessions (09 §14.2): "Wrap up & reflect" below the composer ends + summarizes on demand', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Sessions' }).click();
    await w.getByLabel('Message').fill('Thanks, this really helped');
    await w.getByRole('button', { name: 'Send' }).click();
    await expect(w.getByLabel('Message')).toHaveValue(''); // field clears on send
    await expect(w.getByText(/hear you/i).first()).toBeVisible();

    // The manual wrap-up button sits below the composer for an in-progress session — end + analyze on demand.
    await w.getByRole('button', { name: 'Wrap up & reflect' }).click();
    await expect(w.getByRole('heading', { name: 'Session summary' })).toBeVisible();
    await expect(w.getByRole('button', { name: /View in Memory/i })).toBeVisible();
    // Once complete, the wrap-up button is gone (no duplicate control lingering).
    await expect(w.getByRole('button', { name: 'Wrap up & reflect' })).toHaveCount(0);

    // The session is completed + its Insight feeds the subject's own assembled context.
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('wrap-up e2e: master key missing');
    const insights = await listInsightsForPerson(fs, key, 'owner-1');
    expect(insights.some((i) => i.source === 'session')).toBe(true);
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
    // The redesigned card groups facts into labelled sections; the goal renders under Goals, prefix stripped.
    await expect(w.getByText('Goals & commitments')).toBeVisible();
    await expect(w.getByText('Take a short walk before bed')).toBeVisible();
    await expect(w.getByRole('button', { name: /View in Memory/i })).toBeVisible();

    // The wrap-up card lives INSIDE the scrollable thread, so the pinned crisis footer never overlaps it: the
    // thread's bottom edge sits at/above the "Get help now" footer (the reported overlay bug).
    const threadBox = await w.getByTestId('session-thread').boundingBox();
    const crisisBox = await w.getByRole('button', { name: /get help now/i }).boundingBox();
    if (!threadBox || !crisisBox) throw new Error('overlay guard: missing boxes');
    expect(threadBox.y + threadBox.height).toBeLessThanOrEqual(crisisBox.y + 2);

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

test('guided sessions: the Family group is browsable and the search filters across groups (expansion)', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Sessions' }).click();

    // The new Family & relationships group + its cards browse alongside the existing groups.
    await expect(w.getByText('Family & relationships')).toBeVisible();
    await expect(w.getByText('Your Family Role')).toBeVisible();
    await expect(w.getByText('Sibling Dynamics')).toBeVisible();

    // Search filters across every group; non-matching groups disappear.
    await w.getByLabel('Search guided sessions').fill('boundaries');
    await expect(w.getByText('Boundaries with Family')).toBeVisible();
    await expect(w.getByText('Your Family Role')).toHaveCount(0); // filtered out
    await expect(w.getByText('Building a Habit')).toHaveCount(0); // a coaching entry, filtered out

    // A no-match query shows the calm empty state; clearing it restores the catalog.
    await w.getByLabel('Search guided sessions').fill('zzznotathing');
    await expect(w.getByText(/No sessions match/)).toBeVisible();
    await w.getByLabel('Search guided sessions').fill('');
    await expect(w.getByText('Your Family Role')).toBeVisible();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('challenges (52): co-create a challenge → propose-then-agree captures a tracked Challenge → check-in feeds memory; decline path; 360px clean', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('challenge e2e: master key missing');

    await w.getByRole('link', { name: 'Sessions' }).click();
    // The launcher offers "Take on a challenge" with a light domain chooser (§3.1).
    await expect(w.getByRole('heading', { name: 'Take on a challenge' })).toBeVisible();
    await w.getByRole('button', { name: 'Surprise me' }).click();
    // The static opener seeds offline (no model call, §3.1).
    await expect(w.getByText(/small challenge to try|stretch your comfort zone/i)).toBeVisible();

    // Turn 1 — ask for one: the coach PROPOSES but, with no agreement, captures NOTHING (the decline-shaped
    // common path, §7). Decrypt to prove no Challenge yet.
    await w.getByLabel('Message').fill('give me a challenge');
    await w.getByRole('button', { name: 'Send' }).click();
    await expect(w.getByText(/want to go for it/i)).toBeVisible();
    expect(await listChallenges(fs, key, 'owner-1')).toHaveLength(0);

    // Turn 2 — agree: the coach confirms + emits a private marker → "Challenge set ✓" (the marker never shows).
    await w.getByLabel('Message').fill("yes let's do it");
    await w.getByRole('button', { name: 'Send' }).click();
    await expect(w.getByText(/Challenge set/i)).toBeVisible();
    await expect(w.getByText(/SELFOS:CHALLENGE/)).toHaveCount(0);

    // Decrypt the vault: a real active Challenge exists, back-linked to its conversation.
    await expect
      .poll(async () => (await listChallenges(fs, key, 'owner-1')).length)
      .toBeGreaterThan(0);
    const captured = (await listChallenges(fs, key, 'owner-1'))[0]!;
    expect(captured.status).toBe('active');
    expect(captured.action).toContain('stranger');
    expect(captured.conversationId).toBeTruthy();

    // It appears tracked on the launcher; check in "I did it".
    await w.getByRole('button', { name: 'New session' }).click();
    await expect(w.getByText(captured.action)).toBeVisible();
    await w.getByRole('button', { name: 'I did it' }).click();

    // The card closes into "Past challenges" (proves the IPC write + store reload landed) → decrypt the outcome.
    await expect(w.getByText('Past challenges (1)')).toBeVisible();
    const done = (await listChallenges(fs, key, 'owner-1'))[0]!;
    expect(done.status).toBe('done');
    expect(done.outcome).toBe('did');
    expect(done.insightId).toBeTruthy();
    // The reflection Insight feeds the person's OWN later context (provenance.challengeId, §5.4).
    const reflection = (await listInsightsForPerson(fs, key, 'owner-1')).find(
      (i) => i.provenance.challengeId === captured.id,
    );
    expect(reflection?.source).toBe('session');
    expect(await buildContext(fs, key, 'owner-1')).toContain('stranger');

    // No horizontal overflow / inner scrollbar at phone width on the challenge surfaces (§9/§12).
    await w.setViewportSize({ width: 360, height: 780 });
    const layout = await w.evaluate(() => {
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
    expect(layout.offenders).toEqual([]);
    expect(layout.mainOverflow).toBeLessThanOrEqual(1);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('intimacy guided sessions (48): a new explicit card runs + summarizes; 18+ gated; phone-width', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Sessions' }).click();

    // The expanded Intimacy group is gated behind the one-time 18+ ack (§8.3): the NEW cards are hidden too.
    await w.getByText('Intimacy & connection').click();
    await expect(w.getByRole('button', { name: /Start Kink & Power Exchange/ })).toHaveCount(0);
    await w.getByRole('button', { name: /18 or older/i }).click();
    // After the ack, a new explicit card and the structured builder card both reveal (§3.5).
    await expect(
      w.getByRole('button', { name: /Start Kink & Power Exchange/ }).first(),
    ).toBeVisible();
    await expect(
      w.getByRole('button', { name: /Start Yes \/ No \/ Maybe List/ }).first(),
    ).toBeVisible();

    // No horizontal overflow / inner scrollbar at phone width with the expanded Intimacy group revealed.
    await w.setViewportSize({ width: 390, height: 780 });
    const overflow = await w.evaluate(() => {
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
    expect(overflow.offenders).toEqual([]);
    expect(overflow.mainOverflow).toBeLessThanOrEqual(1);
    await w.setViewportSize({ width: 1100, height: 800 });

    // Start a new explicit chat exercise → its static opener renders (no model call), then a steered reply.
    await w
      .getByRole('button', { name: /Start Kink & Power Exchange/ })
      .first()
      .click();
    await expect(w.getByText(/explore kink and power exchange/i)).toBeVisible();
    await w.getByLabel('Message').fill('I want to understand D/s and how to negotiate a scene.');
    await w.getByRole('button', { name: 'Send' }).click();
    await expect(w.getByText(/hear you/i).first()).toBeVisible();

    // Complete & summarize → the Insight notes THIS exercise (content-correctness: provenance.guideId).
    await w
      .getByRole('complementary', { name: 'Conversations' })
      .getByRole('button', { name: /Session options for/ })
      .first()
      .click();
    await w.getByRole('menuitem', { name: 'Complete & summarize' }).click();
    await expect(w.getByRole('heading', { name: 'Session summary' })).toBeVisible();

    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('intimacy e2e: master key missing');
    const insights = await listInsightsForPerson(fs, key, 'owner-1');
    const session = insights.find((i) => i.source === 'session');
    expect(session?.provenance.guideId).toBe('kink-power-exchange');
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('intimacy guided sessions (48): the Yes/No/Maybe builder advances steps without showing the marker', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Sessions' }).click();
    await w.getByText('Intimacy & connection').click();
    await w.getByRole('button', { name: /18 or older/i }).click();

    // The structured Yes/No/Maybe builder (§5.2): opener + stepper, then a turn advances the stepper via a
    // [[SELFOS:STEP:n]] marker that is NEVER shown to the person (real marker stripping).
    await w
      .getByRole('button', { name: /Start Yes \/ No \/ Maybe List/ })
      .first()
      .click();
    await expect(w.getByText(/build a Yes \/ No \/ Maybe list/i)).toBeVisible();
    // The stepper shows its named steps; "Set up" is the first, and "Sensual & touch" isn't current yet.
    await expect(w.getByText('Set up', { exact: true })).toBeVisible();
    expect(
      await w.locator('li', { hasText: 'Sensual & touch' }).getAttribute('aria-current'),
    ).toBeNull();

    await w.getByLabel('Message').fill('Ready — start the first category.');
    await w.getByRole('button', { name: 'Send' }).click();
    // The fake coach's steered reply renders; the step marker is stripped from the visible text.
    // `.first()` tolerates the brief stream→persist handoff where the streaming bubble + the saved message
    // both match (the same guard the other streaming assertions use).
    await expect(w.getByText(/start with sensual and touch/i).first()).toBeVisible();
    await expect(w.getByText(/SELFOS:STEP/)).toHaveCount(0);
    // The stepper advanced to the first category (step 1).
    await expect(w.locator('li', { hasText: 'Sensual & touch' })).toHaveAttribute(
      'aria-current',
      'step',
    );
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

/**
 * The builder is a focused full-width panel — the master list (and its New/Suggested header) hides while a
 * questionnaire is open. Click the "← Questionnaires" back link to return to the list (to reopen a saved
 * one, see the row, or reach Suggested/New).
 */
async function backToQuestionnaires(w: Page): Promise<void> {
  await w.getByRole('button', { name: 'Questionnaires' }).click();
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

    // Back to the list (the builder is a focused panel) — the new questionnaire shows with its count.
    await backToQuestionnaires(w);
    await expect(w.getByRole('button', { name: /^Weekly check-in/ })).toBeVisible();
    await expect(w.getByText('1 question')).toBeVisible();

    // Reopen and confirm the title + options round-tripped through the encrypted vault.
    await w.getByRole('button', { name: /^Weekly check-in/ }).click();
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
    await backToQuestionnaires(w);
    await expect(w.getByText('2 questions')).toBeVisible();

    // Reopen and confirm everything round-tripped through the encrypted vault.
    await w.getByRole('button', { name: /^Date-night check-in/ }).click();
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

    // Save → reopen: the intimacy type + escalated tier round-trip through the encrypted vault. The
    // builder is a focused full-width panel (the list hides while editing), so go back to the list first.
    await w.getByRole('button', { name: 'Create draft' }).click();
    await w.getByRole('button', { name: 'Questionnaires' }).click();
    await w.getByRole('button', { name: /^Check-in/ }).click();
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
    await backToQuestionnaires(w);

    // Reopen: the alt text round-tripped through the encrypted vault and the image still loads.
    // (The editor thumbnail AND the open inline preview both render it, so scope to the first.)
    await w.getByRole('button', { name: /^Photo prompt/ }).click();
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

    // Builder: with AI off, the "Draft with AI" panel shows the role-aware notice (never an error). The
    // owner sees the set-up path (41 §3.3).
    await startNewQuestionnaire(w);
    await expect(w.getByText(/isn.t set up yet/i).first()).toBeVisible();
    await expect(
      w.getByRole('button', { name: /Set up Claude in Settings/i }).first(),
    ).toBeVisible();

    // Suggested (gap-finder) opens its own surface; after picking a recipient (08 §18.1) the same calm
    // AI-off state shows (generating needs AI).
    await backToQuestionnaires(w);
    await w.getByRole('button', { name: 'Suggested' }).click();
    await expect(w.getByRole('heading', { name: /suggested for you/i })).toBeVisible();
    await w.getByLabel('Who do you want ideas for?').selectOption('owner-1');
    await expect(w.getByText(/isn.t set up yet/i).first()).toBeVisible();

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

    // The Suggested (gap-finder) surface also fits — switch back to desktop, return to the list, open it.
    await resize(1100);
    await backToQuestionnaires(w);
    await w.getByRole('button', { name: 'Suggested' }).click();
    // Pick a recipient first (08 §18.1) so the generate button renders, then measure the fit.
    await w.getByLabel('Who do you want ideas for?').selectOption('owner-1');
    await expect(w.getByRole('button', { name: /suggest questionnaires for/i })).toBeVisible();
    await resize(390);
    await w.waitForTimeout(150);
    expect(await overflow()).toBeLessThanOrEqual(1);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('questionnaires: recipient-first Suggested — tailor, persist, delete, create-binds-recipient (08 §18)', async () => {
  // A household recipient ("Partner") to get ideas for; the owner gets some substantive context so the
  // gap-finder calls the model (not the pre-call thin-context hint). The offline fake returns a suggestion
  // set whose sample questions OMIT `required` and include one OFF-SPEC `type` ("text") — the salvage drops
  // only the bad question, keeping the suggestion (the "unexpected shape" fix, 37).
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  {
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('seed: master key missing');
    const now = new Date().toISOString();
    await savePerson(fs, key, {
      id: 'partner-1',
      schemaVersion: 1,
      displayName: 'Partner',
      isSubject: true,
      tags: [],
      notes: 'Loves cooking together; just started a new job.',
      createdAt: now,
      updatedAt: now,
    });
    await saveInsight(fs, key, {
      id: 'owner-context',
      schemaVersion: 1,
      source: 'intake',
      subjectPersonId: 'owner-1',
      summary: 'Values quality time and honest communication.',
      facts: [{ id: 'f1', text: 'Prefers weekends free for connection.', shareable: true }],
      confidence: 'high',
      categories: [],
      approved: true,
      provenance: { intakeSection: 'your-story', at: now },
      createdAt: now,
      updatedAt: now,
    });
  }
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    // Configure a (fake) key so the AI surfaces become ready.
    await w.getByRole('link', { name: 'Settings' }).click();
    await w.getByRole('button', { name: 'AI', exact: true }).click();
    await w.getByLabel('Claude API key').fill('sk-ant-e2e');
    await w.getByRole('button', { name: /save key/i }).click();
    await expect(w.getByText(/key is configured/i)).toBeVisible();

    await w.getByRole('link', { name: 'Questionnaires' }).click();
    await w.getByRole('button', { name: 'Suggested' }).click();
    // Recipient FIRST (08 §18.1), then generate — tailored to Partner.
    await w.getByLabel('Who do you want ideas for?').selectOption('partner-1');
    await w.getByRole('button', { name: /suggest questionnaires for partner/i }).click();

    // The suggestions render — no data-blame, no "unexpected shape", and the off-spec sample question is
    // dropped while its valid sibling survives (the suggestion is not sunk).
    await expect(w.getByText('Weekly partner check-in')).toBeVisible();
    await expect(w.getByText('What we each need')).toBeVisible();
    await expect(w.getByText(/add more about the people/i)).toHaveCount(0);
    await expect(w.getByText(/unexpected shape/i)).toHaveCount(0);
    await expect(w.getByText('How connected did you feel this week?')).toBeVisible();
    await expect(w.getByText('Anything left unsaid this week?')).toHaveCount(0);

    // PERSISTED in the vault under the AUTHOR, keyed by recipient (decrypt-assert, 08 §18.3).
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('decrypt: master key missing');
    const savedAfterGen = await listSavedSuggestions(fs, key, 'owner-1', 'partner-1');
    expect(savedAfterGen.map((s) => s.title)).toEqual([
      'Weekly partner check-in',
      'What we each need',
    ]);

    // Re-opening the surface for the SAME person re-shows the saved set with NO regenerate (no AI spend) —
    // the button now reads "Suggest more".
    await backToQuestionnaires(w);
    await w.getByRole('button', { name: 'Suggested' }).click();
    await w.getByLabel('Who do you want ideas for?').selectOption('partner-1');
    await expect(w.getByText('Weekly partner check-in')).toBeVisible();
    await expect(w.getByRole('button', { name: /suggest more/i })).toBeVisible();

    // Delete one card → it's gone from the UI and the vault.
    await w.getByRole('button', { name: /delete suggestion “What we each need”/i }).click();
    await expect(w.getByText('What we each need')).toHaveCount(0);
    expect(
      (await listSavedSuggestions(fs, key, 'owner-1', 'partner-1')).map((s) => s.title),
    ).toEqual(['Weekly partner check-in']);

    // "Create from this" runs a FULL knowledge-aware generation (08 §19.4) → the builder opens bound to
    // Partner (no "Who is this for?" re-ask, §18.1) with GENERATED questions that carry real options.
    await w.getByRole('button', { name: /create from this/i }).click();
    await expect(w.getByLabel('Title')).toHaveValue('A gentle weekly check-in');
    await expect(w.getByText('Who is this for?')).toHaveCount(0);
    // The generated multiple-choice question is NOT blank — its option inputs carry real values (the
    // reported blank-options bug is fixed, §19.4).
    await expect(w.getByLabel('Option 1').first()).toHaveValue('Big social events');

    // Saving the new questionnaire removes the suggestion it came from (08 §18.4).
    await w.getByRole('button', { name: 'Create draft' }).click();
    await expect(w.getByRole('button', { name: 'Save' })).toBeVisible(); // saved → button flips to Save
    await expect
      .poll(async () => (await listSavedSuggestions(fs, key, 'owner-1', 'partner-1')).length)
      .toBe(0);

    // Back in Suggested, the consumed person has no saved ideas left — no suggestion cards, and the button
    // is back to the first-time label (not "Suggest more"). (Asserted via controls, not the title text, since
    // the just-created questionnaire now carries that title in the list pane.)
    await backToQuestionnaires(w);
    await w.getByRole('button', { name: 'Suggested' }).click();
    await w.getByLabel('Who do you want ideas for?').selectOption('partner-1');
    await expect(
      w.getByRole('button', { name: /suggest questionnaires for partner/i }),
    ).toBeVisible();
    await expect(w.getByRole('button', { name: /create from this/i })).toHaveCount(0);
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
    // No analyzed answers yet (the live producer wires up with the Inbox, §13.5); the empty state explains
    // when insights appear (41 §3.1).
    await expect(w.getByText(/Insights appear here after your sessions/i)).toBeVisible();
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

test('memory: a member sees only their OWN insights, never another member’s (the cross-user leak fix, spec 20 §1.1)', async () => {
  const { userData, vault } = await seedReadyVault();
  await seedMemberWithPortrait(vault, userData, 'ana-1', 'Ana', 'Ana keeps a private journal');
  await seedMemberWithPortrait(vault, userData, 'bo-1', 'Bo', 'Bo is afraid of heights');
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();

    // Switch from the owner to Ana (owner switching is PIN-free).
    await w.getByRole('button', { name: /signed in as/i }).click();
    await w.getByRole('menuitem', { name: 'Switch person' }).click();
    await w
      .getByRole('dialog', { name: /who.s here/i })
      .getByText('Ana')
      .click();
    await expect(w.getByRole('button', { name: 'Signed in as Ana' })).toBeVisible();

    // Ana's Memory shows HER portrait — and NEVER Bo's (the closed cross-user leak).
    await w.getByRole('link', { name: 'Memory' }).click();
    await expect(w.getByText(/Ana's onboarding portrait/)).toBeVisible();
    await expect(w.getByText(/Ana keeps a private journal/)).toBeVisible();
    await expect(w.getByText(/Bo's onboarding portrait/)).toHaveCount(0);
    await expect(w.getByText(/Bo is afraid of heights/)).toHaveCount(0);

    // Decrypt-level proof: Bo's insight DOES exist on disk — it's withheld by scoping, not merely missing.
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('master key missing');
    const boInsights = await listInsightsForPerson(fs, key, 'bo-1');
    expect(boInsights.some((i) => i.facts.some((f) => f.text === 'Bo is afraid of heights'))).toBe(
      true,
    );

    // Switching to Bo flips the view entirely — Ana's portrait is gone, Bo's appears (per-person reset).
    await w.getByRole('button', { name: 'Signed in as Ana' }).click();
    await w.getByRole('menuitem', { name: 'Switch person' }).click();
    await w
      .getByRole('dialog', { name: /who.s here/i })
      .getByText('Bo')
      .click();
    await expect(w.getByRole('button', { name: 'Signed in as Bo' })).toBeVisible();
    await w.getByRole('link', { name: 'Memory' }).click();
    await expect(w.getByText(/Bo's onboarding portrait/)).toBeVisible();
    await expect(w.getByText(/Ana's onboarding portrait/)).toHaveCount(0);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('memory (#129): a questionnaire you sent a partner is grouped under "Responses", not mislabelled "About you"', async () => {
  const { userData, vault } = await seedReadyVault();
  {
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('memory #129 e2e: master key missing');
    const now = new Date().toISOString();
    // The partner the owner (viewer) sent a questionnaire to, + the symmetric `partner` edge.
    await savePerson(fs, key, {
      id: 'angel-1',
      schemaVersion: 1,
      displayName: 'Angel',
      isSubject: true,
      tags: [],
      createdAt: now,
      updatedAt: now,
    });
    await saveRelationship(fs, key, {
      id: 'rel-angel',
      schemaVersion: 1,
      fromPersonId: 'owner-1',
      toPersonId: 'angel-1',
      type: 'partner',
      createdAt: now,
      updatedAt: now,
    });
    // A real questionnaire + send owner-1 → Angel, so the insight's recipient is resolvable read-time.
    const q = await saveQuestionnaire(fs, key, {
      title: 'How are we doing?',
      type: 'role-feedback',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: 'angel-1' },
      questions: [{ id: 'q1', type: 'shortText', prompt: 'How are we?', required: true }],
    });
    const assignment = await createAssignment(fs, key, {
      questionnaireId: q.id,
      senderPersonId: 'owner-1',
      recipient: { kind: 'person', personId: 'angel-1' },
      channel: 'inApp',
      privacy: 'standard',
      senderVisibleToRecipient: true,
    });
    // A PRE-#129 analysis insight from that send: subject = the owner (sender), Relationships-tagged, with NO
    // `aboutPersonId` stamped — the bridge must resolve it read-time from the assignment (the user's exact case).
    await saveInsight(fs, key, {
      id: 'resp-legacy',
      schemaVersion: 1,
      source: 'questionnaire',
      subjectPersonId: 'owner-1',
      summary: 'Angel wants more protected time together',
      facts: [{ id: 'f1', text: 'Wants more regular date nights', shareable: true }],
      confidence: 'medium',
      categories: ['Relationships'],
      approved: true,
      provenance: { assignmentId: assignment.id, at: now }, // legacy: no aboutPersonId
      createdAt: now,
      updatedAt: now,
    });
    // A genuine "about you" session insight — stays in a life-area card.
    await saveInsight(fs, key, {
      id: 'own-session',
      schemaVersion: 1,
      source: 'session',
      subjectPersonId: 'owner-1',
      summary: 'Values steady routines',
      facts: [],
      confidence: 'medium',
      categories: ['Health & body'],
      approved: true,
      provenance: { conversationId: 'c1', at: now },
      createdAt: now,
      updatedAt: now,
    });
  }

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Memory' }).click();
    await expect(w.getByRole('heading', { name: 'Memory' })).toBeVisible();

    // The sent-questionnaire insight lands in its own "Responses" section, grouped under Angel…
    await expect(
      w.getByRole('heading', { name: 'Responses to your questionnaires' }),
    ).toBeVisible();
    await expect(w.getByRole('heading', { name: 'Angel' })).toBeVisible();
    // …with the honest "From Angel's answers" eyebrow (never "About you"), resolved read-time from the send.
    await expect(w.getByText(/From Angel.s answers/)).toBeVisible();
    await expect(w.getByText('Angel wants more protected time together')).toBeVisible();
    // It is NOT mislabelled as a Relationships life-area card (the #129 bug).
    await expect(w.getByRole('heading', { name: /^Relationships/ })).toHaveCount(0);
    // A genuine own insight still fills its life-area card.
    await expect(w.getByRole('heading', { name: /Health & body/ })).toBeVisible();
    await expect(w.getByText('Values steady routines')).toBeVisible();

    // No horizontal overflow / inner scrollbars at phone width (CLAUDE.md §7/§12).
    await w.setViewportSize({ width: 360, height: 800 });
    const offenders = await w.evaluate(() => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const ox = getComputedStyle(el).overflowX;
        if (el.scrollWidth - el.clientWidth > 1 && (ox === 'auto' || ox === 'scroll')) {
          out.push(`${el.tagName}.${el.className}`);
        }
      }
      const main = document.querySelector('main');
      return { offenders: out, mainOverflow: main ? main.scrollWidth - main.clientWidth : 0 };
    });
    expect(offenders.offenders).toEqual([]);
    expect(offenders.mainOverflow).toBeLessThanOrEqual(1);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('memory redesign (54): a partner’s shared facts never show raw; the Partners view shows AI relationship insights', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  {
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('memory-redesign e2e: master key missing');
    const now = new Date().toISOString();
    // A partner (Pat) + the symmetric `partner` edge to the owner (the viewer).
    await savePerson(fs, key, {
      id: 'pat-1',
      schemaVersion: 1,
      displayName: 'Pat',
      isSubject: true,
      tags: [],
      createdAt: now,
      updatedAt: now,
    });
    await saveRelationship(fs, key, {
      id: 'rel-pat',
      schemaVersion: 1,
      fromPersonId: 'owner-1',
      toPersonId: 'pat-1',
      type: 'partner',
      createdAt: now,
      updatedAt: now,
    });
    // The owner's OWN insight (shown in About you) + Pat's insight: one fact SHARED with the partner type,
    // one PRIVATE — NEITHER may ever appear raw in the owner's Memory (54 §1).
    await saveInsight(fs, key, {
      id: 'own-note',
      schemaVersion: 1,
      source: 'session',
      subjectPersonId: 'owner-1',
      summary: 'OWNER-OWN-NOTE',
      facts: [{ id: 'of', text: 'owner reflects on connection', shareable: false }],
      confidence: 'medium',
      categories: ['Relationships'],
      approved: true,
      provenance: { conversationId: 'c-own', at: now },
      createdAt: now,
      updatedAt: now,
    });
    await saveInsight(fs, key, {
      id: 'pat-note',
      schemaVersion: 1,
      source: 'session',
      subjectPersonId: 'pat-1',
      summary: 'PAT-SUMMARY',
      facts: [
        { id: 'sf', text: 'PARTNER-SHARED-FACT', shareable: false, shareableTypes: ['partner'] },
        { id: 'pf', text: 'PARTNER-PRIVATE-FACT', shareable: false },
      ],
      confidence: 'medium',
      categories: ['Relationships'],
      approved: true,
      provenance: { conversationId: 'c-pat', at: now },
      createdAt: now,
      updatedAt: now,
    });
  }
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Memory' }).click();

    // "About you" shows the owner's OWN note…
    await expect(w.getByText('OWNER-OWN-NOTE')).toBeVisible();
    // …but a partner's shared/private facts are NEVER shown raw (sharing is context, not display, 54 §1).
    await expect(w.getByText('PARTNER-SHARED-FACT')).toHaveCount(0);
    await expect(w.getByText('PARTNER-PRIVATE-FACT')).toHaveCount(0);
    await expect(w.getByText('About people you relate to')).toHaveCount(0);

    // The Partners view: a relationship-insights card. Generate → AI observations (a synthesis, never raw).
    await w.getByRole('button', { name: 'Partners' }).click();
    await expect(w.getByText(/You & Pat/)).toBeVisible();
    await w.getByRole('button', { name: /Reflect on us/ }).click();
    await expect(w.getByText(/both lean on security/)).toBeVisible();
    // Even after the synthesis, the partner's raw shared fact is still never displayed.
    await expect(w.getByText('PARTNER-SHARED-FACT')).toHaveCount(0);

    // Decrypt: Pat's shared fact is partner-scoped (it CAN feed the viewer's synthesis); the cache exists.
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('memory-redesign e2e: key missing (2)');
    const patFacts = (await listInsightsForPerson(fs, key, 'pat-1')).flatMap((i) => i.facts);
    expect(
      patFacts.find((f) => f.text === 'PARTNER-SHARED-FACT')?.shareableTypes?.includes('partner'),
    ).toBe(true);
    const synthRaw = await fs.read('people/owner-1/relationships/pat-1/synthesis.enc');
    expect(synthRaw).not.toBeNull(); // the synthesis was cached

    // Phone width: no horizontal overflow with the Partners card on screen.
    await w.setViewportSize({ width: 360, height: 800 });
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

test('memory: the dashboard groups by life-area, flags a fact (decrypt-persisted), shows "source removed", and fits 390px (spec 20 §3)', async () => {
  const { userData, vault } = await seedReadyVault();
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('master key missing');
  const at = '2026-06-12T10:00:00.000Z';
  // A session insight whose conversation no longer exists → its provenance shows "original source removed".
  await saveInsight(fs, key, {
    id: 'ins-health',
    schemaVersion: 1,
    source: 'session',
    subjectPersonId: 'owner-1',
    summary: 'Sleeps better with a wind-down routine',
    facts: [
      { id: 'f1', text: 'Reads before bed', shareable: false },
      { id: 'f2', text: 'This one is wrong', shareable: false },
    ],
    confidence: 'high',
    confidenceRationale: 'echoed across sessions',
    categories: ['Health & body'],
    metrics: { moodValence: 0.3, moodEnergy: 0.1 },
    approved: true,
    provenance: { conversationId: 'gone-conv', at },
    createdAt: at,
    updatedAt: at,
  });
  // A second area, a draft (Needs review), and a second mood reading (so Trends has ≥2 points).
  await saveInsight(fs, key, {
    id: 'ins-rel',
    schemaVersion: 1,
    source: 'questionnaire',
    subjectPersonId: 'owner-1',
    summary: 'Values quality time with their partner',
    facts: [{ id: 'f1', text: 'Prefers weekends unscheduled', shareable: true }],
    confidence: 'medium',
    confidenceRationale: 'from a recent questionnaire',
    categories: ['Relationships'],
    approved: true,
    provenance: { assignmentId: 'a1', at: '2026-06-13T10:00:00.000Z' },
    createdAt: at,
    updatedAt: '2026-06-13T10:00:00.000Z',
  });
  await saveInsight(fs, key, {
    id: 'ins-draft',
    schemaVersion: 1,
    source: 'questionnaire',
    subjectPersonId: 'owner-1',
    summary: 'Might want to set firmer work boundaries',
    facts: [{ id: 'f1', text: 'Mentions evening emails', shareable: false }],
    confidence: 'low',
    categories: ['Work & purpose'],
    approved: false,
    provenance: { assignmentId: 'a2', at: '2026-06-14T10:00:00.000Z' },
    createdAt: at,
    updatedAt: '2026-06-14T10:00:00.000Z',
  });
  await saveInsight(fs, key, {
    id: 'ins-mood2',
    schemaVersion: 1,
    source: 'session',
    subjectPersonId: 'owner-1',
    summary: 'Felt lighter after a walk',
    facts: [{ id: 'f1', text: 'Walks help reset', shareable: false }],
    confidence: 'medium',
    categories: ['Emotions & patterns'],
    metrics: { moodValence: 0.6, moodEnergy: 0.5 },
    approved: true,
    provenance: { conversationId: 'gone-conv-2', at: '2026-06-15T10:00:00.000Z' },
    createdAt: at,
    updatedAt: '2026-06-15T10:00:00.000Z',
  });

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Memory' }).click();

    // The draft is in "Needs your review"; approved insights group by life-area; Trends is present.
    await expect(w.getByRole('heading', { name: 'Needs your review' })).toBeVisible();
    await expect(w.getByText('Might want to set firmer work boundaries')).toBeVisible();
    await expect(w.getByRole('heading', { name: /Health & body/ })).toBeVisible();
    await expect(w.getByRole('heading', { name: /Relationships/ })).toBeVisible();
    await expect(w.getByText('Trends')).toBeVisible();
    await expect(w.getByText('Sleeps better with a wind-down routine')).toBeVisible();
    // A session insight whose conversation is gone shows "original source removed".
    await expect(w.getByText(/original source removed/i).first()).toBeVisible();

    // Mark the inaccurate fact "not right about me" (the relabelled correction, 44 §3.4) → persists encrypted.
    await w.getByRole('button', { name: /This isn.t right about me: This one is wrong/ }).click();
    await expect(w.getByText('marked not right')).toBeVisible();
    await expect
      .poll(async () => {
        const insight = await getInsight(fs, key, 'owner-1', 'ins-health');
        return insight?.facts.find((f) => f.id === 'f2')?.flaggedInaccurate ?? false;
      })
      .toBe(true);

    // Search narrows the list.
    await w.getByLabel('Search memory').fill('routine');
    await expect(w.getByText('Sleeps better with a wind-down routine')).toBeVisible();

    // No horizontal overflow at phone width.
    await w.setViewportSize({ width: 390, height: 800 });
    const overflow = await w.evaluate(() => {
      let max = 0;
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const style = getComputedStyle(el);
        if (
          (style.overflowX === 'auto' || style.overflowX === 'scroll') &&
          el.scrollWidth - el.clientWidth > max
        ) {
          max = el.scrollWidth - el.clientWidth;
        }
      }
      const main = document.querySelector('main');
      return Math.max(max, main ? main.scrollWidth - main.clientWidth : 0);
    });
    expect(overflow).toBeLessThanOrEqual(1);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('memory overhaul: stats header, type-scope a fact to partner (decrypt), mark "not right" (decrypt), Edit answer + Manage sharing, 360px (spec 44)', async () => {
  const { userData, vault } = await seedReadyVault();
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('master key missing');
  const at = '2026-06-20T10:00:00.000Z';
  // A partner related to the owner, so a partner-scoped fact flows into THEIR context.
  await savePerson(fs, key, {
    id: 'partner-1',
    schemaVersion: 1,
    displayName: 'Pat',
    isSubject: true,
    tags: [],
    createdAt: at,
    updatedAt: at,
  });
  await saveRelationship(fs, key, {
    id: 'rel-p',
    schemaVersion: 1,
    fromPersonId: 'owner-1',
    toPersonId: 'partner-1',
    type: 'partner',
    createdAt: at,
    updatedAt: at,
  });
  // The owner's onboarding portrait (intake → "Edit answer", never a flag) + a session insight (AI-inferred).
  await saveInsight(fs, key, {
    id: 'ins-portrait',
    schemaVersion: 1,
    source: 'intake',
    subjectPersonId: 'owner-1',
    summary: 'A grounded, curious person',
    facts: [{ id: 'pf1', text: 'Grew up in Ohio', shareable: false }],
    confidence: 'high',
    categories: ['Values & beliefs'],
    approved: true,
    provenance: { intakeSection: 'basics', at },
    createdAt: at,
    updatedAt: at,
  });
  await saveInsight(fs, key, {
    id: 'ins-sess',
    schemaVersion: 1,
    source: 'session',
    subjectPersonId: 'owner-1',
    summary: 'From a recent session',
    facts: [
      { id: 'sf1', text: 'Enjoys rock climbing', shareable: false },
      { id: 'sf2', text: 'WRONGLY-INFERRED-CLAIM', shareable: false },
    ],
    confidence: 'medium',
    categories: ['Emotions & patterns'],
    approved: true,
    provenance: { conversationId: 'gone', at },
    createdAt: at,
    updatedAt: at,
  });

  // Before any change, the owner's own facts feed their own context.
  expect(await buildContext(fs, key, 'owner-1')).toContain('WRONGLY-INFERRED-CLAIM');

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Memory' }).click();

    // Stats header: overview total (3 live facts), confidence distribution, sharing summary.
    await expect(w.getByText(/SelfOS knows\s*3\s*things about you/)).toBeVisible();
    await expect(w.getByText(/High\s*1/)).toBeVisible();
    await expect(w.getByText('You’re not sharing anything yet.')).toBeVisible();
    // The broadcast ShareToggle is gone — the per-fact control is now the relationship-scope picker chip.
    await expect(w.getByRole('button', { name: /Enjoys rock climbing: private/i })).toBeVisible();

    // Type-scope "Enjoys rock climbing" to Partner via the card picker → it reaches the partner's context.
    await w.getByRole('button', { name: /Enjoys rock climbing: private/i }).click();
    await w.getByRole('checkbox', { name: 'Partner' }).click();
    await w.keyboard.press('Escape'); // close the picker popover so it can't overlay the next control
    await expect
      .poll(async () => (await buildContext(fs, key, 'partner-1')).includes('Enjoys rock climbing'))
      .toBe(true);

    // Mark the wrong AI-inferred fact "not right about me" → it drops from the owner's own context.
    await w
      .getByRole('button', { name: /This isn.t right about me: WRONGLY-INFERRED-CLAIM/ })
      .click();
    await expect(w.getByText('marked not right')).toBeVisible();
    await expect
      .poll(async () => (await buildContext(fs, key, 'owner-1')).includes('WRONGLY-INFERRED-CLAIM'))
      .toBe(false);

    // No horizontal overflow at phone width (the §12 inner-scrollbar scan + main check).
    const overflowAt = async (): Promise<number> =>
      w.evaluate(() => {
        let max = 0;
        for (const el of Array.from(document.querySelectorAll('*'))) {
          const style = getComputedStyle(el);
          if (
            (style.overflowX === 'auto' || style.overflowX === 'scroll') &&
            el.scrollWidth - el.clientWidth > max
          ) {
            max = el.scrollWidth - el.clientWidth;
          }
        }
        const main = document.querySelector('main');
        return Math.max(max, main ? main.scrollWidth - main.clientWidth : 0);
      });
    await w.setViewportSize({ width: 360, height: 800 });
    expect(await overflowAt()).toBeLessThanOrEqual(1);
    await w.setViewportSize({ width: 1024, height: 800 });

    // Manage sharing → the transparency surface lists the now-shared fact with its scope + recipient.
    await w.getByRole('button', { name: /Manage sharing/ }).click();
    await expect(w.getByRole('heading', { name: /What you share/ })).toBeVisible();
    await expect(w.getByText('Enjoys rock climbing')).toBeVisible();
    await expect(w.getByText(/Shared with Partner · reaching Pat/)).toBeVisible();
    await w.setViewportSize({ width: 360, height: 800 });
    expect(await overflowAt()).toBeLessThanOrEqual(1);
    await w.setViewportSize({ width: 1024, height: 800 });

    // Back to Memory; "Edit answer" on the onboarding portrait deep-links into onboarding (§3.4).
    await w.getByRole('button', { name: /^Memory$/ }).click();
    await w.getByRole('button', { name: /Edit answer/ }).click();
    await expect.poll(() => w.url()).toContain('onboarding');
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('goals: a tracked goal shows on the Goals page with status; marking it Done moves it to closed (57 §3.7)', async () => {
  const { userData, vault } = await seedReadyVault();
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('master key missing');
  const at = '2026-06-20T10:00:00.000Z';
  await saveGoal(fs, key, {
    id: 'goal-1',
    schemaVersion: 1,
    subjectPersonId: 'owner-1',
    text: 'Finish the budget spreadsheet',
    status: 'open',
    lifeArea: 'Goals & growth',
    provenance: { conversationId: 'conv-1', at },
    createdAt: at,
    updatedAt: at,
    lastTouchedAt: at,
  });

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    // Goals now live on their own top-level page (57 §3.7), not inside Memory.
    await w.getByRole('link', { name: 'Goals' }).click();

    // The goal appears under "Goals & commitments" with an Open status.
    await expect(w.getByRole('heading', { name: /Goals & commitments/ })).toBeVisible();
    await expect(w.getByText('Finish the budget spreadsheet')).toBeVisible();

    // Mark it Done via the per-goal status control → it moves to the collapsed "Completed & closed".
    await w
      .getByRole('combobox', { name: /Set status for: Finish the budget spreadsheet/ })
      .selectOption('done');
    await expect(w.getByText(/Completed & closed \(1\)/)).toBeVisible();

    // Decrypt-level proof: the goal persisted as done.
    await expect
      .poll(async () => (await getGoal(fs, key, 'owner-1', 'goal-1'))?.status)
      .toBe('done');

    // The extraction: Memory no longer carries a Goals section (57 §1.3).
    await w.getByRole('link', { name: 'Memory' }).click();
    await expect(w.getByRole('heading', { name: 'Memory' })).toBeVisible();
    await expect(w.getByRole('heading', { name: /Goals & commitments/ })).toHaveCount(0);

    // No horizontal overflow at phone width on the Goals page.
    await w.getByRole('link', { name: 'Goals' }).click();
    await w.setViewportSize({ width: 390, height: 800 });
    const overflow = await w.evaluate(() => {
      let max = 0;
      for (const el of Array.from(document.querySelectorAll('*'))) {
        const style = getComputedStyle(el);
        if (
          (style.overflowX === 'auto' || style.overflowX === 'scroll') &&
          el.scrollWidth - el.clientWidth > max
        ) {
          max = el.scrollWidth - el.clientWidth;
        }
      }
      const main = document.querySelector('main');
      return Math.max(max, main ? main.scrollWidth - main.clientWidth : 0);
    });
    expect(overflow).toBeLessThanOrEqual(1);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('memory cleanup: flagging a previously-shared fact retracts it from a related person’s context (39 §4.2)', async () => {
  const { userData, vault } = await seedReadyVault();
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('master key missing');
  const at = '2026-06-20T10:00:00.000Z';
  // A related contact 'friend-1', related to the owner, so the owner's shared facts flow into friend's context.
  await savePerson(fs, key, {
    id: 'friend-1',
    schemaVersion: 1,
    displayName: 'Casey',
    isSubject: true,
    tags: [],
    createdAt: at,
    updatedAt: at,
  });
  await saveRelationship(fs, key, {
    id: 'rel-1',
    schemaVersion: 1,
    fromPersonId: 'owner-1',
    toPersonId: 'friend-1',
    type: 'friend',
    createdAt: at,
    updatedAt: at,
  });
  // The owner has an insight whose fact is targeted-shared with Casey.
  await saveInsight(fs, key, {
    id: 'ins-share',
    schemaVersion: 1,
    source: 'session',
    subjectPersonId: 'owner-1',
    summary: 'Reflections from a session',
    facts: [
      {
        id: 'fshare',
        text: 'PLANNING-A-SURPRISE-PARTY',
        shareable: false,
        shareableWith: ['friend-1'],
      },
    ],
    confidence: 'medium',
    categories: ['Other'],
    approved: true,
    provenance: { conversationId: 'gone', at },
    createdAt: at,
    updatedAt: at,
  });

  // Before flagging: the shared fact reaches Casey's assembled context.
  expect(await buildContext(fs, key, 'friend-1')).toContain('PLANNING-A-SURPRISE-PARTY');

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Memory' }).click();
    await expect(w.getByText('PLANNING-A-SURPRISE-PARTY')).toBeVisible();

    // Mark it "not right about me" → the share is retracted (Memory shows "sharing withdrawn").
    await w
      .getByRole('button', { name: /This isn.t right about me: PLANNING-A-SURPRISE-PARTY/ })
      .click();
    await expect(w.getByText('sharing withdrawn')).toBeVisible();

    // Decrypt-level proof: Casey's context no longer carries the corrected claim.
    await expect
      .poll(async () =>
        (await buildContext(fs, key, 'friend-1')).includes('PLANNING-A-SURPRISE-PARTY'),
      )
      .toBe(false);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('memory cleanup: deleting a person reaps the orphaned shareableWith from others’ facts (39 §4.5)', async () => {
  const { userData, vault } = await seedReadyVault();
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('master key missing');
  const at = '2026-06-20T10:00:00.000Z';
  await savePerson(fs, key, {
    id: 'friend-2',
    schemaVersion: 1,
    displayName: 'Devon',
    isSubject: false,
    tags: [],
    createdAt: at,
    updatedAt: at,
  });
  await saveInsight(fs, key, {
    id: 'ins-orphan',
    schemaVersion: 1,
    source: 'session',
    subjectPersonId: 'owner-1',
    summary: 'About the owner',
    facts: [
      {
        id: 'forphan',
        text: 'A shared note',
        shareable: false,
        shareableWith: ['friend-2', 'keep'],
      },
    ],
    confidence: 'low',
    categories: [],
    approved: true,
    provenance: { conversationId: 'c', at },
    createdAt: at,
    updatedAt: at,
  });

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    // Delete Devon from People → the reap runs in the delete handler.
    await w.getByRole('link', { name: 'People' }).click();
    await w.getByText('Devon').click();
    await w.getByRole('button', { name: 'Delete person' }).click();

    // Decrypt-level proof: the dangling id is gone from the owner's fact; the other share is untouched.
    await expect
      .poll(async () => {
        const insight = await getInsight(fs, key, 'owner-1', 'ins-orphan');
        return insight?.facts.find((f) => f.id === 'forphan')?.shareableWith ?? [];
      })
      .toEqual(['keep']);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('memory: automatic reconciliation fires on launch when warranted, recording a memory.reconcile usage event (39 §3.3)', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('master key missing');
  const at = '2026-06-20T10:00:00.000Z';
  // Seed 5 approved insights (never reconciled) so the threshold trips on launch.
  for (const n of [1, 2, 3, 4, 5]) {
    await saveInsight(fs, key, {
      id: `ins-${n}`,
      schemaVersion: 1,
      source: 'session',
      subjectPersonId: 'owner-1',
      summary: `Insight number ${n}`,
      facts: [{ id: 'f1', text: `fact ${n}`, shareable: false }],
      confidence: 'low',
      categories: [],
      approved: true,
      provenance: { conversationId: `c${n}`, at },
      createdAt: at,
      updatedAt: at,
    });
  }

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    // The AppShell mounts on launch and drives the auto-reconcile cadence; it runs once (threshold met,
    // un-throttled, AI on) and meters a `memory.reconcile` usage event — even before visiting Memory.
    await expect(w.getByRole('button', { name: /signed in as/i })).toBeVisible();
    await expect
      .poll(
        async () =>
          (
            await queryUsage(fs, key, {
              from: '2026-01-01',
              to: '2027-01-01',
              personId: 'owner-1',
              type: 'memory.reconcile',
            })
          ).length,
        { timeout: 10_000 },
      )
      .toBeGreaterThanOrEqual(1);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('memory: a provenance link opens the live source (dream deep-link survives the per-person reset, spec 20 §3.3)', async () => {
  const { userData, vault } = await seedReadyVault();
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('master key missing');
  const at = '2026-06-12T10:00:00.000Z';
  await saveDream(fs, key, {
    id: 'dream-1',
    schemaVersion: 1,
    personId: 'owner-1',
    narrative: 'I was flying over a calm silver sea',
    lucid: false,
    nightmare: false,
    tags: [],
    people: [],
    sensitivity: 'standard',
    status: 'captured',
    createdAt: at,
    updatedAt: at,
  });
  await saveInsight(fs, key, {
    id: 'ins-dream',
    schemaVersion: 1,
    source: 'dream',
    subjectPersonId: 'owner-1',
    summary: 'A recurring flying dream',
    facts: [{ id: 'f1', text: 'Flying feels freeing', shareable: false }],
    confidence: 'medium',
    categories: ['Emotions & patterns'],
    approved: true,
    provenance: { dreamId: 'dream-1', at },
    createdAt: at,
    updatedAt: at,
  });

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Memory' }).click();
    await expect(w.getByText('A recurring flying dream')).toBeVisible();
    // Clicking the provenance link opens the referenced dream — NOT the empty Dreams list (the per-person
    // reset effect must not clobber the deep-link on mount). It lands on the read-first detail (12 §15.3).
    await w.getByRole('button', { name: /From a dream/ }).click();
    await expect(
      w.getByRole('paragraph').filter({ hasText: /flying over a calm silver sea/i }),
    ).toBeVisible();
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

test('unified delivery (§17.13): a household send also mints a link the recipient can answer anywhere', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();

    // Admin connects the relay (fake Cloudflare).
    await w.getByRole('link', { name: 'Settings' }).click();
    await w.getByRole('button', { name: 'Relay' }).click();
    await w.getByLabel(/cloudflare account id/i).fill('acct-123');
    await w.getByLabel(/cloudflare api token/i).fill('cf-token');
    await w.getByRole('button', { name: /connect & deploy/i }).click();
    await expect(w.getByText(/relay connected at/i)).toBeVisible();

    // Author a HOUSEHOLD-recipient questionnaire (a self check-in to Tester) and send it in-app.
    await w.getByRole('link', { name: 'Questionnaires' }).click();
    await startNewQuestionnaire(w); // binds the owner (Tester) as the recipient
    await w.getByLabel('Title').fill('Self check-in');
    await w.getByLabel('Question 1', { exact: true }).fill('How am I doing?');
    await w.getByRole('button', { name: 'Create draft' }).click();
    await w.getByRole('button', { name: 'Send' }).click();
    // Wait for the send panel to render before clicking its confirm (else .last() races the builder's Send).
    await expect(w.getByRole('heading', { name: /Send .Self check-in/ })).toBeVisible();
    await w.getByRole('button', { name: 'Send' }).last().click({ noWaitAfter: true });

    // §17.13: it landed in the Inbox AND minted a relay link + PIN (answer on either surface).
    await expect(w.getByText(/Sent to Tester/)).toBeVisible();
    const link = await w.getByLabel('Secure link').inputValue();
    expect(link).toMatch(/\.workers\.dev\/q\/[0-9a-f]+#k=/);
    expect(await w.getByLabel('PIN', { exact: true }).inputValue()).toMatch(/^\d{6}$/);

    // Decrypt the vault: the send is an IN-APP assignment that ALSO carries relay material.
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('expected a master key');
    const send = (await listAssignments(fs, key)).find(
      (a) => a.channel === 'inApp' && a.relay?.token,
    );
    expect(send).toBeTruthy();
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
    await w.getByRole('button', { name: /^Weekly check-in/ }).click();
    await w.getByLabel('How are we doing?').fill('Doing great');
    await w.getByRole('button', { name: 'Submit' }).click();
    await expect(w.getByText('Submitted')).toBeVisible();

    // Open the questionnaire's Results tab — a Standard send shows the raw answers.
    await w.getByRole('link', { name: 'Questionnaires' }).click();
    await w.getByRole('button', { name: /^Weekly check-in/ }).click();
    await w.getByRole('button', { name: 'Results' }).click();
    await expect(w.getByText('How are we doing?')).toBeVisible();
    await expect(w.getByText('Doing great')).toBeVisible();
    // AI is off, so analysis is offered via the calm role-aware notice (no dead Analyze button).
    await expect(w.getByText(/isn.t set up yet/i).first()).toBeVisible();

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

test('answer review/edit (56): recipient reviews + edits + resends → Results goes stale → re-analyze clears it', async () => {
  // AI on + a key so Analyze/Re-analyze run (via the offline fake). A SELF check-in (owner = sender = recipient)
  // avoids the account-switch dance — the recipient-scoping is proven in the coreBridge test.
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();

    // Author + send a Standard self check-in.
    await w.getByRole('link', { name: 'Questionnaires' }).click();
    await startNewQuestionnaire(w);
    await w.getByLabel('Title').fill('Weekly check-in');
    await w.getByLabel('Question 1', { exact: true }).fill('How are we doing?');
    await w.getByRole('button', { name: 'Create draft' }).click();
    await w.getByRole('button', { name: 'Send' }).click();
    await w.getByRole('button', { name: 'Standard' }).click();
    await w.getByRole('button', { name: 'Send' }).last().click();
    await expect(w.getByText(/Sent to Tester/)).toBeVisible();
    await w.getByRole('button', { name: 'Done' }).click();

    // Answer + submit from the Inbox.
    await w.getByRole('link', { name: /Inbox/ }).click();
    await w.getByRole('button', { name: /^Weekly check-in/ }).click();
    await w.getByLabel('How are we doing?').fill('Doing okay');
    await w.getByRole('button', { name: 'Submit' }).click();
    await expect(w.getByText('Submitted')).toBeVisible();

    // Analyze it in Results → an insight is drafted.
    await w.getByRole('link', { name: 'Questionnaires' }).click();
    await w.getByRole('button', { name: /^Weekly check-in/ }).click();
    await w.getByRole('button', { name: 'Results' }).click();
    await w.getByRole('button', { name: 'Analyze', exact: true }).click();
    await expect(w.getByText(/insight drafted from this response/i)).toBeVisible();

    // Back to the Inbox: review the submitted answers, then EDIT + resend (56 §3.1).
    await w.getByRole('link', { name: /Inbox/ }).click();
    await w.getByRole('button', { name: /^Weekly check-in/ }).click();
    await expect(w.getByRole('heading', { name: 'Your answers' })).toBeVisible();
    await expect(w.getByText('Doing okay')).toBeVisible();
    await w.getByRole('button', { name: 'Edit answers' }).click();
    const field = w.getByLabel('How are we doing?');
    await field.fill('Actually, really well now');
    await w.getByRole('button', { name: 'Update answers' }).click();
    await expect(w.getByText('Submitted')).toBeVisible();

    // The sender's Results now flags the analysis stale + offers Re-analyze (the `answers-updated` bell nudge is
    // a one-shot per-person read that surfaces on next launch — covered by the bridge + notification tests).
    await w.getByRole('link', { name: 'Questionnaires' }).click();
    await w.getByRole('button', { name: /^Weekly check-in/ }).click();
    await w.getByRole('button', { name: 'Results' }).click();
    await expect(w.getByText(/answers updated since your last analysis/i)).toBeVisible();

    // Decrypt: the response revision climbed to 2 (a resubmit), the answers updated.
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('answer-edit e2e: master key missing');
    const send = (await listAssignments(fs, key)).find((a) => a.senderPersonId === 'owner-1');
    if (!send) throw new Error('expected a send');
    const response = await getResponse(fs, key, send.id);
    expect(response?.revision).toBe(2);
    expect(response?.answers[0]?.value).toBe('Actually, really well now');

    // Re-analyze → the insight's analyzedRevision catches up → the stale chip clears.
    await w.getByRole('button', { name: 'Re-analyze' }).click();
    await expect(w.getByText(/insight drafted from this response/i)).toBeVisible();
    await expect(w.getByText(/answers updated since your last analysis/i)).toHaveCount(0);
    const insights = await listInsightsForPerson(fs, key, 'owner-1');
    const insight = insights.find((i) => i.provenance.assignmentId === send.id);
    expect(insight?.provenance.analyzedRevision).toBe(2);

    // No horizontal overflow at phone width on the review.
    await w.getByRole('link', { name: /Inbox/ }).click();
    await w.getByRole('button', { name: /^Weekly check-in/ }).click();
    await w.setViewportSize({ width: 360, height: 800 });
    const overflow = await w.evaluate(() => {
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
    expect(overflow.offenders).toEqual([]);
    expect(overflow.mainOverflow).toBeLessThanOrEqual(1);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('questionnaires: a questionnaire sent TO you is in your Inbox, NOT your edit list (author-scoped)', async () => {
  const { userData, vault } = await seedReadyVault();
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('author-scope e2e: master key missing');
  // A questionnaire authored by SOMEONE ELSE and sent to the owner — it must land in the Inbox, never the
  // owner's authoring/edit list (fix: the list is scoped to what YOU authored).
  const foreign = await saveQuestionnaire(
    fs,
    key,
    {
      title: 'A friend’s questionnaire',
      type: 'role-feedback',
      sensitivity: 'standard',
      questions: [{ id: 'q1', type: 'shortText', prompt: 'How are you?', required: true }],
    },
    'ghost-author',
  );
  await createAssignment(fs, key, {
    questionnaireId: foreign.id,
    senderPersonId: 'ghost-author',
    recipient: { kind: 'person', personId: 'owner-1' },
    channel: 'inApp',
    privacy: 'standard',
    senderVisibleToRecipient: true,
  });
  // …and one the owner authored themselves.
  await saveQuestionnaire(
    fs,
    key,
    {
      title: 'My own questionnaire',
      type: 'role-feedback',
      sensitivity: 'standard',
      questions: [{ id: 'q1', type: 'shortText', prompt: 'What’s up?', required: true }],
    },
    'owner-1',
  );

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();

    // The edit list shows the owner's OWN, NOT the friend's send-to-them.
    await w.getByRole('link', { name: 'Questionnaires' }).click();
    await expect(w.getByRole('button', { name: /My own questionnaire/ }).first()).toBeVisible();
    await expect(w.getByRole('button', { name: /A friend’s questionnaire/ })).toHaveCount(0);

    // …but the friend's questionnaire IS in the Inbox (as a recipient).
    await w.getByRole('link', { name: /Inbox/ }).click();
    await expect(w.getByRole('button', { name: /A friend’s questionnaire/ }).first()).toBeVisible();
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

    // §16.3: save the draft so Send appears, then send once via the UI.
    await w.getByRole('button', { name: 'Create draft' }).click();
    await w.getByRole('button', { name: 'Send' }).click();
    await w.getByRole('button', { name: 'Standard' }).click();
    await w.getByRole('button', { name: 'Send' }).last().click();
    await w.getByRole('button', { name: 'Done' }).click();
    // The re-ask: a SENT questionnaire is locked + the in-UI "Send again" is disabled until the re-send
    // cooldown (§17.14a), so drive the second send through the bridge (a re-ask is still valid) to get the
    // two submitted responses a trend needs — without waiting out the cooldown.
    const qid = await w.evaluate(async () => {
      const sel = (
        window as unknown as { selfos: { questionnairesList: () => Promise<{ id: string }[]> } }
      ).selfos;
      const list = await sel.questionnairesList();
      return list[0]?.id ?? '';
    });
    await w.evaluate((id) => {
      const sel = (
        window as unknown as {
          selfos: {
            assignmentsCreate: (i: {
              questionnaireId: string;
              privacy: string;
            }) => Promise<unknown>;
          };
        }
      ).selfos;
      return sel.assignmentsCreate({ questionnaireId: id, privacy: 'standard' });
    }, qid);

    // Answer both from the Inbox with ratings 2 then 5. Pick the still-unanswered "New" item, waiting
    // for the list to settle after each submit (else the just-submitted row is still briefly "New").
    await w.getByRole('link', { name: /Inbox/ }).click();
    const ratings = ['2', '5'];
    for (let i = 0; i < ratings.length; i++) {
      const newItems = w.getByRole('button', { name: /Mood check/ }).filter({ hasText: 'New' });
      await expect(newItems).toHaveCount(ratings.length - i);
      await newItems.first().click();
      // Rating questions answer on a slider now (not number buttons).
      await w.getByRole('slider', { name: 'How connected do you feel?' }).fill(ratings[i] ?? '3');
      await w.getByRole('button', { name: 'Submit', exact: true }).click();
    }

    // Results: both sends + a Trends chart for the rating question.
    await w.getByRole('link', { name: 'Questionnaires' }).click();
    await w.getByRole('button', { name: /^Mood check/ }).click();
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

    // Delete the whole questionnaire from the list row (it's SENT → locked, so no Edit-tab delete). Go
    // back to the list first — the detail view hides it.
    await w.getByRole('button', { name: 'Questionnaires' }).first().click();
    await w.getByRole('button', { name: /Options for Mood check/ }).click();
    await w.getByRole('menuitem', { name: 'Delete' }).click();
    await w.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(w.getByRole('button', { name: /^Mood check/ })).toHaveCount(0);
    await expect(w.getByText(/no questionnaires yet/i)).toBeVisible();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('lifecycle (§17.14/§16.3/§3.9): draft-save, send shows a Sent badge + drain affordance, list-row delete', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();

    // Connect a relay so a household send ALSO mints a link → Results surfaces the drain affordance (§17.13).
    await w.getByRole('link', { name: 'Settings' }).click();
    await w.getByRole('button', { name: 'Relay' }).click();
    await w.getByLabel(/cloudflare account id/i).fill('acct-123');
    await w.getByLabel(/cloudflare api token/i).fill('cf-token');
    await w.getByRole('button', { name: /connect & deploy/i }).click();
    await expect(w.getByText(/relay connected at/i)).toBeVisible();

    // #2 — save a draft with ONLY a title (no question yet); "Create draft" is enabled and it persists.
    await w.getByRole('link', { name: 'Questionnaires' }).click();
    await startNewQuestionnaire(w);
    await w.getByLabel('Title').fill('Pulse check');
    await w.getByRole('button', { name: 'Create draft' }).click();
    // Saved → Send now appears (the two-step), and it's still a draft we can keep editing.
    await expect(w.getByRole('button', { name: 'Send' })).toBeVisible();

    // Flesh it out + re-save, then send to the bound household recipient (Standard).
    await w.getByLabel('Question 1', { exact: true }).fill('How are we doing?');
    await w.getByRole('button', { name: 'Save', exact: true }).click();
    await w.getByRole('button', { name: 'Send' }).click();
    await w.getByRole('button', { name: 'Standard' }).click();
    await w.getByRole('button', { name: 'Send' }).last().click();
    await w.getByRole('button', { name: 'Done' }).click();

    // #4 — back at the list, the row now shows a "Sent · <date>" chip (distinct from a draft).
    await expect(w.getByText(/Sent/).first()).toBeVisible();

    // #3 — open it → Results surfaces the "Check for responses" drain button for the household relay link
    // (the bug: it was gated on channel === 'relay', hiding the link for household sends).
    await w.getByRole('button', { name: /^Pulse check/ }).click();
    // The builder header repeats the sent state.
    await expect(w.getByText(/For:/)).toContainText(/Sent/);
    await w.getByRole('button', { name: 'Results' }).click();
    await expect(w.getByRole('button', { name: /check for responses/i })).toBeVisible();

    // #1 — delete from the list row (kebab → Delete → confirm) → the questionnaire is gone.
    await w.getByRole('button', { name: 'Questionnaires' }).first().click(); // back affordance
    await w.getByRole('button', { name: /Options for Pulse check/ }).click();
    await w.getByRole('menuitem', { name: 'Delete' }).click();
    await w.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(w.getByRole('button', { name: /^Pulse check/ })).toHaveCount(0);
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

test('compatibility household (§17.14a): the send mints the recipient a link + delivery; Results drains + resends', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  // Seed a household partner so the compat "Compare you with" picker has someone to choose.
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('expected a master key');
  await savePerson(fs, key, {
    id: 'angel-1',
    schemaVersion: 1,
    displayName: 'Angel',
    isSubject: true,
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();

    // Connect a relay so the household compat recipient ALSO gets a shareable link (§17.14a).
    await w.getByRole('link', { name: 'Settings' }).click();
    await w.getByRole('button', { name: 'Relay' }).click();
    await w.getByLabel(/cloudflare account id/i).fill('acct');
    await w.getByLabel(/cloudflare api token/i).fill('cf');
    await w.getByRole('button', { name: /connect & deploy/i }).click();
    await expect(w.getByText(/relay connected at/i)).toBeVisible();

    // Author a compatibility questionnaire (you + Angel) and send it.
    await w.getByRole('link', { name: 'Questionnaires' }).click();
    await startNewQuestionnaire(w, { compat: true });
    await w.getByLabel('Title').fill('Closeness');
    await w.getByLabel('Question 1', { exact: true }).fill('How connected do you feel?');
    await w.getByRole('button', { name: 'Create draft' }).click();
    await w.getByRole('button', { name: 'Send' }).click();

    // The focused send step REPLACES the editor (no lingering footer). Click the panel's Send → the
    // recipient's link + the prefilled email/SMS delivery appear (the bug: a household compat send showed
    // no link at all). The fake Claude personalizes the variants; the fake relay mints the link.
    await w
      .getByRole('button', { name: /^Send$/ })
      .last()
      .click();
    const link = await w.getByLabel('Secure link').inputValue();
    expect(link).toMatch(/\.workers\.dev\/q\/[0-9a-f]+#k=/);
    expect(await w.getByLabel('PIN', { exact: true }).inputValue()).toMatch(/^\d{6}$/);
    await expect(w.getByRole('button', { name: /^Email$/ })).toBeVisible();
    await expect(w.getByRole('button', { name: /^Text$/ })).toBeVisible();
    await w.getByRole('button', { name: 'Done' }).click();

    // Back at the list, it reads "Sent". Open it → Results offers drain + a per-recipient "Resend" link.
    await expect(w.getByText(/Sent/).first()).toBeVisible();
    await w.getByRole('button', { name: /^Closeness/ }).click();
    await w.getByRole('button', { name: 'Results' }).click();
    await expect(w.getByRole('button', { name: /check for responses/i })).toBeVisible();
    await expect(w.getByRole('button', { name: /Resend Angel’s link/ })).toBeVisible();

    // The relay assignment landed with relay material (the recipient's variant is link-answerable).
    const assignments = await listAssignments(fs, key);
    expect(assignments.some((a) => a.compatibilityGroupId && a.relay?.token)).toBe(true);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

// §17.14a delivery matrix: every send type/recipient that can carry a link must show the SAME delivery UI
// (link + PIN + Email + Text + Copy). Asserting one path with a relay connected once masked the others.
test('delivery matrix (§17.14a): one-person household + external both show link + Email/Text', async () => {
  const { userData, vault } = await seedReadyVault();
  // A household partner so a one-person household send has a real recipient.
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('expected a master key');
  await savePerson(fs, key, {
    id: 'mara-1',
    schemaVersion: 1,
    displayName: 'Mara',
    isSubject: true,
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    // Connect the relay.
    await w.getByRole('link', { name: 'Settings' }).click();
    await w.getByRole('button', { name: 'Relay' }).click();
    await w.getByLabel(/cloudflare account id/i).fill('acct');
    await w.getByLabel(/cloudflare api token/i).fill('cf');
    await w.getByRole('button', { name: /connect & deploy/i }).click();
    await expect(w.getByText(/relay connected at/i)).toBeVisible();

    const assertDelivery = async (): Promise<void> => {
      expect(await w.getByLabel('Secure link').inputValue()).toMatch(/\.workers\.dev\/q\//);
      expect(await w.getByLabel('PIN', { exact: true }).inputValue()).toMatch(/^\d{6}$/);
      await expect(w.getByRole('button', { name: /^Email$/ })).toBeVisible();
      await expect(w.getByRole('button', { name: /^Text$/ })).toBeVisible();
      await expect(w.getByRole('button', { name: /copy message/i })).toBeVisible();
    };

    // (1) ONE-PERSON HOUSEHOLD: a relay is connected, so the in-app send also mints a link + delivery.
    await w.getByRole('link', { name: 'Questionnaires' }).click();
    await startNewQuestionnaire(w); // recipient index 1 = the household partner
    await w.getByLabel('Title').fill('Household check');
    await w.getByLabel('Question 1', { exact: true }).fill('How are we doing?');
    await w.getByRole('button', { name: 'Create draft' }).click();
    await w.getByRole('button', { name: 'Send' }).click();
    await w.getByRole('button', { name: 'Standard' }).click();
    await w.getByRole('button', { name: 'Send' }).last().click();
    await assertDelivery();
    await w.getByRole('button', { name: 'Done' }).click();

    // (2) ONE-PERSON EXTERNAL: a private link send shows the same delivery.
    await w.getByRole('button', { name: 'New' }).click();
    await w.getByLabel('Recipient').selectOption('external');
    await w.getByLabel('Their name').fill('Sam');
    await w.getByRole('button', { name: 'Continue' }).click();
    await w.getByLabel('Title').fill('Outside view');
    await w.getByLabel('Question 1', { exact: true }).fill('How do I come across?');
    await w.getByRole('button', { name: 'Create draft' }).click();
    await w.getByRole('button', { name: 'Send' }).click();
    await expect(w.getByRole('heading', { name: /Send to Sam/i })).toBeVisible();
    await w.getByRole('button', { name: /create link/i }).click();
    await assertDelivery();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('delivery matrix (§17.14a): no relay → a household send shows the connect-a-relay hint, no link', async () => {
  const { userData, vault } = await seedReadyVault();
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('expected a master key');
  await savePerson(fs, key, {
    id: 'mara-1',
    schemaVersion: 1,
    displayName: 'Mara',
    isSubject: true,
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    // NO relay connected — a household send is Inbox-only, but the panel must SAY a link needs a relay
    // (never silently linkless). The hint is actionable, not a dead end.
    await w.getByRole('link', { name: 'Questionnaires' }).click();
    await startNewQuestionnaire(w);
    await w.getByLabel('Title').fill('Quiet check');
    await w.getByLabel('Question 1', { exact: true }).fill('How are we doing?');
    await w.getByRole('button', { name: 'Create draft' }).click();
    await w.getByRole('button', { name: 'Send' }).click();
    await w.getByRole('button', { name: 'Standard' }).click();
    await w.getByRole('button', { name: 'Send' }).last().click();
    // No link is minted, but a clear hint tells the sender how to enable one — and there's no Secure link.
    await expect(w.getByText(/connect a relay in Settings → Relay/i)).toBeVisible();
    await expect(w.getByLabel('Secure link')).toHaveCount(0);
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
    await w.getByRole('button', { name: /^Compatibility check/ }).click();
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
    await w.getByRole('button', { name: /^Closeness check/ }).click();
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

    // Complete the send → AI (fake) personalizes a variant for each of us, frozen per assignment.
    await w.getByRole('button', { name: 'Send' }).last().click({ noWaitAfter: true });
    await expect(w.getByText(/each get a personalized version/i)).toBeVisible();

    // CONTENT CORRECTNESS (§17.12 — the exact bug the user hit): decrypt the RECIPIENT's frozen variant and
    // assert it asks Angel about TESTER (the sender), NOT about herself. A green "it sent" flow never proved
    // this — the variant perspective has to be checked on the actual content.
    const sends = await listAssignments(fs, key);
    const angelSend = sends.find(
      (a) => a.recipient.kind === 'person' && a.recipient.personId === 'angel-1',
    );
    if (!angelSend) throw new Error('expected a paired send to Angel');
    const snap = await getAssignmentSnapshot(fs, key, angelSend.id);
    expect(snap?.questions[0]?.prompt).toContain('about Tester');
    expect(snap?.questions[0]?.prompt).not.toContain('about Angel');
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

test('intimacy topics (§16.5a): the owner manages custom topics in Settings + AI suggest + an inline builder add, persisted', async () => {
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
    await w.getByLabel('Add an activity').fill('Sploshing');
    await w.getByRole('button', { name: 'Add' }).first().click();
    await expect(w.getByText('Sploshing')).toBeVisible();

    // It persisted to the plain prefs file (no master key needed to read it).
    await expect
      .poll(async () => (await readCustomIntimacyTopics(fs)).activities)
      .toContain('Sploshing');

    // Suggest with AI: the offline fake proposes a set that INCLUDES an existing built-in ('Sensual
    // massage') — which is deduped out of the checklist. Uncheck one fresh suggestion, add the rest.
    await w.getByRole('button', { name: 'Suggest with AI' }).click();
    await expect(w.getByLabel('Include Mutual edging')).toBeVisible();
    await expect(w.getByLabel('Include Temperature contrast play')).toBeVisible();
    await expect(w.getByLabel('Include Sensual massage')).toHaveCount(0); // a built-in → deduped
    await w.getByLabel('Include Temperature contrast play').uncheck();
    await w.getByRole('button', { name: /Add selected/ }).click();
    // The picked suggestions persist (across both kinds); the unchecked one does not.
    await expect
      .poll(async () => (await readCustomIntimacyTopics(fs)).activities)
      .toContain('Mutual edging');
    await expect
      .poll(async () => (await readCustomIntimacyTopics(fs)).fantasies)
      .toContain('Rivals-to-lovers roleplay');
    expect((await readCustomIntimacyTopics(fs)).activities).not.toContain(
      'Temperature contrast play',
    );

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
    // AI is off here → the new-dream composer's only action is "Just save" (12 §15.2).
    await w.getByRole('button', { name: 'Just save' }).click();

    // It appears in the journal.
    await expect(w.getByRole('button', { name: /The rearranging house/ })).toBeVisible();

    // Reopen → the read-first detail (12 §15.3); "Edit dream" reveals the form to check the round-trip.
    await w.getByRole('button', { name: /The rearranging house/ }).click();
    await w.getByRole('button', { name: /edit dream/i }).click();
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

test('dreams: dashboard chrome — insight strip, quick filters, time grouping, no x-scroll at 390px', async () => {
  const { userData, vault } = await seedReadyVault();
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('seed: master key missing');
  const daysAgo = (n: number): string => new Date(Date.now() - n * 86_400_000).toISOString();
  const seed = async (
    id: string,
    title: string,
    extra: Partial<Parameters<typeof saveDream>[2]>,
  ): Promise<void> => {
    await saveDream(fs, key, {
      id,
      schemaVersion: 1,
      personId: 'owner-1',
      title,
      narrative: `${title} narrative.`,
      lucid: false,
      nightmare: false,
      tags: [],
      people: [],
      sensitivity: 'standard',
      status: 'captured',
      createdAt: daysAgo(2),
      updatedAt: daysAgo(2),
      ...extra,
    } as Parameters<typeof saveDream>[2]);
  };
  await seed('nm', 'Storm dream', { nightmare: true, dreamDate: daysAgo(2) });
  await seed('lu', 'Flying dream', { lucid: true, dreamDate: daysAgo(3) });
  await seed('old', 'Old dream', { dreamDate: daysAgo(200) });

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Dreams' }).click();

    // Time-grouping headers (12 §16.2): the two recent dreams under "This week", the old one under "Earlier".
    await expect(w.getByText('This week')).toBeVisible();
    await expect(w.getByText('Earlier')).toBeVisible();

    // The deterministic insight strip (no AI): counts from the seeded dreams + a link to the full view.
    await expect(w.getByText('1 nightmare')).toBeVisible();
    await expect(w.getByRole('button', { name: /see patterns/i })).toBeVisible();

    // Quick filter → Nightmares narrows the grid; the lucid card drops.
    await w.getByRole('button', { name: 'Nightmares' }).click();
    await expect(w.getByRole('button', { name: /Storm dream/ })).toBeVisible();
    await expect(w.getByRole('button', { name: /Flying dream/ })).toHaveCount(0);

    // A filter with no matches shows a calm message, not a blank grid.
    await w.getByRole('button', { name: 'Analyzed' }).click();
    await expect(w.getByText(/no analyzed dreams yet/i)).toBeVisible();
    await w.getByRole('button', { name: 'All' }).click();

    // No horizontal overflow at phone width — including the filter's segmented control (an inner-scroll scan).
    await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.setMinimumSize(360, 480);
        win.setSize(390, 800);
      }
    });
    await w.waitForTimeout(300);
    const innerScrollers = await w.evaluate(
      () =>
        [...document.querySelectorAll<HTMLElement>('*')].filter((el) => {
          const ox = getComputedStyle(el).overflowX;
          return (ox === 'auto' || ox === 'scroll') && el.scrollWidth - el.clientWidth > 1;
        }).length,
    );
    expect(innerScrollers).toBe(0);
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
    await w.getByRole('button', { name: 'Just save' }).click();

    // Reopen the saved dream → the image panel sits on the read-first detail (12 §15.3).
    await w.getByRole('button', { name: /Visualize me/ }).click();

    // Pick an expanded, family-grouped preset (beyond the original four) for this image.
    await w.getByRole('combobox', { name: 'Style' }).selectOption({ label: 'Watercolor' });

    // A non-standard tier warns before sending to OpenAI; Continue proceeds.
    await w.getByRole('button', { name: /visualize this dream/i }).click();
    await expect(w.getByText(/this is a sensitive dream/i)).toBeVisible();
    await w.getByRole('button', { name: 'Continue' }).click();
    await expect(w.getByRole('img')).toBeVisible();

    // The hero image is shown at its NATIVE aspect ratio, never cropped/stretched (12 §16.4): inject a
    // known 2:1 source and assert the rendered box keeps ~2:1 (not squashed to a 16:9 or full-width box).
    const ratio = await w.evaluate(async () => {
      const img = document.querySelector('img') as HTMLImageElement;
      const c = document.createElement('canvas');
      c.width = 800;
      c.height = 400;
      c.getContext('2d')!.fillRect(0, 0, 800, 400);
      img.src = c.toDataURL();
      await img.decode();
      const r = img.getBoundingClientRect();
      return { rendered: r.width / r.height, fit: getComputedStyle(img).objectFit };
    });
    expect(Math.abs(ratio.rendered - 2)).toBeLessThan(0.1);
    expect(ratio.fit).toBe('contain');

    // The generated image reaches the dashboard grid (the store refresh, 12 §16): go back → the card now
    // shows the decrypted image as its background (not the fallback gradient) → reopen into the hero.
    await w.getByRole('button', { name: 'Dreams' }).click();
    const gridCard = w.getByRole('button', { name: /Visualize me/ });
    await expect
      .poll(async () => (await gridCard.getAttribute('style')) ?? '')
      .toContain('data:image');
    await gridCard.click();
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
    await w.getByRole('button', { name: 'Just save' }).click();
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
    // AI is off here → the new-dream composer's only action is "Just save" (12 §15.2).
    await w.getByRole('button', { name: 'Just save' }).click();

    // Reopen → the read-first detail; "Edit dream" reveals the link round-tripped through the vault. The
    // stored personId resolves back to the household name "Sam" (the Remove control's label), a linked chip.
    await w.getByRole('button', { name: /Walking with Sam/ }).click();
    await w.getByRole('button', { name: /edit dream/i }).click();
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

test('dreams: a typed new name offers to be added as a contact + optional relationship (12 §15.6)', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Dreams' }).click();
    await w.getByRole('button', { name: 'Log a dream' }).click();
    await w.getByLabel('What happened?').fill('Sarah appeared and we talked for hours.');
    await w.getByLabel('Title (optional)').fill('Talking with Sarah');

    // Type a NEW name (not an existing household person) → the "add them?" prompt appears.
    await w.getByPlaceholder(/add a name/i).fill('Sarah');
    await w.getByPlaceholder(/add a name/i).press('Enter');
    // force: the prompt sits mid-form and Playwright's pre-click scroll aligns it under the window-spanning
    // sticky titlebar (02 §13) which intercepts the hit-test. The prompt's rendering + actionability are
    // covered by DreamPeopleEditor RTL; here we just drive the persist-to-vault round-trip.
    await w.getByRole('button', { name: /add as contact/i }).click({ force: true });
    // The chip upgrades to linked, and the optional relationship step appears.
    await expect(w.getByText('linked')).toBeVisible();
    await w.getByLabel('Relationship').selectOption({ label: 'Friend' });
    await w.getByRole('button', { name: 'Save', exact: true }).click({ force: true });

    // The new contact + relationship persist household-wide the moment they're created (decrypt the vault) —
    // independent of whether the dream is saved. This is the core of the quick-add feature.
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('master key missing');
    await expect
      .poll(async () => (await listPeople(fs, key)).some((p) => p.displayName === 'Sarah'))
      .toBe(true);
    const sarah = (await listPeople(fs, key)).find((p) => p.displayName === 'Sarah');
    expect(sarah?.isSubject).toBe(false); // added as a contact, never a subject/login
    await expect
      .poll(async () =>
        (await listRelationships(fs, key)).some(
          (r) => r.toPersonId === sarah?.id && r.type === 'friend',
        ),
      )
      .toBe(true);
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
    // AI is on → "Start reflection" saves the dream AND opens the guided session directly (12 §15.3).
    await w.getByRole('button', { name: /start reflection/i }).click();
    await expect(w.getByRole('heading', { name: 'Dream analysis' })).toBeVisible();
    // The coach OPENS the reflection itself (12 §15.4) — its first message streams in, no blank chat.
    await expect(w.getByText(/hear you/i).first()).toBeVisible();

    // A guided turn streams the reflective reply.
    await w.getByLabel('Message').fill('It felt unsettling but oddly familiar.');
    await w.getByRole('button', { name: 'Send' }).click();
    await expect(w.getByText('It felt unsettling but oddly familiar.')).toBeVisible();

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
    // The header "Patterns" button (exact — the dashboard insight strip also has a "See patterns" link).
    await w.getByRole('button', { name: 'Patterns', exact: true }).click();
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
    // "Start reflection" saves + opens the guided session; the coach opens first (12 §15.3/§15.4).
    await w.getByRole('button', { name: /start reflection/i }).click();
    await expect(w.getByText(/hear you/i).first()).toBeVisible();
    await w.getByRole('button', { name: 'Create analysis' }).click();
    await expect(w.getByRole('heading', { name: 'Your dream analysis' })).toBeVisible();
    await w.getByRole('button', { name: /add to my coaching context/i }).click();
    await expect(w.getByText(/in your coaching context/i)).toBeVisible();

    // The share controls appear; share the first fact with Partner via its per-person toggle chip.
    await expect(w.getByText('Share with people in your life')).toBeVisible();
    await w.getByRole('button', { name: 'Partner', pressed: false }).first().click();

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

test('relationship-scoped sharing: a partner-scoped fact reaches the partner, not the sibling (42 §10)', async () => {
  // The headline privacy guard — decrypt the assembled context so it can't silently regress.
  const { userData, vault } = await seedReadyVault();
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('seed: master key missing');
  const at = new Date().toISOString();

  // owner-1 (Alex) is Bri's PARTNER and Cory's SIBLING.
  for (const [id, displayName] of [
    ['bri', 'Bri'],
    ['cory', 'Cory'],
  ] as const) {
    await savePerson(fs, key, {
      id,
      schemaVersion: 1,
      displayName,
      isSubject: true,
      tags: [],
      createdAt: at,
      updatedAt: at,
    });
  }
  await saveRelationship(fs, key, {
    id: 'ab',
    schemaVersion: 1,
    fromPersonId: 'owner-1',
    toPersonId: 'bri',
    type: 'partner',
    createdAt: at,
    updatedAt: at,
  });
  await saveRelationship(fs, key, {
    id: 'ac',
    schemaVersion: 1,
    fromPersonId: 'owner-1',
    toPersonId: 'cory',
    type: 'sibling',
    createdAt: at,
    updatedAt: at,
  });
  // Alex owns a fact scoped to PARTNER only.
  await saveInsight(fs, key, {
    id: 'i1',
    schemaVersion: 1,
    source: 'session',
    subjectPersonId: 'owner-1',
    summary: 'A theme',
    facts: [
      {
        id: 'f1',
        text: 'Alex wants to feel closer at home',
        shareable: false,
        shareableTypes: ['partner'],
      },
    ],
    confidence: 'medium',
    categories: [],
    approved: true,
    provenance: { at },
    createdAt: at,
    updatedAt: at,
  });

  // The partner's session context HAS it, wrapped under the confidentiality preamble ("shared ≠ shown").
  const partnerCtx = await buildContext(fs, key, 'bri');
  expect(partnerCtx).toContain('Alex wants to feel closer at home');
  expect(partnerCtx).toContain('Treat them as private background');
  expect(partnerCtx).toContain('never quote them');

  // The sibling's context does NOT — wrong relationship type → excluded, and no preamble at all.
  const siblingCtx = await buildContext(fs, key, 'cory');
  expect(siblingCtx).not.toContain('Alex wants to feel closer at home');
  expect(siblingCtx).not.toContain('Treat them as private background');

  // Remove the partner edge → the fact disappears from the partner's context at once (read-time re-gate).
  await fs.remove('relationships/ab.enc');
  const afterRemoval = await buildContext(fs, key, 'bri');
  expect(afterRemoval).not.toContain('Alex wants to feel closer at home');

  await rm(userData, { recursive: true, force: true });
  await rm(vault, { recursive: true, force: true });
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
    // Anchor to the version line (`v0.4.0 · sha · date`) so it doesn't also match the "Check for updates"
    // result line ("You’re up to date (v0.4.0).") — the app version, not Electron's.
    await expect(w.getByText(new RegExp(`^v${pkg.version.replace(/\./g, '\\.')}`))).toBeVisible();
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
        ring: rect('button[aria-label*="AI usage"]'),
        appearance: rect('button[aria-label^="Appearance"]'),
        account: rect('button[aria-label^="Signed in as"]'),
      };
    });
    const items = [geo.ring, geo.appearance, geo.account];
    for (const item of items) expect(item).not.toBeNull();
    const tops = items.map((i) => i?.top ?? -1);
    const heights = items.map((i) => i?.height ?? -1);
    // The right cluster (usage · appearance · account) shares a top edge + height (≤1px tolerance) — they all
    // render through the one TitlebarControl primitive. (Sync status moved out of the titlebar to a boot-level
    // SyncWarning in the 25-29 group, so it's no longer part of this cluster.)
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

test('home: the onboarding card shows in-progress stats and fits at 390px (17 §13)', async () => {
  const { userData, vault, fs, key } = await seedHomeVault();
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  // The owner is exempt from the onboarding gate, so an in-progress intake renders the Home card with stats.
  await writeEncryptedJson(
    fs,
    'people/owner-1/intake/session.enc',
    {
      id: 'intake-ip',
      schemaVersion: 1,
      personId: 'owner-1',
      status: 'inProgress',
      sections: [
        // basics: a form section, started + one answer; life-now: skipped (its questions don't count as remaining).
        {
          id: 'basics',
          status: 'complete',
          restricted: false,
          messages: [],
          answers: { occupation: 'nurse' },
        },
        { id: 'life-now', status: 'skipped', restricted: false, messages: [], answers: {} },
      ],
      startedAt: 'now',
      updatedAt: twoDaysAgo,
    },
    key,
  );
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await expect(w.getByRole('heading', { name: /finish getting to know selfos/i })).toBeVisible();
    await expect(w.getByText(/of \d+ answered/)).toBeVisible();
    await expect(w.getByText(/2 of \d+ done/)).toBeVisible(); // basics complete + life-now skipped
    // The "last updated" line renders (its exact relative value is unit-tested in OnboardingCard.test).
    await expect(w.getByText('Last updated', { exact: true })).toBeVisible();
    await expect(w.getByRole('button', { name: /continue onboarding/i })).toBeVisible();

    // 390px: the stat row wraps, no horizontal overflow anywhere.
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
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('home: the onboarding card nudges for a review when the portrait is stale (17 §13)', async () => {
  const { userData, vault, fs, key } = await seedHomeVault();
  // A complete intake whose answers have changed since the portrait snapshot → "due for a review" (no clock).
  await writeEncryptedJson(
    fs,
    'people/owner-1/intake/session.enc',
    {
      id: 'intake-done',
      schemaVersion: 1,
      personId: 'owner-1',
      status: 'complete',
      sections: [
        {
          id: 'basics',
          status: 'complete',
          restricted: false,
          messages: [],
          answers: { occupation: 'nurse' },
        },
      ],
      portraitAnswerSig: {}, // a portrait exists, but an answer is present that wasn't snapshotted → stale
      startedAt: 'now',
      updatedAt: 'now',
      completedAt: 'now',
    },
    key,
  );
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await expect(w.getByRole('heading', { name: /quick profile review/i })).toBeVisible();
    await expect(w.getByText('Changed since portrait')).toBeVisible();
    await expect(w.getByRole('button', { name: /refresh my portrait/i })).toBeVisible();
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
          // basics fills a field; family exercises the parent-figures roster; story checks the removed
          // chapters/happiest questions are gone; intimacy is the 18+ gate. The rest stay skipped.
          status: ['basics', 'family', 'story', 'intimacy'].includes(id) ? 'notStarted' : 'skipped',
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
    await w.getByLabel('What do you do for work?', { exact: true }).fill('nurse');
    await w
      .getByLabel('How would you describe your appearance?', { exact: true })
      .fill('tall, curly hair');
    // Gender is a basics identity field (it no longer drives the intimacy matrix — anatomy does, 46).
    await w.getByRole('radio', { name: 'Man', exact: true }).click();
    // Ethnicity is now a multi-select (pick one or more) → joined into the string `ethnicity` field.
    // Multi options render as role="checkbox" cards; `exact` avoids "East Asian" matching "Southeast Asian".
    await w.getByRole('checkbox', { name: 'East Asian', exact: true }).click();
    await w.getByRole('checkbox', { name: 'Mixed / Multiple', exact: true }).click();
    // A structured label+date entry (the new dateList control) → Person.importantDates.
    await w.getByRole('button', { name: '+ Add a date' }).click();
    await w.getByLabel('Any dates you’d like me to remember? — label 1').fill('Anniversary');
    await w.getByLabel('Any dates you’d like me to remember? — date 1').fill('2014-06-21');
    // Layout guard for the dateRow: the label input must FILL the row (it flexes), the date input is
    // content-sized, and nothing overflows the card. The regression collapsed the label to ~0 and pushed
    // the remove button outside the card — caught here by label-wider-than-date + no page overflow.
    const dateLabelBox = await w
      .getByLabel('Any dates you’d like me to remember? — label 1')
      .boundingBox();
    const dateInputBox = await w
      .getByLabel('Any dates you’d like me to remember? — date 1')
      .boundingBox();
    expect(dateLabelBox!.width).toBeGreaterThan(dateInputBox!.width);
    await expect(w.getByRole('button', { name: /Remove Anniversary/ })).toBeVisible();
    const dateRowOverflow = await w.evaluate(() => {
      const main = document.querySelector('main');
      return main ? main.scrollWidth - main.clientWidth : 0;
    });
    expect(dateRowOverflow).toBeLessThanOrEqual(1);
    await w.getByRole('button', { name: /Continue/ }).click();

    // Core done → the invited grid offers the deeper sections. Open Family & roots and add a parent-figures
    // roster row (portrait/context only, like the kids/pets rosters) — relation/status + the two date columns.
    await w.getByRole('button', { name: /Family & roots/ }).click();
    await expect(w.getByRole('heading', { name: 'Family & roots' })).toBeVisible();
    await w.getByRole('button', { name: '+ Add', exact: true }).click();
    await w.getByLabel(/— Relation 1$/).selectOption('Mother');
    await w.getByLabel(/— Status 1$/).selectOption('Passed away');
    await w.getByLabel(/— Birthday 1$/).fill('1955-03-10');
    // The "Date they passed" column is always shown (the roster has no per-column conditional visibility),
    // labelled "(if applicable)" so a living parent's row leaves it blank.
    await w.getByLabel(/— Date they passed \(if applicable\) 1$/).fill('2020-08-01');
    await w.getByRole('button', { name: /Continue/ }).click();

    // Open Your story → the two removed prompts (chapters / happiest) are gone.
    await w.getByRole('button', { name: /Your story/ }).click();
    await expect(w.getByRole('heading', { name: 'Your story' })).toBeVisible();
    await expect(
      w.getByText('If your life so far were a few chapters, what would they be?'),
    ).toHaveCount(0);
    await expect(w.getByText('Your happiest chapter so far')).toHaveCount(0);
    await w.getByRole('button', { name: /Continue/ }).click();

    // Opening intimacy shows the shared 18+ gate.
    await w.getByRole('button', { name: /Intimacy & sexuality/ }).click();
    await expect(w.getByRole('button', { name: /18 or older/ })).toBeVisible();
    // Acknowledge 18+ → the rebalanced intimacy form renders. The core (e.g. orientation) shows immediately;
    // the explicit specifics — incl. the 5-point activity MATRIX (Hard no · Not interested · Curious · Like it ·
    // Love it) — sit behind the opt-in "get specific?" toggle (27 §4.2/§4.3). Pick "Who are you drawn to?" so the
    // matrix's oral rows tailor to the person (a straight man), toggle the gate, fill a row, then Continue so
    // the matrix answer actually persists.
    await w.getByRole('button', { name: /18 or older/ }).click();
    await expect(w.getByText('Who are you drawn to?')).toBeVisible(); // a core, always-visible question
    // The two removed always-visible intimacy questions (afterCare, the free-text boundaries) are gone.
    await expect(w.getByText('After intense or vulnerable sex, what do you need?')).toHaveCount(0);
    await expect(
      w.getByText('Consent, safety, or boundaries SelfOS should always hold'),
    ).toHaveCount(0);
    await expect(w.getByRole('radio', { name: 'Love it' })).toHaveCount(0); // matrix gated by default
    // drawnTo is captured as coaching context (no longer drives the matrix, 46).
    await w.getByRole('checkbox', { name: 'Women', exact: true }).click();
    await w
      .getByRole('radiogroup', { name: /Want to get into the explicit specifics/ })
      .getByRole('radio', { name: 'Yes' })
      .click();
    // The anatomy questions use the updated, clearer wording (2026-06-26).
    await expect(w.getByText('Which of the following do you have?')).toBeVisible();
    await expect(w.getByText('What do you like your partner(s) to have?')).toBeVisible();
    // 46: the oral rows are driven by the DIRECT anatomy questions, not gender/orientation. Answer own + partner
    // anatomy → the matrix resolves the receiving + giving-oral labels for THIS anatomy.
    await w.getByRole('radio', { name: 'Cock (penis)', exact: true }).click(); // own anatomy → receiving label
    await w.getByRole('checkbox', { name: 'Pussy (vulva)', exact: true }).click(); // partner → giving label
    // The 5-point labelled matrix renders, tailored by anatomy: cunnilingus-giving + receiving-blowjob, never
    // the blowjob-giving variant (no partner has a penis) — the GitHub #62 wrong row is gone (46).
    await expect(w.getByRole('radio', { name: 'Love it' }).first()).toBeVisible();
    await expect(w.getByRole('radiogroup', { name: /Receiving oral \(blowjob\)/ })).toBeVisible();
    await expect(w.getByRole('radiogroup', { name: /Going down on her/ })).toBeVisible();
    await expect(w.getByRole('radiogroup', { name: /Giving a blowjob/ })).toHaveCount(0);
    // 49: the (now ~90-row) matrix renders GROUPED by category, sensual→extreme, every group OPEN by default —
    // category headers above their rows, and the FULL surface renders to the bottom (no collapsed accordion).
    await expect(w.getByRole('heading', { name: 'Sensual & sensory' })).toBeVisible();
    await expect(w.getByRole('heading', { name: 'Oral' })).toBeVisible();
    await expect(w.getByRole('heading', { name: 'Taboo fantasy' })).toBeVisible();
    // A row from the FIRST and the LAST category are both present — nothing hidden in a default-collapsed
    // <details> (the CLAUDE.md §7/§12 collapsed-accordion bug class).
    await expect(w.getByRole('radiogroup', { name: /Sensual massage/ })).toBeVisible();
    await expect(w.getByRole('radiogroup', { name: /Pet play/ })).toBeVisible();
    // A 2026-06-26 inventory addition renders as a matrix row in its category (sensual).
    await expect(w.getByRole('radiogroup', { name: /Watch partner masturbate/ })).toBeVisible();
    expect(await w.locator('details:not([open])').count()).toBe(0);
    // The 5-point matrix must wrap cleanly at phone width — no horizontal scroll on the page or any inner
    // control (the .scale row wraps the five labelled points). Check WHILE the long grouped matrix is on screen,
    // at BOTH 390px and the narrower ~360px (49 §7/§9/§10).
    const matrixOverflow = () =>
      w.evaluate(() => {
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
    for (const width of [390, 360]) {
      await w.setViewportSize({ width, height: 780 });
      const guard = await matrixOverflow();
      expect(guard.offenders, `overflow at ${width}px`).toEqual([]);
      expect(guard.mainOverflow, `main overflow at ${width}px`).toBeLessThanOrEqual(1);
    }
    await w.setViewportSize({ width: 1280, height: 800 });
    // Rate the gender-aware giving-oral row "Love it" (point 5) — it must persist through the submit.
    await w
      .getByRole('radiogroup', { name: /Going down on her/ })
      .getByRole('radio', { name: 'Love it' })
      .click();
    // Porn follow-ups (each with an "Other" write-in) reveal only when watchPorn ≠ Never. The genre list is
    // NOT orientation-filtered — people watch across categories.
    await expect(w.getByText('What kind of porn are you into?')).toHaveCount(0); // hidden until set
    await w
      .getByRole('radiogroup', { name: /Do you watch porn\?/ })
      .getByRole('radio', { name: 'Sometimes', exact: true })
      .click();
    await expect(w.getByText('What kind of porn are you into?')).toBeVisible();
    await expect(w.getByText('When do you like to watch it?')).toBeVisible();
    await w.getByRole('checkbox', { name: 'Amateur', exact: true }).click();
    await w.getByRole('checkbox', { name: 'Alone', exact: true }).click();
    await w.getByRole('button', { name: /Continue/ }).click();

    // Generate the portrait → a confirm modal (encourages adding more) → it releases the gate (§14.2/§15)
    // and feeds the person's own context.
    await w.getByRole('button', { name: /See my portrait/ }).click();
    await w.getByRole('button', { name: 'Generate my portrait' }).click();
    await expect(w.getByText(/come to understand about you/)).toBeVisible();
    // The portrait renders as Markdown (34): the fake portrait's bold + list become real <strong>/<li>,
    // not literal `**` — the structured-not-blob acceptance for the flagged onboarding surface (§3.2).
    await expect(w.locator('main li', { hasText: 'honesty' }).first()).toBeVisible();
    await expect(w.locator('main strong', { hasText: 'honesty' }).first()).toBeVisible();
    await expect(w.getByText('**honesty**')).toHaveCount(0);

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
    expect(filled?.ethnicity).toContain('East Asian'); // multi-select → joined string
    expect(filled?.ethnicity).toContain('Mixed / Multiple');
    expect(filled?.importantDates).toEqual([{ label: 'Anniversary', date: '2014-06-21' }]); // dateList
    // The intimacy activity matrix persists, keyed by the STABLE row key (46 §4.2) — NOT the display label —
    // so a later anatomy/gender/orientation edit can never orphan it. The rated giving-oral row resolves to
    // the anatomy-independent `oral-giving-vulva`, and the direct anatomy answers persist as coaching context.
    const intimacyAnswers = (await getIntakeSession(fs, key, 'owner-1'))?.sections.find(
      (s) => s.id === 'intimacy',
    )?.answers;
    expect(intimacyAnswers?.drawnTo).toEqual(['Women']);
    expect(intimacyAnswers?.ownAnatomy).toBe('Cock (penis)');
    expect(intimacyAnswers?.partnerAnatomy).toEqual(['Pussy (vulva)']);
    expect(intimacyAnswers?.activities).toEqual({ 'oral-giving-vulva': 5 });
    // The porn follow-ups persisted (revealed by watchPorn = Sometimes).
    expect(intimacyAnswers?.watchPorn).toBe('Sometimes');
    expect(intimacyAnswers?.pornGenres).toEqual(['Amateur']);
    expect(intimacyAnswers?.pornWhen).toEqual(['Alone']);
    // The parent-figures roster persisted under the family section (portrait/context only — no Person field).
    const familyAnswers = (await getIntakeSession(fs, key, 'owner-1'))?.sections.find(
      (s) => s.id === 'family',
    )?.answers;
    expect(familyAnswers?.parentFigures).toEqual([
      { relation: 'Mother', status: 'Passed away', birthday: '1955-03-10', passedOn: '2020-08-01' },
    ]);
    const context = await buildContext(fs, key, 'owner-1');
    expect(context).toContain('thoughtful and steady'); // the portrait summary feeds own context
    expect(context).toContain('grief'); // a restricted fact still feeds the person's OWN coaching

    // The Owner is the full-access role → sees both the portrait summary AND the restricted ('grief')
    // fact directly in Memory, marked "private" (own-coaching-only; a member would get it redacted, §8.4).
    await w.getByRole('link', { name: 'Memory' }).click();
    await expect(w.getByText(/thoughtful and steady/)).toBeVisible();
    await expect(w.getByText(/Carries grief/)).toBeVisible();
    await expect(w.getByText('private').first()).toBeVisible();

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

test('onboarding per-question sharing: scope a section to Partner → fact reaches partner not sibling; editing auto-saves (43 + auto-save fix)', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  // Seed a partner B + a sibling C of the owner, and an in-progress intake with only `basics` to do.
  {
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('sharing e2e: master key missing');
    const now = new Date().toISOString();
    for (const [id, name] of [
      ['partner-b', 'Bee'],
      ['sibling-c', 'Cee'],
    ] as const) {
      await savePerson(fs, key, {
        id,
        schemaVersion: 1,
        displayName: name,
        isSubject: true,
        tags: [],
        createdAt: now,
        updatedAt: now,
      });
    }
    // edge.type = "to is from's ___": B is the owner's partner; C is the owner's sibling.
    await saveRelationship(fs, key, {
      id: 'rel-b',
      schemaVersion: 1,
      fromPersonId: 'owner-1',
      toPersonId: 'partner-b',
      type: 'partner',
      createdAt: now,
      updatedAt: now,
    });
    await saveRelationship(fs, key, {
      id: 'rel-c',
      schemaVersion: 1,
      fromPersonId: 'owner-1',
      toPersonId: 'sibling-c',
      type: 'sibling',
      createdAt: now,
      updatedAt: now,
    });
    await writeEncryptedJson(
      fs,
      'people/owner-1/intake/session.enc',
      {
        id: 'intake-sharing',
        schemaVersion: 1,
        personId: 'owner-1',
        status: 'inProgress',
        sections: [
          { id: 'basics', status: 'notStarted', restricted: false, messages: [], answers: {} },
          { id: 'life-now', status: 'skipped', restricted: false, messages: [], answers: {} },
          { id: 'values', status: 'skipped', restricted: false, messages: [], answers: {} },
          { id: 'want', status: 'skipped', restricted: false, messages: [], answers: {} },
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
    await w.getByRole('link', { name: 'Home' }).waitFor();
    await w.getByRole('link', { name: 'Home' }).click();
    await w.getByRole('button', { name: /Start onboarding|Continue onboarding/ }).click();

    await expect(w.getByRole('heading', { name: 'The basics' })).toBeVisible();
    // The honest "shared ≠ shown" explainer + per-question sharing chips are present (43 §3.1/§3.3).
    await expect(w.getByText(/inform their AI coaching/i)).toBeVisible();
    // The chip's accessible name starts with the prompt, so target the textbox role explicitly (avoid the
    // getByLabel substring collision with the chip button).
    await w.getByRole('textbox', { name: 'What do you do for work?' }).fill('nurse');

    // Use the per-SECTION bulk control to scope the whole basics section to Partner ONLY: open it, clear to
    // Private, then check Partner. (The picker only offers Partner + Sibling — the types in the owner's graph.)
    await w.getByRole('button', { name: /this whole section/i }).click();
    await w.getByRole('button', { name: 'Private (only me)' }).click();
    await w.getByRole('checkbox', { name: 'Partner' }).click();
    await w.keyboard.press('Escape'); // close the popover
    // The occupation chip now reads "shared with Partner".
    await expect(
      w.getByRole('button', { name: /What do you do for work\?: shared with Partner/i }),
    ).toBeVisible();

    // No horizontal overflow (page or inner controls) at phone width while the sharing chips render (43 §9).
    await w.setViewportSize({ width: 390, height: 800 });
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
    await w.setViewportSize({ width: 1280, height: 800 });

    await w.getByRole('button', { name: /Continue/ }).click();
    // basics was the only pending core section → generate the portrait.
    await w.getByRole('button', { name: /See my portrait/ }).click();
    await w.getByRole('button', { name: 'Generate my portrait' }).click();
    await expect(w.getByText(/come to understand about you/)).toBeVisible();

    // Decrypt: the basics answer carries the Partner scope, and the derived 'nurse' fact is type-scoped to
    // partner (never broadcast) while the restricted 'grief' fact stays own-only.
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('sharing e2e: master key missing');
    await expect
      .poll(async () => (await getIntakeSession(fs, key, 'owner-1'))?.status)
      .toBe('complete');
    const basics = (await getIntakeSession(fs, key, 'owner-1'))?.sections.find(
      (s) => s.id === 'basics',
    );
    expect(basics?.answerSharing?.occupation).toEqual(['partner']);
    const insightId = (await getIntakeSession(fs, key, 'owner-1'))?.insightId;
    if (!insightId) throw new Error('sharing e2e: portrait insight missing');
    const insight = await getInsight(fs, key, 'owner-1', insightId);
    const nurseFact = insight?.facts.find((f) => f.text.includes('nurse'));
    expect(nurseFact?.shareable).toBe(false);
    expect(nurseFact?.shareableTypes).toEqual(['partner']);

    // The partner B sees the shared intake FACT ("Works as a nurse") in a cross-shared block behind the
    // confidentiality preamble; the sibling C gets NO cross-shared block at all (the preamble only appears
    // when something crosses). Neither sees the restricted 'grief' fact (42 §3.4 / 43 §8). NB: the promoted
    // `occupation` PROFILE field is shared to all related people by spec 15 independently — so the spec-43
    // signal is the FACT text + the preamble, not the bare word "nurse".
    const partnerCtx = await buildContext(fs, key, 'partner-b');
    expect(partnerCtx).toContain('Works as a nurse');
    expect(partnerCtx).toContain('shared by people related to');
    expect(partnerCtx).not.toContain('grief');
    const siblingCtx = await buildContext(fs, key, 'sibling-c');
    expect(siblingCtx).not.toContain('Works as a nurse');
    expect(siblingCtx).not.toContain('shared by people related to');
    expect(siblingCtx).not.toContain('grief');

    // Auto-save on edit (the reported bug fix): re-open the now-COMPLETE basics section and widen its sharing
    // to also include Sibling. With NO "Save" click, the change must persist — a completed section auto-saves.
    await w
      .getByRole('button', { name: /The basics/i })
      .first()
      .click();
    await expect(w.getByRole('button', { name: 'Done' })).toBeVisible(); // complete → auto-saving, "Done" not "Save"
    await w.getByRole('button', { name: /this whole section/i }).click();
    await w.getByRole('checkbox', { name: 'Sibling' }).click(); // Partner is already on; add Sibling
    await w.keyboard.press('Escape');
    // No Save/Done click — the auto-save persists the widened scope to the vault within the debounce window.
    await expect
      .poll(
        async () =>
          (await getIntakeSession(fs, key, 'owner-1'))?.sections.find((s) => s.id === 'basics')
            ?.answerSharing?.occupation ?? [],
        { timeout: 4000 },
      )
      .toContain('sibling');
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('onboarding: a FIRST-TIME section auto-saves answers + sharing on select, before any Continue (the real reported bug)', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('autosave e2e: master key missing');
  // A partner so the sharing picker offers a type, + an intake with `basics` NOT started (first-time).
  {
    const now = new Date().toISOString();
    await savePerson(fs, key, {
      id: 'partner-b',
      schemaVersion: 1,
      displayName: 'Bee',
      isSubject: true,
      tags: [],
      createdAt: now,
      updatedAt: now,
    });
    await saveRelationship(fs, key, {
      id: 'rel-b',
      schemaVersion: 1,
      fromPersonId: 'owner-1',
      toPersonId: 'partner-b',
      type: 'partner',
      createdAt: now,
      updatedAt: now,
    });
    await writeEncryptedJson(
      fs,
      'people/owner-1/intake/session.enc',
      {
        id: 'intake-autosave',
        schemaVersion: 1,
        personId: 'owner-1',
        status: 'inProgress',
        sections: [
          { id: 'basics', status: 'notStarted', restricted: false, messages: [], answers: {} },
          { id: 'life-now', status: 'skipped', restricted: false, messages: [], answers: {} },
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
    await w.getByRole('link', { name: 'Home' }).click();
    await w.getByRole('button', { name: /Start onboarding|Continue onboarding/ }).click();
    await expect(w.getByRole('heading', { name: 'The basics' })).toBeVisible();

    // Fill an answer — and DO NOT click Continue/Done. It must auto-save as a draft on its own.
    await w.getByRole('textbox', { name: 'What do you do for work?' }).fill('nurse');
    // Then change the section sharing to Partner ONLY (clear to Private, then add Partner) — also no Save click.
    await w.getByRole('button', { name: /this whole section/i }).click();
    await w.getByRole('button', { name: 'Private (only me)' }).click();
    await w.getByRole('checkbox', { name: 'Partner' }).click();
    await w.keyboard.press('Escape');

    // The first-time section auto-saves the answer (as a draft) the moment it's typed — no Continue click.
    await expect
      .poll(
        async () =>
          (await getIntakeSession(fs, key, 'owner-1'))?.sections.find((s) => s.id === 'basics')
            ?.answers?.occupation ?? null,
        { timeout: 4000 },
      )
      .toBe('nurse');
    // …and the SHARING change auto-saves too (the reported "private status isn't saving" bug).
    await expect
      .poll(
        async () =>
          (await getIntakeSession(fs, key, 'owner-1'))?.sections.find((s) => s.id === 'basics')
            ?.answerSharing?.occupation ?? [],
        { timeout: 4000 },
      )
      .toEqual(['partner']);
    // A draft auto-save must NOT prematurely COMPLETE a section the person is still filling out.
    const basics = (await getIntakeSession(fs, key, 'owner-1'))?.sections.find(
      (s) => s.id === 'basics',
    );
    expect(basics?.status).not.toBe('complete');
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('memory: an existing (pre-spec) portrait shares by default — Sharing reflects it, cards are clean (share-by-default backfill)', async () => {
  // Reproduces the real bug: a portrait synthesized BEFORE per-question sharing existed (answers present,
  // NO `answerSharing`, facts with NO `shareableTypes`) showed everything as "Private". The backfill resolves
  // a missing answerSharing entry to the category default, so existing portraits share by default.
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('backfill e2e: master key missing');
  const now = new Date().toISOString();
  await savePerson(fs, key, {
    id: 'partner-b',
    schemaVersion: 1,
    displayName: 'Bee',
    isSubject: true,
    tags: [],
    createdAt: now,
    updatedAt: now,
  });
  await saveRelationship(fs, key, {
    id: 'rel-b',
    schemaVersion: 1,
    fromPersonId: 'owner-1',
    toPersonId: 'partner-b',
    type: 'partner',
    createdAt: now,
    updatedAt: now,
  });
  // A COMPLETE intake from BEFORE per-question sharing: answers present, NO `answerSharing` on the section.
  await writeEncryptedJson(
    fs,
    'people/owner-1/intake/session.enc',
    {
      id: 'intake-pre',
      schemaVersion: 1,
      personId: 'owner-1',
      status: 'complete',
      insightId: 'portrait-pre',
      sections: [
        {
          id: 'health',
          status: 'complete',
          restricted: false,
          messages: [],
          answers: { sleepSchedule: 'Early to bed, early to rise' },
        },
      ],
      startedAt: now,
      updatedAt: now,
    },
    key,
  );
  // The pre-spec portrait Insight: facts with NO `shareableTypes` (own-only — the symptom).
  await saveInsight(fs, key, {
    id: 'portrait-pre',
    schemaVersion: 1,
    source: 'intake',
    subjectPersonId: 'owner-1',
    summary: 'A warm portrait.',
    facts: [{ id: 'f1', text: 'Values steady routines', shareable: false }],
    confidence: 'medium',
    categories: ['Health & body'],
    approved: true,
    provenance: { intakeSection: 'health', at: now },
    createdAt: now,
    updatedAt: now,
  });

  // The backfill applies on the ANSWER path immediately (no re-synthesis): the partner's context has it.
  expect(await buildContext(fs, key, 'partner-b')).toContain('Early to bed, early to rise');

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Memory' }).click();
    // The Sharing summary reflects the backfilled share — NOT the empty "not sharing anything yet".
    await expect(w.getByText(/You.?re sharing/i)).toBeVisible();
    await expect(w.getByText(/not sharing anything yet/i)).toHaveCount(0);
    // Clean cards (44 audit): the portrait fact renders with NO per-fact "Private" chip.
    await expect(w.getByText('Values steady routines')).toBeVisible();
    expect(await w.getByText('Private', { exact: true }).count()).toBe(0);
    // Manage sharing is the one place — it lists the shared onboarding answer.
    await w.getByRole('button', { name: /Manage sharing/i }).click();
    await expect(w.getByText(/Early to bed, early to rise/)).toBeVisible();
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
    await w.getByRole('button', { name: /Family & roots/ }).click();
    await expect(w.getByText('My name is Sam.')).toBeVisible();
    await expect(w.getByText('Lovely to meet you, Sam.')).toBeVisible();
    // Reloading returns to the same section (device-local), not back to the core flow: reopening
    // Onboarding lands directly on Family & roots (its transcript) without re-clicking the grid card.
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
    await w.getByRole('button', { name: /Health & body/ }).click();
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
// is the regression where a gated follow-up was buried in a far-down group and never seemed to appear. (Spec
// 27 reshaped the intimacy block, so this exercises the live conditionals: a partner follow-up + dirty talk.)
test('onboarding: intimacy conditionals reveal under their trigger (partner / opt-in specifics)', async () => {
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

    // The current-sex-life follow-ups are HIDDEN until "Do you have a sexual partner right now?" is Yes,
    // then REVEAL right under it.
    await expect(w.getByText('How satisfied are you with your sex life?')).toHaveCount(0);
    await w
      .getByRole('radiogroup', { name: 'Do you have a sexual partner right now?' })
      .getByRole('radio', { name: 'Yes' })
      .click();
    await expect(w.getByText('How satisfied are you with your sex life?')).toBeVisible();
    await expect(w.getByText('How often are you intimate now?')).toBeVisible();

    // The explicit specifics are HIDDEN until the opt-in "want to get specific?" toggle is Yes (27 §4.3),
    // then REVEAL together.
    await expect(w.getByText('Dirty talk — things you love to hear')).toHaveCount(0);
    await expect(w.getByText('What turns you on or gets you in the mood?')).toHaveCount(0);
    await w
      .getByRole('radiogroup', { name: /Want to get into the explicit specifics/ })
      .getByRole('radio', { name: 'Yes' })
      .click();
    await expect(w.getByText('What turns you on or gets you in the mood?')).toBeVisible();
    await expect(w.getByText('Dirty talk — things you love to hear')).toBeVisible();

    // 47 §7 — clearing a trigger HIDES its follow-ups again (an orphan can't linger on screen). Setting
    // the partner question back to No re-hides the current-sex-life follow-ups...
    await w
      .getByRole('radiogroup', { name: 'Do you have a sexual partner right now?' })
      .getByRole('radio', { name: 'No' })
      .click();
    await expect(w.getByText('How satisfied are you with your sex life?')).toHaveCount(0);
    // ...and toggling the opt-in back to No re-hides the explicit specifics.
    await w
      .getByRole('radiogroup', { name: /Want to get into the explicit specifics/ })
      .getByRole('radio', { name: 'No' })
      .click();
    await expect(w.getByText('What turns you on or gets you in the mood?')).toHaveCount(0);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('onboarding: clicking "share with partner" on a section saves immediately, even before answering (the screenshot bug)', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('share-instant e2e: master key missing');
  // A partner so the picker offers a type, + a FRESH intimacy section (nothing answered yet) — the exact
  // state in the user's screenshot.
  {
    const now = new Date().toISOString();
    await savePerson(fs, key, {
      id: 'partner-b',
      schemaVersion: 1,
      displayName: 'Bee',
      isSubject: true,
      tags: [],
      createdAt: now,
      updatedAt: now,
    });
    await saveRelationship(fs, key, {
      id: 'rel-b',
      schemaVersion: 1,
      fromPersonId: 'owner-1',
      toPersonId: 'partner-b',
      type: 'partner',
      createdAt: now,
      updatedAt: now,
    });
    await writeEncryptedJson(
      fs,
      'people/owner-1/intake/session.enc',
      {
        id: 'intake-share-instant',
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
    await w.getByRole('button', { name: /18 or older/ }).click();
    await expect(w.getByText('Who are you drawn to?')).toBeVisible();

    // Open the section sharing and click Partner — WITHOUT answering any question first (the screenshot).
    await w.getByRole('button', { name: /this whole section/i }).click();
    await w.getByRole('button', { name: 'Private (only me)' }).click();
    await w.getByRole('checkbox', { name: 'Partner', exact: true }).click(); // the picker checkbox, not an answer option
    await w.keyboard.press('Escape');

    // It must persist to the vault right away — even though NOTHING is answered yet. (Pre-fix: answerSharing
    // is only written for ANSWERED questions, so a fresh-section bulk-share saved nothing.)
    await expect
      .poll(
        async () => {
          const intimacy = (await getIntakeSession(fs, key, 'owner-1'))?.sections.find(
            (s) => s.id === 'intimacy',
          );
          return Object.values(intimacy?.answerSharing ?? {}).length;
        },
        { timeout: 4000 },
      )
      .toBeGreaterThan(0);
    const intimacy = (await getIntakeSession(fs, key, 'owner-1'))?.sections.find(
      (s) => s.id === 'intimacy',
    );
    const scopes = Object.values(intimacy?.answerSharing ?? {});
    expect(scopes.every((v) => v.length === 1 && v[0] === 'partner')).toBe(true); // every question → Partner
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

// 46 §7/§10: editing anatomy after rating the matrix re-LABELS the oral rows but must NOT orphan a rating —
// each row is keyed by a STABLE key, so the stored ratings stay attached through the edit. This is the headline
// orphan regression the spec calls out, driven through the real UI + a decrypt before/after.
test('onboarding: editing anatomy re-labels the oral rows WITHOUT orphaning a rating (46)', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');
  {
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('orphan e2e: master key missing');
    // Seed an intimacy section already opted into "get specific", with anatomy answered (own=penis, partner=
    // vulva) and three ratings keyed by STABLE keys: the receiving row, the vulva-giving row, and a universal.
    await writeEncryptedJson(
      fs,
      'people/owner-1/intake/session.enc',
      {
        id: 'intake-orphan',
        schemaVersion: 1,
        personId: 'owner-1',
        status: 'inProgress',
        sections: ['basics', 'intimacy'].map((id) => ({
          id,
          status: id === 'intimacy' ? 'inProgress' : 'skipped',
          restricted: id === 'intimacy',
          messages: [],
          answers:
            id === 'intimacy'
              ? {
                  getSpecific: true,
                  ownAnatomy: 'Cock (penis)',
                  partnerAnatomy: ['Pussy (vulva)'],
                  // A PRE-49 value: the receiving + vulva-giving rows keyed by stable keys, plus a universal row
                  // keyed by the OLD 'bondage' slug (49 split it into the categorized inventory). The panel
                  // migrates the legacy key to the new stable key on load (49 §4.3 carry-forward, no data loss).
                  activities: { 'oral-receiving': 3, 'oral-giving-vulva': 5, bondage: 4 },
                }
              : {},
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
    await w.getByRole('button', { name: /18 or older/ }).click();

    // The seeded ratings show against the anatomy-resolved rows: receiving = blowjob (own penis), giving =
    // going-down (partner vulva).
    await expect(w.getByRole('radiogroup', { name: /Receiving oral \(blowjob\)/ })).toBeVisible();
    await expect(w.getByRole('radiogroup', { name: /Going down on her/ })).toBeVisible();

    // EDIT own anatomy penis → vulva. The receiving row RE-LABELS live to "going down on you" — but its rating
    // (and the giving/universal ratings) must survive, because they're keyed by stable keys, not the label.
    await w.getByRole('radio', { name: 'Pussy (vulva)', exact: true }).click(); // ownAnatomy single-select
    await expect(
      w.getByRole('radiogroup', { name: /Receiving oral \(going down on you\)/ }),
    ).toBeVisible();
    await w.getByRole('button', { name: 'Continue', exact: true }).click();

    // Decrypt: the anatomy-keyed ratings are UNCHANGED (no orphan) — the relabel touched only the display label —
    // and the PRE-49 'bondage' rating carried forward to its new stable key (49 §4.3, no data loss).
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('orphan e2e: master key missing');
    const intimacyAnswers = async () =>
      (await getIntakeSession(fs, key, 'owner-1'))?.sections.find((s) => s.id === 'intimacy')
        ?.answers;
    // Poll — the Continue submit persists asynchronously, so the decrypt read must wait for the write to land.
    await expect
      .poll(async () => (await intimacyAnswers())?.activities)
      .toEqual({
        'oral-receiving': 3,
        'oral-giving-vulva': 5,
        'light-bondage-cuffs-ties': 4, // pre-49 'bondage' → new stable key (carry-forward)
      });
    expect((await intimacyAnswers())?.ownAnatomy).toBe('Pussy (vulva)');
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
      .getByRole('checkbox', { name: 'Children' })
      .click();
    await expect(children.getByRole('radio', { name: 'Have young kids' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // Having kids reveals the children roster (name / gender / date-of-birth per child — a DOB, not a
    // stale age).
    await expect(w.getByText('Tell me about your kids')).toBeVisible();
    await w.getByRole('button', { name: '+ Add', exact: true }).click(); // only the children roster is shown yet
    await w.getByLabel('Tell me about your kids — Name 1').fill('Emma');
    await w.getByLabel('Tell me about your kids — Gender 1').selectOption('Girl');
    await w.getByLabel('Tell me about your kids — Date of birth 1').fill('2018-05-14');
    // The roster row stacks its fields — no horizontal overflow.
    const rosterOverflow = await w.evaluate(() => {
      const main = document.querySelector('main');
      return main ? main.scrollWidth - main.clientWidth : 0;
    });
    expect(rosterOverflow).toBeLessThanOrEqual(1);

    // Selecting a pet reveals the pets roster (name / species / gender / date-of-birth — a DOB, not an age).
    await w
      .getByRole('group', { name: 'Any pets?' })
      .getByRole('checkbox', { name: 'Dog' })
      .click();
    await expect(w.getByText('Tell me about your pets')).toBeVisible();
    // Pets is the last roster in the section, so its "+ Add" is the last one (children's is above it).
    await w.getByRole('button', { name: '+ Add', exact: true }).last().click();
    await w.getByLabel('Tell me about your pets — Name 1').fill('Rex');
    const petDob = w.getByLabel('Tell me about your pets — Date of birth 1');
    await expect(petDob).toHaveAttribute('type', 'date');
    await petDob.fill('2022-03-09');

    // "Health & body": a per-substance frequency reveals only once that substance is selected.
    await w.getByRole('button', { name: /Health & body/ }).click();
    await expect(w.getByText('Cannabis — how often?')).toHaveCount(0);
    await w
      .getByRole('group', { name: 'Which recreational substances do you use, if any?' })
      .getByRole('checkbox', { name: 'Cannabis / weed' })
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
    await w.getByLabel('What do you do for work?', { exact: true }).fill('nurse');
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

test('progressive profile: a session circling an unexplored area surfaces a depth invitation → Go deeper opens the section (29)', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  await createNodeSecretStore(userData, passthrough).set('anthropic.apiKey', 'sk-ant-e2e');

  // Seed the owner's intake so EVERY invited section except "Family & roots" is filled — the depth-detection
  // pass then has exactly one unexplored area to name, making the fake deterministic.
  const seedFs = createNodeFileSystem(vault);
  const seedKey = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!seedKey) throw new Error('depth e2e: master key missing');
  await writeEncryptedJson(
    seedFs,
    'people/owner-1/intake/session.enc',
    {
      id: 'intake-depth',
      schemaVersion: 1,
      personId: 'owner-1',
      status: 'complete',
      sections: [
        'health',
        'relationships',
        'work-money',
        'joy-play',
        'story',
        'weighs',
        'intimacy',
      ].map((id) => ({
        id,
        status: 'complete',
        restricted: id === 'weighs' || id === 'intimacy',
        messages: [],
        answers: {},
      })),
      startedAt: 'now',
      updatedAt: 'now',
      completedAt: 'now',
    },
    seedKey,
  );

  // SELFOS_FAKE_DEPTH makes the offline analyzer emit one depth invitation when handed the unexplored-areas
  // context — so existing analysis E2E (without the flag) stay untouched.
  const app = await electron.launch({
    args: [`--user-data-dir=${userData}`, MAIN],
    env: { ...e2eEnv(), SELFOS_FAKE_DEPTH: '1' },
  });
  try {
    const w = await app.firstWindow();

    // Run a session and complete + summarize — the SAME paid pass detects the unexplored area.
    await w.getByRole('link', { name: 'Sessions' }).click();
    await w.getByLabel('Message').fill('I keep coming back to my family lately');
    await w.getByRole('button', { name: 'Send' }).click();
    await expect(w.getByText(/hear you/i).first()).toBeVisible();
    await w
      .getByRole('complementary', { name: 'Conversations' })
      .getByRole('button', { name: /Session options for/ })
      .first()
      .click();
    await w.getByRole('menuitem', { name: 'Complete & summarize' }).click();
    await expect(w.getByRole('heading', { name: 'Session summary' })).toBeVisible();

    // Decrypt the vault: a kind:'depth' invitation for "family" was recorded as a by-product (no new screen).
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('depth e2e: master key missing (2)');
    const depth = (await listProfileSuggestions(fs, key, 'owner-1')).filter(
      (s) => s.kind === 'depth',
    );
    expect(depth).toHaveLength(1);
    expect(depth[0]?.sectionId).toBe('family');
    expect(depth[0]?.status).toBe('pending');

    // §53 absorbed the standalone depth card into the ranked "For you" engine; the invitation now renders as
    // a recommendation ("Want to go a little deeper?" naming the area) carrying the same "Go deeper" action.
    await w.getByRole('link', { name: 'Home', exact: true }).click();
    await expect(w.getByText(/Want to go a little deeper\?/)).toBeVisible();
    await expect(w.getByText(/coming back to Family & roots/)).toBeVisible();
    await w.setViewportSize({ width: 390, height: 800 });
    const overflow = await w.evaluate(() => {
      const main = document.querySelector('main');
      return main ? main.scrollWidth - main.clientWidth : 0;
    });
    expect(overflow).toBeLessThanOrEqual(1);
    await w.setViewportSize({ width: 1100, height: 800 });

    // Go deeper → the Family section opens in onboarding (the existing intake form path; §29 adds no new UI).
    await w.getByRole('button', { name: /Go deeper/ }).click();
    await expect(w.getByRole('heading', { name: 'Family & roots' })).toBeVisible();

    // Accepting resolves the invitation (no nagging — the accepted area won't be re-offered).
    const after = (await listProfileSuggestions(fs, key, 'owner-1')).filter(
      (s) => s.kind === 'depth',
    );
    expect(after[0]?.status).toBe('accepted');
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('household AI key (25): owner shares a key → a keyless device inherits it (member scenario)', async () => {
  const { userData, vault } = await seedReadyVault({ 'ai.enabled': true });
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Settings' }).click();
    await w.getByRole('button', { name: 'AI', exact: true }).click();

    // Owner adds a device key — it auto-shares with the household (25 §5.6: the default; the manual
    // "share" button was removed). Saving alone mirrors it into the vault; the UI confirms the share.
    await w.getByLabel('Claude API key').fill('sk-ant-e2e-shared-key');
    await w.getByRole('button', { name: 'Save key' }).click();
    // Wait for the POST-SAVE confirmation specifically — it renders only once `status.hasSharedKey` is true,
    // which is `config/ai-credentials.enc` existing + decrypting (aiCredentialsService). The looser
    // /shared with your household/i ALSO matched the static pre-save explainer ("Keys you add here are
    // shared with your household automatically…"), so it passed before the share write finished → the
    // readFile below raced the write (intermittent ENOENT). This distinct text is a deterministic wait.
    await expect(w.getByText(/every member device uses this key/i)).toBeVisible();

    // The shared key is stored ENCRYPTED in the vault (ciphertext on disk, the key inside the envelope).
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    const onDisk = await readFile(join(vault, 'config', 'ai-credentials.enc'), 'utf8');
    expect(onDisk).toContain('aes-256-gcm');
    expect(onDisk).not.toContain('sk-ant-e2e-shared-key');
    const creds = (await readEncryptedJson(fs, 'config/ai-credentials.enc', key)) as {
      anthropicApiKey?: string;
    };
    expect(creds?.anthropicApiKey).toBe('sk-ant-e2e-shared-key');

    // Simulate a member's own device: clear the device override so ONLY the shared vault key remains.
    await w.getByRole('button', { name: 'Clear' }).click();

    // A keyless device resolves the shared key — booleans-only status, value never crosses IPC.
    const status = (await w.evaluate(() =>
      (
        window as unknown as {
          selfos: { aiKeyStatus: (i: { provider: string }) => Promise<unknown> };
        }
      ).selfos.aiKeyStatus({ provider: 'anthropic' }),
    )) as { source?: string; resolvedReady?: boolean; hasDeviceOverride?: boolean };
    expect(status).toMatchObject({
      hasDeviceOverride: false,
      resolvedReady: true,
      source: 'shared',
    });
    expect(JSON.stringify(status)).not.toContain('sk-ant-e2e-shared-key');

    // The AI is now available on a surface despite no device key (no "Connect Claude" prompt).
    await w.getByRole('link', { name: 'Sessions' }).click();
    await expect(w.getByText(/connect claude in/i)).toHaveCount(0);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('questionnaires: an invalid draft reads as a Draft with Send disabled + reasons; fixing enables it (38 §3.4/§3.9)', async () => {
  const { userData, vault } = await seedReadyVault();

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Questionnaires' }).click();
    await startNewQuestionnaire(w);
    await w.getByLabel('Title').fill('Weekly check-in');
    await w.getByLabel('Question 1', { exact: true }).fill('Pick one');
    // A singleChoice with no options is genuinely invalid → a Draft that can't be sent.
    await w.getByLabel('Answer type').selectOption({ label: 'Single choice' });
    await w.getByRole('button', { name: 'Create draft' }).click();

    // The header shows a Draft badge, Send is disabled, and the reasons are spelled out (38 §3.4).
    await expect(w.getByText('Draft', { exact: true })).toBeVisible();
    await expect(w.getByRole('button', { name: 'Send' })).toBeDisabled();
    await expect(w.getByText(/finish before you can send/i)).toBeVisible();

    // Fixing it (two options) clears the Draft and enables Send.
    await w.getByLabel('Option 1', { exact: true }).fill('A');
    await w.getByLabel('Option 2', { exact: true }).fill('B');
    await expect(w.getByRole('button', { name: 'Send' })).toBeEnabled();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('questionnaires: responses-arrived names the responder → View results → export a real file, Private prose absent (38 §3.1/§3.7)', async () => {
  const { userData, vault } = await seedReadyVault();
  const saveDir = await mkdtemp(join(tmpdir(), 'selfos-e2e-save-'));
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('expected a master key');
  const now = new Date().toISOString();
  await savePerson(fs, key, {
    id: 'mara-1',
    schemaVersion: 1,
    displayName: 'Mara',
    isSubject: true,
    tags: [],
    createdAt: now,
    updatedAt: now,
  });
  // A PRIVATE questionnaire with a prose + a numeric question — exported, the prose must be excluded.
  const q = await saveQuestionnaire(
    fs,
    key,
    {
      title: 'Weekly check-in',
      type: 'role-feedback',
      sensitivity: 'standard',
      recipient: { kind: 'person', personId: 'mara-1' },
      questions: [
        { id: 'prose', type: 'shortText', prompt: 'Anything to add?', required: false },
        {
          id: 'rate',
          type: 'rating',
          prompt: 'Rate it',
          required: true,
          scale: { min: 1, max: 5 },
        },
      ],
    },
    'owner-1',
  );
  const assignment = await createAssignment(fs, key, {
    questionnaireId: q.id,
    senderPersonId: 'owner-1',
    recipient: { kind: 'person', personId: 'mara-1' },
    channel: 'inApp',
    privacy: 'private',
    senderVisibleToRecipient: true,
  });
  await submitResponse(fs, key, {
    assignmentId: assignment.id,
    answers: [
      { questionId: 'prose', value: 'my secret prose' },
      { questionId: 'rate', value: 4 },
    ],
  });

  const app = await electron.launch({
    args: [`--user-data-dir=${userData}`, MAIN],
    env: { ...e2eEnv(), SELFOS_FAKE_SAVE_DIR: saveDir },
  });
  try {
    const w = await app.firstWindow();
    // The responses-arrived notification names the responder (not a faceless count) — 1 unread.
    await expect(w.getByRole('button', { name: 'Notifications, 1 unread' })).toBeVisible();
    await w.getByRole('button', { name: /^Notifications/ }).click();
    const center = w.getByRole('menu', { name: 'Notifications' });
    const row = center.getByRole('menuitem').filter({ hasText: 'Mara answered' });
    await expect(row).toBeVisible();

    // "View results" deep-links straight to that questionnaire's Results (38 §3.1).
    await row.getByRole('button', { name: 'View' }).click();
    await expect.poll(() => w.evaluate(() => window.location.hash)).toContain('focus=');
    await expect(w.getByRole('heading', { name: 'Results' })).toBeVisible();
    // A Private send never shows its raw answers to the sender.
    await expect(w.getByText(/Answered privately/i)).toBeVisible();

    // Export CSV writes a real file OUTSIDE the vault; the Private prose is absent, the numeric value present.
    await w.getByRole('button', { name: /Export CSV/i }).click();
    await expect(w.getByText(/outside your encrypted vault/i)).toBeVisible();
    const csv = await readFile(join(saveDir, 'weekly-check-in.csv'), 'utf8');
    expect(csv).toContain('Rate it');
    expect(csv).toContain('4');
    expect(csv).not.toContain('my secret prose');
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
    await rm(saveDir, { recursive: true, force: true });
  }
});

test('discoverability: role-aware AI-unavailable — owner gets the Settings → AI link, a member is told to ask the owner (41)', async () => {
  // No AI key seeded → AI is unavailable; the common real "not set up" state (§7 DoD prerequisite-absent).
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();

    // Owner: the Sessions launcher shows the owner set-up path → it navigates to Settings.
    await w.getByRole('link', { name: 'Sessions' }).click();
    await expect(w.getByText(/isn.t set up yet/i).first()).toBeVisible();
    // The launcher and the suggestions row each render the notice — either owner link reaches Settings.
    await w
      .getByRole('button', { name: /Set up Claude in Settings/i })
      .first()
      .click();
    await expect.poll(() => w.evaluate(() => window.location.hash)).toContain('/settings');

    // Create + grant a member (onboarded so the gate doesn't take over), then switch to them.
    await w.getByRole('link', { name: 'People' }).click();
    await w.getByRole('button', { name: 'Add person' }).click();
    await w.getByLabel('Name').fill('Jordan');
    await w.getByRole('button', { name: 'Create' }).click();
    await w.getByText('Jordan').click();
    await w.getByRole('button', { name: 'Access' }).click();
    await w.getByRole('button', { name: 'Grant access' }).click();
    await expect(w.getByText(/can sign in/i)).toBeVisible();
    await completeIntakeFor(vault, userData, 'Jordan');

    await w.getByRole('button', { name: /signed in as/i }).click();
    await w.getByRole('menuitem', { name: 'Switch person' }).click();
    await w
      .getByRole('dialog', { name: /who.s here/i })
      .getByText('Jordan')
      .click();
    await expect(w.getByRole('button', { name: 'Signed in as Jordan' })).toBeVisible();

    // Member: the ask-the-owner copy, and NO owner-only Settings → AI link anywhere on the surface.
    await w.getByRole('link', { name: 'Sessions' }).click();
    await expect(w.getByText(/ask the person who set up this household/i).first()).toBeVisible();
    await expect(w.getByRole('button', { name: /Set up Claude in Settings/i })).toHaveCount(0);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('discoverability: the Inbox empty state offers "Create a questionnaire" → the builder (41)', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Inbox' }).click();
    await expect(w.getByText(/nothing to answer right now/i)).toBeVisible();
    await w.getByRole('button', { name: /Create a questionnaire/i }).click();
    await expect.poll(() => w.evaluate(() => window.location.hash)).toContain('/questionnaires');
    await expect(w.getByRole('heading', { name: 'Questionnaires' })).toBeVisible();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('discoverability: Settings shows the device-vs-synced signal (41)', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'Settings' }).click();
    // Appearance (the default section) is synced across devices.
    await expect(w.getByText('Synced').first()).toBeVisible();
    // About → "Check for updates automatically" is device-local.
    await w.getByRole('button', { name: 'About', exact: true }).click();
    await expect(w.getByText('This device').first()).toBeVisible();

    // ~360px: no PAGE/`main` horizontal scrollbar (CLAUDE.md §12). The section nav's own pill-row scroll is
    // intentional (the responsive Settings design), so check main/doc width — matching the settings guard.
    // ~360px: no inner horizontal scrollbar on the Settings CONTENT. The section nav's pill row is an
    // intentional horizontal scroll (the responsive Settings design), so it's excluded; everything else
    // must not scroll-x (CLAUDE.md §12). `main` itself fits at 360px — verified separately below.
    await w.setViewportSize({ width: 360, height: 780 });
    const offenders = await w.evaluate(() => {
      const bad: string[] = [];
      document.querySelectorAll('*').forEach((el) => {
        const ox = getComputedStyle(el).overflowX;
        const isSectionNav = /sections/.test(el.className); // the intentional pill-row scroll
        if (
          !isSectionNav &&
          el.scrollWidth - el.clientWidth > 1 &&
          (ox === 'auto' || ox === 'scroll')
        ) {
          bad.push(`${el.tagName}.${el.className}`);
        }
      });
      return bad;
    });
    expect(offenders).toEqual([]);
    // The Settings content column (`main`) fits the 360px viewport with no horizontal scroll.
    const mainFits = await w.evaluate(() => {
      const main = document.querySelector('main');
      return !!main && main.scrollWidth <= main.clientWidth;
    });
    expect(mainFits).toBe(true);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('discoverability: the first-run orientation shows, is dismissed, is re-openable, and stays dismissed on relaunch (41)', async () => {
  const { userData, vault } = await seedReadyVault();
  let app = await launch(userData);
  try {
    const w = await app.firstWindow();
    // Home shows the brief orientation with the not-medical line.
    await expect(w.getByRole('heading', { name: /how selfos works/i })).toBeVisible();
    await expect(w.getByText(/not medical care/i).first()).toBeVisible();

    // No horizontal overflow at ~360px with the orientation card present.
    await w.setViewportSize({ width: 360, height: 780 });
    const offenders = await w.evaluate(() => {
      const bad: string[] = [];
      document.querySelectorAll('*').forEach((el) => {
        const ox = getComputedStyle(el).overflowX;
        if (el.scrollWidth - el.clientWidth > 1 && (ox === 'auto' || ox === 'scroll')) {
          bad.push(`${el.tagName}.${el.className}`);
        }
      });
      return bad;
    });
    expect(offenders).toEqual([]);
    await w.setViewportSize({ width: 1100, height: 800 });

    // Dismiss it → gone.
    await w.getByRole('button', { name: 'Dismiss welcome' }).click();
    await expect(w.getByRole('heading', { name: /how selfos works/i })).toHaveCount(0);

    // Re-openable any time from the account menu → "About SelfOS".
    await w.getByRole('button', { name: /signed in as/i }).click();
    await w.getByRole('menuitem', { name: 'About SelfOS' }).click();
    await expect(w.getByRole('dialog', { name: /about selfos/i })).toBeVisible();
    await w.getByRole('button', { name: /got it/i }).click();
    await expect(w.getByRole('dialog', { name: /about selfos/i })).toHaveCount(0);
  } finally {
    await app.close();
  }

  // Relaunch: the dismissal persisted (device-local, per-person) — the card does not reappear.
  app = await launch(userData);
  try {
    const w = await app.firstWindow();
    // Wait for Home to settle (the brand-new owner sees the getting-started card), then confirm the
    // orientation card is gone — the device-local dismissal persisted across the relaunch.
    await expect(w.getByRole('heading', { name: /welcome to selfos/i })).toBeVisible();
    await expect(w.getByRole('heading', { name: /how selfos works/i })).toHaveCount(0);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('self-assessments (50): take ECR-R → profile bars → retake adds a trend; AI-off narrate is calm; 360px clean', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'You' }).click();
    await expect(w.getByRole('heading', { name: /how you see yourself/i })).toBeVisible();

    // Take the Attachment (ECR-R) test through the rendered UI — its catalog card's "Take" button.
    await w.getByRole('heading', { name: 'Attachment style' }).scrollIntoViewIfNeeded();
    await w
      .locator(
        'xpath=//h3[normalize-space()="Attachment style"]/ancestor::*[contains(@class,"card")][1]',
      )
      .getByRole('button', { name: 'Take' })
      .click();
    await w.getByRole('button', { name: 'Begin' }).click();
    const groups1 = w.locator('[role="radiogroup"]');
    await expect(groups1).toHaveCount(36);
    for (let i = 0; i < 36; i += 1) await groups1.nth(i).getByRole('radio').last().click();
    const score1 = w.getByRole('button', { name: 'See my result' });
    await score1.scrollIntoViewIfNeeded();
    await score1.click();

    // The result profile renders subscale bars (text + band).
    await expect(w.getByRole('heading', { name: 'Your results' })).toBeVisible();
    await expect(w.getByText('Attachment anxiety')).toBeVisible();
    await expect(w.getByText('Attachment avoidance')).toBeVisible();

    // AI is off → the narrative button shows a calm state, never a blocked result.
    await w.getByRole('button', { name: /Reflect on my result/ }).click();
    await expect(w.getByText(/Turn on AI in Settings/i)).toBeVisible();

    // Retake → a second dated result → the trends + history sections appear.
    await w.getByRole('button', { name: 'Retake' }).click();
    await w.getByRole('button', { name: 'Begin' }).click();
    const groups2 = w.locator('[role="radiogroup"]');
    await expect(groups2).toHaveCount(36);
    for (let i = 0; i < 36; i += 1) await groups2.nth(i).getByRole('radio').last().click();
    await w.getByRole('button', { name: 'See my result' }).scrollIntoViewIfNeeded();
    await w.getByRole('button', { name: 'See my result' }).click();
    await expect(w.getByText(/How this has shifted \(2 takes\)/)).toBeVisible();
    await expect(w.getByRole('heading', { name: 'History' })).toBeVisible();

    // 95 — back on the hub, the taken test drops out of "Available tests": Attachment lives ONLY under
    // "Your profiles" (with Retake), never a second time as a catalog "Take" card.
    await w.getByRole('link', { name: 'You' }).click();
    await expect(w.getByRole('heading', { name: /how you see yourself/i })).toBeVisible();
    const profiles = w.locator('section', {
      has: w.getByRole('heading', { name: 'Your profiles' }),
    });
    await expect(profiles.getByRole('heading', { name: 'Attachment style' })).toBeVisible();
    const available = w.locator('section', {
      has: w.getByRole('heading', { name: 'Available tests' }),
    });
    await expect(available.getByRole('heading', { name: 'Attachment style' })).toHaveCount(0);

    // The derived Insight is on disk, approved, source 'test'.
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('tests e2e: master key missing');
    const insights = await listInsightsForPerson(fs, key, 'owner-1');
    const testInsight = insights.find(
      (i) => i.source === 'test' && i.provenance.testId === 'ecr-r',
    );
    expect(testInsight?.approved).toBe(true);

    // No horizontal overflow / inner scrollbar at phone width on the result surface.
    await w.setViewportSize({ width: 360, height: 780 });
    const overflow = await w.evaluate(() => {
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
    expect(overflow.offenders).toEqual([]);
    expect(overflow.mainOverflow).toBeLessThanOrEqual(1);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('self-assessments (50): the kink test is 18+-gated; a result writes partner-scoped, Intimacy-gated facts (decrypt)', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'You' }).click();

    // The Intimacy & sexuality group is 18+-gated — the cards are withheld until acknowledged.
    await expect(w.getByText(/These are 18\+/)).toBeVisible();
    await expect(w.getByRole('heading', { name: 'Kink & intimacy interests' })).toHaveCount(0);
    await w.getByRole('button', { name: /18 or older/i }).click();
    await expect(w.getByRole('heading', { name: 'Kink & intimacy interests' })).toBeVisible();

    // Take it: opt into a category (reveals its matrix), rate one item, score.
    await w
      .locator(
        'xpath=//h3[normalize-space()="Kink & intimacy interests"]/ancestor::*[contains(@class,"card")][1]',
      )
      .getByRole('button', { name: 'Take' })
      .click();
    await w.getByRole('button', { name: 'Begin' }).click();
    await w.getByText('Sensual & sensory', { exact: true }).click(); // a kink-areas multiChoice option
    // The revealed category matrix → rate the first row's last point.
    await w.locator('[role="radiogroup"]').first().getByRole('radio').last().click();
    await w.getByRole('button', { name: 'See my result' }).scrollIntoViewIfNeeded();
    await w.getByRole('button', { name: 'See my result' }).click();
    await expect(w.getByRole('heading', { name: 'Your results' })).toBeVisible();

    // Decrypt: the derived Insight's facts are PARTNER-scoped + tagged Intimacy (spec 54 §4.3, Option A).
    // Sensitive kink facts are NOT `restricted` (so they can reach a partner) but are never broadcast
    // (`shareable: false`) and are scoped strictly to the `partner` relationship type — so a sibling/parent/
    // coworker never sees them. `lifeArea: 'Intimacy'` keeps them own-context-gated to an intimacy topic.
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('kink e2e: master key missing');
    const insights = await listInsightsForPerson(fs, key, 'owner-1');
    const kink = insights.find(
      (i) => i.source === 'test' && i.provenance.testId === 'kink-interests',
    );
    expect(kink).toBeTruthy();
    expect(kink!.facts.length).toBeGreaterThan(0);
    expect(
      kink!.facts.every(
        (f) =>
          f.restricted !== true &&
          f.shareable === false &&
          f.lifeArea === 'Intimacy' &&
          Array.isArray(f.shareableTypes) &&
          f.shareableTypes.length === 1 &&
          f.shareableTypes[0] === 'partner',
      ),
    ).toBe(true);
    // Reaches the OWN intimacy context, but not a non-intimacy one.
    const intimacy = await summarizeForContext(fs, key, 'owner-1', [], { lifeAreas: ['Intimacy'] });
    expect(intimacy).toContain('intimacy interests');
    const money = await summarizeForContext(fs, key, 'owner-1', [], { lifeAreas: ['Money'] });
    expect(money).not.toContain('intimacy interests');
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

/** Click every PHQ-9 matrix row's point with the given label (e.g. "Not at all" / "Several days"). */
async function answerEveryRow(w: Page, label: string): Promise<void> {
  const groups = w.locator('[role="radiogroup"]');
  const count = await groups.count();
  for (let i = 0; i < count; i += 1) {
    await groups.nth(i).getByRole('radio', { name: label, exact: true }).click();
  }
}

test('wellbeing (51): mood check-in → GENTLE range + help line; AI-off narrate is calm; retake adds a trend + Home sibling; 360px clean', async () => {
  const { userData, vault } = await seedReadyVault();
  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'You' }).click();

    // The wellbeing group is distinct and NOT 18+-gated; it invites a "Check in", not "Take".
    await expect(w.getByRole('heading', { name: 'Reflections & check-ins' })).toBeVisible();
    await expect(w.getByText(/reflections, not diagnoses/i)).toBeVisible();
    await w.getByRole('heading', { name: 'Mood check-in' }).scrollIntoViewIfNeeded();
    await w
      .locator(
        'xpath=//h3[normalize-space()="Mood check-in"]/ancestor::*[contains(@class,"card")][1]',
      )
      .getByRole('button', { name: 'Check in' })
      .click();

    // The intro leads with the not-medical framing, then Begin.
    await expect(w.getByText(/not.*a.*diagnosis, a screening, or medical advice/i)).toBeVisible();
    await w.getByRole('button', { name: 'Begin' }).click();

    // Answer all 9 items "Not at all" → a benign 'minimal' band.
    const groups = w.locator('[role="radiogroup"]');
    await expect(groups).toHaveCount(9);
    await answerEveryRow(w, 'Not at all');
    await w.getByRole('button', { name: 'See my check-in' }).scrollIntoViewIfNeeded();
    await w.getByRole('button', { name: 'See my check-in' }).click();

    // The result shows the GENTLE range + the ALWAYS-PRESENT professional-help line — never the clinical band.
    await expect(w.getByRole('heading', { name: 'Your check-in' })).toBeVisible();
    await expect(w.getByText(/your mood has felt mostly okay lately/i)).toBeVisible();
    await expect(w.getByText(/This is a reflection, not a medical opinion/i)).toBeVisible();
    await expect(w.getByText('minimal', { exact: true })).toHaveCount(0);

    // AI is off → the narrative button is a calm state, never a blocked result.
    await w.getByRole('button', { name: /Reflect on my result/ }).click();
    await expect(w.getByText(/Turn on AI in Settings/i)).toBeVisible();

    // Check in again → a second dated result → the trend appears. Keep item 9 benign (so no crisis flag).
    await w.getByRole('button', { name: 'Check in again' }).click();
    await w.getByRole('button', { name: 'Begin' }).click();
    await expect(w.locator('[role="radiogroup"]')).toHaveCount(9);
    await answerEveryRow(w, 'Several days');
    await w
      .getByRole('radiogroup', { name: /better off dead/i })
      .getByRole('radio', { name: 'Not at all', exact: true })
      .click();
    await w.getByRole('button', { name: 'See my check-in' }).scrollIntoViewIfNeeded();
    await w.getByRole('button', { name: 'See my check-in' }).click();
    await expect(w.getByText(/How this has shifted \(2 takes\)/)).toBeVisible();

    // No horizontal overflow / inner scrollbar at phone width on the result surface.
    await w.setViewportSize({ width: 360, height: 780 });
    const overflow = await w.evaluate(() => {
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
    expect(overflow.offenders).toEqual([]);
    expect(overflow.mainOverflow).toBeLessThanOrEqual(1);
    await w.setViewportSize({ width: 1024, height: 800 });

    // The derived Insight is on disk, approved, source 'test', for the mood check-in — and its fact is never shared.
    const fs = createNodeFileSystem(vault);
    const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
    if (!key) throw new Error('wellbeing e2e: master key missing');
    const insights = await listInsightsForPerson(fs, key, 'owner-1');
    const mood = insights.find((i) => i.source === 'test' && i.provenance.testId === 'phq9');
    expect(mood?.approved).toBe(true);
    expect(mood?.crisisFlag).toBeUndefined();
    expect(mood?.facts.every((f) => f.shareable === false && f.shareableWith === undefined)).toBe(
      true,
    );

    // Home folds the two check-ins into the Wellbeing picture as a distinct sibling series.
    await w.getByRole('link', { name: 'Home' }).click();
    await expect(w.getByRole('heading', { name: 'Wellbeing' })).toBeVisible();
    await expect(w.getByText('Your check-ins')).toBeVisible();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test('wellbeing (51): PHQ-9 item 9 surfaces crisis resources MID-check-in; the flag is own-only + feeds the Home aggregation (AI off)', async () => {
  const { userData, vault } = await seedReadyVault();
  // Seed one recent crisis-flagged session insight so the wellbeing crisis flag makes the §40 signal recur (≥2).
  const fs = createNodeFileSystem(vault);
  const key = await loadMasterKey(createNodeSecretStore(userData, passthrough));
  if (!key) throw new Error('wellbeing crisis e2e: master key missing');
  const recentIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await saveInsight(fs, key, {
    id: 'seed-crisis',
    schemaVersion: 1,
    source: 'session',
    subjectPersonId: 'owner-1',
    summary: 'A heavy session',
    facts: [],
    confidence: 'medium',
    categories: [],
    approved: true,
    crisisFlag: true,
    provenance: { conversationId: 'seed-crisis', at: recentIso },
    createdAt: recentIso,
    updatedAt: recentIso,
  });

  const app = await launch(userData);
  try {
    const w = await app.firstWindow();
    await w.getByRole('link', { name: 'You' }).click();
    await w.getByRole('heading', { name: 'Mood check-in' }).scrollIntoViewIfNeeded();
    await w
      .locator(
        'xpath=//h3[normalize-space()="Mood check-in"]/ancestor::*[contains(@class,"card")][1]',
      )
      .getByRole('button', { name: 'Check in' })
      .click();
    await w.getByRole('button', { name: 'Begin' }).click();

    // No crisis surface yet.
    await expect(w.getByRole('alert')).toHaveCount(0);

    // Answer item 9 ("better off dead…") with any positive value → crisis resources appear IMMEDIATELY, before finishing.
    const item9 = w.getByRole('radiogroup', { name: /better off dead/i });
    await item9.getByRole('radio', { name: 'Several days', exact: true }).click();
    await expect(w.getByRole('alert')).toContainText(/please reach out to someone who can help/i);
    // The always-present crisis footer resources are there too.
    await expect(w.getByRole('button', { name: /get help now/i })).toBeVisible();

    // Finish the rest and score. answerEveryRow sets all 9 rows (incl. item 9) to "Not at all"; re-set item 9
    // positive afterwards so the required matrix is complete AND the crisis flag stands.
    await answerEveryRow(w, 'Not at all');
    await item9.getByRole('radio', { name: 'Several days', exact: true }).click();
    await w.getByRole('button', { name: 'See my check-in' }).scrollIntoViewIfNeeded();
    await w.getByRole('button', { name: 'See my check-in' }).click();
    await expect(w.getByRole('alert')).toContainText(/you don’t have to face it alone/i);

    // Decrypt: the derived Insight is crisisFlag, own (owner-1), and never shared (shareable false, no shareableWith).
    const insights = await listInsightsForPerson(fs, key, 'owner-1');
    const mood = insights.find((i) => i.source === 'test' && i.provenance.testId === 'phq9');
    expect(mood?.crisisFlag).toBe(true);
    expect(mood?.subjectPersonId).toBe('owner-1');
    expect(mood?.facts.every((f) => f.shareable === false && f.shareableWith === undefined)).toBe(
      true,
    );

    // Home: with the seeded crisis flag + this one (≥2 in 14 days), the supportive resources-first banner shows.
    await w.getByRole('link', { name: 'Home' }).click();
    await expect(w.getByText('988')).toBeVisible();
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});
