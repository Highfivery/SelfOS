import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { listCoveredTopics, markCoveredTopic } from './coveredTopicsStore';
import { COVERED_TOPICS_CAP } from '../schemas';

const key = generateMasterKey();
const now = (n: number): Date => new Date(2026, 0, 1, 0, 0, n);
let seq = 0;
const mintId = (): string => `id-${seq++}`;

describe('coveredTopicsStore', () => {
  it('records a covered topic per author + recipient, newest first', async () => {
    const fs = memFileSystem();
    await markCoveredTopic(
      fs,
      key,
      'author',
      { recipientPersonId: 'r1', note: 'Their job' },
      now(1),
      mintId,
    );
    await markCoveredTopic(
      fs,
      key,
      'author',
      { recipientPersonId: 'r1', note: 'Their hobbies', sourcePrompt: 'What are your hobbies?' },
      now(2),
      mintId,
    );
    const topics = await listCoveredTopics(fs, key, 'author', 'r1');
    expect(topics.map((t) => t.note)).toEqual(['Their hobbies', 'Their job']);
    expect(topics[0]?.sourcePrompt).toBe('What are your hobbies?');
  });

  it('de-dupes the same topic (refreshes to the top rather than duplicating)', async () => {
    const fs = memFileSystem();
    await markCoveredTopic(fs, key, 'a', { recipientPersonId: 'r', note: 'Money' }, now(1), mintId);
    await markCoveredTopic(fs, key, 'a', { recipientPersonId: 'r', note: 'Faith' }, now(2), mintId);
    await markCoveredTopic(
      fs,
      key,
      'a',
      { recipientPersonId: 'r', note: '  money  ' },
      now(3),
      mintId,
    );
    const topics = await listCoveredTopics(fs, key, 'a', 'r');
    // Only one "money" note remains, refreshed to the top.
    expect(topics.map((t) => t.note.toLowerCase().trim())).toEqual(['money', 'faith']);
  });

  it('scopes by recipient AND author (no cross-leak)', async () => {
    const fs = memFileSystem();
    await markCoveredTopic(fs, key, 'a1', { recipientPersonId: 'r1', note: 'X' }, now(1), mintId);
    await markCoveredTopic(fs, key, 'a1', { recipientPersonId: 'r2', note: 'Y' }, now(2), mintId);
    expect((await listCoveredTopics(fs, key, 'a1', 'r1')).map((t) => t.note)).toEqual(['X']);
    expect((await listCoveredTopics(fs, key, 'a1', 'r2')).map((t) => t.note)).toEqual(['Y']);
    // A different author sees nothing (the doc lives under the author's folder).
    expect(await listCoveredTopics(fs, key, 'a2', 'r1')).toEqual([]);
  });

  it('caps a recipient set at COVERED_TOPICS_CAP (oldest dropped)', async () => {
    const fs = memFileSystem();
    for (let i = 0; i < COVERED_TOPICS_CAP + 5; i++) {
      await markCoveredTopic(
        fs,
        key,
        'a',
        { recipientPersonId: 'r', note: `topic ${i}` },
        now(i),
        mintId,
      );
    }
    const topics = await listCoveredTopics(fs, key, 'a', 'r');
    expect(topics).toHaveLength(COVERED_TOPICS_CAP);
    // The newest are kept.
    expect(topics[0]?.note).toBe(`topic ${COVERED_TOPICS_CAP + 4}`);
  });
});
