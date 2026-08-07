import { describe, expect, it } from 'vitest';

import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import {
  NOT_APPLICABLE_SKIP_REASON,
  PREFER_NOT_TO_SAY_SKIP_REASON,
  UNCLEAR_SKIP_REASON,
} from './answering';
import {
  applyChange,
  applyDecline,
  applyEngagement,
  applyReciprocity,
  buildFeedbackGuidance,
  CHANGE_CAP,
  classifyDeclineReason,
  emptyProfile,
  FEEDBACK_CAP,
  markChangesExplored,
  readProfile,
  writeProfile,
} from './personalizationProfile';

const key = generateMasterKey();
const at = (n: number): Date => new Date(2026, 0, 1, 0, 0, n);

describe('classifyDeclineReason', () => {
  it('maps the three presets to their steering kinds', () => {
    expect(classifyDeclineReason(UNCLEAR_SKIP_REASON)).toBe('unclear');
    expect(classifyDeclineReason(PREFER_NOT_TO_SAY_SKIP_REASON)).toBe('prefer-not-to-say');
    expect(classifyDeclineReason(NOT_APPLICABLE_SKIP_REASON)).toBe('not-applicable');
  });

  it('treats a reasonless or free-text skip as the weak `skipped` signal', () => {
    expect(classifyDeclineReason(undefined)).toBe('skipped');
    expect(classifyDeclineReason('  ')).toBe('skipped');
    expect(classifyDeclineReason('I would rather answer this later')).toBe('skipped');
  });
});

describe('readProfile / writeProfile', () => {
  it('derives a fresh empty profile when no file exists', async () => {
    const fs = memFileSystem();
    const p = await readProfile(fs, key, 'p1');
    expect(p.personId).toBe('p1');
    expect(p.feedback).toEqual([]);
    expect(p.changes).toEqual([]);
    expect(p.coverage.topics).toEqual([]);
  });

  it('round-trips through the encrypted vault file', async () => {
    const fs = memFileSystem();
    const p = applyDecline(
      emptyProfile('p1'),
      { questionPrompt: 'How is work?', reason: NOT_APPLICABLE_SKIP_REASON },
      at(1),
    );
    await writeProfile(fs, key, p);
    // The bytes on disk are ciphertext, not the plain doc.
    const onDisk = await fs.read('people/p1/questionnaires/personalizationProfile.enc');
    expect(onDisk).toBeTruthy();
    expect(new TextDecoder().decode(onDisk!)).not.toContain('How is work?');
    const back = await readProfile(fs, key, 'p1');
    expect(back.feedback).toHaveLength(1);
    expect(back.feedback[0]?.kind).toBe('not-applicable');
    expect(back.feedback[0]?.questionPrompt).toBe('How is work?');
  });

  it('degrades a corrupt doc to a safe empty profile rather than throwing', async () => {
    const fs = memFileSystem();
    await writeProfile(fs, key, {
      // deliberately malformed: feedback holds a bad entry
      ...emptyProfile('p1'),
      feedback: [{ kind: 'not-a-kind' } as never],
    });
    const back = await readProfile(fs, key, 'p1');
    // The whole feedback array `.catch([])`es to empty; the read never throws.
    expect(back.personId).toBe('p1');
    expect(back.feedback).toEqual([]);
  });
});

describe('applyDecline', () => {
  it('records each preset with its differentiated kind', () => {
    let p = emptyProfile('p1');
    p = applyDecline(p, { questionPrompt: 'Q1', reason: UNCLEAR_SKIP_REASON }, at(1));
    p = applyDecline(p, { questionPrompt: 'Q2', reason: NOT_APPLICABLE_SKIP_REASON }, at(2));
    p = applyDecline(p, { questionPrompt: 'Q3', reason: PREFER_NOT_TO_SAY_SKIP_REASON }, at(3));
    expect(p.feedback.map((f) => f.kind)).toEqual([
      'prefer-not-to-say',
      'not-applicable',
      'unclear',
    ]); // newest first
  });

  it('keeps the free-text reason but classifies it as `skipped`', () => {
    const p = applyDecline(
      emptyProfile('p1'),
      { topicId: 'Work:career', questionPrompt: 'Q', reason: 'later please' },
      at(1),
    );
    expect(p.feedback[0]).toMatchObject({
      kind: 'skipped',
      reason: 'later please',
      topicId: 'Work:career',
    });
  });

  it('collapses a repeated identical decline instead of bloating', () => {
    let p = emptyProfile('p1');
    p = applyDecline(p, { questionPrompt: 'Q', reason: NOT_APPLICABLE_SKIP_REASON }, at(1));
    p = applyDecline(p, { questionPrompt: 'Q', reason: NOT_APPLICABLE_SKIP_REASON }, at(5));
    expect(p.feedback).toHaveLength(1);
    expect(p.feedback[0]?.at).toBe(at(5).toISOString()); // refreshed
  });

  it('caps the feedback ledger at FEEDBACK_CAP (oldest dropped)', () => {
    let p = emptyProfile('p1');
    for (let i = 0; i < FEEDBACK_CAP + 20; i++) {
      p = applyDecline(p, { questionPrompt: `Q${i}`, reason: NOT_APPLICABLE_SKIP_REASON }, at(i));
    }
    expect(p.feedback).toHaveLength(FEEDBACK_CAP);
    expect(p.feedback[0]?.questionPrompt).toBe(`Q${FEEDBACK_CAP + 19}`); // newest kept
  });
});

describe('applyEngagement', () => {
  it('records rich vs bailed engagement', () => {
    let p = emptyProfile('p1');
    p = applyEngagement(p, { topicId: 'Values:faith', engagement: 'rich' }, at(1));
    p = applyEngagement(p, { topicId: 'Money:budget', engagement: 'bailed' }, at(2));
    expect(p.feedback.map((f) => f.kind)).toEqual(['bailed', 'answered-richly']);
  });
});

describe('applyChange / markChangesExplored', () => {
  it('records a detected shift as unexplored', () => {
    const p = applyChange(
      emptyProfile('p1'),
      { topicId: 'Goals:career', kind: 'numeric-shift', from: '2/5', to: '5/5' },
      at(1),
    );
    expect(p.changes[0]).toMatchObject({
      kind: 'numeric-shift',
      from: '2/5',
      to: '5/5',
      explored: false,
    });
  });

  it('is idempotent on re-detecting the same shift (preserves explored)', () => {
    let p = applyChange(
      emptyProfile('p1'),
      { topicId: 'Goals:career', kind: 'numeric-shift', from: '2/5', to: '5/5' },
      at(1),
    );
    p = markChangesExplored(p, { topicId: 'Goals:career' }, at(2));
    expect(p.changes[0]?.explored).toBe(true);
    const same = applyChange(
      p,
      { topicId: 'Goals:career', kind: 'numeric-shift', from: '2/5', to: '5/5' },
      at(3),
    );
    expect(same).toBe(p); // no-op, same object
    expect(same.changes[0]?.explored).toBe(true); // stays explored
  });

  it('replaces a prior shift and resets explored when the value changes again', () => {
    let p = applyChange(
      emptyProfile('p1'),
      { topicId: 'Goals:career', kind: 'numeric-shift', from: '2/5', to: '5/5' },
      at(1),
    );
    p = markChangesExplored(p, { topicId: 'Goals:career' }, at(2));
    p = applyChange(
      p,
      { topicId: 'Goals:career', kind: 'numeric-shift', from: '5/5', to: '1/5' },
      at(3),
    );
    expect(p.changes).toHaveLength(1);
    expect(p.changes[0]).toMatchObject({ from: '5/5', to: '1/5', explored: false });
  });

  it('caps the change log at CHANGE_CAP', () => {
    let p = emptyProfile('p1');
    for (let i = 0; i < CHANGE_CAP + 10; i++) {
      p = applyChange(p, { topicId: `T${i}`, kind: 'contradiction', from: 'a', to: 'b' }, at(i));
    }
    expect(p.changes).toHaveLength(CHANGE_CAP);
  });

  it('markChangesExplored is a no-op when nothing matches', () => {
    const p = applyChange(
      emptyProfile('p1'),
      { topicId: 'Goals:career', kind: 'numeric-shift', from: '2/5', to: '5/5' },
      at(1),
    );
    expect(markChangesExplored(p, { topicId: 'nope' }, at(2))).toBe(p);
  });
});

describe('buildFeedbackGuidance', () => {
  it('renders avoid / boundary / reword sections differentiated by reason', () => {
    let p = emptyProfile('p1');
    p = applyDecline(
      p,
      { questionPrompt: 'How is work?', reason: NOT_APPLICABLE_SKIP_REASON },
      at(1),
    );
    p = applyDecline(
      p,
      { questionPrompt: 'Your sex life?', reason: PREFER_NOT_TO_SAY_SKIP_REASON },
      at(2),
    );
    p = applyDecline(
      p,
      { questionPrompt: 'Describe your vibe', reason: UNCLEAR_SKIP_REASON },
      at(3),
    );
    const g = buildFeedbackGuidance(p, at(4));
    expect(g).toContain("DON'T APPLY");
    expect(g).toContain('How is work?');
    expect(g).toContain('boundary');
    expect(g).toContain('Your sex life?');
    expect(g).toContain('UNCLEAR');
    expect(g).toContain('Describe your vibe');
  });

  it('drops a prefer-not-to-say boundary after the cooldown window', () => {
    const p = applyDecline(
      emptyProfile('p1'),
      { questionPrompt: 'A boundary topic', reason: PREFER_NOT_TO_SAY_SKIP_REASON },
      new Date('2026-01-01T00:00:00.000Z'),
    );
    // 30 days later → within the 180-day cooldown → still avoided.
    expect(buildFeedbackGuidance(p, new Date('2026-01-31T00:00:00.000Z'))).toContain(
      'A boundary topic',
    );
    // 200 days later → past the cooldown → a fresh re-approach is allowed, so it drops off.
    expect(buildFeedbackGuidance(p, new Date('2026-07-20T00:00:00.000Z'))).not.toContain(
      'A boundary topic',
    );
  });

  it('is empty when there is no steering signal (a plain skip / engagement only)', () => {
    let p = applyDecline(
      emptyProfile('p1'),
      { questionPrompt: 'Q', reason: 'later please' },
      at(1),
    );
    p = applyEngagement(p, { topicId: 'x', engagement: 'rich' }, at(2));
    expect(buildFeedbackGuidance(p, at(3))).toBe('');
  });
});

describe('applyReciprocity', () => {
  it('adds new candidates and dedupes by (partner, note), keeping the original timestamp', () => {
    let p = applyReciprocity(
      emptyProfile('p1'),
      [{ fromPartnerId: 'b', note: 'wants rope play' }],
      at(1),
    );
    expect(p.relational?.reciprocity).toHaveLength(1);
    expect(p.relational?.reciprocity[0]).toMatchObject({
      fromPartnerId: 'b',
      note: 'wants rope play',
      explored: false,
    });
    // Re-detecting the same desire is a no-op — the original `at` is kept so it ages out of the fresh window.
    const same = applyReciprocity(p, [{ fromPartnerId: 'b', note: 'wants rope play' }], at(9));
    expect(same.relational?.reciprocity).toHaveLength(1);
    expect(same.relational?.reciprocity[0]?.at).toBe(at(1).toISOString());
    // A genuinely new desire is added, newest first.
    p = applyReciprocity(p, [{ fromPartnerId: 'b', note: 'wants a weekend away' }], at(2));
    expect(p.relational?.reciprocity.map((r) => r.note)).toEqual([
      'wants a weekend away',
      'wants rope play',
    ]);
  });
});
