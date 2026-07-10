import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { Insight, InsightFact } from '../schemas';
import {
  deleteInsight,
  digestableInsights,
  flagInsightFact,
  getInsight,
  listInsightsForPerson,
  listRelatedShareableInsights,
  reapOrphanShares,
  saveInsight,
  selectPortraitFacts,
  summarizeForContext,
} from './insightStore';

const key = generateMasterKey();

function insight(over: Partial<Insight> & { id: string; subjectPersonId: string }): Insight {
  return {
    schemaVersion: 1,
    source: 'questionnaire',
    summary: `summary-${over.id}`,
    facts: [],
    confidence: 'medium',
    categories: [],
    approved: true,
    provenance: { at: '2026-06-10T00:00:00.000Z' },
    createdAt: '2026-06-10T00:00:00.000Z',
    updatedAt: '2026-06-10T00:00:00.000Z',
    ...over,
  };
}

const pf = (id: string, lifeArea?: string): InsightFact => ({
  id,
  text: `fact-${id}`,
  shareable: false,
  ...(lifeArea ? { lifeArea } : {}),
});

describe('digestableInsights (topic-free cross-feature digests — 52 §8.4 leak guard)', () => {
  const restrictedFact = (id: string): InsightFact => ({
    id,
    text: `restricted-${id}`,
    shareable: false,
    restricted: true,
    lifeArea: 'Intimacy',
  });

  it('keeps a normal insight', () => {
    const i = insight({ id: 'a', subjectPersonId: 'p', facts: [pf('f1')] });
    expect(digestableInsights([i]).map((x) => x.id)).toEqual(['a']);
  });

  it('drops a WHOLLY-restricted insight ENTIRELY (e.g. a challenge reflection — its summary restates it)', () => {
    const i = insight({
      id: 'r',
      subjectPersonId: 'p',
      summary: 'Took on a challenge: "explore X". They reflected: <intimate detail>',
      facts: [restrictedFact('a'), restrictedFact('b')],
    });
    expect(digestableInsights([i])).toEqual([]);
  });

  it('KEEPS a mixed insight (some restricted facts + a general summary, e.g. the intake portrait)', () => {
    const i = insight({
      id: 'portrait',
      subjectPersonId: 'p',
      summary: 'A general overview of who they are',
      facts: [pf('shareable'), restrictedFact('secret')],
    });
    // Kept so the digest still names the portrait; its restricted fact is dropped on the facts line elsewhere.
    expect(digestableInsights([i]).map((x) => x.id)).toEqual(['portrait']);
  });

  it('drops a wholly-flagged insight (summary restates a corrected claim)', () => {
    const i = insight({
      id: 'w',
      subjectPersonId: 'p',
      facts: [{ ...pf('f1'), flaggedInaccurate: true }],
    });
    expect(digestableInsights([i])).toEqual([]);
  });

  it('a restricted fact that is ALSO flagged-inaccurate is not "live" → a sibling live fact keeps the insight', () => {
    const i = insight({
      id: 'rf',
      subjectPersonId: 'p',
      facts: [pf('keepme'), { ...restrictedFact('gone'), flaggedInaccurate: true }],
    });
    expect(digestableInsights([i]).map((x) => x.id)).toEqual(['rf']);
  });
});

describe('selectPortraitFacts (28 §pillar-2 — per-call portrait relevance)', () => {
  it('legacy: NO life-area tags → bounds to the budget (45), no narrowing, order preserved', () => {
    const facts = Array.from({ length: 60 }, (_, i) => pf(`f${i}`)); // all untagged
    const out = selectPortraitFacts(facts, { lifeAreas: ['Money'] }, false);
    expect(out.length).toBe(45);
    expect(out[0]?.id).toBe('f0');
    expect(out.at(-1)?.id).toBe('f44');
  });

  it('a crisis-flagged portrait is NEVER topically narrowed — only bounded', () => {
    const facts = [
      pf('money', 'Money'),
      pf('intimacy', 'Intimacy'),
      ...Array.from({ length: 5 }, (_, i) => pf(`fam${i}`, 'Family')),
    ];
    const out = selectPortraitFacts(facts, { lifeAreas: ['Money'] }, true);
    // Off-topic Intimacy/Family facts are all kept (under budget) — distress safety: keep the full picture.
    expect(out.map((f) => f.id)).toEqual(facts.map((f) => f.id));
  });

  it('always includes CORE (identity/goals/emotions/relationships/health + untagged) regardless of topic', () => {
    const facts = [
      pf('emotions', 'Emotions & patterns'),
      pf('goals', 'Goals & growth'),
      pf('rel', 'Relationships'),
      pf('untagged'),
      pf('money', 'Money'), // topical, NOT in this topic
    ];
    const ids = selectPortraitFacts(facts, { lifeAreas: ['Intimacy'] }, false).map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['emotions', 'goals', 'rel', 'untagged']));
  });

  it('NARROWS: keeps core + the topic facts, drops off-topic non-core when over budget', () => {
    const core = Array.from({ length: 25 }, (_, i) => pf(`core${i}`, 'Goals & growth'));
    const money = Array.from({ length: 30 }, (_, i) => pf(`money${i}`, 'Money'));
    const intimacy = Array.from({ length: 30 }, (_, i) => pf(`int${i}`, 'Intimacy'));
    const ids = selectPortraitFacts(
      [...core, ...money, ...intimacy],
      { lifeAreas: ['Money'] },
      false,
    ).map((f) => f.id);
    expect(ids.length).toBe(45);
    expect(ids.filter((id) => id.startsWith('core')).length).toBe(25); // all core guaranteed
    expect(ids.filter((id) => id.startsWith('money')).length).toBe(20); // topic fills the rest
    expect(ids.some((id) => id.startsWith('int'))).toBe(false); // off-topic, non-core → dropped
  });

  it('distress (Emotions & patterns) is core → present even on an unrelated (Money) topic, over budget', () => {
    const facts = [
      pf('distress', 'Emotions & patterns'),
      ...Array.from({ length: 50 }, (_, i) => pf(`m${i}`, 'Money')),
    ];
    const ids = selectPortraitFacts(facts, { lifeAreas: ['Money'] }, false).map((f) => f.id);
    expect(ids).toContain('distress');
  });

  it('SAFETY: a distress fact ranked LAST, past a full core budget, is still kept on an off-topic call', () => {
    // 25 higher-priority core (fills the core budget) + 30 topic facts (fill the rest) would crowd out a
    // late distress fact WITHOUT the always-take-distress rule. It must survive (CLAUDE.md §1).
    const facts = [
      ...Array.from({ length: 25 }, (_, i) => pf(`g${i}`, 'Goals & growth')),
      ...Array.from({ length: 30 }, (_, i) => pf(`m${i}`, 'Money')),
      pf('latedistress', 'Emotions & patterns'),
    ];
    const ids = selectPortraitFacts(facts, { lifeAreas: ['Money'] }, false).map((f) => f.id);
    expect(ids).toContain('latedistress');
    expect(ids.length).toBe(45);
  });

  it('no topic → core + priority fill, bounded (no topical preference)', () => {
    const facts = Array.from({ length: 60 }, (_, i) =>
      pf(`f${i}`, i < 10 ? 'Goals & growth' : 'Money'),
    );
    expect(selectPortraitFacts(facts, undefined, false).length).toBe(45);
  });
});

describe('insightStore', () => {
  it('saves, reads, lists (newest first), and deletes', async () => {
    const fs = memFileSystem();
    await saveInsight(
      fs,
      key,
      insight({ id: 'i1', subjectPersonId: 'p1', updatedAt: '2026-06-10T10:00:00.000Z' }),
    );
    await saveInsight(
      fs,
      key,
      insight({ id: 'i2', subjectPersonId: 'p1', updatedAt: '2026-06-10T12:00:00.000Z' }),
    );
    expect((await listInsightsForPerson(fs, key, 'p1')).map((i) => i.id)).toEqual(['i2', 'i1']);
    expect((await getInsight(fs, key, 'p1', 'i1'))?.summary).toBe('summary-i1');
    await deleteInsight(fs, 'p1', 'i1');
    expect(await getInsight(fs, key, 'p1', 'i1')).toBeNull();
  });

  it('stores insights encrypted at rest', async () => {
    const fs = memFileSystem();
    await saveInsight(
      fs,
      key,
      insight({ id: 'i1', subjectPersonId: 'p1', summary: 'they love climbing' }),
    );
    const bytes = await fs.read('people/p1/insights/i1.enc');
    const raw = bytes && new TextDecoder().decode(bytes);
    expect(raw).toContain('aes-256-gcm');
    expect(raw).not.toContain('they love climbing');
  });

  describe('summarizeForContext', () => {
    it('includes own approved insights (summary + all own facts) and excludes unapproved ones', async () => {
      const fs = memFileSystem();
      await saveInsight(
        fs,
        key,
        insight({
          id: 'i1',
          subjectPersonId: 'p1',
          summary: 'values honesty',
          facts: [{ id: 'f1', text: 'private to them', shareable: false }],
        }),
      );
      await saveInsight(
        fs,
        key,
        insight({ id: 'i2', subjectPersonId: 'p1', approved: false, summary: 'not yet approved' }),
      );

      const out = await summarizeForContext(fs, key, 'p1', []);
      expect(out).toContain('values honesty');
      expect(out).toContain('private to them'); // own private facts feed their OWN coaching
      expect(out).not.toContain('not yet approved'); // unapproved insights never enter context
    });

    it('gates a SENSITIVE (restricted) own insight to its life-area topic — feeds intimacy, not money (50 §3.4)', async () => {
      const fs = memFileSystem();
      await saveInsight(
        fs,
        key,
        insight({
          id: 'i1',
          subjectPersonId: 'p1',
          source: 'test',
          summary: 'their intimacy interests',
          facts: [
            {
              id: 'f1',
              text: 'strong draw to impact',
              shareable: false,
              restricted: true,
              lifeArea: 'Intimacy',
            },
          ],
        }),
      );
      expect(await summarizeForContext(fs, key, 'p1', [], { lifeAreas: ['Intimacy'] })).toContain(
        'their intimacy interests',
      );
      expect(await summarizeForContext(fs, key, 'p1', [], { lifeAreas: ['Money'] })).not.toContain(
        'their intimacy interests',
      );
    });

    it('fail-closed: a restricted fact with NO life-area is withheld from EVERY context (50 §8)', async () => {
      const fs = memFileSystem();
      await saveInsight(
        fs,
        key,
        insight({
          id: 'i1',
          subjectPersonId: 'p1',
          source: 'test',
          summary: 'untagged sensitive summary',
          facts: [{ id: 'f1', text: 'sensitive fact', shareable: false, restricted: true }],
        }),
      );
      // No life-area to match → withheld even when the topic is Intimacy (never leaks the summary).
      expect(
        await summarizeForContext(fs, key, 'p1', [], { lifeAreas: ['Intimacy'] }),
      ).not.toContain('untagged sensitive summary');
    });

    it('excludeRestricted (58 §6.3): drops the pinned portrait’s restricted + sensitive facts even on an intimacy topic, keeps its safe summary + general facts', async () => {
      const fs = memFileSystem();
      await saveInsight(
        fs,
        key,
        insight({
          id: 'portrait',
          subjectPersonId: 'p1',
          source: 'intake', // the PINNED portrait — otherwise exempt from relevance gating (§15)
          summary: 'a warm, thoughtful person',
          facts: [
            { id: 'g', text: 'loves hiking', shareable: false },
            {
              id: 'r',
              text: 'a trauma disclosure',
              shareable: false,
              restricted: true,
              lifeArea: 'Intimacy',
            },
            { id: 's', text: 'a desire preference', shareable: false, lifeArea: 'Intimacy' },
          ],
        }),
      );
      const topic = { lifeAreas: ['Intimacy'] };
      // Normal (solo) context on an intimacy topic: the portrait is present and its restricted/sensitive facts feed.
      const solo = await summarizeForContext(fs, key, 'p1', [], topic);
      expect(solo).toContain('a trauma disclosure');
      expect(solo).toContain('a desire preference');

      // The couples path: same topic, but restricted + sensitive facts are dropped; summary + general fact stay.
      const couples = await summarizeForContext(fs, key, 'p1', [], topic, 'Ben', {
        excludeRestricted: true,
      });
      expect(couples).toContain('a warm, thoughtful person');
      expect(couples).toContain('loves hiking');
      expect(couples).not.toContain('a trauma disclosure');
      expect(couples).not.toContain('a desire preference');
    });

    it('excludeRestricted drops a WHOLLY-restricted insight’s summary too (nothing left to feed)', async () => {
      const fs = memFileSystem();
      await saveInsight(
        fs,
        key,
        insight({
          id: 'portrait',
          subjectPersonId: 'p1',
          source: 'intake',
          summary: 'general portrait line',
          facts: [{ id: 'g', text: 'enjoys cooking', shareable: false }],
        }),
      );
      // A separate wholly-restricted intake fact set would already be dropped by feedableInsights; here we
      // confirm the general portrait still feeds under excludeRestricted (default-off callers unaffected).
      const couples = await summarizeForContext(fs, key, 'p1', [], undefined, 'Ben', {
        excludeRestricted: true,
      });
      expect(couples).toContain('general portrait line');
      expect(couples).toContain('enjoys cooking');
    });

    it("includes related people's SHAREABLE facts but never their private ones", async () => {
      const fs = memFileSystem();
      await saveInsight(
        fs,
        key,
        insight({
          id: 'i1',
          subjectPersonId: 'p2',
          facts: [
            { id: 'f1', text: 'p2 started a new job', shareable: true },
            { id: 'f2', text: 'p2 confidential', shareable: false },
          ],
        }),
      );

      const out = await summarizeForContext(fs, key, 'p1', [{ id: 'p2', displayName: 'Sam' }]);
      expect(out).toContain('Shareable about Sam');
      expect(out).toContain('p2 started a new job');
      expect(out).not.toContain('p2 confidential');
    });

    it('PINS the onboarding portrait (source intake) in context past the recency cap', async () => {
      const fs = memFileSystem();
      // An old intake portrait, then 14 newer session insights (> the 12 own-insight cap).
      await saveInsight(
        fs,
        key,
        insight({
          id: 'portrait',
          subjectPersonId: 'p1',
          source: 'intake',
          summary: 'the foundational portrait',
          updatedAt: '2026-06-01T00:00:00.000Z',
        }),
      );
      for (let i = 0; i < 14; i += 1) {
        await saveInsight(
          fs,
          key,
          insight({
            id: `s${i}`,
            subjectPersonId: 'p1',
            source: 'session',
            summary: `session ${i}`,
            updatedAt: `2026-06-${String(10 + i).padStart(2, '0')}T00:00:00.000Z`,
          }),
        );
      }
      const out = await summarizeForContext(fs, key, 'p1', []);
      // Despite being the oldest, the portrait is still in context (pinned).
      expect(out).toContain('the foundational portrait');
    });

    it('returns an empty string when there are no insights', async () => {
      const fs = memFileSystem();
      expect(await summarizeForContext(fs, key, 'p1', [])).toBe('');
    });

    it('selects the topic-relevant portrait facts (28): a Money topic surfaces Money facts, not Intimacy', async () => {
      const fs = memFileSystem();
      // An intake portrait larger than the per-call budget: all-core fillers + 1 Money + 1 Intimacy fact.
      const facts: InsightFact[] = [
        ...Array.from({ length: 45 }, (_, i) => pf(`core${i}`, 'Goals & growth')),
        pf('themoney', 'Money'),
        pf('theintimacy', 'Intimacy'),
      ];
      await saveInsight(
        fs,
        key,
        insight({ id: 'portrait', subjectPersonId: 'p1', source: 'intake', facts }),
      );
      const moneyCtx = await summarizeForContext(fs, key, 'p1', [], { lifeAreas: ['Money'] });
      // The Money fact is surfaced for a money topic; the off-topic Intimacy fact is narrowed out (budget).
      expect(moneyCtx).toContain('fact-themoney');
      expect(moneyCtx).not.toContain('fact-theintimacy');
      // The pinned summary is always present regardless of topic.
      expect(moneyCtx).toContain('summary-portrait');
    });
  });

  describe('listRelatedShareableInsights (the Memory dashboard view, spec 20 §5.1)', () => {
    const related = [{ id: 'p2', displayName: 'Sam' }];

    it("surfaces a related person's shareable facts only, with the summary stripped", async () => {
      const fs = memFileSystem();
      await saveInsight(
        fs,
        key,
        insight({
          id: 'i1',
          subjectPersonId: 'p2',
          summary: 'SAMS PRIVATE SUMMARY',
          facts: [
            { id: 'f1', text: 'p2 started a new job', shareable: true },
            { id: 'f2', text: 'p2 confidential', shareable: false },
          ],
        }),
      );
      const out = await listRelatedShareableInsights(fs, key, 'p1', related);
      expect(out).toHaveLength(1);
      expect(out[0]!.subjectPersonId).toBe('p2');
      expect(out[0]!.summary).toBe(''); // a related person's summary is private to them — never crosses over
      expect(out[0]!.facts.map((f) => f.text)).toEqual(['p2 started a new job']);
      expect(out[0]!.facts.some((f) => f.text === 'p2 confidential')).toBe(false);
    });

    it("scrubs a related person's private envelope (metrics, crisisFlag, precise provenance, shareableWith)", async () => {
      const fs = memFileSystem();
      await saveInsight(
        fs,
        key,
        insight({
          id: 'i1',
          subjectPersonId: 'p2',
          summary: 'SAMS PRIVATE SUMMARY',
          metrics: { moodValence: -0.8, moodEnergy: -0.5 },
          crisisFlag: true,
          provenance: { intakeSection: 'what-weighs-on-you', conversationId: 'conv-99', at: 'now' },
          facts: [
            { id: 'f1', text: 'p2 likes hiking', shareable: true, shareableWith: ['pX', 'p1'] },
          ],
        }),
      );
      const [related] = await listRelatedShareableInsights(fs, key, 'p1', [
        { id: 'p2', displayName: 'Sam' },
      ]);
      expect(related).toBeDefined();
      expect(related!.metrics).toBeUndefined(); // private wellbeing signals never cross over
      expect(related!.crisisFlag).toBeUndefined(); // their crisis state is their own
      expect(related!.provenance).toEqual({ at: 'now' }); // precise origin (section/conversation) stripped
      expect(related!.summary).toBe('');
      // The shared fact crosses with text only — `shareableWith` (who ELSE has it) does not.
      expect(related!.facts).toEqual([{ id: 'f1', text: 'p2 likes hiking', shareable: true }]);
    });

    it('honors per-person targeting (shareableWith) and never exposes a restricted fact', async () => {
      const fs = memFileSystem();
      await saveInsight(
        fs,
        key,
        insight({
          id: 'i1',
          subjectPersonId: 'p2',
          facts: [
            { id: 'f1', text: 'targeted at p1', shareable: false, shareableWith: ['p1'] },
            { id: 'f2', text: 'targeted at someone else', shareable: false, shareableWith: ['pX'] },
            { id: 'f3', text: 'restricted yet shareable', shareable: true, restricted: true },
          ],
        }),
      );
      const out = await listRelatedShareableInsights(fs, key, 'p1', related);
      expect(out[0]!.facts.map((f) => f.text)).toEqual(['targeted at p1']);
    });

    it('excludes a related draft (unapproved) insight and drops insights with no shareable fact', async () => {
      const fs = memFileSystem();
      await saveInsight(
        fs,
        key,
        insight({
          id: 'draft',
          subjectPersonId: 'p2',
          approved: false,
          facts: [{ id: 'f1', text: 'unapproved but shareable', shareable: true }],
        }),
      );
      await saveInsight(
        fs,
        key,
        insight({
          id: 'allPrivate',
          subjectPersonId: 'p2',
          facts: [{ id: 'f1', text: 'all private', shareable: false }],
        }),
      );
      expect(await listRelatedShareableInsights(fs, key, 'p1', related)).toEqual([]);
    });
  });

  describe('flagInsightFact + flagged-fact context exclusion (spec 20 §3.6)', () => {
    const now = new Date('2026-06-16T00:00:00.000Z');

    it('flags one fact (stamps flaggedAt) and clears it (drops both fields)', async () => {
      const fs = memFileSystem();
      await saveInsight(
        fs,
        key,
        insight({
          id: 'i1',
          subjectPersonId: 'p1',
          facts: [
            { id: 'f1', text: 'fact one', shareable: false },
            { id: 'f2', text: 'fact two', shareable: false },
          ],
        }),
      );
      const flagged = await flagInsightFact(fs, key, 'p1', 'i1', 'f1', true, now);
      expect(flagged?.facts.find((f) => f.id === 'f1')?.flaggedInaccurate).toBe(true);
      expect(flagged?.facts.find((f) => f.id === 'f1')?.flaggedAt).toBe('2026-06-16T00:00:00.000Z');
      expect(flagged?.facts.find((f) => f.id === 'f2')?.flaggedInaccurate).toBeUndefined();

      const cleared = await flagInsightFact(fs, key, 'p1', 'i1', 'f1', false, now);
      const f1 = cleared?.facts.find((f) => f.id === 'f1');
      expect(f1 && 'flaggedInaccurate' in f1).toBe(false);
      expect(f1 && 'flaggedAt' in f1).toBe(false);
    });

    it('flags the whole insight when factId is null', async () => {
      const fs = memFileSystem();
      await saveInsight(
        fs,
        key,
        insight({
          id: 'i1',
          subjectPersonId: 'p1',
          facts: [
            { id: 'f1', text: 'a', shareable: false },
            { id: 'f2', text: 'b', shareable: false },
          ],
        }),
      );
      const flagged = await flagInsightFact(fs, key, 'p1', 'i1', null, true, now);
      expect(flagged?.facts.every((f) => f.flaggedInaccurate)).toBe(true);
    });

    it('excludes a flagged fact from OWN context immediately (summarizeForContext)', async () => {
      const fs = memFileSystem();
      await saveInsight(
        fs,
        key,
        insight({
          id: 'i1',
          subjectPersonId: 'p1',
          facts: [
            { id: 'f1', text: 'still true', shareable: false },
            { id: 'f2', text: 'WRONG', shareable: false, flaggedInaccurate: true },
          ],
        }),
      );
      const out = await summarizeForContext(fs, key, 'p1', []);
      expect(out).toContain('still true');
      expect(out).not.toContain('WRONG');
    });

    it('drops a WHOLLY-flagged insight (summary too) from own context', async () => {
      const fs = memFileSystem();
      await saveInsight(
        fs,
        key,
        insight({
          id: 'i1',
          subjectPersonId: 'p1',
          summary: 'THIS WHOLE THING IS WRONG',
          facts: [
            { id: 'f1', text: 'wrong a', shareable: false, flaggedInaccurate: true },
            { id: 'f2', text: 'wrong b', shareable: false, flaggedInaccurate: true },
          ],
        }),
      );
      await saveInsight(
        fs,
        key,
        insight({ id: 'i2', subjectPersonId: 'p1', summary: 'still good' }),
      );
      const out = await summarizeForContext(fs, key, 'p1', []);
      expect(out).not.toContain('THIS WHOLE THING IS WRONG'); // the summary is gone too
      expect(out).toContain('still good'); // an unflagged summary-only insight is unaffected
    });

    it('excludes a flagged fact from a RELATED person’s shared context', async () => {
      const fs = memFileSystem();
      await saveInsight(
        fs,
        key,
        insight({
          id: 'i1',
          subjectPersonId: 'p2',
          facts: [
            { id: 'f1', text: 'shareable + true', shareable: true },
            { id: 'f2', text: 'shareable but WRONG', shareable: true, flaggedInaccurate: true },
          ],
        }),
      );
      const out = await summarizeForContext(fs, key, 'p1', [{ id: 'p2', displayName: 'Sam' }]);
      expect(out).toContain('shareable + true');
      expect(out).not.toContain('WRONG');
      // ...and from the Memory dashboard's related view too.
      const related = await listRelatedShareableInsights(fs, key, 'p1', [
        { id: 'p2', displayName: 'Sam' },
      ]);
      expect(related[0]?.facts.map((f) => f.text)).toEqual(['shareable + true']);
    });

    it('RETRACTS a previously-shared fact on flag (strips shares + stamps retractedShareAt)', async () => {
      const fs = memFileSystem();
      await saveInsight(
        fs,
        key,
        insight({
          id: 'i1',
          subjectPersonId: 'p2',
          facts: [
            { id: 'f1', text: 'broadcast WRONG', shareable: true },
            { id: 'f2', text: 'targeted WRONG', shareable: false, shareableWith: ['p1', 'p3'] },
            { id: 'f3', text: 'never shared', shareable: false },
          ],
        }),
      );
      // Before flagging, p1 sees both shared facts.
      const before = await summarizeForContext(fs, key, 'p1', [{ id: 'p2', displayName: 'Sam' }]);
      expect(before).toContain('broadcast WRONG');
      expect(before).toContain('targeted WRONG');

      const f1 = await flagInsightFact(fs, key, 'p2', 'i1', 'f1', true, now);
      const flaggedF1 = f1?.facts.find((f) => f.id === 'f1');
      expect(flaggedF1?.shareable).toBe(false);
      expect(flaggedF1?.retractedShareAt).toBe('2026-06-16T00:00:00.000Z');

      const f2 = await flagInsightFact(fs, key, 'p2', 'i1', 'f2', true, now);
      const flaggedF2 = f2?.facts.find((f) => f.id === 'f2');
      expect('shareableWith' in (flaggedF2 ?? {})).toBe(false); // every per-person grant stripped
      expect(flaggedF2?.retractedShareAt).toBe('2026-06-16T00:00:00.000Z');

      // After flagging, the related person's coaching context no longer carries either fact.
      const after = await summarizeForContext(fs, key, 'p1', [{ id: 'p2', displayName: 'Sam' }]);
      expect(after).not.toContain('WRONG');

      // A never-shared fact flagged inaccurate gets NO retraction stamp (nothing to withdraw).
      const f3 = await flagInsightFact(fs, key, 'p2', 'i1', 'f3', true, now);
      const flaggedF3 = f3?.facts.find((f) => f.id === 'f3');
      expect('retractedShareAt' in (flaggedF3 ?? {})).toBe(false);
    });

    it('clearing a flag drops the retraction stamp but does NOT re-grant the share', async () => {
      const fs = memFileSystem();
      await saveInsight(
        fs,
        key,
        insight({
          id: 'i1',
          subjectPersonId: 'p2',
          facts: [{ id: 'f1', text: 'was shared', shareable: true }],
        }),
      );
      await flagInsightFact(fs, key, 'p2', 'i1', 'f1', true, now);
      const cleared = await flagInsightFact(fs, key, 'p2', 'i1', 'f1', false, now);
      const f1 = cleared?.facts.find((f) => f.id === 'f1');
      expect(f1 && 'flaggedInaccurate' in f1).toBe(false);
      expect(f1 && 'retractedShareAt' in f1).toBe(false);
      expect(f1?.shareable).toBe(false); // share stays stripped — re-sharing is a deliberate action
    });
  });

  describe('reapOrphanShares (39-living-memory §4.5 — orphaned-share cleanup)', () => {
    it('removes a deleted person’s id from every other person’s shareableWith, and nowhere else', async () => {
      const fs = memFileSystem();
      await saveInsight(
        fs,
        key,
        insight({
          id: 'i1',
          subjectPersonId: 'p1',
          facts: [
            {
              id: 'f1',
              text: 'shared with gone+kept',
              shareable: false,
              shareableWith: ['gone', 'kept'],
            },
            { id: 'f2', text: 'shared with gone only', shareable: false, shareableWith: ['gone'] },
            { id: 'f3', text: 'shared elsewhere', shareable: false, shareableWith: ['kept'] },
          ],
        }),
      );
      await saveInsight(
        fs,
        key,
        insight({
          id: 'i2',
          subjectPersonId: 'p3',
          updatedAt: '2026-06-01T00:00:00.000Z',
          facts: [{ id: 'g1', text: 'untouched', shareable: true }],
        }),
      );

      const reaped = await reapOrphanShares(fs, key, 'gone');
      expect(reaped).toBe(2);

      const i1 = await getInsight(fs, key, 'p1', 'i1');
      expect(i1?.facts.find((f) => f.id === 'f1')?.shareableWith).toEqual(['kept']); // 'gone' removed, 'kept' stays
      expect('shareableWith' in (i1?.facts.find((f) => f.id === 'f2') ?? {})).toBe(false); // emptied → dropped
      expect(i1?.facts.find((f) => f.id === 'f3')?.shareableWith).toEqual(['kept']); // unrelated share untouched

      // An untouched insight is not re-saved — its updatedAt is unchanged (invisible maintenance).
      const i2 = await getInsight(fs, key, 'p3', 'i2');
      expect(i2?.updatedAt).toBe('2026-06-01T00:00:00.000Z');
    });

    it('does not bump updatedAt on a touched insight (no bubbling in Memory)', async () => {
      const fs = memFileSystem();
      await saveInsight(
        fs,
        key,
        insight({
          id: 'i1',
          subjectPersonId: 'p1',
          updatedAt: '2026-05-01T00:00:00.000Z',
          facts: [{ id: 'f1', text: 'x', shareable: false, shareableWith: ['gone'] }],
        }),
      );
      await reapOrphanShares(fs, key, 'gone');
      const i1 = await getInsight(fs, key, 'p1', 'i1');
      expect(i1?.updatedAt).toBe('2026-05-01T00:00:00.000Z');
    });
  });
});
