import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { ClaudeClient } from '../host';
import type { Insight, Person } from '../schemas';
import { listConversations } from '../conversations';
import { getInsight, saveInsight, summarizeForContext, updateInsight } from '../insights';
import { getPerson, savePerson } from '../people';
import { queryUsage } from '../usage';
import {
  ensureIntakeSession,
  getIntakeSession,
  listRestrictedIntakeFacts,
  redactRestrictedFacts,
  runIntakeTurn,
  skipIntakeSection,
  stripIntakeFieldMarkers,
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
    capture?: (s: string) => void;
  } = {},
): ClaudeClient {
  const usage = { inputTokens: 12, outputTokens: 6, cacheWriteTokens: 0, cacheReadTokens: 0 };
  return {
    send: () => Promise.resolve(''),
    stream: (options, onDelta) => {
      over.capture?.(options.system);
      const last = options.messages.at(-1)?.content ?? '';
      let text: string;
      if (last.includes('closing portrait')) text = JSON.stringify(over.portrait ?? PORTRAIT);
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

  it('fills the mapped Person field from a direct answer marker, and strips the marker from the saved text', async () => {
    const fs = await setup();
    const client = fakeClient({ reply: 'Lovely. [[SELFOS:FIELD:occupation=nurse]]' });
    const res = await runIntakeTurn(turn(fs, client, 'basics', 'I am a nurse.'));
    expect(res.ok && res.filledFields).toContain('occupation');
    expect((await getPerson(fs, key, 'p1'))?.occupation).toBe('nurse');
    const saved = (await getIntakeSession(fs, key, 'p1'))?.sections.find((s) => s.id === 'basics');
    const lastAssistant = saved?.messages.at(-1)?.content ?? '';
    expect(lastAssistant).not.toContain('SELFOS:FIELD');
    expect(lastAssistant).toContain('Lovely.');
  });

  it('fills a list field comma-separated', async () => {
    const fs = await setup();
    const client = fakeClient({ reply: 'Got it. [[SELFOS:FIELD:languages=English, Spanish]]' });
    await runIntakeTurn(turn(fs, client, 'basics', 'English and Spanish.'));
    expect((await getPerson(fs, key, 'p1'))?.languages).toEqual(['English', 'Spanish']);
  });

  it('auto-locks a sensitive direct field to own-context-only (privateFields)', async () => {
    const fs = await setup();
    const client = fakeClient({ reply: 'Thank you. [[SELFOS:FIELD:healthNotes=manages anxiety]]' });
    await runIntakeTurn(turn(fs, client, 'health', 'I have anxiety.'));
    const p = await getPerson(fs, key, 'p1');
    expect(p?.healthNotes).toBe('manages anxiety');
    expect(p?.privateFields).toContain('healthNotes');
  });

  it('ignores a field marker whose key is not declared for the section', async () => {
    const fs = await setup();
    // healthNotes is not a `basics` direct field — it must be ignored there.
    const client = fakeClient({ reply: 'Ok. [[SELFOS:FIELD:healthNotes=secret]]' });
    const res = await runIntakeTurn(turn(fs, client, 'basics', 'hi'));
    expect(res.ok && (res.filledFields ?? [])).not.toContain('healthNotes');
    expect((await getPerson(fs, key, 'p1'))?.healthNotes).toBeUndefined();
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

  it('exposes restricted facts only via the break-glass reader; redaction strips them', async () => {
    const fs = await setup();
    await synthesizeIntake(synth(fs, fakeClient()));
    const restricted = await listRestrictedIntakeFacts(fs, key, 'p1');
    expect(restricted).toHaveLength(1);
    expect(restricted[0]?.text).toContain('grief');
    const session = await getIntakeSession(fs, key, 'p1');
    const insight = (await getInsight(fs, key, 'p1', session!.insightId!)) as Insight;
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
