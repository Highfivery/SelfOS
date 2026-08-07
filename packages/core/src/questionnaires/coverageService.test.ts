import { describe, expect, it } from 'vitest';

import { generateMasterKey } from '../crypto';
import type { ClaudeClient, FileSystem } from '../host';

import { memFileSystem } from '../host/memFileSystem';

import type { AiDeps } from './aiCall';
import { refreshCoverage } from './coverageService';
import { readProfile } from './personalizationProfile';
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

    // …and the combined generation guidance now leads with the unexplored ground.
    const guidance = await gatherRecipientFeedbackGuidance(fs, key, 'p1', new Date());
    expect(guidance).toContain('NEW / UNEXPLORED GROUND');
    expect(guidance).toContain('- Money');
    expect(guidance).toContain('Already explored');
    expect(guidance).toContain('- Work & purpose');
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
