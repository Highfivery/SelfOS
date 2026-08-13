import { describe, expect, it } from 'vitest';

import { generateMasterKey } from '../crypto';
import type { ClaudeClient, FileSystem } from '../host';
import { flattenContent } from '../host/claudeClient';

import { memFileSystem } from '../host/memFileSystem';

import type { AiDeps } from './aiCall';
import { refreshCoverage, refreshNextCandidates } from './coverageService';
import {
  applyCandidateCuration,
  applyDecline,
  readProfile,
  writeProfile,
} from './personalizationProfile';
import { NOT_APPLICABLE_SKIP_REASON } from './answering';
import { emptyLedger, writeLedger } from './askLedger';
import { buildCoverageGuidance } from './coverageModel';
import { SATURATION_ASKS } from './topicMap';
import { gatherRecipientFeedbackGuidance } from './recipientHistory';

const key = generateMasterKey();

const client = (text: string): ClaudeClient => ({
  send: () => Promise.resolve(''),
  stream: (_o, onDelta) => {
    onDelta(text);
    return Promise.resolve({
      text,
      usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
    });
  },
});

/** A client that records every system/user prompt it is handed, so we can assert what reaches the model. */
const capturingClient = (
  text: string,
): { client: ClaudeClient; prompts: { system: string; user: string }[] } => {
  const prompts: { system: string; user: string }[] = [];
  return {
    prompts,
    client: {
      send: () => Promise.resolve(''),
      stream: (o, onDelta) => {
        prompts.push({
          system: o.system,
          user: o.messages.map((m) => flattenContent(m.content)).join('\n'),
        });
        onDelta(text);
        return Promise.resolve({
          text,
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    },
  };
};

const deps = (fs: FileSystem, text: string, apiKey: string | null = 'sk-test'): AiDeps => ({
  fs,
  key,
  client: client(text),
  apiKey,
  model: 'claude-sonnet-4-6',
  personId: 'author',
  now: new Date('2026-08-07T00:00:00.000Z'),
});

const ASSESSMENTS = JSON.stringify([
  {
    lifeArea: 'Work & purpose',
    depth: 0.8,
    subTopics: [{ label: 'Career direction', depth: 0.1 }],
  },
  { lifeArea: 'Money', depth: 0 },
  { lifeArea: 'Health & body', depth: 0.5 },
]);

describe('refreshCoverage', () => {
  it('populates the coverage map from the AI placement and steers generation to new ground', async () => {
    const fs = memFileSystem();
    const res = await refreshCoverage(deps(fs, ASSESSMENTS), 'p1');
    expect(res.ok).toBe(true);

    const profile = await readProfile(fs, key, 'p1');
    expect(profile.coverage.lastPlacementAt).toBe('2026-08-07T00:00:00.000Z');
    const work = profile.coverage.topics.find((t) => t.topicId === 'Work & purpose');
    expect(work).toMatchObject({ depth: 0.8, explored: true });
    expect(profile.coverage.topics.find((t) => t.topicId === 'Money')).toMatchObject({
      explored: false,
      depth: 0,
    });
    // A sub-topic was minted.
    expect(
      profile.coverage.topics.some((t) => t.topicId === 'Work & purpose:career-direction'),
    ).toBe(true);
    // Intimacy categories were folded in deterministically (a fresh person → all uncovered).
    expect(profile.coverage.topics.some((t) => t.topicId === 'Intimacy:oral')).toBe(true);

    // …and the shared steering block is now BOUNDARIES ONLY (spec 71 §5.5). Choosing ground moved to the
    // planner, scoped to the questionnaire's type + tier, because this block was type-agnostic: on a real
    // unfiltered intimacy draft it told the model to lead with "Friendships" and to leave every explicit
    // category alone. A fresh person has no skip/decline history, so there is nothing to say here at all.
    const guidance = await gatherRecipientFeedbackGuidance(fs, key, 'p1', new Date());
    expect(guidance).not.toContain('NEW / UNEXPLORED GROUND');
    expect(guidance).not.toContain('Already explored');
  });

  it('persists LEDGER counts on the intimacy rows, so worked ground never reads as "lead here"', async () => {
    // The skeleton's intimacy rows are structure only, and `applyCoverageAssessments` never scores Intimacy —
    // so without folding the ledger in before persisting, every category stays `explored:false, depth:0` and
    // `buildCoverageGuidance` (which reads the PERSISTED profile, not the folded view) puts the most
    // worked-through ground in the vault under "NEW / UNEXPLORED GROUND — lead here" for the candidate feed.
    const fs = memFileSystem();
    await writeLedger(fs, key, {
      ...emptyLedger('p1'),
      backfilledAt: '2026-08-01T00:00:00.000Z',
      entries: Array.from({ length: SATURATION_ASKS }, (_, i) => ({
        questionId: `q${i}`,
        assignmentId: `a${i}`,
        at: '2026-08-05T00:00:00.000Z',
        type: 'intimacy',
        tier: 'unfiltered' as const,
        topicIds: ['Intimacy:oral'],
        gist: 'oral',
        outcome: 'rich' as const,
      })),
    });
    expect((await refreshCoverage(deps(fs, ASSESSMENTS), 'p1')).ok).toBe(true);

    const profile = await readProfile(fs, key, 'p1');
    const oral = profile.coverage.topics.find((t) => t.topicId === 'Intimacy:oral');
    expect(oral).toMatchObject({ askedCount: SATURATION_ASKS, explored: true });
    // …and the guidance built from that profile no longer leads there, while untouched ground still does.
    const guidance = buildCoverageGuidance(profile);
    const fresh = guidance.split('Already explored')[0] ?? '';
    expect(fresh).not.toContain('- Oral');
    expect(fresh).toContain('- Money');
  });

  it('is fail-safe: a no-key pass leaves the last-good coverage untouched', async () => {
    const fs = memFileSystem();
    await refreshCoverage(deps(fs, ASSESSMENTS), 'p1'); // populate first
    const before = (await readProfile(fs, key, 'p1')).coverage;

    const res = await refreshCoverage(deps(fs, ASSESSMENTS, null), 'p1'); // no key → degrade
    expect(res).toMatchObject({ ok: false, degraded: true });
    // Coverage is preserved, not wiped.
    expect((await readProfile(fs, key, 'p1')).coverage).toEqual(before);
  });

  it('is fail-safe on a garbled reply (leaves coverage, flags degraded)', async () => {
    const fs = memFileSystem();
    const res = await refreshCoverage(deps(fs, 'not json at all'), 'p1');
    expect(res).toMatchObject({ ok: false, degraded: true });
    expect((await readProfile(fs, key, 'p1')).coverage.topics).toEqual([]);
  });
});

const CANDIDATES = JSON.stringify([
  { lifeArea: 'Money', prompt: 'What would financial security feel like for you?', kind: 'new' },
  { lifeArea: 'Health & body', prompt: 'What helps you actually rest?', kind: 'new' },
  {
    lifeArea: 'Work & purpose',
    prompt: 'What part of your work still feels unfinished?',
    kind: 'go-deeper',
  },
]);

describe('refreshNextCandidates', () => {
  it('proposes candidates from the coverage + feedback steering and persists them', async () => {
    const fs = memFileSystem();
    // Seed a placed coverage map + a declined topic so there is real steering to assert reaches the model.
    await refreshCoverage(deps(fs, ASSESSMENTS), 'p1');
    let profile = await readProfile(fs, key, 'p1');
    profile = applyDecline(
      profile,
      {
        topicId: 'Money',
        questionPrompt: 'How much do you earn?',
        reason: NOT_APPLICABLE_SKIP_REASON,
      },
      new Date('2026-08-07T00:00:00.000Z'),
    );
    await writeProfile(fs, key, profile);

    const cap = capturingClient(CANDIDATES);
    const res = await refreshNextCandidates({ ...deps(fs, ''), client: cap.client }, 'p1');
    expect(res.ok).toBe(true);

    // The steering reached the model (assert the PROMPT, not just the outcome — the durable lesson).
    const user = cap.prompts.map((p) => p.user).join('\n');
    expect(user).toContain('NEW / UNEXPLORED GROUND'); // coverage steering leads with new ground
    expect(user).toContain('How much do you earn?'); // the declined topic is in the avoid steering
    expect(cap.prompts.some((p) => p.system.includes('candidate questions'))).toBe(true);

    const after = await readProfile(fs, key, 'p1');
    expect(after.candidates.map((c) => c.prompt)).toContain(
      'What would financial security feel like for you?',
    );
    expect(after.candidates.find((c) => c.kind === 'go-deeper')?.prompt).toContain('unfinished');
    expect(after.candidatesRefreshedAt).toBeTruthy();
  });

  it('is fail-safe: a no-key pass leaves the last-good candidates untouched', async () => {
    const fs = memFileSystem();
    await refreshNextCandidates(deps(fs, CANDIDATES), 'p1'); // populate
    const before = (await readProfile(fs, key, 'p1')).candidates;
    expect(before.length).toBeGreaterThan(0);

    const res = await refreshNextCandidates(deps(fs, CANDIDATES, null), 'p1'); // no key → degrade
    expect(res).toMatchObject({ ok: false, degraded: true });
    expect((await readProfile(fs, key, 'p1')).candidates).toEqual(before);
  });

  it('is fail-safe on a garbled reply (keeps candidates, flags degraded)', async () => {
    const fs = memFileSystem();
    await refreshNextCandidates(deps(fs, CANDIDATES), 'p1'); // populate
    const before = (await readProfile(fs, key, 'p1')).candidates;
    const res = await refreshNextCandidates(deps(fs, 'not json at all'), 'p1');
    expect(res).toMatchObject({ ok: false, degraded: true });
    expect((await readProfile(fs, key, 'p1')).candidates).toEqual(before);
  });

  it('carries a pinned candidate forward across a refresh (curation preserved)', async () => {
    const fs = memFileSystem();
    await refreshNextCandidates(deps(fs, CANDIDATES), 'p1');
    let profile = await readProfile(fs, key, 'p1');
    const money = profile.candidates.find((c) => c.lifeArea === 'Money')!;
    profile = applyCandidateCuration(profile, { candidateId: money.id, action: 'ask' }, new Date());
    await writeProfile(fs, key, profile);

    // Re-run with the same proposal: the pin survives, and the re-offered prompt isn't duplicated.
    const after = await refreshNextCandidates(deps(fs, CANDIDATES), 'p1');
    expect(after.ok).toBe(true);
    const reread = await readProfile(fs, key, 'p1');
    expect(reread.candidates.find((c) => c.id === money.id)?.curation).toBe('asked');
    expect(reread.candidates.filter((c) => c.lifeArea === 'Money')).toHaveLength(1);
  });
});
