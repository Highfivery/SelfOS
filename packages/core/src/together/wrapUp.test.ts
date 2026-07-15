import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { ClaudeClient, ClaudeMessage, FileSystem } from '../host';
import type { Agreement, Person, TogetherSession } from '../schemas';
import { buildContext, savePerson, saveRelationship } from '../people';
import { listInsightsForPerson } from '../insights';
import { queryUsage } from '../usage';
import { parseAgreementMarker, stripAgreementMarker } from '../conversations/agreementMarker';
import { stripCoachMarkers } from '../conversations/guidedSteps';
import { appendMessage, createSession, pairKeyFor } from './togetherService';
import { runTogetherTurn } from './togetherChatService';
import {
  captureAgreementFromMarker,
  dedupeAgreements,
  getReport,
  isReportStale,
  listAgreements,
  normalizeAgreementText,
  saveAgreement,
  standingAgreements,
} from './agreementService';
import { runTogetherWrapUp, type TogetherWrapUpDeps } from './togetherAnalysisService';
import { buildGroundingPack } from './groundingPack';

const key = generateMasterKey();
const BEN = 'ben';
const ANGEL = 'angel';
const NOW = new Date('2026-07-10T12:00:00.000Z');

function person(id: string, displayName: string): Person {
  return {
    id,
    schemaVersion: 1,
    displayName,
    isSubject: true,
    tags: [],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

/** A fake Claude client that captures the analyze input + returns a fixed reply. */
function analyzeClient(reply: string): {
  client: ClaudeClient;
  captured: { system?: string; messages?: ClaudeMessage[] };
} {
  const captured: { system?: string; messages?: ClaudeMessage[] } = {};
  const client: ClaudeClient = {
    send: () => Promise.resolve('ok'),
    stream: (opts) => {
      captured.system = opts.system;
      captured.messages = opts.messages;
      return Promise.resolve({
        text: reply,
        usage: { inputTokens: 100, outputTokens: 50, cacheWriteTokens: 0, cacheReadTokens: 0 },
      });
    },
  };
  return { client, captured };
}

async function seedSession(fs: FileSystem): Promise<TogetherSession> {
  await savePerson(fs, key, person(BEN, 'Ben'));
  await savePerson(fs, key, person(ANGEL, 'Angel'));
  await saveRelationship(fs, key, {
    id: 'rel-partner',
    schemaVersion: 2,
    fromPersonId: BEN,
    toPersonId: ANGEL,
    type: 'partner',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  });
  return createSession(fs, key, { initiatorPersonId: BEN, participantIds: [BEN, ANGEL] }, NOW);
}

/** A well-formed wrap-up reply naming both partners; SECRET only appears in an aside (must never reach the AI). */
const WRAPUP_JSON = JSON.stringify({
  summary: 'You both showed up honestly and named what you each need.',
  themes: ['connection', 'time'],
  workedThrough: ['naming the pattern'],
  connectionValence: 0.4,
  frictionLevel: 0.2,
  partners: [
    {
      name: 'Ben',
      reflection: 'You spoke your needs clearly, Ben.',
      facts: ['wants more time'],
      sensitiveFacts: [],
      crisisFlag: false,
    },
    {
      name: 'Angel',
      reflection: 'You listened well, Angel.',
      facts: ['values reassurance'],
      sensitiveFacts: ['a desire preference'],
      crisisFlag: false,
    },
  ],
});

describe('agreementMarker (§6.4)', () => {
  it('parses text + timeframe, tolerates malformed, and strips (incl. mid-stream partials)', () => {
    expect(
      parseAgreementMarker(
        'Great. [[SELFOS:AGREEMENT:{"text":"screen-free dinners","timeframe":"weekdays"}]]',
      ),
    ).toEqual({ text: 'screen-free dinners', timeframe: 'weekdays' });
    expect(parseAgreementMarker('[[SELFOS:AGREEMENT:{"text":""}]]')).toBeNull(); // empty text
    expect(parseAgreementMarker('[[SELFOS:AGREEMENT:{not json}]]')).toBeNull();
    expect(parseAgreementMarker('no marker here')).toBeNull();
    expect(stripAgreementMarker('Nice work.\n[[SELFOS:AGREEMENT:{"text":"x"}]]')).toBe(
      'Nice work.',
    );
    expect(stripAgreementMarker('mid [[SELFOS:AGREEMENT:{"text":"x"')).toBe('mid'); // unterminated
    expect(stripAgreementMarker('mid [[SELFOS:AGRE')).toBe('mid'); // prefix partial
    // The shared stripper removes it too (a SOLO coach that ever emits one never shows it).
    expect(stripCoachMarkers('Hi [[SELFOS:AGREEMENT:{"text":"x"}]]')).toBe('Hi');
  });
});

describe('agreementService ledger (§3.9)', () => {
  it('creates, edits (preserving createdAt + origin), retires, and lists newest-first', async () => {
    const fs = memFileSystem();
    const a = await saveAgreement(
      fs,
      key,
      BEN,
      ANGEL,
      { text: 'weekly date', status: 'standing', sessionId: 's1' },
      NOW,
    );
    expect(a?.pairKey).toBe(pairKeyFor(BEN, ANGEL));
    expect(a?.status).toBe('standing');

    // Edit inline: text changes, createdAt + provenance preserved, updatedAt bumps (§11 #2 LWW).
    const edited = await saveAgreement(
      fs,
      key,
      ANGEL,
      BEN,
      { id: a!.id, text: 'weekly date night', status: 'standing', sessionId: 's-other' },
      new Date('2026-07-11T00:00:00.000Z'),
    );
    expect(edited?.text).toBe('weekly date night');
    expect(edited?.createdAt).toBe(a?.createdAt);
    expect(edited?.provenance.sessionId).toBe('s1'); // origin preserved, not overwritten by the editor's session
    expect(edited?.updatedAt).not.toBe(a?.updatedAt);

    // Retire.
    await saveAgreement(
      fs,
      key,
      BEN,
      ANGEL,
      { id: a!.id, text: 'weekly date night', status: 'retired', sessionId: 's1' },
      NOW,
    );
    const all = await listAgreements(fs, key, pairKeyFor(BEN, ANGEL));
    expect(all).toHaveLength(1);
    expect(all[0]?.status).toBe('retired');
    expect(standingAgreements(all)).toHaveLength(0);
  });

  it('captures an agreement from a coach marker as standing', async () => {
    const fs = memFileSystem();
    const a = await captureAgreementFromMarker(
      fs,
      key,
      BEN,
      ANGEL,
      { text: 'no phones at dinner', timeframe: 'daily' },
      's1',
      NOW,
    );
    expect(a?.status).toBe('standing');
    expect(a?.timeframe).toBe('daily');
  });

  it('DE-DUPES a repeated coach marker — never mints a duplicate agreement (issue #206)', async () => {
    const fs = memFileSystem();
    const first = await captureAgreementFromMarker(
      fs,
      key,
      BEN,
      ANGEL,
      { text: 'Screen-free dinners.', timeframe: 'weekdays' },
      's1',
      NOW,
    );
    // The coach repeats the SAME agreement (different case/punctuation) on a later turn / retry.
    const second = await captureAgreementFromMarker(
      fs,
      key,
      BEN,
      ANGEL,
      { text: 'screen-free dinners' },
      's1',
      new Date(NOW.getTime() + 60_000),
    );
    // No duplicate file: the ledger holds exactly one, and the repeat returns the existing record.
    const all = await listAgreements(fs, key, pairKeyFor(BEN, ANGEL));
    expect(all).toHaveLength(1);
    expect(second?.id).toBe(first?.id);
  });

  it('normalizeAgreementText + dedupeAgreements collapse identical text, preferring the most-actionable', () => {
    expect(normalizeAgreementText('Screen-free dinners.')).toBe(
      normalizeAgreementText('screen-free   dinners'),
    );
    const mk = (over: Partial<Agreement>): Agreement => ({
      id: over.id ?? 'x',
      schemaVersion: 1,
      pairKey: pairKeyFor(BEN, ANGEL),
      text: 'screen-free dinners',
      status: 'standing',
      provenance: { sessionId: 's1', at: 'now' },
      createdAt: 'now',
      updatedAt: 'now',
      ...over,
    });
    // Two identical DONE twins collapse to one (the newer wins).
    const twoDone = dedupeAgreements([
      mk({ id: 'a', status: 'done', updatedAt: '2026-07-10T00:00:00.000Z' }),
      mk({ id: 'b', status: 'done', updatedAt: '2026-07-11T00:00:00.000Z' }),
    ]);
    expect(twoDone).toHaveLength(1);
    expect(twoDone[0]?.id).toBe('b');
    // A live standing re-commit wins over an older done twin (never hidden behind a completed one).
    const mixed = dedupeAgreements([
      mk({ id: 'done', status: 'done', updatedAt: '2026-07-12T00:00:00.000Z' }),
      mk({ id: 'standing', status: 'standing', updatedAt: '2026-07-10T00:00:00.000Z' }),
    ]);
    expect(mixed).toHaveLength(1);
    expect(mixed[0]?.id).toBe('standing');
    // Distinct texts are never merged.
    expect(dedupeAgreements([mk({ id: 'a' }), mk({ id: 'b', text: 'weekly walk' })])).toHaveLength(
      2,
    );
  });

  it('derives report staleness from the newest shared human message', () => {
    const report = {
      id: 'r',
      schemaVersion: 1 as const,
      sessionId: 's1',
      summary: 's',
      themes: [],
      workedThrough: [],
      agreementIds: [],
      createdAt: '2026-07-10T12:00:00.000Z',
      updatedAt: '2026-07-10T12:00:00.000Z',
    };
    expect(isReportStale(report, null)).toBe(false);
    expect(isReportStale(report, '2026-07-10T11:00:00.000Z')).toBe(false); // older msg
    expect(isReportStale(report, '2026-07-10T13:00:00.000Z')).toBe(true); // newer msg
    expect(isReportStale(null, '2026-07-10T13:00:00.000Z')).toBe(false);
    // Staleness compares against updatedAt (last generated), so a fresh reflect/refresh clears it: a report
    // re-generated at 12:30 is NOT stale against a 12:15 message even though createdAt (12:00) is older.
    const refreshed = { ...report, updatedAt: '2026-07-10T12:30:00.000Z' };
    expect(isReportStale(refreshed, '2026-07-10T12:15:00.000Z')).toBe(false);
    expect(isReportStale(refreshed, '2026-07-10T12:45:00.000Z')).toBe(true);
  });
});

describe('runTogetherWrapUp (§3.8) — the safety-critical wrap-up', () => {
  async function seedWithTranscript(fs: FileSystem): Promise<TogetherSession> {
    const session = await seedSession(fs);
    await appendMessage(fs, key, session.id, {
      id: 'm1',
      schemaVersion: 1,
      authorPersonId: BEN,
      role: 'user',
      content: 'I want more time together.',
      ts: '2026-07-10T12:01:00.000Z',
    });
    await appendMessage(fs, key, session.id, {
      id: 'm2',
      schemaVersion: 1,
      authorPersonId: ANGEL,
      role: 'assistant',
      content: 'I hear you both.',
      ts: '2026-07-10T12:02:00.000Z',
    });
    // A PRIVATE ASIDE by Ben — its content must NEVER reach the analyze input, report, or twins (§3.8).
    await appendMessage(fs, key, session.id, {
      id: 'm3',
      schemaVersion: 1,
      authorPersonId: BEN,
      role: 'user',
      content: 'SECRETASIDE I am scared to say this.',
      ts: '2026-07-10T12:03:00.000Z',
      privateAside: true,
    });
    return session;
  }

  const deps = (
    fs: FileSystem,
    client: ClaudeClient,
    over: Partial<TogetherWrapUpDeps> & { session: TogetherSession },
  ): TogetherWrapUpDeps => ({
    fs,
    key,
    client,
    apiKey: 'sk-test',
    model: 'claude-sonnet-4-6',
    memoryEnabled: true,
    now: new Date('2026-07-10T12:10:00.000Z'),
    relationshipId: 'rel-partner',
    ...over,
  });

  it('EXCLUDES asides from the analyze input, writes two twins + a report, and keeps the aside out of BOTH', async () => {
    const fs = memFileSystem();
    const session = await seedWithTranscript(fs);
    const { client, captured } = analyzeClient(WRAPUP_JSON);
    const result = await runTogetherWrapUp(deps(fs, client, { session }));
    expect(result.ok).toBe(true);

    // The aside NEVER reaches the model.
    const sentText = JSON.stringify(captured.messages);
    expect(sentText).not.toContain('SECRETASIDE');

    // A shared report exists (no crisis detail) + two twins, each subject = that partner.
    const report = await getReport(fs, key, session.id);
    expect(report?.summary).toContain('showed up honestly');
    expect(report?.metrics?.connectionValence).toBeCloseTo(0.4);

    const benTwins = (await listInsightsForPerson(fs, key, BEN)).filter(
      (i) => i.source === 'together',
    );
    const angelTwins = (await listInsightsForPerson(fs, key, ANGEL)).filter(
      (i) => i.source === 'together',
    );
    // Ben has no sexual facts → one MAIN twin. Angel has one → a MAIN twin + an INTIMACY companion.
    expect(benTwins).toHaveLength(1);
    expect(angelTwins).toHaveLength(2);
    const benMain = benTwins[0];
    const angelMain = angelTwins.find((i) => !i.facts.some((f) => f.restricted));
    expect(benMain?.subjectPersonId).toBe(BEN);
    expect(benMain?.provenance.togetherSessionId).toBe(session.id);
    expect(benMain?.provenance.pairKey).toBe(session.pairKey);
    expect(benMain?.relationshipId).toBe('rel-partner');
    // The aside is absent from ALL twins.
    expect(JSON.stringify(benTwins)).not.toContain('SECRETASIDE');
    expect(JSON.stringify(angelTwins)).not.toContain('SECRETASIDE');
    // Dyad metrics on the MAIN twins (the pulse source); the intimacy companion carries no metrics.
    expect(benMain?.metrics?.frictionLevel).toBeCloseTo(0.2);
    expect(angelMain?.metrics?.frictionLevel).toBeCloseTo(0.2);
  });

  it('splits sexual facts onto a RESTRICTED intimacy companion (own-context-only) so the MAIN reflection still feeds (§3.8)', async () => {
    const fs = memFileSystem();
    const session = await seedWithTranscript(fs);
    await runTogetherWrapUp(deps(fs, analyzeClient(WRAPUP_JSON).client, { session }));
    const twins = (await listInsightsForPerson(fs, key, ANGEL)).filter(
      (i) => i.source === 'together',
    );
    const main = twins.find((i) => !i.facts.some((f) => f.restricted));
    const intimacy = twins.find((i) => i.facts.some((f) => f.restricted));
    // The MAIN twin carries the reflection + the non-sexual fact, with NO restricted fact → it feeds context.
    expect(main?.summary).toContain('listened well');
    expect(main?.facts.find((f) => f.text === 'values reassurance')?.restricted).toBeUndefined();
    expect(main?.facts.some((f) => f.text === 'a desire preference')).toBe(false);
    // The sexual fact lives on the companion — restricted + lifeArea Intimacy (own intimacy-topic context only).
    const sensitive = intimacy?.facts.find((f) => f.text === 'a desire preference');
    expect(sensitive?.restricted).toBe(true);
    expect(sensitive?.lifeArea).toBe('Intimacy');
    expect(intimacy?.categories).toContain('Intimacy');
  });

  it('the MAIN twin feeds the partner’s own coaching context (the reflection is never withheld, §3.8)', async () => {
    const fs = memFileSystem();
    const session = await seedWithTranscript(fs);
    await runTogetherWrapUp(deps(fs, analyzeClient(WRAPUP_JSON).client, { session }));
    // buildContext (own, no excludeRestricted) must surface Angel's reflection + non-sexual fact, but NEVER
    // the sexual fact in a non-intimacy topic (it's restricted + intimacy-gated).
    const context = await buildContext(fs, key, ANGEL);
    expect(context).toContain('values reassurance');
    expect(context).not.toContain('a desire preference');
  });

  it('routes a crisis flag to the AFFECTED partner’s twin ONLY — never into the shared report (§8.5)', async () => {
    const fs = memFileSystem();
    const session = await seedWithTranscript(fs);
    const crisisJson = JSON.stringify({
      summary: 'A supportive, detail-free recap.',
      themes: [],
      workedThrough: [],
      connectionValence: 0,
      frictionLevel: 0.3,
      partners: [
        {
          name: 'Ben',
          reflection: 'You are carrying a lot.',
          facts: [],
          sensitiveFacts: [],
          crisisFlag: true,
        },
        {
          name: 'Angel',
          reflection: 'You were steady.',
          facts: [],
          sensitiveFacts: [],
          crisisFlag: false,
        },
      ],
    });
    await runTogetherWrapUp(deps(fs, analyzeClient(crisisJson).client, { session }));
    const benTwin = (await listInsightsForPerson(fs, key, BEN)).find(
      (i) => i.source === 'together',
    );
    const angelTwin = (await listInsightsForPerson(fs, key, ANGEL)).find(
      (i) => i.source === 'together',
    );
    expect(benTwin?.crisisFlag).toBe(true);
    expect(angelTwin?.crisisFlag).toBeUndefined();
    const report = await getReport(fs, key, session.id);
    expect(report?.summary).toBe('A supportive, detail-free recap.'); // no crisis detail
  });

  it('is idempotent: re-running overwrites the SAME twins + report in place', async () => {
    const fs = memFileSystem();
    const session = await seedWithTranscript(fs);
    const first = await runTogetherWrapUp(deps(fs, analyzeClient(WRAPUP_JSON).client, { session }));
    const firstReportId = first.ok ? first.report.id : '';
    const firstTwinId = (await listInsightsForPerson(fs, key, BEN)).find(
      (i) => i.source === 'together',
    )?.id;
    await runTogetherWrapUp(deps(fs, analyzeClient(WRAPUP_JSON).client, { session }));
    const benTwins = (await listInsightsForPerson(fs, key, BEN)).filter(
      (i) => i.source === 'together',
    );
    expect(benTwins).toHaveLength(1); // not duplicated
    expect(benTwins[0]?.id).toBe(firstTwinId); // reuse-the-id
    expect((await getReport(fs, key, session.id))?.id).toBe(firstReportId);
  });

  // ── Action items → deduped pair agreements + reflect-vs-wrap-up mode (58 §3.8/§3.9) ────────────────
  const withActions = (items: { text: string; timeframe?: string }[]): string =>
    JSON.stringify({
      summary: 'A warm recap.',
      themes: [],
      workedThrough: [],
      connectionValence: 0.3,
      frictionLevel: 0.1,
      partners: [
        { name: 'Ben', reflection: 'r', facts: [], sensitiveFacts: [], crisisFlag: false },
        { name: 'Angel', reflection: 'r', facts: [], sensitiveFacts: [], crisisFlag: false },
      ],
      actionItems: items,
    });

  it('creates a STANDING pair agreement per action item (with timeframe), referenced by the report', async () => {
    const fs = memFileSystem();
    const session = await seedWithTranscript(fs);
    const json = withActions([
      { text: 'Plan a weekly date night', timeframe: 'this week' },
      { text: 'Check in for 10 minutes each night' },
    ]);
    const result = await runTogetherWrapUp(deps(fs, analyzeClient(json).client, { session }));
    expect(result.ok).toBe(true);
    const agreements = standingAgreements(await listAgreements(fs, key, session.pairKey));
    expect(agreements.map((a) => a.text).sort()).toEqual([
      'Check in for 10 minutes each night',
      'Plan a weekly date night',
    ]);
    expect(agreements.find((a) => a.text.startsWith('Plan'))?.timeframe).toBe('this week');
    // The report references the freshly-minted action items.
    const report = await getReport(fs, key, session.id);
    expect(report?.agreementIds).toHaveLength(2);
  });

  it('DE-DUPES action items against existing agreements (by normalized text) — never doubles them', async () => {
    const fs = memFileSystem();
    const session = await seedWithTranscript(fs);
    // A pre-existing agreement (e.g. captured from a chat marker) — trailing punctuation + case differ.
    await saveAgreement(
      fs,
      key,
      BEN,
      ANGEL,
      { text: 'Plan a weekly date night.', status: 'standing', sessionId: session.id },
      NOW,
    );
    const json = withActions([
      { text: 'plan a weekly   date night' }, // a rephrasing of the existing one → skipped
      { text: 'Check in nightly' }, // genuinely new → created
    ]);
    await runTogetherWrapUp(deps(fs, analyzeClient(json).client, { session }));
    const texts = standingAgreements(await listAgreements(fs, key, session.pairKey)).map(
      (a) => a.text,
    );
    expect(texts).toHaveLength(2); // the original + the one new item, NOT three
    expect(texts).toContain('Check in nightly');
  });

  it('reflect-then-wrap-up never doubles the action items (both de-dup against the ledger)', async () => {
    const fs = memFileSystem();
    const session = await seedWithTranscript(fs);
    const json = withActions([
      { text: 'Plan a date night' },
      { text: 'Say one appreciation daily' },
    ]);
    // A mid-session reflect creates the two action items…
    await runTogetherWrapUp(deps(fs, analyzeClient(json).client, { session, mode: 'reflect' }));
    // …then wrapping up re-runs the SAME analysis — it must NOT re-create them.
    await runTogetherWrapUp(deps(fs, analyzeClient(json).client, { session, mode: 'wrapUp' }));
    expect(standingAgreements(await listAgreements(fs, key, session.pairKey))).toHaveLength(2);
  });

  it('mode: a mid-session reflect leaves the session OPEN; wrap-up marks it DONE', async () => {
    const fs = memFileSystem();
    const session = await seedWithTranscript(fs);
    // 'reflect' → no `wrappedUp` on the report (the session stays open).
    await runTogetherWrapUp(
      deps(fs, analyzeClient(WRAPUP_JSON).client, { session, mode: 'reflect' }),
    );
    let report = await getReport(fs, key, session.id);
    expect(report?.wrappedUp).toBeUndefined();
    expect(report?.wrappedUpAt).toBeUndefined();
    // 'wrapUp' (the default) → marks it done (idempotent: same report id).
    await runTogetherWrapUp(
      deps(fs, analyzeClient(WRAPUP_JSON).client, { session, mode: 'wrapUp' }),
    );
    report = await getReport(fs, key, session.id);
    expect(report?.wrappedUp).toBe(true);
    expect(report?.wrappedUpAt).toBe('2026-07-10T12:10:00.000Z');
  });

  it('a reflect on an ALREADY wrapped-up session preserves the wrapped-up state (never silently un-wraps, #206)', async () => {
    const fs = memFileSystem();
    const session = await seedWithTranscript(fs);
    // Wrap up → the session is DONE.
    await runTogetherWrapUp(
      deps(fs, analyzeClient(WRAPUP_JSON).client, { session, mode: 'wrapUp' }),
    );
    const wrappedAt = (await getReport(fs, key, session.id))?.wrappedUpAt;
    expect(wrappedAt).toBe('2026-07-10T12:10:00.000Z');
    // A later "Reflect again" (mode reflect, a fresh timestamp) refreshes the report but must NOT drop
    // `wrappedUp` — otherwise the session would derive back to `active` with no new message (the #206 fix).
    await runTogetherWrapUp(
      deps(fs, analyzeClient(WRAPUP_JSON).client, {
        session,
        mode: 'reflect',
        now: new Date('2026-07-10T12:30:00.000Z'),
      }),
    );
    const report = await getReport(fs, key, session.id);
    expect(report?.wrappedUp).toBe(true);
    expect(report?.wrappedUpAt).toBe(wrappedAt); // carried forward from the original wrap-up, not cleared
    expect(report?.updatedAt).toBe('2026-07-10T12:30:00.000Z'); // the reflection itself did refresh
  });

  it('a partner name that doesn’t resolve writes NO twin (fail-safe against a wrong-subject reflection)', async () => {
    const fs = memFileSystem();
    const session = await seedWithTranscript(fs);
    const badJson = JSON.stringify({
      summary: 'ok',
      themes: [],
      workedThrough: [],
      connectionValence: 0,
      frictionLevel: 0,
      partners: [
        { name: 'Ben', reflection: 'r', facts: [], sensitiveFacts: [], crisisFlag: false },
        {
          name: 'Stranger',
          reflection: 'leaked?',
          facts: ['leaked'],
          sensitiveFacts: [],
          crisisFlag: false,
        },
      ],
    });
    await runTogetherWrapUp(deps(fs, analyzeClient(badJson).client, { session }));
    expect(
      (await listInsightsForPerson(fs, key, BEN)).filter((i) => i.source === 'together'),
    ).toHaveLength(1);
    expect(
      (await listInsightsForPerson(fs, key, ANGEL)).filter((i) => i.source === 'together'),
    ).toHaveLength(0);
  });

  it('writes NO twins when the two partners share a display name (can’t disambiguate → never mis-subject)', async () => {
    const fs = memFileSystem();
    // Two partners both named "Sam" — the name→id map can't tell them apart.
    await savePerson(fs, key, person('sam-a', 'Sam'));
    await savePerson(fs, key, person('sam-b', 'Sam'));
    await saveRelationship(fs, key, {
      id: 'rel-sam',
      schemaVersion: 2,
      fromPersonId: 'sam-a',
      toPersonId: 'sam-b',
      type: 'partner',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    });
    const session = await createSession(
      fs,
      key,
      { initiatorPersonId: 'sam-a', participantIds: ['sam-a', 'sam-b'] },
      NOW,
    );
    await appendMessage(fs, key, session.id, {
      id: 'm1',
      schemaVersion: 1,
      authorPersonId: 'sam-a',
      role: 'user',
      content: 'hi',
      ts: '2026-07-10T12:01:00.000Z',
    });
    const result = await runTogetherWrapUp(
      deps(fs, analyzeClient(WRAPUP_JSON).client, { session }),
    );
    // The report is still produced; NO twins are written (neither partner gets a possibly-wrong reflection).
    expect(result.ok).toBe(true);
    expect(
      (await listInsightsForPerson(fs, key, 'sam-a')).filter((i) => i.source === 'together'),
    ).toHaveLength(0);
    expect(
      (await listInsightsForPerson(fs, key, 'sam-b')).filter((i) => i.source === 'together'),
    ).toHaveLength(0);
  });

  it('references THIS session’s standing agreements in the report', async () => {
    const fs = memFileSystem();
    const session = await seedWithTranscript(fs);
    const a = await captureAgreementFromMarker(
      fs,
      key,
      BEN,
      ANGEL,
      { text: 'weekly walk' },
      session.id,
      NOW,
    );
    await captureAgreementFromMarker(
      fs,
      key,
      BEN,
      ANGEL,
      { text: 'from another session' },
      'other-session',
      NOW,
    );
    const result = await runTogetherWrapUp(
      deps(fs, analyzeClient(WRAPUP_JSON).client, { session }),
    );
    expect(result.ok && result.report.agreementIds).toEqual([a!.id]);
  });

  it('meters the paid call even when the reply is malformed, and gates memory-off / no-key / empty', async () => {
    const fs = memFileSystem();
    const session = await seedWithTranscript(fs);
    // Malformed reply → MALFORMED, but usage IS recorded (meter-before-parse).
    const bad = await runTogetherWrapUp(
      deps(fs, analyzeClient('not json at all').client, { session }),
    );
    expect(bad.ok).toBe(false);
    const usage = await queryUsage(fs, key, {
      from: '2026-01-01T00:00:00.000Z',
      to: '2027-01-01T00:00:00.000Z',
    });
    expect(usage.some((u) => u.type === 'together.analyze')).toBe(true);

    // Memory off / no key / empty transcript.
    expect(
      (
        await runTogetherWrapUp(
          deps(fs, analyzeClient(WRAPUP_JSON).client, { session, memoryEnabled: false }),
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await runTogetherWrapUp(
          deps(fs, analyzeClient(WRAPUP_JSON).client, { session, apiKey: null }),
        )
      ).ok,
    ).toBe(false);
    const emptyFs = memFileSystem();
    const emptySession = await seedSession(emptyFs);
    const emptyResult = await runTogetherWrapUp(
      deps(emptyFs, analyzeClient(WRAPUP_JSON).client, { session: emptySession }),
    );
    expect(emptyResult.ok).toBe(false);
    expect(!emptyResult.ok && emptyResult.reason).toBe('EMPTY');
  });
});

describe('couples-turn agreement capture (§6.4)', () => {
  const AGREEMENT_REPLY =
    'That sounds like a real commitment. [[SELFOS:AGREEMENT:{"text":"screen-free dinners","timeframe":"weekdays"}]]';

  it('captures an agreement from a SHARED reply; strips the marker from the saved text', async () => {
    const fs = memFileSystem();
    const session = await seedSession(fs);
    const out = await runTogetherTurn({
      fs,
      key,
      client: analyzeClient(AGREEMENT_REPLY).client,
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      session,
      authorPersonId: BEN,
      userText: 'Let’s do screen-free dinners.',
      onDelta: () => {},
      now: NOW,
    });
    expect(out.ok).toBe(true);
    const agreements = await listAgreements(fs, key, session.pairKey);
    expect(agreements).toHaveLength(1);
    expect(agreements[0]?.text).toBe('screen-free dinners');
    expect(agreements[0]?.status).toBe('standing');
    // The marker never persists in the transcript.
    const { listMessages } = await import('./togetherService');
    const msgs = await listMessages(fs, key, session.id);
    expect(JSON.stringify(msgs)).not.toContain('SELFOS:AGREEMENT');
  });

  it('does NOT capture an agreement from a private ASIDE reply (§3.6 — asides mint no shared artifacts)', async () => {
    const fs = memFileSystem();
    const session = await seedSession(fs);
    await runTogetherTurn({
      fs,
      key,
      client: analyzeClient(AGREEMENT_REPLY).client,
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      session,
      authorPersonId: BEN,
      userText: 'a private thought',
      privateAside: true,
      onDelta: () => {},
      now: NOW,
    });
    expect(await listAgreements(fs, key, session.pairKey)).toHaveLength(0);
  });
});

describe('grounding pack v2 (§3.9)', () => {
  it('includes standing agreements + the last wrap-up summary', async () => {
    const fs = memFileSystem();
    const session = await seedSession(fs);
    await appendMessage(fs, key, session.id, {
      id: 'm1',
      schemaVersion: 1,
      authorPersonId: BEN,
      role: 'user',
      content: 'hi',
      ts: '2026-07-10T12:01:00.000Z',
    });
    await captureAgreementFromMarker(
      fs,
      key,
      BEN,
      ANGEL,
      { text: 'screen-free dinners', timeframe: 'weekdays' },
      session.id,
      NOW,
    );
    await runTogetherWrapUp({
      fs,
      key,
      client: analyzeClient(WRAPUP_JSON).client,
      apiKey: 'sk-test',
      model: 'claude-sonnet-4-6',
      session,
      memoryEnabled: true,
      now: new Date('2026-07-10T12:10:00.000Z'),
    });
    const grounding = await buildGroundingPack(fs, key, session, (id) =>
      id === BEN ? 'Ben' : 'Angel',
    );
    expect(grounding).toContain('screen-free dinners');
    expect(grounding).toContain('weekdays');
    expect(grounding).toContain('showed up honestly'); // last wrap-up summary
  });
});
