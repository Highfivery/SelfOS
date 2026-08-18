import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import type { ClaudeClient, ClaudeStreamResult } from '../host';
import { memFileSystem } from '../host/memFileSystem';
import type { AiDeps } from '../questionnaires/aiCall';
import { queryUsage } from '../usage';
import { writeEncryptedJson } from '../vault';
import type { EmailResponse, SentSuggestion } from '../schemas';
import { saveInsight } from '../insights';
import type { Insight } from '../schemas';
import { emptyLexicon, writeLexicon } from '../tests/adaptive/lexicon';
import {
  buildAvoidSet,
  gatherSuggestionSignals,
  generateSuggestion,
  hasNewSuggestionData,
  listSentSuggestions,
  recordSentSuggestion,
  type SuggestionSignals,
} from './emailSuggestionService';

const key = generateMasterKey();
const now = new Date('2026-09-01T12:00:00.000Z');
const PERSON = 'me';

/** A Claude client that always returns the given text as one non-truncated reply. */
function clientReturning(text: string): ClaudeClient {
  const result: ClaudeStreamResult = {
    text,
    usage: { inputTokens: 100, outputTokens: 80, cacheWriteTokens: 0, cacheReadTokens: 0 },
    stopReason: 'end_turn',
  };
  return { send: () => Promise.resolve(''), stream: () => Promise.resolve(result) };
}

function deps(fs: ReturnType<typeof memFileSystem>, client: ClaudeClient): AiDeps {
  return { fs, key, client, apiKey: 'sk', model: 'claude-sonnet-4-6', personId: PERSON, now };
}

const emptySignals: SuggestionSignals = { newInsights: [], newSessionCount: 0 };

describe('hasNewSuggestionData (67 §3.3)', () => {
  it('is false with no new data and true with any fresh signal', () => {
    expect(hasNewSuggestionData(emptySignals)).toBe(false);
    expect(hasNewSuggestionData({ ...emptySignals, newSessionCount: 1 })).toBe(true);
    expect(hasNewSuggestionData({ ...emptySignals, observation: 'a reflection' })).toBe(true);
    expect(hasNewSuggestionData(emptySignals, 2)).toBe(true); // intimacy overlap
  });
});

describe('gatherSuggestionSignals — own-subject only (#129)', () => {
  const insight = (id: string, over: Partial<Insight>): Insight => ({
    id,
    schemaVersion: 1,
    source: 'questionnaire',
    subjectPersonId: PERSON,
    summary: `summary-${id}`,
    facts: [],
    confidence: 'medium',
    categories: [],
    approved: true,
    provenance: { at: '2026-08-20T00:00:00.000Z' },
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    ...over,
  });
  const since = new Date('2026-08-01T00:00:00.000Z');

  it('excludes an about-someone-else response so it neither triggers nor populates the email', async () => {
    const fs = memFileSystem();
    // A questionnaire this person SENT to their partner — attributed to them, but about Angel.
    await saveInsight(
      fs,
      key,
      insight('about-angel', {
        summary: 'Angel’s intimate life is multisensory',
        provenance: { at: '2026-08-20T00:00:00.000Z', aboutPersonId: 'angel', aboutName: 'Angel' },
      }),
    );
    const signals = await gatherSuggestionSignals(fs, key, PERSON, since, now);
    expect(signals.newInsights).toHaveLength(0);
    expect(hasNewSuggestionData(signals)).toBe(false); // a partner's answers never trigger your email
  });

  it('keeps the person’s own insight', async () => {
    const fs = memFileSystem();
    await saveInsight(fs, key, insight('own', { summary: 'weighing a career change' }));
    const signals = await gatherSuggestionSignals(fs, key, PERSON, since, now);
    expect(signals.newInsights.map((i) => i.id)).toEqual(['own']);
  });
});

describe('generateSuggestion (67 §3.3)', () => {
  it('composes a de-dup-checked suggestion from a fresh signal', async () => {
    const fs = memFileSystem();
    const client = clientReturning(
      '{"headline":"A small step","body":"Notice one good moment today.",' +
        '"options":[{"label":"Yes, one thing","stance":"yes"},{"label":"Not this week","stance":"maybe"}]}',
    );
    const out = await generateSuggestion(deps(fs, client), {
      openGround: [],
      family: 'ai-suggestion',
      signals: { ...emptySignals, observation: 'You have been reflecting on rest.' },
      avoid: { texts: [], subjects: new Set() },
    });
    expect(out).not.toBeNull();
    expect(out?.suggestion.headline).toBe('A small step');
    expect(out?.suggestion.suggestionType).toBe('question-to-sit-with');
    expect(out?.sent.text).toContain('A small step');
    expect(out?.usage.type).toBe('email.suggest');
    // `runClaude` records the usage event ONCE internally — the caller must NOT re-record it (that would
    // double-count against budget). Exactly one `email.suggest` event exists.
    const events = await queryUsage(fs, key, {
      from: '2000-01-01T00:00:00.000Z',
      to: '2100-01-01T00:00:00.000Z',
      personId: PERSON,
      type: 'email.suggest',
    });
    expect(events).toHaveLength(1);
  });

  it('drops a candidate that near-duplicates a recent suggestion (never a re-phrasing)', async () => {
    const fs = memFileSystem();
    const client = clientReturning(
      '{"headline":"Notice one good moment","body":"Notice one good moment today and name it."}',
    );
    const out = await generateSuggestion(deps(fs, client), {
      openGround: [],
      family: 'ai-suggestion',
      signals: { ...emptySignals, observation: 'rest' },
      avoid: {
        texts: ['Notice one good moment today Notice one good moment today and name it'],
        subjects: new Set(),
      },
    });
    expect(out).toBeNull();
  });

  it('returns null for the intimacy family when the shared overlap is exhausted', async () => {
    const fs = memFileSystem();
    const client = clientReturning('{"headline":"x","body":"y"}');
    const out = await generateSuggestion(deps(fs, client), {
      openGround: [],
      family: 'ai-suggestion-intimacy',
      signals: emptySignals,
      avoid: { texts: [], subjects: new Set(['act-1']) },
      intimacyOverlap: [{ key: 'act-1', label: 'A' }], // the only overlap act is avoided
    });
    expect(out).toBeNull();
  });

  it("an intimacy email draws on the person's OWN open ground — and says so when nothing is open", async () => {
    // The invariant questionnaire generation guards (spec 71 §5.3), now enforced by the TYPE: `openGround` is
    // required and an EMPTY list is meaningful. It means this person has worked every area through, and the
    // prompt must say so rather than degrade to the seeded families — which would nudge them toward exactly
    // the areas they exhausted, inside an explicit email nobody reviews first.
    const fs = memFileSystem();
    const systems: string[] = [];
    const capture: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: (o, onDelta) => {
        systems.push(o.system ?? ''); // the explicit framing rides the SYSTEM prompt
        const text = '{"headline":"x","body":"y"}';
        onDelta(text);
        return Promise.resolve({
          text,
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        } as ClaudeStreamResult);
      },
    };
    const base = {
      family: 'ai-suggestion-intimacy' as const,
      signals: emptySignals,
      avoid: { texts: [], subjects: new Set<string>() },
      intimacyOverlap: [{ key: 'act-1', label: 'A' }],
    };

    await generateSuggestion(deps(fs, capture), {
      ...base,
      openGround: [{ label: 'Edge play', blurb: 'The intense edges.' }],
    });
    expect(systems[0] ?? '').toContain('Edge play');

    systems.length = 0;
    await generateSuggestion(deps(fs, capture), { ...base, openGround: [] });
    const sent = systems[0] ?? '';
    expect(sent).toMatch(/worked through/i);
    expect(sent).not.toContain('Group & swinging');
    expect(sent).not.toContain('Bondage & restraint');
  });

  it('returns null when the model declines / returns no usable JSON', async () => {
    const fs = memFileSystem();
    const out = await generateSuggestion(deps(fs, clientReturning('I cannot help with that.')), {
      family: 'ai-suggestion',
      signals: { ...emptySignals, observation: 'rest' },
      avoid: { texts: [], subjects: new Set() },
      openGround: [],
    });
    expect(out).toBeNull();
  });
});

describe('buildAvoidSet (67 §3.3/§3.6 — per-family)', () => {
  async function seed(
    fs: ReturnType<typeof memFileSystem>,
    suggestion: SentSuggestion,
    response: EmailResponse,
  ) {
    await recordSentSuggestion(fs, key, PERSON, suggestion);
    await writeEncryptedJson(
      fs,
      `people/${PERSON}/email/responses/${response.id}.enc`,
      response,
      key,
    );
  }

  const sentBase: Omit<SentSuggestion, 'id' | 'subjectKey'> = {
    schemaVersion: 1,
    family: 'ai-suggestion',
    suggestionType: 'something-to-try',
    text: 'try a walk',
    tokens: [],
    sentAt: '2026-08-25T00:00:00.000Z',
  };
  const respBase: Omit<EmailResponse, 'id' | 'answer' | 'suggestionId' | 'respondedAt'> = {
    schemaVersion: 1,
    family: 'ai-suggestion',
    kind: 'reaction',
    sensitivity: 'standard',
    source: 'relay-tap',
    edited: false,
  };

  it('avoids a not-for-me subject forever', async () => {
    const fs = memFileSystem();
    await seed(
      fs,
      { ...sentBase, id: 's1', subjectKey: 'goal-1' },
      {
        ...respBase,
        id: 'r1',
        suggestionId: 's1',
        answer: 'not-for-me',
        respondedAt: '2026-08-26T00:00:00.000Z',
      },
    );
    const avoid = await buildAvoidSet(fs, key, PERSON, 'ai-suggestion', now);
    expect(avoid.subjects.has('goal-1')).toBe(true);
    expect(avoid.texts).toContain('try a walk');
  });

  it('avoids a maybe-later subject only within the resurface window', async () => {
    const fs = memFileSystem();
    await seed(
      fs,
      { ...sentBase, id: 's2', subjectKey: 'goal-2' },
      {
        ...respBase,
        id: 'r2',
        suggestionId: 's2',
        answer: 'maybe-later',
        respondedAt: '2026-08-30T00:00:00.000Z',
      },
    );
    // 2 days ago → still resting.
    expect(
      (await buildAvoidSet(fs, key, PERSON, 'ai-suggestion', now)).subjects.has('goal-2'),
    ).toBe(true);
    // 5 weeks later → resurfaces.
    const later = new Date('2026-10-06T00:00:00.000Z');
    expect(
      (await buildAvoidSet(fs, key, PERSON, 'ai-suggestion', later)).subjects.has('goal-2'),
    ).toBe(false);
  });

  it('keeps the two families’ avoid-sets separate', async () => {
    const fs = memFileSystem();
    await seed(
      fs,
      { ...sentBase, id: 's3', subjectKey: 'act-9', family: 'ai-suggestion-intimacy' },
      {
        ...respBase,
        id: 'r3',
        family: 'ai-suggestion-intimacy',
        suggestionId: 's3',
        answer: 'not-for-me',
        respondedAt: '2026-08-26T00:00:00.000Z',
      },
    );
    // The non-intimacy family's avoid-set is unaffected by an intimacy "not for me".
    expect((await buildAvoidSet(fs, key, PERSON, 'ai-suggestion', now)).subjects.has('act-9')).toBe(
      false,
    );
    expect(
      (await buildAvoidSet(fs, key, PERSON, 'ai-suggestion-intimacy', now)).subjects.has('act-9'),
    ).toBe(true);
    expect(await listSentSuggestions(fs, key, PERSON, 'ai-suggestion-intimacy')).toHaveLength(1);
  });
});

describe('generateSuggestion — shared steering (spec 69 P4: email joins the one universe)', () => {
  /** A client that captures the assembled user message so we can assert what reached the model. */
  function capturingClient(reply: string): { client: ClaudeClient; seen: () => string } {
    let captured = '';
    const result: ClaudeStreamResult = {
      text: reply,
      usage: { inputTokens: 10, outputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0 },
      stopReason: 'end_turn',
    };
    const client: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: (options) => {
        captured = options.messages.map((m) => m.content).join('\n');
        return Promise.resolve(result);
      },
    };
    return { client, seen: () => captured };
  }

  it('feeds the coverage/feedback guidance + covered-topics avoid into the prompt, author-blind', async () => {
    const fs = memFileSystem();
    const { client, seen } = capturingClient(
      '{"headline":"A fresh angle","body":"Notice something new this week.",' +
        '"options":[{"label":"Yes, one thing","stance":"yes"},{"label":"Not this week","stance":"maybe"}]}',
    );
    const out = await generateSuggestion(deps(fs, client), {
      openGround: [],
      family: 'ai-suggestion',
      signals: { ...emptySignals, observation: 'You have been reflecting on rest.' },
      avoid: { texts: [], subjects: new Set() },
      steering: {
        feedbackGuidance:
          "WHERE THIS PERSON HAS AND HASN'T BEEN EXPLORED (steer strongly to NEW ground):\nNEW / UNEXPLORED GROUND — lead here:\n- Money",
        coveredTopics: ['their commute routine', 'their morning coffee'],
      },
    });
    expect(out).not.toBeNull();
    const prompt = seen();
    // The shared steering reached the model…
    expect(prompt).toContain('NEW / UNEXPLORED GROUND');
    expect(prompt).toContain('ALREADY COVERED elsewhere');
    expect(prompt).toContain('their commute routine');
    // …but it stays author-blind: the raw steering never comes back in the suggestion.
    expect(JSON.stringify(out)).not.toContain('their commute routine');
    expect(JSON.stringify(out)).not.toContain('NEW / UNEXPLORED GROUND');
  });

  it('omits the steering blocks entirely when there is nothing to steer', async () => {
    const fs = memFileSystem();
    const { client, seen } = capturingClient(
      '{"headline":"A small step","body":"One kind thing today."}',
    );
    await generateSuggestion(deps(fs, client), {
      openGround: [],
      family: 'ai-suggestion',
      signals: { ...emptySignals, observation: 'A reflection.' },
      avoid: { texts: [], subjects: new Set() },
    });
    expect(seen()).not.toContain('ALREADY COVERED elsewhere');
    expect(seen()).not.toContain('WHERE THIS PERSON');
  });
});

describe('emailed answers are written for the email (#459, #523)', () => {
  it('keeps answers that answer the question, and refuses a set that cannot', async () => {
    // Reported twice: an emailed question arrived with "I'm game / Maybe later / Not for me", which reads as
    // "do you want to answer this?" and answers nothing. Answers must answer the exact prompt (08 §32.8) —
    // the rule already enforced for in-app generation, which the email surface bypassed entirely.
    const fs = memFileSystem();
    const good = await generateSuggestion(
      deps(
        fs,
        clientReturning(
          '{"headline":"A question","body":"What would make this week feel different?","options":[' +
            '{"label":"More time alone","stance":"other"},' +
            '{"label":"Fewer obligations","stance":"other"},' +
            '{"label":"Not for me right now","stance":"no"},' +
            '{"label":"Not sure yet","stance":"other"}]}',
        ),
      ),
      {
        openGround: [],
        family: 'ai-suggestion',
        signals: { ...emptySignals, observation: 'You have been reflecting on rest.' },
        avoid: { texts: [], subjects: new Set() },
      },
    );
    expect(good?.suggestion.options.map((o) => o.label)).toEqual([
      'More time alone',
      'Fewer obligations',
      'Not for me right now',
      'Not sure yet',
    ]);
    // The words are per-email; the MEANING rides alongside them, so ruling a subject out still works.
    expect(good?.suggestion.options.map((o) => o.stance)).toEqual([
      'other',
      'other',
      'no',
      'other',
    ]);

    // An unusable set (blank + a case-insensitive duplicate leaves one real answer) means NO suggestion.
    // The old shape — "degrade to no buttons" — is what the delivery path turned back into the reported
    // engagement trio; a suggestion this feature cannot deliver honestly is simply not sent (#523).
    const bad = await generateSuggestion(
      deps(
        fs,
        clientReturning(
          '{"headline":"Another","body":"What is on your mind?","options":["Rest","  ","REST"]}',
        ),
      ),
      {
        openGround: [],
        family: 'ai-suggestion',
        signals: { ...emptySignals, observation: 'Something new entirely to avoid the de-dup.' },
        avoid: { texts: [], subjects: new Set() },
      },
    );
    expect(bad).toBeNull();
  });

  it('refuses a set the generic engagement labels DOMINATE (#523)', async () => {
    // The exact reported email, this time proposed by the model itself. A set that would fit ANY email
    // answers no particular one, so it is refused rather than sent under a model's byline.
    const fs = memFileSystem();
    const echoed = await generateSuggestion(
      deps(
        fs,
        clientReturning(
          '{"headline":"The habit of holding it alone","body":"When did you first learn that holding it ' +
            'alone was the safer thing to do?","options":[{"label":"I\'m game","stance":"yes"},' +
            '{"label":"Maybe later","stance":"maybe"},{"label":"Not for me","stance":"no"}]}',
        ),
      ),
      {
        openGround: [],
        family: 'ai-suggestion',
        signals: { ...emptySignals, observation: 'A thread of carrying things alone.' },
        avoid: { texts: [], subjects: new Set() },
      },
    );
    expect(echoed).toBeNull();

    // …but one honest decline among specific answers is a real answer to a real proposal, not the defect.
    const mixed = await generateSuggestion(
      deps(
        fs,
        clientReturning(
          '{"headline":"A walk Thursday","body":"Would a short walk on Thursday help?","options":[' +
            '{"label":"Yes, Thursday works","stance":"yes"},{"label":"Another day","stance":"maybe"},' +
            '{"label":"Not for me","stance":"no"}]}',
        ),
      ),
      {
        openGround: [],
        family: 'ai-suggestion',
        signals: { ...emptySignals, observation: 'Something else entirely, to dodge the de-dup.' },
        avoid: { texts: [], subjects: new Set() },
      },
    );
    expect(mixed?.suggestion.options.map((o) => o.label)).toEqual([
      'Yes, Thursday works',
      'Another day',
      'Not for me',
    ]);
  });

  it('tells the model the answers are per-email, never one set that fits any email', async () => {
    // A prompt rule with no assertion silently rots — and this is the exact wording the defect came from.
    const fs = memFileSystem();
    let system = '';
    const base = clientReturning('{"headline":"h","body":"b","options":[]}');
    const client: ClaudeClient = {
      ...base,
      stream: (o, onDelta) => {
        system = o.system ?? '';
        return base.stream(o, onDelta);
      },
    };
    await generateSuggestion(deps(fs, client), {
      openGround: [],
      family: 'ai-suggestion',
      signals: { ...emptySignals, observation: 'Fresh ground.' },
      avoid: { texts: [], subjects: new Set() },
    });
    expect(system).toMatch(/`options` is REQUIRED/);
    expect(system).toMatch(/written for THIS body/);
    expect(system).toMatch(/NEVER a generic set that would fit any email/);
    expect(system).toMatch(/I'm game/);
    // The stance contract — dynamic wording is only safe because the meaning travels with it.
    expect(system).toMatch(/Set `stance` on each answer/);
  });
});

describe('74 §8.4 — the intimacy email carries the hard nos', () => {
  /** A person who has ruled one word out. */
  async function withBoundary(fs: ReturnType<typeof memFileSystem>): Promise<void> {
    await writeLexicon(fs, key, {
      ...emptyLexicon(PERSON, now),
      boundaries: [{ text: 'whore', kind: 'word', at: now.toISOString() }],
    });
  }

  const intimacyInput = {
    openGround: [],
    family: 'ai-suggestion-intimacy' as const,
    signals: emptySignals,
    avoid: { texts: [], subjects: new Set<string>() },
    intimacyOverlap: [{ key: 'oral', label: 'oral' }],
  };

  it('puts the ruled-out word in the prompt as a hard negative constraint', async () => {
    const fs = memFileSystem();
    await withBoundary(fs);
    let seen = '';
    const client: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: (opts: { system?: string }) => {
        seen = opts.system ?? '';
        return Promise.resolve({
          text: '{"headline":"Tonight","body":"Tell him what you want."}',
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
          stopReason: 'end_turn' as const,
        });
      },
    } as unknown as ClaudeClient;
    await generateSuggestion(deps(fs, client), intimacyInput);
    expect(seen).toContain('whore');
    expect(seen).toMatch(/NEVER use any of these/i);
  });

  it('REFUSES to send a suggestion that touches a boundary, whatever the model returned', async () => {
    // This is the only surface where explicit generated text leaves the device unreviewed, so the prompt
    // line is not enough on its own — not sending beats sending the one thing they ruled out.
    const fs = memFileSystem();
    await withBoundary(fs);
    const client = clientReturning('{"headline":"Tonight","body":"Tell him you are his whore."}');
    expect(await generateSuggestion(deps(fs, client), intimacyInput)).toBeNull();
  });

  it('refuses when a ruled-out word is in a BUTTON, not just the sentence above it', async () => {
    // The answers are model-written prose too (67 §3.3a) — they reach the person on the button AND are
    // quoted into their coaching context. A hard no in a label is exactly as unsendable as one in the body.
    const fs = memFileSystem();
    await withBoundary(fs);
    const client = clientReturning(
      '{"headline":"Tonight","body":"What sounds good tonight?","options":[' +
        '{"label":"Call me your whore","stance":"yes"},{"label":"Something slower","stance":"other"}]}',
    );
    expect(await generateSuggestion(deps(fs, client), intimacyInput)).toBeNull();
  });
});
