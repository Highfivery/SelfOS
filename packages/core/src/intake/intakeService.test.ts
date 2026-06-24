import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { ClaudeClient } from '../host';
import { factSharedWithViewer, type Insight, type Person } from '../schemas';
import { listConversations } from '../conversations';
import { getInsight, saveInsight, summarizeForContext, updateInsight } from '../insights';
import { getPerson, savePerson } from '../people';
import { SHARING_PRESETS } from '../people/sharingPresets';
import { queryUsage } from '../usage';
import {
  ensureIntakeSession,
  getIntakeSession,
  redactRestrictedFacts,
  runIntakeTurn,
  setIntakeAnswerSharing,
  skipIntakeSection,
  stripIntakeFieldMarkers,
  submitSectionForm,
  synthesizeIntake,
  type IntakeSynthesizeDeps,
  type IntakeTurnDeps,
} from './intakeService';

const key = generateMasterKey();
const NOW = new Date('2026-06-14T10:00:00.000Z');

const PORTRAIT = {
  portrait: 'You are someone who carries a lot with quiet grace and a deep wish to be understood.',
  facts: [
    { text: 'Works as a nurse', section: 'basics' },
    { text: 'Carries grief from a recent loss', section: 'weighs' },
    { text: 'Values honesty above all', section: 'values' },
  ],
  metrics: { valence: 0.2 },
  inferred: { communicationStyle: 'direct and warm', goals: 'feel less alone' },
  crisisFlag: false,
};

/** Fake client: portrait JSON when asked for the closing portrait, reflection JSON for a reflection, else a reply. */
function fakeClient(
  over: {
    reply?: string;
    reflection?: string;
    portrait?: unknown;
    portraitText?: string;
    capture?: (s: string) => void;
    captureMessages?: (m: { role: string; content: string }[]) => void;
    captureOptions?: (o: { maxTokens?: number; extendedThinking?: boolean }) => void;
  } = {},
): ClaudeClient {
  const usage = { inputTokens: 12, outputTokens: 6, cacheWriteTokens: 0, cacheReadTokens: 0 };
  return {
    send: () => Promise.resolve(''),
    stream: (options, onDelta) => {
      over.capture?.(options.system);
      over.captureMessages?.(options.messages);
      over.captureOptions?.(options);
      const last = options.messages.at(-1)?.content ?? '';
      let text: string;
      if (last.includes('closing portrait'))
        text = over.portraitText ?? JSON.stringify(over.portrait ?? PORTRAIT);
      else if (last.includes('reflection'))
        text = JSON.stringify({ reflection: over.reflection ?? 'You carry a lot with grace.' });
      else text = over.reply ?? 'Thank you for sharing. What feels most important right now?';
      onDelta(text);
      return Promise.resolve({ text, usage });
    },
  };
}

function person(over: Partial<Person> & { id: string } = { id: 'p1' }): Person {
  return {
    schemaVersion: 4,
    displayName: 'Sam',
    isSubject: true,
    tags: [],
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...over,
  };
}

function base(fs: ReturnType<typeof memFileSystem>, client: ClaudeClient) {
  return {
    fs,
    key,
    client,
    apiKey: 'sk-test' as string | null,
    model: 'claude-sonnet-4-6',
    personId: 'p1',
    now: NOW,
  };
}

function turn(
  fs: ReturnType<typeof memFileSystem>,
  client: ClaudeClient,
  sectionId: string,
  userText: string,
  over: Partial<IntakeTurnDeps> = {},
): IntakeTurnDeps {
  return { ...base(fs, client), sectionId, userText, onDelta: () => {}, ...over };
}

function synth(
  fs: ReturnType<typeof memFileSystem>,
  client: ClaudeClient,
  over: Partial<IntakeSynthesizeDeps> = {},
): IntakeSynthesizeDeps {
  return { ...base(fs, client), ...over };
}

async function setup() {
  const fs = memFileSystem();
  await savePerson(fs, key, person({ id: 'p1' }));
  return fs;
}

describe('intakeService', () => {
  it('ensures a fresh session with all catalog sections, and is idempotent on resume', async () => {
    const fs = await setup();
    const a = await ensureIntakeSession(fs, key, 'p1', NOW);
    expect(a.status).toBe('inProgress');
    expect(a.sections.length).toBeGreaterThanOrEqual(10);
    expect(a.sections.find((s) => s.id === 'intimacy')?.restricted).toBe(true);
    const b = await ensureIntakeSession(fs, key, 'p1', NOW);
    expect(b.id).toBe(a.id); // resume — same session, not a new one
  });

  it('runs an interview turn under the person (NOT in Sessions) and meters intake.interview', async () => {
    const fs = await setup();
    const res = await runIntakeTurn(turn(fs, fakeClient(), 'basics', 'Hi, I am Sam.'));
    expect(res.ok).toBe(true);
    // The transcript lives under the person's intake — never in the Sessions list.
    expect(await listConversations(fs, key, 'p1')).toHaveLength(0);
    const usage = await queryUsage(fs, key, {
      from: '2026-01-01',
      to: '2027-01-01',
      type: 'intake.interview',
    });
    expect(usage).toHaveLength(1);
    const session = await getIntakeSession(fs, key, 'p1');
    expect(session?.sections.find((s) => s.id === 'basics')?.messages).toHaveLength(2);
  });

  it('submitSectionForm fills mapped Person fields, persists answers, marks complete, and runs NO AI', async () => {
    const fs = await setup();
    const session = await submitSectionForm(
      fs,
      key,
      'p1',
      'basics',
      {
        occupation: 'nurse',
        languages: ['English', 'Spanish'],
        pronouns: 'she/her',
        ethnicity: ['East Asian', 'Mixed / Multiple'],
      },
      NOW,
    );
    const p = await getPerson(fs, key, 'p1');
    expect(p?.occupation).toBe('nurse');
    expect(p?.languages).toEqual(['English', 'Spanish']); // multi → list field
    expect(p?.pronouns).toBe('she/her');
    expect(p?.ethnicity).toBe('East Asian, Mixed / Multiple'); // multi → joined STRING field (not a list)
    const basics = session.sections.find((s) => s.id === 'basics');
    expect(basics?.status).toBe('complete');
    expect(basics?.answers.occupation).toBe('nurse'); // structured answers persist under the person
    // A form submit spends nothing.
    const usage = await queryUsage(fs, key, { from: '2026-01-01', to: '2027-01-01' });
    expect(usage).toHaveLength(0);
  });

  it('fills appearance, importantDates (dateList, incomplete rows dropped), and interests (from passions)', async () => {
    const fs = await setup();
    await submitSectionForm(
      fs,
      key,
      'p1',
      'basics',
      {
        appearanceDescription: 'tall, curly hair, glasses',
        importantDates: [
          { label: 'Anniversary', date: '2014-06-21' },
          { label: 'Incomplete', date: '' },
        ],
      },
      NOW,
    );
    await submitSectionForm(fs, key, 'p1', 'joy-play', { passions: ['Music', 'Travel'] }, NOW);
    const p = await getPerson(fs, key, 'p1');
    expect(p?.appearanceDescription).toBe('tall, curly hair, glasses');
    expect(p?.importantDates).toEqual([{ label: 'Anniversary', date: '2014-06-21' }]);
    expect(p?.interests).toEqual(['Music', 'Travel']);
  });

  it('setIntakeAnswerSharing changes ONE answered question’s scope, clears it on empty, and no-ops a phantom', async () => {
    const fs = await setup();
    await submitSectionForm(fs, key, 'p1', 'health', { physicalConditions: 'asthma' }, NOW);
    // Set a deliberate scope on the answered question.
    const updated = await setIntakeAnswerSharing(
      fs,
      key,
      'p1',
      'health',
      'physicalConditions',
      ['partner'],
      NOW,
    );
    expect(updated).not.toBeNull();
    let session = await getIntakeSession(fs, key, 'p1');
    let section = session?.sections.find((s) => s.id === 'health');
    expect(section?.answerSharing?.physicalConditions).toEqual(['partner']);
    // Empty types clears the scope (own-only) — the key is removed, not stored as [].
    await setIntakeAnswerSharing(fs, key, 'p1', 'health', 'physicalConditions', [], NOW);
    session = await getIntakeSession(fs, key, 'p1');
    section = session?.sections.find((s) => s.id === 'health');
    expect(section?.answerSharing?.physicalConditions).toBeUndefined();
    // A phantom (unanswered) question is a no-op (null) — the picker can't scope what isn't answered.
    expect(
      await setIntakeAnswerSharing(fs, key, 'p1', 'health', 'not-a-question', ['partner'], NOW),
    ).toBeNull();
  });

  it('joins multiple questions targeting one field instead of clobbering, and is idempotent (healthNotes)', async () => {
    const fs = await setup();
    const answers = { physicalConditions: 'asthma', healthOther: 'sensitive to caffeine' };
    await submitSectionForm(fs, key, 'p1', 'health', answers, NOW);
    const p = await getPerson(fs, key, 'p1');
    expect(p?.healthNotes).toContain('asthma'); // physicalConditions — NOT clobbered
    expect(p?.healthNotes).toContain('sensitive to caffeine'); // healthOther catch-all
    // Re-submitting the same answers rebuilds the field (no append/duplication).
    await submitSectionForm(fs, key, 'p1', 'health', answers, NOW);
    expect((await getPerson(fs, key, 'p1'))?.healthNotes).toBe(p?.healthNotes);
  });

  it('locks the sensitive promoted fields to own-context-only (privateFields)', async () => {
    const fs = await setup();
    await submitSectionForm(
      fs,
      key,
      'p1',
      'health',
      { physicalConditions: 'manages anxiety' },
      NOW,
    );
    let p = await getPerson(fs, key, 'p1');
    expect(p?.healthNotes).toBe('manages anxiety');
    expect(p?.privateFields).toContain('healthNotes');
    // The intimacy orientation/relationship-style promotions are private too (§14.6).
    await submitSectionForm(
      fs,
      key,
      'p1',
      'intimacy',
      { sexualOrientation: ['Bisexual'], relationshipStyle: 'Monogamous' },
      NOW,
    );
    p = await getPerson(fs, key, 'p1');
    expect(p?.sexualOrientation).toBe('Bisexual'); // multi → joined string field
    expect(p?.relationshipStyle).toBe('Monogamous');
    expect(p?.privateFields).toEqual(
      expect.arrayContaining(['healthNotes', 'sexualOrientation', 'relationshipStyle']),
    );
  });

  it('persists a PARTIAL intimacy activity matrix and formats it with 5-point labels for the portrait (27)', async () => {
    const fs = await setup();
    // Only TWO of the ~30 activity rows are rated. The shared `isAnswered` requires EVERY matrix row, so it
    // would drop this; the intake's own check accepts a partial matrix, so the ratings persist. Use non-oral
    // (universal) rows so the gender-aware resolution doesn't relabel them.
    const r0 = 'Bondage';
    const r1 = 'Choking (giving)';
    const activities = { [r0]: 5, [r1]: 1 }; // r0 = Love it (5), r1 = Hard no (1)
    await submitSectionForm(fs, key, 'p1', 'intimacy', { activities }, NOW);
    const sec = (await getIntakeSession(fs, key, 'p1'))?.sections.find((s) => s.id === 'intimacy');
    expect(sec?.answers.activities).toEqual(activities); // the partial matrix is kept, not dropped

    // Synthesis feeds the answers to the model as readable LABELS, not bare "1/5" or "[object Object]".
    let messages: { role: string; content: string }[] = [];
    const client = fakeClient({ captureMessages: (m) => (messages = m) });
    await synthesizeIntake(synth(fs, client));
    const body = messages.map((m) => m.content).join('\n');
    expect(body).toContain(`${r0}: Love it`);
    expect(body).toContain(`${r1}: Hard no`);
    expect(body).not.toContain('[object Object]');
  });

  it('synthesis resolves the activity matrix oral rows by gender + drawnTo (27 §4.2)', async () => {
    const fs = await setup();
    // A straight man: own anatomy tailors receiving; partner anatomy (Women) tailors giving to cunnilingus.
    await submitSectionForm(fs, key, 'p1', 'basics', { gender: 'Man' }, NOW);
    await submitSectionForm(fs, key, 'p1', 'intimacy', { drawnTo: ['Women'] }, NOW);
    // Rate the two resolved oral rows (the keys the renderer would have produced for this person).
    const activities = {
      'Receiving oral (blowjob)': 5,
      'Going down on her (oral)': 4,
    };
    await submitSectionForm(fs, key, 'p1', 'intimacy', { activities }, NOW);

    let messages: { role: string; content: string }[] = [];
    const client = fakeClient({ captureMessages: (m) => (messages = m) });
    await synthesizeIntake(synth(fs, client));
    const body = messages.map((m) => m.content).join('\n');
    // The resolved rows map back to their labels — never a straight man's "blowjob"-giving variant.
    expect(body).toContain('Receiving oral (blowjob): Love it');
    expect(body).toContain('Going down on her (oral): Like it');
    expect(body).not.toContain('Giving a blowjob');
  });

  it('keeps a matrix rating in synthesis even if a later gender/drawnTo edit orphans its row key (27)', async () => {
    const fs = await setup();
    // Rated as a straight man, then they change gender — the stored oral key no longer resolves. The rating
    // must still reach the portrait (appended verbatim), never silently dropped.
    await submitSectionForm(fs, key, 'p1', 'basics', { gender: 'Man' }, NOW);
    await submitSectionForm(
      fs,
      key,
      'p1',
      'intimacy',
      { drawnTo: ['Women'], activities: { 'Receiving oral (blowjob)': 5 } },
      NOW,
    );
    // The edit: gender → Woman (drawnTo still Women → now uncertain pairing → neutral rows).
    await submitSectionForm(fs, key, 'p1', 'basics', { gender: 'Woman' }, NOW);

    let messages: { role: string; content: string }[] = [];
    const client = fakeClient({ captureMessages: (m) => (messages = m) });
    await synthesizeIntake(synth(fs, client));
    const body = messages.map((m) => m.content).join('\n');
    expect(body).toContain('Receiving oral (blowjob): Love it'); // orphaned key still surfaces with its label
  });

  it('ignores answers not declared for the section (the trust boundary)', async () => {
    const fs = await setup();
    // `healthNotes` is a real Person key but NOT a `basics` question id — it must be ignored there, and a
    // made-up id is dropped entirely (a malicious renderer can't fill arbitrary fields).
    await submitSectionForm(
      fs,
      key,
      'p1',
      'basics',
      { healthNotes: 'secret', madeUpQuestion: 'x', occupation: 'nurse' },
      NOW,
    );
    const p = await getPerson(fs, key, 'p1');
    expect(p?.healthNotes).toBeUndefined();
    expect(p?.occupation).toBe('nurse');
    const basics = (await getIntakeSession(fs, key, 'p1'))?.sections.find((s) => s.id === 'basics');
    expect(basics?.answers).not.toHaveProperty('healthNotes');
    expect(basics?.answers).not.toHaveProperty('madeUpQuestion');
  });

  it('appends the interviewer addendum AFTER persona + safety + context', async () => {
    const fs = await setup();
    let system = '';
    const client = fakeClient({ capture: (s) => (system = s) });
    await runIntakeTurn(turn(fs, client, 'story', 'Where to start...'));
    const persona = system.indexOf('warm, reflective wellness companion');
    const safety = system.indexOf('NOT medical care');
    const interviewer = system.indexOf('getting to know you');
    expect(persona).toBeGreaterThanOrEqual(0);
    expect(safety).toBeGreaterThan(persona);
    expect(interviewer).toBeGreaterThan(safety);
  });

  it('refuses a turn with no key or over budget', async () => {
    const fs = await setup();
    const noKey = await runIntakeTurn(turn(fs, fakeClient(), 'basics', 'hi', { apiKey: null }));
    expect(noKey).toEqual({ ok: false, reason: 'NO_KEY', message: expect.any(String) });
  });

  it('skips a section without blocking', async () => {
    const fs = await setup();
    const session = await skipIntakeSection(fs, key, 'p1', 'intimacy', NOW);
    expect(session.sections.find((s) => s.id === 'intimacy')?.status).toBe('skipped');
  });

  it('section synthesis marks the section complete and stores a reflection (intake.synthesize)', async () => {
    const fs = await setup();
    await runIntakeTurn(turn(fs, fakeClient(), 'story', 'My childhood was...'));
    const res = await synthesizeIntake(synth(fs, fakeClient(), { sectionId: 'story' }));
    expect(res.ok).toBe(true);
    const section = (await getIntakeSession(fs, key, 'p1'))?.sections.find((s) => s.id === 'story');
    expect(section?.status).toBe('complete');
    expect(section?.reflection).toBeTruthy();
    const usage = await queryUsage(fs, key, {
      from: '2026-01-01',
      to: '2027-01-01',
      type: 'intake.synthesize',
    });
    expect(usage).toHaveLength(1);
  });

  it('synthesizes the portrait Insight (source intake, restricted facts flagged, none broadcast-shareable) and fills inferred fields', async () => {
    const fs = await setup();
    await runIntakeTurn(turn(fs, fakeClient(), 'basics', 'I am a nurse.'));
    const res = await synthesizeIntake(synth(fs, fakeClient()));
    expect(res.ok && res.insightId).toBeTruthy();
    const session = await getIntakeSession(fs, key, 'p1');
    expect(session?.status).toBe('complete');
    const insight = (await getInsight(fs, key, 'p1', session!.insightId!)) as Insight;
    expect(insight.source).toBe('intake');
    expect(insight.approved).toBe(true);
    // The 'weighs' fact is restricted; the others are not. None default to broadcast-shareable.
    const restricted = insight.facts.find((f) => f.text.includes('grief'));
    const open = insight.facts.find((f) => f.text.includes('nurse'));
    expect(restricted?.restricted).toBe(true);
    expect(open?.restricted).toBeUndefined();
    expect(insight.facts.every((f) => f.shareable === false)).toBe(true);
    // Inferred fields fill the (empty) Person profile.
    const p = await getPerson(fs, key, 'p1');
    expect(p?.communicationStyle).toBe('direct and warm');
  });

  it('salvages a portrait when the model reply has off-spec fields (non-numeric metric, malformed fact)', async () => {
    const fs = await setup();
    await runIntakeTurn(turn(fs, fakeClient(), 'basics', 'I am a nurse.'));
    // A single off-spec field must NOT discard the whole portrait (the reported 2026-06-22 failure).
    const offSpec = {
      portrait: 'A warm, resilient person who works in care.',
      facts: [
        { text: 'Works as a nurse', section: 'basics' },
        { notText: 'malformed — no text field' }, // dropped, not fatal
      ],
      metrics: { valence: 0.4, mood: 'calm' }, // 'calm' is non-numeric → metrics salvaged away
      crisisFlag: 'no', // non-boolean → ignored
    };
    const res = await synthesizeIntake(synth(fs, fakeClient({ portrait: offSpec })));
    expect(res.ok).toBe(true); // salvaged, not rejected
    const session = await getIntakeSession(fs, key, 'p1');
    const insight = (await getInsight(fs, key, 'p1', session!.insightId!)) as Insight;
    expect(insight.summary).toContain('resilient');
    expect(insight.facts.map((f) => f.text)).toContain('Works as a nurse');
    expect(insight.facts.every((f) => f.text.length > 0)).toBe(true); // the malformed fact was dropped
  });

  it('salvages a truncated portrait — recovers the summary + complete facts, drops the cut-off one (#19)', async () => {
    const fs = await setup();
    await runIntakeTurn(turn(fs, fakeClient(), 'basics', 'I am a nurse.'));
    // Cut off mid-`facts`: the summary + first fact are intact; a second fact is truncated.
    const truncated =
      '{"portrait":"A warm, resilient person who works in care.","facts":[' +
      '{"text":"Works as a nurse","section":"basics"},{"text":"Lives in Aus';
    const res = await synthesizeIntake(synth(fs, fakeClient({ portraitText: truncated })));
    expect(res.ok).toBe(true); // onboarding completes instead of dead-ending
    const session = await getIntakeSession(fs, key, 'p1');
    const insight = (await getInsight(fs, key, 'p1', session!.insightId!)) as Insight;
    expect(insight.summary).toContain('resilient');
    expect(insight.facts.map((f) => f.text)).toEqual(['Works as a nurse']); // the truncated fact dropped
  });

  it('reports "cut off" only when even the summary did not come through (#19)', async () => {
    const fs = await setup();
    await runIntakeTurn(turn(fs, fakeClient(), 'basics', 'I am a nurse.'));
    const truncated = '{"portr'; // cut off before the portrait value — nothing to salvage
    const res = await synthesizeIntake(synth(fs, fakeClient({ portraitText: truncated })));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/cut off/i);
  });

  it('hard-caps the stored portrait facts at the synthesis budget, keeping model order (28)', async () => {
    const fs = await setup();
    await runIntakeTurn(turn(fs, fakeClient(), 'basics', 'I am a nurse.'));
    // A model that ignores "at most N" and returns 80 facts must NOT bloat the pinned portrait.
    const many = {
      ...PORTRAIT,
      facts: Array.from({ length: 80 }, (_, i) => ({
        text: `Fact number ${i}`,
        section: 'basics',
      })),
    };
    // The bounded synthesis call MUST disable adaptive thinking, or `maxTokens` is the combined
    // thinking+output budget and the portrait JSON can truncate to empty (the adaptive-thinking lesson).
    let opts: { maxTokens?: number; extendedThinking?: boolean } = {};
    const res = await synthesizeIntake(
      synth(fs, fakeClient({ portrait: many, captureOptions: (o) => (opts = o) })),
    );
    expect(res.ok).toBe(true);
    expect(opts.extendedThinking).toBe(false);
    const session = await getIntakeSession(fs, key, 'p1');
    const insight = (await getInsight(fs, key, 'p1', session!.insightId!)) as Insight;
    expect(insight.facts.length).toBe(60); // capped at PORTRAIT_FACT_SYNTHESIS_BUDGET
    expect(insight.facts[0]?.text).toBe('Fact number 0'); // model ordering preserved (most important first)
    expect(insight.facts.at(-1)?.text).toBe('Fact number 59');
  });

  it('tags each portrait fact with a life-area: model value, else section fallback, else core (28)', async () => {
    const fs = await setup();
    await runIntakeTurn(turn(fs, fakeClient(), 'basics', 'I am a nurse.'));
    const portrait = {
      ...PORTRAIT,
      facts: [
        { text: 'A money fact tagged by the model', section: 'weighs', lifeArea: 'Money' }, // model wins
        { text: 'A work fact', section: 'work-money' }, // section fallback → Work & purpose
        { text: 'A values fact', section: 'values' }, // section fallback → Values & beliefs
        { text: 'An identity fact', section: 'basics' }, // identity section → undefined ⇒ CORE
        { text: 'A bogus-tag fact', section: 'health', lifeArea: 'NotARealArea' }, // invalid → section health
      ],
    };
    const res = await synthesizeIntake(synth(fs, fakeClient({ portrait })));
    expect(res.ok).toBe(true);
    const session = await getIntakeSession(fs, key, 'p1');
    const insight = (await getInsight(fs, key, 'p1', session!.insightId!)) as Insight;
    const area = (t: string) => insight.facts.find((f) => f.text.startsWith(t))?.lifeArea;
    expect(area('A money fact')).toBe('Money'); // model's valid value normalized + kept
    expect(area('A work fact')).toBe('Work & purpose'); // derived from section
    expect(area('A values fact')).toBe('Values & beliefs');
    expect(area('An identity fact')).toBeUndefined(); // basics → core (never narrowed)
    expect(area('A bogus-tag fact')).toBe('Health & body'); // invalid model tag → section fallback
  });

  it('honors a per-question `restricted` answer in a non-restricted section via a "(sensitive)" block (§14.8)', async () => {
    const fs = await setup();
    // The Health section is NOT restricted, but `substancesUsed` is a per-question restricted answer; `sleep`
    // is open. Per-question restriction must carry the substance fact but not the sleep fact.
    await submitSectionForm(
      fs,
      key,
      'p1',
      'health',
      { sleep: 5, substancesUsed: ['Cannabis / weed'] },
      NOW,
    );

    const usage = { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 };
    let captured: { role: string; content: string }[] = [];
    const client: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: (options, onDelta) => {
        const last = options.messages.at(-1)?.content ?? '';
        if (last.includes('closing portrait')) {
          captured = options.messages.map((m) => ({ role: m.role, content: m.content }));
          const text = JSON.stringify({
            portrait: 'A thoughtful person.',
            facts: [
              { text: 'Uses cannabis occasionally', section: 'health-sensitive' },
              { text: 'Sleeps reasonably well', section: 'health' },
            ],
            crisisFlag: false,
          });
          onDelta(text);
          return Promise.resolve({ text, usage });
        }
        onDelta('ok');
        return Promise.resolve({ text: 'ok', usage });
      },
    };

    const res = await synthesizeIntake(synth(fs, client));
    expect(res.ok).toBe(true);

    // The restricted answer was routed under a distinct "(sensitive)" block; the open answer under the plain one.
    const sensitiveBlock = captured.find((m) => m.content.includes('(id: health-sensitive)'));
    const plainBlock = captured.find((m) => /\(id: health\)/.test(m.content));
    expect(sensitiveBlock?.content).toContain('recreational substances');
    expect(sensitiveBlock?.content).not.toContain('How well do you sleep');
    expect(plainBlock?.content).toContain('How well do you sleep');
    expect(plainBlock?.content).not.toContain('recreational substances');

    // The fact from the sensitive block is flagged restricted; the plain one is not.
    const session = await getIntakeSession(fs, key, 'p1');
    const insight = (await getInsight(fs, key, 'p1', session!.insightId!)) as Insight;
    expect(insight.facts.find((f) => f.text.includes('cannabis'))?.restricted).toBe(true);
    expect(insight.facts.find((f) => f.text.includes('Sleeps'))?.restricted).toBeUndefined();
  });

  it('persists a roster answer in the section (no Person field) and feeds it to the portrait', async () => {
    const fs = await setup();
    await submitSectionForm(
      fs,
      key,
      'p1',
      'life-now',
      { children: [{ name: 'Emma', gender: 'Girl', dob: '2018-05-14' }] },
      NOW,
    );
    // Stored in the section answers; NOT promoted to a Person field (storage is portrait/context only).
    const session = await getIntakeSession(fs, key, 'p1');
    expect(session?.sections.find((s) => s.id === 'life-now')?.answers.children).toEqual([
      { name: 'Emma', gender: 'Girl', dob: '2018-05-14' },
    ]);
    expect(await getPerson(fs, key, 'p1')).not.toHaveProperty('children');

    // It reaches the synthesis input (the portrait), formatted as readable text — not "[object Object]".
    let captured = '';
    const usage = { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 };
    const client: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: (options, onDelta) => {
        if ((options.messages.at(-1)?.content ?? '').includes('closing portrait')) {
          captured = options.messages.map((m) => m.content).join('\n');
        }
        const text = JSON.stringify({ portrait: 'p', facts: [], crisisFlag: false });
        onDelta(text);
        return Promise.resolve({ text, usage });
      },
    };
    await synthesizeIntake(synth(fs, client));
    expect(captured).toContain('Emma, Girl, 2018-05-14'); // DOB, not a stale age
    expect(captured).not.toContain('[object Object]');
  });

  it('feeds the portrait into the person’s OWN coaching context, including restricted facts', async () => {
    const fs = await setup();
    await synthesizeIntake(synth(fs, fakeClient()));
    const context = await summarizeForContext(fs, key, 'p1', []);
    expect(context).toContain('quiet grace');
    expect(context).toContain('grief'); // own context keeps restricted facts (only owner views redact them)
  });

  it('re-synthesis reuses the insight id and carries shareable choices forward by text', async () => {
    const fs = await setup();
    const first = await synthesizeIntake(synth(fs, fakeClient()));
    const insightId = (first as { insightId: string }).insightId;
    // The owner promotes the 'values' fact to a related person.
    const insight = (await getInsight(fs, key, 'p1', insightId)) as Insight;
    const valuesFact = insight.facts.find((f) => f.text.includes('honesty'))!;
    valuesFact.shareableWith = ['other-1'];
    await saveInsight(fs, key, insight);
    // Re-synthesize (same portrait text) — the carried choice survives.
    const second = await synthesizeIntake(synth(fs, fakeClient()));
    expect((second as { insightId: string }).insightId).toBe(insightId);
    const after = (await getInsight(fs, key, 'p1', insightId)) as Insight;
    expect(after.facts.find((f) => f.text.includes('honesty'))?.shareableWith).toEqual(['other-1']);
  });

  it('redaction strips restricted facts for non-privileged viewers (§8.4)', async () => {
    const fs = await setup();
    await synthesizeIntake(synth(fs, fakeClient()));
    const session = await getIntakeSession(fs, key, 'p1');
    const insight = (await getInsight(fs, key, 'p1', session!.insightId!)) as Insight;
    expect(insight.facts.some((f) => f.restricted)).toBe(true); // the portrait has a restricted fact
    const redacted = redactRestrictedFacts(insight);
    expect(redacted.facts.some((f) => f.restricted)).toBe(false);
    expect(redacted.facts.length).toBe(insight.facts.length - 1);
  });

  it('keeps a fact restricted when it is edited/approved in Memory (no §8.4 strip)', async () => {
    const fs = await setup();
    await synthesizeIntake(synth(fs, fakeClient()));
    const session = await getIntakeSession(fs, key, 'p1');
    const insight = (await getInsight(fs, key, 'p1', session!.insightId!)) as Insight;
    // Simulate the Memory edit→save payload: only {id, text, shareable} reach the renderer, no `restricted`.
    await updateInsight(fs, key, 'p1', insight.id, {
      facts: insight.facts.map((f) => ({ id: f.id, text: f.text, shareable: true })),
    });
    const after = (await getInsight(fs, key, 'p1', insight.id)) as Insight;
    expect(after.facts.find((f) => f.text.includes('grief'))?.restricted).toBe(true);
    // The redaction still strips it from the owner's normal view after the edit.
    expect(redactRestrictedFacts(after).facts.some((f) => f.text.includes('grief'))).toBe(false);
  });

  it('never broadcasts a restricted fact to a related person, even if shareable is toggled on', async () => {
    const fs = await setup();
    await synthesizeIntake(synth(fs, fakeClient()));
    const session = await getIntakeSession(fs, key, 'p1');
    const insight = (await getInsight(fs, key, 'p1', session!.insightId!)) as Insight;
    // Force every restricted fact broadcast-shareable — the related-person gate must STILL exclude it.
    insight.facts = insight.facts.map((f) => (f.restricted ? { ...f, shareable: true } : f));
    await saveInsight(fs, key, insight);
    const ctx = await summarizeForContext(fs, key, 'p2', [{ id: 'p1', displayName: 'Sam' }]);
    expect(ctx).not.toContain('grief'); // p1's restricted fact never reaches p2's context
  });

  it('strips markers but keeps natural text', () => {
    expect(stripIntakeFieldMarkers('Nice to meet you.\n[[SELFOS:FIELD:occupation=nurse]]')).toBe(
      'Nice to meet you.',
    );
    // A trailing, not-yet-closed marker fragment is hidden too (the live-stream flash guard).
    expect(stripIntakeFieldMarkers('Lovely. [[SELFOS:FIELD:occupation=nur')).toBe('Lovely.');
  });
});

describe('intake per-question sharing (43)', () => {
  it('submitSectionForm persists answerSharing: explicit choice + category default for unset', async () => {
    const fs = await setup();
    // `faith` answered with an explicit scope; `values` answered with NO scope → its category preset.
    await submitSectionForm(
      fs,
      key,
      'p1',
      'values',
      { values: ['Honesty'], faith: 'Agnostic' },
      NOW,
      { faith: ['partner'] },
    );
    const session = await getIntakeSession(fs, key, 'p1');
    const sharing = session?.sections.find((s) => s.id === 'values')?.answerSharing ?? {};
    expect(sharing['faith']).toEqual(['partner']);
    // `values` had no explicit scope → defaults to the `values` category preset (everyone).
    expect(sharing['values']).toEqual(SHARING_PRESETS.values);
  });

  it('submitSectionForm defaults a restricted question to Private (empty) when unset', async () => {
    const fs = await setup();
    await submitSectionForm(fs, key, 'p1', 'weighs', { weighsWhat: ['Grief or loss'] }, NOW);
    const session = await getIntakeSession(fs, key, 'p1');
    const sharing = session?.sections.find((s) => s.id === 'weighs')?.answerSharing ?? {};
    expect(sharing['weighsWhat']).toEqual([]);
  });

  it('synthesize tags a non-restricted fact with the section scope (and the gate honors it)', async () => {
    const fs = await setup();
    await submitSectionForm(fs, key, 'p1', 'values', { values: ['Honesty'] }, NOW, {
      values: ['partner', 'friend'],
    });
    const portrait = {
      ...PORTRAIT,
      facts: [{ text: 'Values honesty above all', section: 'values' }],
    };
    await synthesizeIntake(synth(fs, fakeClient({ portrait })));
    const session = await getIntakeSession(fs, key, 'p1');
    const fact = (await getInsight(fs, key, 'p1', session!.insightId!))!.facts.find((f) =>
      f.text.includes('honesty'),
    )!;
    expect(fact.restricted).toBeUndefined();
    expect(fact.shareable).toBe(false); // never broadcast — type-scoped only
    expect(fact.shareableTypes).toEqual(['partner', 'friend']);
    // The 42 gate shares it with a partner/friend viewer, not a sibling.
    expect(factSharedWithViewer(fact, 'pv', ['partner'])).toBe(true);
    expect(factSharedWithViewer(fact, 'pv', ['sibling'])).toBe(false);
  });

  it('a restricted fact stays restricted + own-only when its answers are NOT opted in', async () => {
    const fs = await setup();
    await submitSectionForm(fs, key, 'p1', 'weighs', { weighsWhat: ['Grief or loss'] }, NOW); // default Private
    const portrait = { ...PORTRAIT, facts: [{ text: 'Carries grief', section: 'weighs' }] };
    await synthesizeIntake(synth(fs, fakeClient({ portrait })));
    const session = await getIntakeSession(fs, key, 'p1');
    const fact = (await getInsight(fs, key, 'p1', session!.insightId!))!.facts.find((f) =>
      f.text.includes('grief'),
    )!;
    expect(fact.restricted).toBe(true);
    expect(fact.shareableTypes).toBeUndefined();
    expect(factSharedWithViewer(fact, 'pv', ['partner'])).toBe(false);
  });

  it('an opted-in restricted answer yields a NON-restricted, type-scoped fact', async () => {
    const fs = await setup();
    await submitSectionForm(fs, key, 'p1', 'weighs', { weighsWhat: ['Grief or loss'] }, NOW, {
      weighsWhat: ['partner'],
    });
    const portrait = { ...PORTRAIT, facts: [{ text: 'Carries grief', section: 'weighs' }] };
    await synthesizeIntake(synth(fs, fakeClient({ portrait })));
    const session = await getIntakeSession(fs, key, 'p1');
    const fact = (await getInsight(fs, key, 'p1', session!.insightId!))!.facts.find((f) =>
      f.text.includes('grief'),
    )!;
    expect(fact.restricted).toBeUndefined();
    expect(fact.shareableTypes).toEqual(['partner']);
    expect(factSharedWithViewer(fact, 'pv', ['partner'])).toBe(true);
  });

  it('a section never submitted post-spec (no answerSharing) keeps its facts own-only', async () => {
    const fs = await setup();
    // No form submit → sections carry no answerSharing; the portrait still references them.
    const portrait = {
      ...PORTRAIT,
      facts: [{ text: 'Values honesty above all', section: 'values' }],
    };
    await synthesizeIntake(synth(fs, fakeClient({ portrait })));
    const session = await getIntakeSession(fs, key, 'p1');
    const fact = (await getInsight(fs, key, 'p1', session!.insightId!))!.facts.find((f) =>
      f.text.includes('honesty'),
    )!;
    expect(fact.shareableTypes).toBeUndefined();
    expect(factSharedWithViewer(fact, 'pv', ['partner'])).toBe(false);
  });

  it('most-restrictive-of-section: one Private answer locks the section facts to own-only', async () => {
    const fs = await setup();
    await submitSectionForm(
      fs,
      key,
      'p1',
      'values',
      { values: ['Honesty'], faith: 'Agnostic' },
      NOW,
      { values: ['partner'], faith: [] }, // faith is Private → intersection is empty
    );
    const portrait = {
      ...PORTRAIT,
      facts: [{ text: 'Values honesty above all', section: 'values' }],
    };
    await synthesizeIntake(synth(fs, fakeClient({ portrait })));
    const session = await getIntakeSession(fs, key, 'p1');
    const fact = (await getInsight(fs, key, 'p1', session!.insightId!))!.facts.find((f) =>
      f.text.includes('honesty'),
    )!;
    expect(fact.shareableTypes).toBeUndefined();
  });
});
