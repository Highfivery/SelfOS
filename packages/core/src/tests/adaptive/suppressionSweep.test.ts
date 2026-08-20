import { describe, expect, it } from 'vitest';

import { memFileSystem } from '../../host/memFileSystem';
import type { FileSystem } from '../../host';
import { upsertPerson } from '../../people/peopleService';
import { applyDirectionalMarks, emptyLexicon, writeLexicon } from './lexicon';
import { DIRTY_TALK } from './instruments/dirtyTalk';
import { buildCouplesSuppressionBlock } from './steer';
import { buildTogetherSystemPrompt } from '../../together/togetherPromptBuilder';
import { pairKeyFor } from '../../together/togetherService';
import type { TogetherSession } from '../../schemas';
import type { ClaudeClient } from '../../host';
import { suggestGuidedSessions } from '../../conversations/guidanceService';

const NOW = new Date('2026-08-20T12:00:00.000Z');
const KEY = new Uint8Array(32).fill(7);

/** One person who has ruled a word out, so every path below has something to suppress. */
async function seedWithAHardNo(fs: FileSystem, name: string): Promise<string> {
  const id = (await upsertPerson(fs, KEY, { displayName: name, isSubject: true, tags: [] })).id;
  const lex = applyDirectionalMarks(
    emptyLexicon(id, NOW),
    DIRTY_TALK.bank,
    { 'names-rough-heavy:manwhore': { hear: 'never', say: 'never' } },
    'take:1',
    NOW,
  );
  await writeLexicon(fs, KEY, lex);
  return id;
}

describe('74 §5.8a — suppression is unconditional on every path that writes prose a person reads', () => {
  it('reaches a COUPLES prompt for a pair that has NOT acknowledged 18+', async () => {
    /*
     * The §3.6.30 sweep moved the couples hard-no list OUT of `if (allAdultAcked)`, because a pair where
     * either partner had not acked — or had revoked — generated prose both of them read with no list at all.
     * That fix shipped with no test anywhere; this is it.
     */
    const fs = memFileSystem();
    const ben = await seedWithAHardNo(fs, 'Ben');
    const angel = (await upsertPerson(fs, KEY, { displayName: 'Angel', isSubject: true, tags: [] }))
      .id;
    const session: TogetherSession = {
      id: 's1',
      schemaVersion: 1,
      pairKey: pairKeyFor(ben, angel),
      participantIds: [ben, angel],
      initiatorPersonId: ben,
      createdAt: NOW.toISOString(),
    };

    const unacked = await buildTogetherSystemPrompt(fs, KEY, session, { allAdultAcked: false });
    expect(unacked).toContain('manwhore');

    // …and an acked pair still gets it — carried by the merged block rather than twice.
    const acked = await buildTogetherSystemPrompt(fs, KEY, session, { allAdultAcked: true });
    expect(acked).toContain('manwhore');
  });

  it('keeps the de-dup invariant the couples path rides on', async () => {
    /*
     * `togetherPromptBuilder` emits the standalone list only when the merged block is absent, to avoid
     * printing it twice. That is safe ONLY because the merged builder returns '' when there is nothing to
     * suppress either. If a future early-return broke that, the un-acked branch would silently go bare —
     * so the invariant is pinned here rather than left to a comment.
     */
    const fs = memFileSystem();
    const ben = await seedWithAHardNo(fs, 'Ben');
    expect(await buildCouplesSuppressionBlock(fs, KEY, [ben])).toContain('manwhore');

    const bare = memFileSystem();
    const nobody = (
      await upsertPerson(bare, KEY, { displayName: 'Nobody', isSubject: true, tags: [] })
    ).id;
    expect(await buildCouplesSuppressionBlock(bare, KEY, [nobody])).toBe('');
  });

  it('reaches the GUIDED SUGGESTIONS pass, whose reasons the person reads', async () => {
    /*
     * `guided.suggest` writes a `reason` per suggestion that the person reads on the launcher, and
     * `adultAllowed` admits the intimacy group into the catalog — but the pass had no hard-no list at all.
     */
    const fs = memFileSystem();
    const me = await seedWithAHardNo(fs, 'Ben');
    let captured = '';
    const client: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: (options) => {
        captured = options.system ?? '';
        return Promise.resolve({
          text: JSON.stringify({ suggestions: [] }),
          usage: { inputTokens: 10, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    await suggestGuidedSessions(
      {
        fs,
        key: KEY,
        client,
        apiKey: 'sk-test',
        model: 'claude-sonnet-4-6',
        personId: me,
        now: NOW,
      },
      { adultAllowed: false },
    );
    expect(captured).toContain('manwhore');
  });
});
