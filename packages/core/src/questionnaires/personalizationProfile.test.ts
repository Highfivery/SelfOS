import { describe, expect, it } from 'vitest';

import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import {
  NOT_APPLICABLE_SKIP_REASON,
  PREFER_NOT_TO_SAY_SKIP_REASON,
  UNCLEAR_SKIP_REASON,
} from './answering';
import {
  addPartnerWish,
  applyCandidateCuration,
  clearCandidateFeed,
  isActiveCandidate,
  applyChange,
  applyDecline,
  applyEngagement,
  applyReciprocity,
  applySteer,
  buildCandidateGuidance,
  buildFeedbackGuidance,
  CANDIDATE_CAP,
  CANDIDATES_PER_AREA,
  CHANGE_CAP,
  classifyDeclineReason,
  emptyProfile,
  FEEDBACK_CAP,
  markCandidateAsked,
  markChangesExplored,
  mergeCandidates,
  PARTNER_WISH_CAP,
  readProfile,
  removePartnerWish,
  writeProfile,
  type NextCandidate,
  type PersonalizationProfile,
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

  it('reads a pre-spec-70 profile (no candidate fields) as an empty feed — additive, no version bump', async () => {
    const fs = memFileSystem();
    // A profile written before spec 70 existed: no `candidates` / `candidatesRefreshedAt`.
    const legacy = {
      schemaVersion: 1,
      personId: 'p1',
      updatedAt: new Date(0).toISOString(),
      coverage: { topics: [] },
      feedback: [],
      changes: [],
    };
    await writeProfile(fs, key, legacy as never);
    const back = await readProfile(fs, key, 'p1');
    expect(back.candidates).toEqual([]);
    expect(back.candidatesRefreshedAt).toBeUndefined();
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

  it('is empty for a weak signal only (a plain reasonless skip)', () => {
    const p = applyDecline(
      emptyProfile('p1'),
      { questionPrompt: 'Q', reason: 'later please' },
      at(1),
    );
    expect(buildFeedbackGuidance(p, at(2))).toBe('');
  });

  it('steers toward shorter/simpler questionnaires after a recent abandonment (bailed, spec 69 §5.2)', () => {
    const p = applyEngagement(
      emptyProfile('p1'),
      { topicId: 'a1', questionPrompt: 'A long survey', engagement: 'bailed' },
      at(1),
    );
    const g = buildFeedbackGuidance(p, at(2));
    expect(g).toMatch(/left check-ins UNFINISHED/);
    // Topic-agnostic: it must NOT name the unfinished check-in (it's about length, not what to ask).
    expect(g).not.toContain('A long survey');
  });

  it('surfaces a productive vein (answered-richly) as a deepen-with-a-fresh-angle hint (spec 69 §5.2)', () => {
    const p = applyEngagement(
      emptyProfile('p1'),
      { questionPrompt: 'What are you proudest of at work?', engagement: 'rich' },
      at(1),
    );
    const g = buildFeedbackGuidance(p, at(2));
    expect(g).toMatch(/engaged RICHLY/);
    expect(g).toContain('What are you proudest of at work?');
  });

  it('does not surface a productive vein for a topic they later marked off', () => {
    let p = applyEngagement(
      emptyProfile('p1'),
      { questionPrompt: 'Money worries?', engagement: 'rich' },
      at(1),
    );
    p = applyDecline(
      p,
      { questionPrompt: 'Money worries?', reason: NOT_APPLICABLE_SKIP_REASON },
      at(2),
    );
    const g = buildFeedbackGuidance(p, at(3));
    // Marked-off wins: it's in the avoid list, never the productive list.
    expect(g).toMatch(/DON'T APPLY/);
    expect(g).not.toMatch(/engaged RICHLY/);
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

describe('applySteer (spec 69 §3.4 transparency steer)', () => {
  it('leave-alone records a not-applicable feedback entry keyed by topic (→ the avoid list)', () => {
    const p = applySteer(
      emptyProfile('p1'),
      { topicId: 'Work & purpose', label: 'Work & purpose', action: 'leave-alone' },
      at(1),
    );
    const entry = p.feedback.find((f) => f.topicId === 'Work & purpose');
    expect(entry?.kind).toBe('not-applicable');
    // It reaches the generation avoid list.
    expect(buildFeedbackGuidance(p, at(2))).toMatch(/DON'T APPLY[\s\S]*Work & purpose/);
  });

  it('explore-more sets the coverage topic reopenedBy: explicit-request (creating it if absent)', () => {
    const p = applySteer(
      emptyProfile('p1'),
      { topicId: 'Health', lifeArea: 'Health', label: 'Health', action: 'explore-more' },
      at(1),
    );
    const topic = p.coverage.topics.find((t) => t.topicId === 'Health');
    expect(topic?.reopenedBy).toBe('explicit-request');
    expect(topic?.saturated).toBe(false);
  });

  it('explore-more overrides a prior leave-alone (removes the not-applicable entry)', () => {
    let p = applySteer(
      emptyProfile('p1'),
      { topicId: 'Health', label: 'Health', action: 'leave-alone' },
      at(1),
    );
    expect(p.feedback.some((f) => f.topicId === 'Health' && f.kind === 'not-applicable')).toBe(
      true,
    );
    p = applySteer(p, { topicId: 'Health', label: 'Health', action: 'explore-more' }, at(2));
    expect(p.feedback.some((f) => f.topicId === 'Health')).toBe(false);
    expect(p.coverage.topics.find((t) => t.topicId === 'Health')?.reopenedBy).toBe(
      'explicit-request',
    );
  });

  it('clear removes both an explore-more reopen and a leave-alone entry, and is a no-op when nothing is set', () => {
    let p = applySteer(
      emptyProfile('p1'),
      { topicId: 'Health', label: 'Health', action: 'explore-more' },
      at(1),
    );
    p = applySteer(p, { topicId: 'Health', label: 'Health', action: 'clear' }, at(2));
    expect(p.coverage.topics.find((t) => t.topicId === 'Health')?.reopenedBy).toBeUndefined();
    const before = p;
    const after = applySteer(before, { topicId: 'Nope', action: 'clear' }, at(3));
    expect(after).toBe(before); // no change ⇒ identity (no updatedAt churn)
  });
});

// ── Candidate feed (spec 70 §3.2) ───────────────────────────────────────────────────────────────────────────

const candidate = (
  over: Partial<NextCandidate> & { id: string; prompt: string },
): NextCandidate => ({
  lifeArea: 'Work & purpose',
  kind: 'new',
  curation: 'none',
  at: at(1).toISOString(),
  ...over,
});

const withCandidates = (candidates: NextCandidate[]): PersonalizationProfile => ({
  ...emptyProfile('p1'),
  candidates,
});

describe('applyCandidateCuration', () => {
  it('maps each panel action to the persisted curation state', () => {
    let p = withCandidates([candidate({ id: 'c1', prompt: 'What drives you?' })]);
    p = applyCandidateCuration(p, { candidateId: 'c1', action: 'ask' }, at(2));
    expect(p.candidates[0]?.curation).toBe('asked');
    p = applyCandidateCuration(p, { candidateId: 'c1', action: 'not-this' }, at(3));
    expect(p.candidates[0]?.curation).toBe('skipped');
    p = applyCandidateCuration(p, { candidateId: 'c1', action: 'go-deeper' }, at(4));
    expect(p.candidates[0]?.curation).toBe('go-deeper');
    p = applyCandidateCuration(p, { candidateId: 'c1', action: 'clear' }, at(5));
    expect(p.candidates[0]?.curation).toBe('none');
  });

  it('is a no-op for an unknown or already-minted candidate (identity, no churn)', () => {
    const p = withCandidates([
      candidate({ id: 'c1', prompt: 'A', mintedAssignmentId: 'a1' }),
      candidate({ id: 'c2', prompt: 'B', curation: 'asked' }),
    ]);
    expect(applyCandidateCuration(p, { candidateId: 'nope', action: 'ask' }, at(2))).toBe(p);
    // already-minted candidate can't be re-curated
    expect(applyCandidateCuration(p, { candidateId: 'c1', action: 'ask' }, at(2))).toBe(p);
    // no-change action returns identity
    expect(applyCandidateCuration(p, { candidateId: 'c2', action: 'ask' }, at(2))).toBe(p);
  });
});

describe('clearCandidateFeed', () => {
  it('marks every ACTIVE candidate skipped, leaving minted + already-skipped ones untouched', () => {
    const p = withCandidates([
      candidate({ id: 'c1', prompt: 'A' }),
      candidate({ id: 'c2', prompt: 'B', curation: 'asked' }),
      candidate({ id: 'c3', prompt: 'C', curation: 'skipped' }),
      candidate({ id: 'c4', prompt: 'D', mintedAssignmentId: 'a1' }),
    ]);
    const cleared = clearCandidateFeed(p, at(9));
    // No active candidate remains → the feed is empty.
    expect(cleared.candidates.filter(isActiveCandidate)).toHaveLength(0);
    expect(cleared.candidates.find((c) => c.id === 'c1')?.curation).toBe('skipped');
    expect(cleared.candidates.find((c) => c.id === 'c2')?.curation).toBe('skipped'); // was 'asked'
    // The already-minted candidate keeps its minted stamp (it was asked, not shown).
    expect(cleared.candidates.find((c) => c.id === 'c4')?.mintedAssignmentId).toBe('a1');
  });

  it('is a no-op (identity) when the feed is already empty', () => {
    const p = withCandidates([candidate({ id: 'c1', prompt: 'A', curation: 'skipped' })]);
    expect(clearCandidateFeed(p, at(9))).toBe(p);
  });
});

describe('markCandidateAsked', () => {
  it('stamps a candidate whose prompt was actually asked so it drops off + stops steering', () => {
    const p = withCandidates([
      candidate({ id: 'c1', prompt: 'What does a good day at work look like for you?' }),
      candidate({ id: 'c2', prompt: 'What do you do to unwind?' }),
    ]);
    const stamped = markCandidateAsked(
      p,
      { assignmentId: 'a1', askedPrompts: ['what does a good work day look like for you'] },
      at(2),
    );
    expect(stamped.candidates.find((c) => c.id === 'c1')?.mintedAssignmentId).toBe('a1');
    expect(stamped.candidates.find((c) => c.id === 'c2')?.mintedAssignmentId).toBeUndefined();
    // The minted one is excluded from generation steering.
    const guidance = buildCandidateGuidance(stamped);
    expect(guidance).not.toContain('good day at work');
    expect(guidance).toContain('unwind');
  });

  it('is idempotent + a no-op when nothing matches (identity)', () => {
    const p = withCandidates([candidate({ id: 'c1', prompt: 'What drives you?' })]);
    expect(markCandidateAsked(p, { assignmentId: 'a1', askedPrompts: [] }, at(2))).toBe(p);
    expect(
      markCandidateAsked(p, { assignmentId: 'a1', askedPrompts: ['totally unrelated'] }, at(2)),
    ).toBe(p);
    const once = markCandidateAsked(
      p,
      { assignmentId: 'a1', askedPrompts: ['what drives you'] },
      at(2),
    );
    expect(once.candidates[0]?.mintedAssignmentId).toBe('a1');
    expect(
      markCandidateAsked(once, { assignmentId: 'a2', askedPrompts: ['what drives you'] }, at(3)),
    ).toBe(once);
  });
});

describe('mergeCandidates', () => {
  it('carries pinned candidates forward, drops asked ones, and never re-proposes a skipped phrasing', () => {
    const p = withCandidates([
      candidate({ id: 'pin', prompt: 'What are you most proud of lately?', curation: 'asked' }),
      candidate({ id: 'skip', prompt: 'How is your love life?', curation: 'skipped' }),
      candidate({ id: 'old', prompt: 'What does rest mean to you?' }),
    ]);
    // "old" was actually asked; the proposal re-offers the skipped phrasing + a genuinely new one.
    const merged = mergeCandidates(
      p,
      [
        { lifeArea: 'Relationships', prompt: 'how is your love life', kind: 'new' },
        { lifeArea: 'Health & body', prompt: 'What helps you sleep well?', kind: 'new' },
      ],
      ['what does rest mean to you'],
      at(2),
    );
    const prompts = merged.candidates.map((c) => c.prompt);
    expect(prompts).toContain('What are you most proud of lately?'); // pin carried forward
    expect(prompts).not.toContain('What does rest mean to you?'); // asked → dropped
    expect(prompts).toContain('What helps you sleep well?'); // genuinely new → added
    // the skipped phrasing is not re-proposed as a fresh candidate...
    expect(
      merged.candidates.filter((c) => c.prompt.toLowerCase() === 'how is your love life'),
    ).toHaveLength(0);
    // ...but the person's existing skip is preserved (still declined).
    expect(merged.candidates.find((c) => c.id === 'skip')?.curation).toBe('skipped');
    expect(merged.candidatesRefreshedAt).toBe(at(2).toISOString());
  });

  it('caps proposals per life area', () => {
    // Genuinely distinct prompts (no shared subject tokens) so the per-area cap — not the near-dup filter — limits them.
    const topics = [
      'How do you feel about your savings?',
      'What would financial freedom look like?',
      'Where does debt weigh on you?',
      'Which purchase last brought you joy?',
      'When did money first stress you out?',
    ];
    const proposed = topics.map((prompt) => ({ lifeArea: 'Money', prompt, kind: 'new' as const }));
    expect(proposed.length).toBeGreaterThan(CANDIDATES_PER_AREA);
    const merged = mergeCandidates(emptyProfile('p1'), proposed, [], at(2));
    expect(merged.candidates.filter((c) => c.lifeArea === 'Money')).toHaveLength(
      CANDIDATES_PER_AREA,
    );
  });

  it('declined ("Not this") candidates never block their area or freeze the feed (spec 70 §13)', () => {
    // Three declined candidates in one area — "Not this" is not a topic ban, so a fresh set still fills it.
    const declined: NextCandidate[] = [
      candidate({
        id: 's1',
        lifeArea: 'Money',
        prompt: 'How do you feel about your savings?',
        curation: 'skipped',
      }),
      candidate({
        id: 's2',
        lifeArea: 'Money',
        prompt: 'What would financial freedom look like?',
        curation: 'skipped',
      }),
      candidate({
        id: 's3',
        lifeArea: 'Money',
        prompt: 'Where does debt weigh on you?',
        curation: 'skipped',
      }),
    ];
    const proposed = [
      {
        lifeArea: 'Money',
        prompt: 'What did your family teach you about money?',
        kind: 'new' as const,
      },
      {
        lifeArea: 'Money',
        prompt: 'When did you last feel financially secure?',
        kind: 'new' as const,
      },
      // …but re-proposing a declined phrasing verbatim is still dropped (the de-dup memory).
      { lifeArea: 'Money', prompt: 'How do you feel about your savings?', kind: 'new' as const },
    ];
    const merged = mergeCandidates(withCandidates(declined), proposed, [], at(2));
    const activeMoney = merged.candidates.filter(
      (c) => c.lifeArea === 'Money' && c.curation === 'none',
    );
    // The area re-filled up to the per-area cap despite three declines sitting in it.
    expect(activeMoney).toHaveLength(CANDIDATES_PER_AREA - 1); // 2 genuinely-new (the 3rd was a declined re-ask)
    expect(activeMoney.map((c) => c.prompt)).toContain(
      'What did your family teach you about money?',
    );
    // The declined phrasing was NOT re-added as an active candidate.
    expect(activeMoney.map((c) => c.prompt)).not.toContain('How do you feel about your savings?');
    // The declines are retained (bounded de-dup memory), still marked skipped.
    expect(merged.candidates.filter((c) => c.curation === 'skipped')).toHaveLength(3);
    // buildCandidateGuidance shows the fresh candidates, not the declines.
    const g = buildCandidateGuidance(merged);
    expect(g).toContain('What did your family teach you about money?');
    expect(g).not.toContain('How do you feel about your savings?');
  });

  it('bounds the stored set, keeping curated candidates', () => {
    // Index-tagged tokens so no two prompts near-duplicate (each `existingN entryN` is unique to its index).
    const existing = Array.from({ length: CANDIDATE_CAP }, (_, i) =>
      candidate({ id: `e${i}`, lifeArea: `Area ${i}`, prompt: `existing${i} entry${i}` }),
    );
    existing[0] = { ...existing[0]!, curation: 'asked' };
    const proposed = Array.from({ length: 5 }, (_, i) => ({
      lifeArea: `New area ${i}`,
      prompt: `fresh${i} item${i}`,
      kind: 'new' as const,
    }));
    const merged = mergeCandidates(withCandidates(existing), proposed, [], at(2));
    expect(merged.candidates).toHaveLength(CANDIDATE_CAP);
    // The pinned candidate is never dropped by the cap (curated candidates sort first).
    expect(merged.candidates.some((c) => c.id === 'e0' && c.curation === 'asked')).toBe(true);
  });
});

describe('buildCandidateGuidance', () => {
  it('leads with pinned (★), splits new vs go-deeper, and excludes skipped/minted; empty ⇒ ""', () => {
    expect(buildCandidateGuidance(emptyProfile('p1'))).toBe('');
    const p = withCandidates([
      candidate({ id: 'c1', prompt: 'A plain new question', kind: 'new' }),
      candidate({ id: 'c2', prompt: 'A pinned question', kind: 'new', curation: 'asked' }),
      candidate({ id: 'c3', prompt: 'A deeper thread', kind: 'go-deeper' }),
      candidate({ id: 'c4', prompt: 'A declined question', kind: 'new', curation: 'skipped' }),
      candidate({ id: 'c5', prompt: 'An asked question', kind: 'new', mintedAssignmentId: 'a1' }),
    ]);
    const g = buildCandidateGuidance(p);
    expect(g).toContain('QUESTIONS SELFOS IS CURIOUS ABOUT ASKING THIS PERSON NEXT');
    expect(g).toContain('★ A pinned question');
    expect(g).toContain('New ground');
    expect(g).toContain('Threads worth going deeper on');
    expect(g).toContain('A deeper thread');
    expect(g).not.toContain('A declined question'); // skipped excluded
    expect(g).not.toContain('An asked question'); // minted excluded
    // pinned leads its section (before the plain new one).
    expect(g.indexOf('A pinned question')).toBeLessThan(g.indexOf('A plain new question'));
  });
});

// ── Partner wishes (spec 70 §3.5) ───────────────────────────────────────────────────────────────────────────

describe('addPartnerWish / removePartnerWish', () => {
  it('adds a wish to the OWN profile, dedups an identical (partner, note), and removes by id', () => {
    let p = addPartnerWish(
      emptyProfile('a'),
      { partnerPersonId: 'b', note: 'try cooking together' },
      at(1),
    );
    expect(p.relational?.partnerWishes).toHaveLength(1);
    expect(p.relational!.partnerWishes[0]).toMatchObject({
      partnerPersonId: 'b',
      note: 'try cooking together',
      intimacy: false,
    });
    // Re-adding the same (partner, note) refreshes rather than bloats.
    p = addPartnerWish(p, { partnerPersonId: 'b', note: 'try cooking together' }, at(5));
    expect(p.relational?.partnerWishes).toHaveLength(1);
    // A different partner + an intimacy wish are separate entries.
    p = addPartnerWish(p, { partnerPersonId: 'b', note: 'more foreplay', intimacy: true }, at(6));
    p = addPartnerWish(p, { partnerPersonId: 'c', note: 'talk about money' }, at(7));
    expect(p.relational?.partnerWishes).toHaveLength(3);
    expect(p.relational?.partnerWishes.find((w) => w.note === 'more foreplay')?.intimacy).toBe(
      true,
    );
    // Remove by id (read the CURRENT id — a re-add mints a fresh one).
    const removeId = p.relational!.partnerWishes.find((w) => w.note === 'try cooking together')!.id;
    p = removePartnerWish(p, removeId, at(8));
    expect(p.relational?.partnerWishes.some((w) => w.id === removeId)).toBe(false);
    expect(p.relational?.partnerWishes).toHaveLength(2);
  });

  it('a blank note is a no-op; removing a missing id is a no-op (identity)', () => {
    const p = emptyProfile('a');
    expect(addPartnerWish(p, { partnerPersonId: 'b', note: '   ' }, at(1))).toBe(p);
    const withOne = addPartnerWish(p, { partnerPersonId: 'b', note: 'x' }, at(1));
    expect(removePartnerWish(withOne, 'nope', at(2))).toBe(withOne);
  });

  it('caps the stored wishes at PARTNER_WISH_CAP (newest kept)', () => {
    let p = emptyProfile('a');
    for (let i = 0; i < PARTNER_WISH_CAP + 5; i++) {
      p = addPartnerWish(p, { partnerPersonId: 'b', note: `wish number ${i}` }, at(i));
    }
    expect(p.relational?.partnerWishes).toHaveLength(PARTNER_WISH_CAP);
    expect(p.relational?.partnerWishes[0]?.note).toBe(`wish number ${PARTNER_WISH_CAP + 4}`);
  });

  it('preserves the reciprocity ledger when adding a wish', () => {
    let p = applyReciprocity(
      emptyProfile('a'),
      [{ fromPartnerId: 'b', note: 'partner likes X' }],
      at(1),
    );
    p = addPartnerWish(p, { partnerPersonId: 'b', note: 'a wish' }, at(2));
    expect(p.relational?.reciprocity).toHaveLength(1);
    expect(p.relational?.partnerWishes).toHaveLength(1);
  });
});
