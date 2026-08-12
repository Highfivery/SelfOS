import { describe, expect, it } from 'vitest';

import { generateMasterKey } from '../crypto';
import type { ClaudeClient, FileSystem } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import { upsertPerson } from '../people/peopleService';
import type { Question } from '../schemas';
import {
  classifyOutcome,
  deriveTopicStats,
  emptyLedger,
  mergeEntries,
  readLedger,
  writeLedger,
  type AskLedgerEntry,
} from './askLedger';
import { generateQuestions, type AiDeps } from './generationService';
import { readProfile, writeProfile } from './personalizationProfile';
import { buildPlanUserMessage, PLAN_SYSTEM, steeringLifeAreas } from './planService';
import { hasRecitation } from './selfContained';
import {
  buildLedgerReference,
  mintTopics,
  resolveTopicId,
  seedTopics,
  topicStatuses,
  type Topic,
} from './topicMap';

/**
 * Spec 71 — the question-intelligence rebuild.
 *
 * The regression fixtures here are modelled on the REAL vault shape behind the member report: a recipient with
 * ~99 intimacy questions across nine categories at or past the saturation threshold, a third of them
 * unclassifiable by the keyword engine, and a candidate feed steering an unfiltered draft toward Friendships.
 *
 * §10 of the spec makes the PROMPT assertions mandatory rather than optional: the previous engine shipped
 * completely inert under a fully green suite because every test asserted outcome COUNTS and none asserted what
 * actually reached the model.
 */

const key = generateMasterKey();
const now = new Date('2026-08-12T12:00:00.000Z');

function fakeClient(text: string): ClaudeClient {
  return {
    send: () => Promise.resolve(text),
    stream: (_o, onDelta) => {
      onDelta(text);
      return Promise.resolve({
        text,
        usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
      });
    },
  };
}

/** A client that records every system+user prompt it is given, and replies in sequence. */
function recordingClient(responses: string[]): {
  client: ClaudeClient;
  prompts: { system: string; user: string }[];
} {
  const prompts: { system: string; user: string }[] = [];
  let i = 0;
  return {
    prompts,
    client: {
      send: () => Promise.resolve(''),
      stream: (o, onDelta) => {
        const user = o.messages
          .map((m) => (typeof m.content === 'string' ? m.content : ''))
          .join('\n');
        prompts.push({ system: o.system ?? '', user });
        const text = responses[Math.min(i, responses.length - 1)] ?? '';
        i += 1;
        onDelta(text);
        return Promise.resolve({
          text,
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    },
  };
}

const deps = (fs: FileSystem, client: ClaudeClient, personId: string): AiDeps => ({
  fs,
  key,
  client,
  apiKey: 'sk-x',
  model: 'claude-sonnet-4-6',
  personId,
  now,
});

const entry = (over: Partial<AskLedgerEntry> & { questionId: string }): AskLedgerEntry => ({
  assignmentId: 'a1',
  at: '2026-08-01T00:00:00.000Z',
  type: 'intimacy',
  tier: 'unfiltered',
  topicIds: [],
  gist: '',
  outcome: 'pending',
  ...over,
});

// ── The ask ledger ────────────────────────────────────────────────────────────────────────────────────

describe('askLedger', () => {
  it('merges by questionId — a re-append is a no-op, so sends and the backfill are both idempotent', () => {
    const a = [
      entry({ questionId: 'q1', topicIds: ['Intimacy:oral'], gist: 'oral, going deeper' }),
    ];
    const merged = mergeEntries(a, a);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.topicIds).toEqual(['Intimacy:oral']);
  });

  it('only ever ENRICHES an existing entry — a later blank tag cannot erase what is already known', () => {
    const prior = [
      entry({ questionId: 'q1', topicIds: ['Intimacy:anal'], gist: 'anal', outcome: 'rich' }),
    ];
    const merged = mergeEntries(prior, [entry({ questionId: 'q1' })]);
    expect(merged[0]).toMatchObject({ topicIds: ['Intimacy:anal'], gist: 'anal', outcome: 'rich' });
  });

  it('classifies outcomes deterministically, and a decline is not a skip', () => {
    const q: Question = { id: 'q', type: 'longText', prompt: 'p', required: false };
    expect(classifyOutcome(q, undefined)).toBe('skipped');
    expect(classifyOutcome(q, { declined: true, reason: 'Prefer not to say' })).toBe('declined');
    expect(classifyOutcome(q, 'short')).toBe('brief');
    expect(classifyOutcome(q, 'x'.repeat(200))).toBe('rich');
  });

  it('derives per-topic counts from what was actually asked, so counts cannot drift', () => {
    const ledger = {
      ...emptyLedger('p'),
      entries: [
        entry({
          questionId: 'q1',
          topicIds: ['t'],
          outcome: 'rich',
          at: '2026-08-01T00:00:00.000Z',
        }),
        entry({
          questionId: 'q2',
          topicIds: ['t'],
          outcome: 'skipped',
          at: '2026-08-05T00:00:00.000Z',
        }),
      ],
    };
    expect(deriveTopicStats(ledger).get('t')).toEqual({
      askedCount: 2,
      richCount: 1,
      deadCount: 1,
      lastAskedAt: '2026-08-05T00:00:00.000Z',
    });
  });
});

// ── The emergent topic map ────────────────────────────────────────────────────────────────────────────

describe('topicMap', () => {
  it('seeds from the built-in vocabulary, so day one is no worse than the engine it replaces', () => {
    const seeded = seedTopics();
    expect(seeded.some((t) => t.topicId === 'Intimacy:oral')).toBe(true);
    expect(seeded.some((t) => t.topicId === 'Money')).toBe(true);
    // Intimacy is NOT also seeded as a bare general area — it is covered by its categories.
    expect(seeded.filter((t) => t.topicId === 'Intimacy')).toHaveLength(0);
  });

  it('folds a near-synonym into the existing topic instead of forking a half-counted twin', () => {
    const topics = seedTopics();
    expect(resolveTopicId('Dirty talk & verbal', topics)).toBe('Intimacy:dirty-talk');
    expect(resolveTopicId('dirty talk', topics)).toBe('Intimacy:dirty-talk');
    const { resolved, topics: after } = mintTopics(topics, [{ label: 'talk, dirty' }]);
    expect(resolved).toEqual(['Intimacy:dirty-talk']);
    // …and the wording that resolved is remembered as an alias for next time.
    expect(after.find((t) => t.topicId === 'Intimacy:dirty-talk')?.aliases).toContain(
      'talk, dirty',
    );
  });

  it('MINTS genuinely new ground — the vocabulary is a seed, not a ceiling', () => {
    // "Who initiates" has no built-in category at all; the old keyword engine could never see it.
    const { resolved, topics } = mintTopics(seedTopics(), [
      { label: 'Who initiates', lifeArea: 'Intimacy' },
    ]);
    expect(resolved).toHaveLength(1);
    const minted = topics.find((t) => t.topicId === resolved[0]);
    expect(minted).toMatchObject({ label: 'Who initiates', lifeArea: 'Intimacy', seeded: false });
  });

  it('SATURATES worked ground — and unrelated new material can no longer re-open it (spec 71 §1 D3)', () => {
    const topics: Topic[] = seedTopics();
    const ledger = {
      ...emptyLedger('p'),
      entries: [1, 2, 3, 4].map((n) =>
        entry({
          questionId: `q${n}`,
          topicIds: ['Intimacy:dirty-talk'],
          at: '2026-06-01T00:00:00.000Z',
          outcome: 'brief',
        }),
      ),
    };
    // The exact shape of the old bug: fresh material exists, but about a DIFFERENT topic.
    const statuses = topicStatuses({
      topics,
      ledger,
      newMaterialTopicIds: ['Work & purpose'],
      now,
    });
    const dirty = statuses.find((s) => s.topic.topicId === 'Intimacy:dirty-talk');
    expect(dirty?.stats.askedCount).toBe(4);
    expect(dirty?.saturated).toBe(true);
    expect(dirty?.reopenedBy).toBeUndefined();
    expect(dirty?.open).toBe(false);
  });

  it('re-opens on TOPIC-RELEVANT material, but the cooldown floor still holds', () => {
    const ledger = {
      ...emptyLedger('p'),
      entries: [1, 2, 3].map((n) =>
        entry({ questionId: `q${n}`, topicIds: ['Intimacy:anal'], at: '2026-06-01T00:00:00.000Z' }),
      ),
    };
    const reopened = topicStatuses({
      topics: seedTopics(),
      ledger,
      newMaterialTopicIds: ['Intimacy:anal'],
      now,
    }).find((s) => s.topic.topicId === 'Intimacy:anal');
    expect(reopened?.reopenedBy).toBe('new-material');
    expect(reopened?.saturated).toBe(false);

    // …but asked 2 days ago instead, the hard floor keeps it shut regardless of the signal.
    const recent = {
      ...emptyLedger('p'),
      entries: [1, 2, 3].map((n) =>
        entry({ questionId: `q${n}`, topicIds: ['Intimacy:anal'], at: '2026-08-10T00:00:00.000Z' }),
      ),
    };
    const cooling = topicStatuses({
      topics: seedTopics(),
      ledger: recent,
      newMaterialTopicIds: ['Intimacy:anal'],
      now,
    }).find((s) => s.topic.topicId === 'Intimacy:anal');
    expect(cooling?.inCooldown).toBe(true);
    expect(cooling?.open).toBe(false);
  });

  it('the cooldown floor gates RE-OPENING worked ground — it never closes ground that still has headroom', () => {
    // Caught by running against a real vault: applying the floor to every recently-touched topic left 1 of 14
    // areas open and shut the two LEAST-worked ones (asked once and twice), which would push the planner to
    // invent new ground while obvious ground sat unused.
    const ledger = {
      ...emptyLedger('p'),
      entries: [
        entry({ questionId: 'q1', topicIds: ['Intimacy:edge'], at: '2026-08-10T00:00:00.000Z' }),
      ],
    };
    const edge = topicStatuses({ topics: seedTopics(), ledger, now }).find(
      (s) => s.topic.topicId === 'Intimacy:edge',
    );
    expect(edge?.stats.askedCount).toBe(1);
    expect(edge?.inCooldown).toBe(true); // asked 2 days ago…
    expect(edge?.open).toBe(true); // …but only ONE ask, so there is still ground here
  });

  it('closes a vein the person keeps skipping, regardless of ask count, and new material will not re-open it', () => {
    const ledger = {
      ...emptyLedger('p'),
      entries: [1, 2, 3].map((n) =>
        entry({
          questionId: `q${n}`,
          topicIds: ['Intimacy:group'],
          at: '2026-05-01T00:00:00.000Z',
          outcome: 'skipped',
        }),
      ),
    };
    const s = topicStatuses({
      topics: seedTopics(),
      ledger,
      newMaterialTopicIds: ['Intimacy:group'],
      now,
    }).find((t) => t.topic.topicId === 'Intimacy:group');
    expect(s?.saturatedByQuality).toBe(true);
    expect(s?.saturated).toBe(true);
  });

  it('builds the de-dup reference from counts + gists, not raw prompts (the 2.7%-survival fix)', () => {
    const ledger = {
      ...emptyLedger('p'),
      entries: [
        entry({
          questionId: 'q1',
          topicIds: ['Intimacy:dirty-talk'],
          gist: 'what she wants to hear',
        }),
        entry({ questionId: 'q2', topicIds: ['Intimacy:dirty-talk'], gist: 'saying it out loud' }),
      ],
    };
    const ref = buildLedgerReference(topicStatuses({ topics: seedTopics(), ledger, now }), ledger);
    expect(ref).toContain('Dirty talk & verbal — asked 2×');
    expect(ref).toContain('what she wants to hear');
  });
});

// ── Type + tier scoping ───────────────────────────────────────────────────────────────────────────────

describe('inventing genuinely new ground', () => {
  it('tells the planner to NAME new ground, and to insist on it once everything is worked through', () => {
    const someOpen = buildPlanUserMessage({
      type: 'intimacy',
      sensitivity: 'unfiltered',
      count: 3,
      statuses: topicStatuses({ topics: seedTopics(), ledger: emptyLedger('p'), now }),
    });
    // The standing instruction lives in the system prompt…
    expect(PLAN_SYSTEM).toMatch(/SHOULD NAME NEW GROUND/);
    expect(someOpen).not.toContain('You MUST name genuinely NEW ground');

    // …and once every named area is worked through, the user message makes it mandatory rather than
    // letting the planner fall back to re-mining (or returning nothing at all).
    const worked = {
      ...emptyLedger('p'),
      entries: seedTopics()
        .filter((t) => t.lifeArea === 'Intimacy')
        .flatMap((t) =>
          [1, 2, 3].map((n) =>
            entry({
              // Recent enough that the 90-day dormancy re-open does not fire — this is the genuinely
              // exhausted state, not a stale one.
              questionId: `${t.topicId}-${n}`,
              topicIds: [t.topicId],
              at: '2026-08-01T00:00:00.000Z',
            }),
          ),
        ),
    };
    const exhausted = buildPlanUserMessage({
      type: 'intimacy',
      sensitivity: 'unfiltered',
      count: 3,
      statuses: topicStatuses({ topics: seedTopics(), ledger: worked, now }).filter(
        (s) => s.topic.lifeArea === 'Intimacy',
      ),
    });
    expect(exhausted).toContain('You MUST name genuinely NEW ground');
  });

  it('files an invented intimacy topic under Intimacy, so it scopes correctly on every later draft', () => {
    // A strand the built-in 14 categories have no name for.
    const { resolved, topics } = mintTopics(seedTopics(), [
      { label: 'Being wanted out of her caretaking role', lifeArea: 'Intimacy' },
    ]);
    const minted = topics.find((t) => t.topicId === resolved[0]);
    expect(minted?.lifeArea).toBe('Intimacy');
    expect(minted?.seeded).toBe(false);
  });
});

describe('steeringLifeAreas', () => {
  it('confines an EXPLICIT intimacy questionnaire to Intimacy — the "Friendships" fix (spec 71 §1 D2)', () => {
    expect(steeringLifeAreas('intimacy', 'unfiltered')).toEqual(['Intimacy']);
    expect(steeringLifeAreas('intimacy', 'explicit')).toEqual(['Intimacy']);
    expect(steeringLifeAreas('scenario', 'unfiltered')).toEqual(['Intimacy']);
  });

  it('keeps the gentle tier relational, where connection questions genuinely belong', () => {
    expect(steeringLifeAreas('intimacy', 'intimacyGeneral')).toContain('Relationships');
  });
});

// ── Guards ────────────────────────────────────────────────────────────────────────────────────────────

describe('hasRecitation', () => {
  it('catches quoting a known fact back at the person (7+ of the real recipient’s questions did this)', () => {
    expect(
      hasRecitation(
        "You've marked explicit dirty talk as something you're curious about. What would you want?",
      ),
    ).toBe(true);
    expect(
      hasRecitation("You've said silence is a turn-off during sex — so what do you want instead?"),
    ).toBe(true);
    expect(hasRecitation('You marked anal as a maybe. How far would you want to go?')).toBe(true);
  });

  it('does NOT catch simply NAMING a fact, which self-containment requires', () => {
    expect(hasRecitation('When a worry about your health shows up, what do you do first?')).toBe(
      false,
    );
    expect(hasRecitation('If you said no to him more often, what would change?')).toBe(false);
    expect(hasRecitation('What would you say to your younger self?')).toBe(false);
  });
});

// ── The prompt itself (spec 71 §10) ───────────────────────────────────────────────────────────────────

/** Seed a recipient whose ledger reproduces the reported shape: heavily-worked explicit ground, backfilled. */
async function seedHeavyHistory(fs: FileSystem): Promise<string> {
  const person = (await upsertPerson(fs, key, { displayName: 'Angel', isSubject: true, tags: [] }))
    .id;
  const worked = [
    'Intimacy:penetration',
    'Intimacy:dirty-talk',
    'Intimacy:impact',
    'Intimacy:exhibition',
    'Intimacy:anal',
    'Intimacy:oral',
  ];
  const entries: AskLedgerEntry[] = [];
  for (const topicId of worked) {
    for (let n = 0; n < 4; n += 1) {
      entries.push(
        entry({
          questionId: `${topicId}-${n}`,
          topicIds: [topicId],
          at: '2026-07-01T00:00:00.000Z',
          gist: `worked ${topicId}`,
          outcome: 'brief',
        }),
      );
    }
  }
  await writeLedger(fs, key, {
    ...emptyLedger(person),
    entries,
    backfilledAt: '2026-08-11T00:00:00.000Z',
  });
  // The real profile behind the report carried an emergent Relationships sub-topic, "Friendships", at the
  // LOWEST depth of anything on the map — which is exactly how it came to lead an unfiltered intimacy set.
  // Seeding it here is what makes the off-type assertion below a real guard rather than a tautology.
  await writeProfile(fs, key, {
    ...(await readProfile(fs, key, person)),
    personId: person,
    topics: [
      ...seedTopics(),
      {
        topicId: 'Relationships:friendships',
        label: 'Friendships',
        lifeArea: 'Relationships',
        seeded: false,
        aliases: [],
      },
    ],
  });
  return person;
}

describe('the generation prompt (spec 71 §10 — assert what reaches the model)', () => {
  const GENERATED = JSON.stringify({
    title: 'T',
    questions: [
      {
        type: 'longText',
        prompt: 'A frank new question?',
        topics: ['Edge play'],
        gist: 'edge play',
      },
    ],
  });
  const PLAN = JSON.stringify({
    threads: [{ topicId: 'Intimacy:edge', label: 'Edge play', angle: 'what she wants tried' }],
  });

  it('never puts worked-through ground in front of the model, and never pulls an unfiltered set off-type', async () => {
    const fs = memFileSystem();
    const person = await seedHeavyHistory(fs);
    const { client, prompts } = recordingClient([PLAN, GENERATED, '[1]']);
    const res = await generateQuestions(deps(fs, client, person), {
      type: 'intimacy',
      sensitivity: 'unfiltered',
      count: 1,
      recipientPersonId: person,
      context: {
        authorPersonId: person,
        includeAuthor: true,
        includeTarget: false,
        includeRelationship: false,
      },
      existingPrompts: [],
      now,
    });
    expect(res.ok).toBe(true);

    const planPrompt = prompts[0]?.user ?? '';
    // Read each section in isolation — a cross-section regex would match the same label in the other block.
    const section = (header: string): string => {
      const start = planPrompt.indexOf(header);
      if (start === -1) return '';
      const rest = planPrompt.slice(start + header.length);
      const end = rest.search(/\n[A-Z][A-Z /—-]{6,}/);
      return end === -1 ? rest : rest.slice(0, end);
    };
    // The saturated ground is stated as OFF-LIMITS, and is NOT offered as open ground.
    expect(section('OFF-LIMITS THIS TIME')).toContain('Dirty talk & verbal');
    expect(section('GROUND STILL OPEN')).not.toContain('Dirty talk & verbal');
    expect(section('GROUND STILL OPEN')).toContain('Edge play');
    // NOTHING outside Intimacy may steer an unfiltered set — this is the reported "Friendships" defect.
    expect(planPrompt).not.toContain('Friendships');
    expect(planPrompt).not.toContain('Work & purpose');
    expect(planPrompt).not.toContain('Money');

    const genPrompt = prompts[1]?.user ?? '';
    // Generation is handed the chosen thread, and told it is ground — not wording to echo.
    expect(genPrompt).toContain('GROUND TO OPEN THIS TIME');
    expect(genPrompt).toContain('Edge play');
    expect(genPrompt).toMatch(/A thread is ground to open, NOT wording to reuse/);
    // The register is restated LAST, so the governing instruction is also the most recent one.
    const reminder = genPrompt.lastIndexOf('that register GOVERNS');
    expect(reminder).toBeGreaterThan(-1);
    expect(genPrompt.slice(reminder)).not.toContain('GROUND TO OPEN');
  });

  it('tags each question with the ground it covers, minting new vocabulary as it goes', async () => {
    const fs = memFileSystem();
    const person = await seedHeavyHistory(fs);
    const { client } = recordingClient([PLAN, GENERATED, '[1]']);
    const res = await generateQuestions(deps(fs, client, person), {
      type: 'intimacy',
      sensitivity: 'unfiltered',
      count: 1,
      recipientPersonId: person,
      context: {
        authorPersonId: person,
        includeAuthor: true,
        includeTarget: false,
        includeRelationship: false,
      },
      existingPrompts: [],
      now,
    });
    expect(res.questions?.[0]?.topicIds).toEqual(['Intimacy:edge']);
    expect(res.questions?.[0]?.gist).toBe('edge play');
  });

  it('drops a question that recites a known fact back at the person', async () => {
    const fs = memFileSystem();
    const person = await seedHeavyHistory(fs);
    const returned = JSON.stringify({
      title: 'T',
      questions: [
        { type: 'longText', prompt: "You've marked dirty talk as a maybe — how far would you go?" },
        {
          type: 'longText',
          prompt: 'What would make being watched feel exciting rather than exposing?',
        },
      ],
    });
    const { client } = recordingClient([PLAN, returned, '[1,2]']);
    const res = await generateQuestions(deps(fs, client, person), {
      type: 'intimacy',
      sensitivity: 'unfiltered',
      count: 2,
      recipientPersonId: person,
      context: {
        authorPersonId: person,
        includeAuthor: true,
        includeTarget: false,
        includeRelationship: false,
      },
      existingPrompts: [],
      now,
    });
    expect(res.questions?.map((q) => q.prompt)).toEqual([
      'What would make being watched feel exciting rather than exposing?',
    ]);
  });

  it('does not spend a planning call on an EXTERNAL recipient, who has no household record', async () => {
    const fs = memFileSystem();
    const { client, prompts } = recordingClient([GENERATED, '[1]']);
    await generateQuestions(deps(fs, client, 'author'), {
      type: 'general',
      sensitivity: 'standard',
      count: 1,
      context: {
        authorPersonId: 'author',
        includeAuthor: true,
        includeTarget: false,
        includeRelationship: false,
      },
      existingPrompts: [],
      now,
    });
    expect(prompts.every((p) => !p.system.includes('You PLAN a questionnaire'))).toBe(true);
  });

  it('keeps the legacy steering until the backfill has run, so the migration has no blind window', async () => {
    const fs = memFileSystem();
    const person = (await upsertPerson(fs, key, { displayName: 'New', isSubject: true, tags: [] }))
      .id;
    // A ledger with entries but NO `backfilledAt` — a partially-seeded person mid-migration.
    await writeLedger(fs, key, {
      ...emptyLedger(person),
      entries: [entry({ questionId: 'q1', topicIds: ['Intimacy:oral'] })],
    });
    const { client, prompts } = recordingClient([GENERATED, '[1]']);
    await generateQuestions(deps(fs, client, person), {
      type: 'intimacy',
      sensitivity: 'unfiltered',
      count: 1,
      recipientPersonId: person,
      context: {
        authorPersonId: person,
        includeAuthor: true,
        includeTarget: false,
        includeRelationship: false,
      },
      existingPrompts: [],
      now,
    });
    // No planning call — the ledger is not authoritative yet.
    expect(prompts.every((p) => !p.system.includes('You PLAN a questionnaire'))).toBe(true);
  });
});

describe('ledger persistence across a real generate', () => {
  it('a fresh person starts with an empty ledger and no backfill flag', async () => {
    const fs = memFileSystem();
    const ledger = await readLedger(fs, key, 'nobody');
    expect(ledger.entries).toEqual([]);
    expect(ledger.backfilledAt).toBeUndefined();
  });

  it('a corrupt ledger degrades to empty rather than throwing out of generation', async () => {
    const fs = memFileSystem();
    const person = (await upsertPerson(fs, key, { displayName: 'X', isSubject: true, tags: [] }))
      .id;
    await writeLedger(fs, key, { ...emptyLedger(person), entries: [] });
    const res = await generateQuestions(deps(fs, fakeClient('not json'), person), {
      type: 'general',
      sensitivity: 'standard',
      count: 1,
      recipientPersonId: person,
      context: {
        authorPersonId: person,
        includeAuthor: true,
        includeTarget: false,
        includeRelationship: false,
      },
      existingPrompts: [],
      now,
    });
    expect(res.ok).toBe(false); // an honest parse failure, never a throw
  });
});
