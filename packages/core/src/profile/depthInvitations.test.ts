import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { IntakeSection, IntakeSession, Person, RawDepthInvitation } from '../schemas';
import { getPerson, savePerson } from '../people';
import {
  acceptSuggestion,
  dismissSuggestion,
  listProfileSuggestions,
} from './profileSuggestionService';
import {
  DEPTH_COOLDOWN_DAYS,
  depthAskInstruction,
  depthDetectionContext,
  recordDepthInvitationsFromAnalysis,
  resolveDepthSection,
  unfilledInvitedSections,
} from './depthInvitations';

const key = generateMasterKey();
const NOW = new Date('2026-06-15T10:00:00.000Z');
const plusDays = (d: number): Date => new Date(NOW.getTime() + d * 86_400_000);

function person(): Person {
  return {
    id: 'p1',
    schemaVersion: 4,
    displayName: 'Sam',
    isSubject: true,
    tags: [],
    occupation: 'nurse',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

const section = (id: string, status: IntakeSection['status']): IntakeSection => ({
  id,
  status,
  restricted: id === 'weighs' || id === 'intimacy',
  messages: [],
  answers: {},
});

function intakeSession(overrides: Partial<IntakeSession> = {}): IntakeSession {
  return {
    id: 's1',
    schemaVersion: 1,
    personId: 'p1',
    status: 'complete',
    sections: [],
    completedAt: NOW.toISOString(),
    startedAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

const invite = (over: Partial<RawDepthInvitation> = {}): RawDepthInvitation => ({
  theme: 'your father',
  rationale: 'family has come up a few times',
  ...over,
});

async function setup() {
  const fs = memFileSystem();
  await savePerson(fs, key, person());
  return fs;
}

const depthOf = async (fs: ReturnType<typeof memFileSystem>) =>
  (await listProfileSuggestions(fs, key, 'p1')).filter((s) => s.kind === 'depth');

describe('unfilledInvitedSections', () => {
  it('returns invited sections that are notStarted or skipped, never core/filled/inProgress', () => {
    const session = intakeSession({
      sections: [
        section('family', 'complete'),
        section('health', 'inProgress'),
        section('work-money', 'skipped'),
        // relationships, joy-play, story, weighs, intimacy default to notStarted
      ],
    });
    const ids = unfilledInvitedSections(session).map((s) => s.id);
    expect(ids).not.toContain('family'); // complete
    expect(ids).not.toContain('health'); // inProgress
    expect(ids).toContain('work-money'); // skipped
    expect(ids).toContain('relationships'); // notStarted
    expect(ids).not.toContain('basics'); // core — never invited
  });

  it('treats a null session as everything unfilled (nothing answered yet)', () => {
    const ids = unfilledInvitedSections(null).map((s) => s.id);
    expect(ids).toContain('family');
    expect(ids).toContain('intimacy');
  });

  it('marks an explicitly-skipped section as skipped', () => {
    const session = intakeSession({ sections: [section('family', 'skipped')] });
    expect(unfilledInvitedSections(session).find((s) => s.id === 'family')?.skipped).toBe(true);
  });
});

describe('resolveDepthSection', () => {
  const unfilled = unfilledInvitedSections(null);
  it('resolves by an unfilled invited sectionId', () => {
    expect(resolveDepthSection(invite({ sectionId: 'family' }), unfilled)?.id).toBe('family');
  });
  it('resolves by life-area when no sectionId (Family → family, Money → work-money)', () => {
    expect(resolveDepthSection(invite({ lifeArea: 'Family' }), unfilled)?.id).toBe('family');
    expect(resolveDepthSection(invite({ lifeArea: 'Money' }), unfilled)?.id).toBe('work-money');
  });
  it('drops a core/non-existent/unmapped target', () => {
    expect(resolveDepthSection(invite({ sectionId: 'basics' }), unfilled)).toBeNull();
    expect(resolveDepthSection(invite({ sectionId: 'nope' }), unfilled)).toBeNull();
    expect(resolveDepthSection(invite({ lifeArea: 'Other' }), unfilled)).toBeNull();
  });
});

describe('recordDepthInvitationsFromAnalysis', () => {
  it('records a depth invitation for an unfilled invited section', async () => {
    const fs = await setup();
    await recordDepthInvitationsFromAnalysis(
      fs,
      key,
      'p1',
      [invite({ sectionId: 'family' })],
      'session',
      'insight-1',
      intakeSession(),
      NOW,
    );
    const depth = await depthOf(fs);
    expect(depth).toHaveLength(1);
    expect(depth[0]).toMatchObject({
      kind: 'depth',
      sectionId: 'family',
      theme: 'your father',
      restricted: false,
      status: 'pending',
    });
    expect(depth[0]?.observed).toBe('your father'); // schema requires a non-empty observed
  });

  it('drops a core-section, already-filled, and hallucinated target', async () => {
    const fs = await setup();
    const session = intakeSession({ sections: [section('family', 'complete')] });
    await recordDepthInvitationsFromAnalysis(
      fs,
      key,
      'p1',
      [
        invite({ sectionId: 'basics' }), // core
        invite({ sectionId: 'family' }), // already complete
        invite({ sectionId: 'does-not-exist' }), // hallucinated
      ],
      'session',
      'insight-1',
      session,
      NOW,
    );
    expect(await depthOf(fs)).toHaveLength(0);
  });

  it('inherits restricted from the trusted catalog, never the model', async () => {
    const fs = await setup();
    await recordDepthInvitationsFromAnalysis(
      fs,
      key,
      'p1',
      // weighs is a restricted catalog section; the model has no say.
      [invite({ sectionId: 'weighs', theme: 'a hard time growing up' })],
      'session',
      'insight-1',
      intakeSession(),
      NOW,
    );
    const depth = await depthOf(fs);
    expect(depth[0]?.restricted).toBe(true);
  });

  it('dedups: a new invitation for the same area supersedes the prior pending one', async () => {
    const fs = await setup();
    await recordDepthInvitationsFromAnalysis(
      fs,
      key,
      'p1',
      [invite({ sectionId: 'family', theme: 'your dad' })],
      'session',
      'insight-1',
      intakeSession(),
      NOW,
    );
    await recordDepthInvitationsFromAnalysis(
      fs,
      key,
      'p1',
      [invite({ sectionId: 'family', theme: 'your mum' })],
      'session',
      'insight-2',
      intakeSession(),
      plusDays(1),
    );
    const depth = await depthOf(fs);
    expect(depth).toHaveLength(1);
    expect(depth[0]?.theme).toBe('your mum'); // newest wins
  });

  it('enforces the global cap (one pending depth at a time, newest wins across areas)', async () => {
    const fs = await setup();
    await recordDepthInvitationsFromAnalysis(
      fs,
      key,
      'p1',
      [invite({ sectionId: 'family' })],
      'session',
      'insight-1',
      intakeSession(),
      NOW,
    );
    await recordDepthInvitationsFromAnalysis(
      fs,
      key,
      'p1',
      [invite({ sectionId: 'work-money', theme: 'money stress' })],
      'session',
      'insight-2',
      intakeSession(),
      plusDays(1),
    );
    const pending = (await depthOf(fs)).filter((s) => s.status === 'pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]?.sectionId).toBe('work-money');
  });

  it('does not re-fire a dismissed area within the cooldown', async () => {
    const fs = await setup();
    await recordDepthInvitationsFromAnalysis(
      fs,
      key,
      'p1',
      [invite({ sectionId: 'family' })],
      'session',
      'insight-1',
      intakeSession(),
      NOW,
    );
    const pending = (await depthOf(fs)).filter((s) => s.status === 'pending');
    await dismissSuggestion(fs, key, 'p1', pending[0]!.id, plusDays(1));
    await recordDepthInvitationsFromAnalysis(
      fs,
      key,
      'p1',
      [invite({ sectionId: 'family' })],
      'session',
      'insight-2',
      intakeSession(),
      plusDays(10),
    );
    expect((await depthOf(fs)).filter((s) => s.status === 'pending')).toHaveLength(0);
  });

  it('keeps a skipped section a standing decline within the cooldown, then re-invites after it', async () => {
    const fs = await setup();
    const session = intakeSession({ sections: [section('family', 'skipped')] });
    // Within the cooldown (since onboarding completed at NOW) → dropped.
    await recordDepthInvitationsFromAnalysis(
      fs,
      key,
      'p1',
      [invite({ sectionId: 'family' })],
      'session',
      'insight-1',
      session,
      plusDays(DEPTH_COOLDOWN_DAYS - 1),
    );
    expect(await depthOf(fs)).toHaveLength(0);
    // After the cooldown → a strong recurrence may re-invite.
    await recordDepthInvitationsFromAnalysis(
      fs,
      key,
      'p1',
      [invite({ sectionId: 'family' })],
      'session',
      'insight-2',
      session,
      plusDays(DEPTH_COOLDOWN_DAYS + 1),
    );
    expect(await depthOf(fs)).toHaveLength(1);
  });

  it('is a no-op when nothing is unfilled', async () => {
    const fs = await setup();
    const session = intakeSession({
      sections: [
        section('family', 'complete'),
        section('health', 'complete'),
        section('relationships', 'complete'),
        section('work-money', 'complete'),
        section('joy-play', 'complete'),
        section('story', 'complete'),
        section('weighs', 'complete'),
        section('intimacy', 'complete'),
      ],
    });
    await recordDepthInvitationsFromAnalysis(
      fs,
      key,
      'p1',
      [invite({ sectionId: 'family' })],
      'session',
      'insight-1',
      session,
      NOW,
    );
    expect(await depthOf(fs)).toHaveLength(0);
  });
});

describe('accept / dismiss for a depth invitation', () => {
  it('accept does NOT write a Person field and keeps the resolved sectionId', async () => {
    const fs = await setup();
    await recordDepthInvitationsFromAnalysis(
      fs,
      key,
      'p1',
      [invite({ sectionId: 'family' })],
      'session',
      'insight-1',
      intakeSession(),
      NOW,
    );
    const pending = (await depthOf(fs)).filter((s) => s.status === 'pending');
    const accepted = await acceptSuggestion(fs, key, 'p1', pending[0]!.id, plusDays(1));
    expect(accepted?.status).toBe('accepted');
    expect(accepted?.kind).toBe('depth');
    expect(accepted?.sectionId).toBe('family');
    // The person is untouched — a depth invitation only opens a section, it never writes a field.
    expect((await getPerson(fs, key, 'p1'))?.occupation).toBe('nurse');
  });
});

describe('prompt helpers', () => {
  it('depthDetectionContext lists ids/titles and flags heavier sections; empty when none', () => {
    expect(depthDetectionContext([])).toBe('');
    const ctx = depthDetectionContext(unfilledInvitedSections(null));
    expect(ctx).toContain('Profile areas they have not explored yet');
    expect(ctx).toContain('family ("Family & roots")');
    expect(ctx).toContain('[a heavier, sensitive area]'); // weighs / intimacy
  });

  it('depthAskInstruction names the sections + guards crisis; empty when none', () => {
    expect(depthAskInstruction({ sections: [] })).toBe('');
    const ask = depthAskInstruction({
      sections: unfilledInvitedSections(
        intakeSession({ sections: [section('family', 'skipped')] }),
      ).filter((s) => s.id === 'family'),
    });
    expect(ask).toContain('Family & roots');
    expect(ask).toMatch(/crisis/i);
  });
});
