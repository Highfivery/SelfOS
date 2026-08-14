import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { EmailClient } from '../host';
import { writeEncryptedJson } from '../vault';
import { saveGoal } from '../goals/goalService';
import { upsertPerson } from '../people/peopleService';
import { upsertRelationship } from '../people/relationshipService';
import { acknowledgeAdult } from '../conversations/guidanceService';
import { setYnmOptIn } from '../together/ynmService';
import { submitSectionForm } from '../intake/intakeService';
import type { IntakeAnswerValue } from '../schemas';
import { emptyLedger, writeLedger } from '../questionnaires/askLedger';
import { SATURATION_ASKS } from '../questionnaires/topicMap';
import { updateEmailConfig } from './emailConfig';
import { setEmailPrefs } from './emailPrefs';
import { listEmailActivity, sendFamilyEmail } from './emailSend';
import { mintEmailToken } from './emailResponse';
import { buildDigestEmail, buildReEngagementEmail, buildWelcomeEmail } from './emailComposer';
import {
  gatherDigestContent,
  gatherReEngagement,
  mapResendStatus,
  nextDigestAt,
  reconcileEmailSchedule,
  scheduleQuestionnaireReminder,
} from './emailSchedule';

const key = generateMasterKey();
const PERSON = 'me';

/** A scheduling-aware fake Resend client that records sends/cancels + serves configurable status polls. */
function schedulingFake() {
  const sent: { id: string; scheduledAt?: string; to: string; subject: string }[] = [];
  const canceled: string[] = [];
  const statuses = new Map<string, string>();
  let n = 0;
  const client: EmailClient = {
    send: (req) => {
      const id = `re-${++n}`;
      sent.push({
        id,
        ...(req.scheduledAt ? { scheduledAt: req.scheduledAt } : {}),
        to: req.to,
        subject: req.subject,
      });
      // Resend reports a not-yet-fired scheduled email as `scheduled`; an immediate send as `sent`.
      statuses.set(id, req.scheduledAt ? 'scheduled' : 'sent');
      return Promise.resolve({ ok: true as const, id });
    },
    cancel: (_apiKey, id) => {
      canceled.push(id);
      return Promise.resolve();
    },
    status: (_apiKey, ids) =>
      Promise.resolve(ids.map((id) => ({ id, status: statuses.get(id) ?? 'sent' }))),
    verify: () => Promise.resolve({ ok: true as const, domains: [] }),
  };
  return { client, sent, canceled, setStatus: (id: string, s: string) => statuses.set(id, s) };
}

async function configured(fs = memFileSystem(), now = new Date('2026-08-05T12:00:00.000Z')) {
  await updateEmailConfig(fs, key, { fromAddress: 'hi@fam.example', fromName: 'SelfOS' }, now);
  await setEmailPrefs(fs, key, PERSON, { address: 'me@inbox.example' }, false, now);
  return fs;
}

/** Two partners with the full intimacy-email consent chain: a partner edge, both 18+ acks, both YNM opt-ins,
 *  and one act both rate >= curious so a mutual overlap exists (67 §8.2). */
async function seedIntimacyPartners(
  fs: ReturnType<typeof memFileSystem>,
): Promise<{ a: string; b: string }> {
  const at = new Date('2026-08-01T00:00:00.000Z');
  const a = await upsertPerson(fs, key, { displayName: 'Ash', isSubject: true, tags: [] });
  const b = await upsertPerson(fs, key, { displayName: 'Bo', isSubject: true, tags: [] });
  await upsertRelationship(fs, key, { fromPersonId: a.id, toPersonId: b.id, type: 'partner' });
  await acknowledgeAdult(fs, key, a.id);
  await acknowledgeAdult(fs, key, b.id);
  await setYnmOptIn(fs, key, a.id, b.id, true, at);
  await setYnmOptIn(fs, key, b.id, a.id, true, at);
  for (const [id, rating] of [
    [a.id, 3],
    [b.id, 4],
  ] as const) {
    await submitSectionForm(
      fs,
      key,
      id,
      'intimacy',
      { activities: { 'sensual-massage': rating } as unknown as IntakeAnswerValue },
      at,
      undefined,
      false,
    );
  }
  return { a: a.id, b: b.id };
}

async function seedSynthesis(fs: ReturnType<typeof memFileSystem>, observation: string) {
  await writeEncryptedJson(
    fs,
    `people/${PERSON}/coaching/synthesis.enc`,
    {
      schemaVersion: 1,
      observation,
      subjectPersonId: PERSON,
      sources: [],
      computedAt: '2026-08-04T00:00:00.000Z',
    },
    key,
  );
}

const baseReconcile = (fs: ReturnType<typeof memFileSystem>, over = {}) => ({
  fs,
  key,
  email: schedulingFake().client,
  resendKey: 're-key' as string | undefined,
  personId: PERSON,
  prefs: null as Awaited<ReturnType<typeof setEmailPrefs>> | null,
  crisisSuppressed: false,
  now: new Date('2026-08-05T12:00:00.000Z'),
  ...over,
});

describe('mapResendStatus (67 §5.1)', () => {
  it('maps Resend statuses onto EmailDeliveryStatus; unknown → null', () => {
    expect(mapResendStatus('delivered')).toBe('delivered');
    expect(mapResendStatus('opened')).toBe('opened');
    expect(mapResendStatus('bounced')).toBe('bounced');
    expect(mapResendStatus('complained')).toBe('complained');
    expect(mapResendStatus('canceled')).toBe('canceled');
    expect(mapResendStatus('queued')).toBeNull();
  });
});

describe('nextDigestAt (67 §3.2a)', () => {
  it('computes the coming digest day at the configured local hour, strictly future', () => {
    const prefs = { digestDay: 0, digestTime: 'evening' } as never; // Sunday evening (19:00)
    const wed = new Date('2026-08-05T12:00:00.000Z'); // a Wednesday
    const at = new Date(nextDigestAt(prefs, wed));
    expect(at.getDay()).toBe(0); // Sunday
    expect(at.getHours()).toBe(19);
    expect(at.getTime()).toBeGreaterThan(wed.getTime());
  });

  it('rolls to next week when today’s slot has already passed', () => {
    const prefs = { digestDay: 3, digestTime: 'morning' } as never; // Wednesday morning (08:00)
    const wedAfternoon = new Date('2026-08-05T20:00:00.000Z'); // Wed, past 08:00 local
    const at = new Date(nextDigestAt(prefs, wedAfternoon));
    expect(at.getDay()).toBe(3);
    expect(at.getTime() - wedAfternoon.getTime()).toBeGreaterThan(5 * 24 * 60 * 60 * 1000);
  });
});

describe('gatherDigestContent (67 §3.2 family C)', () => {
  it('returns null on an empty vault (no empty digest)', async () => {
    const fs = memFileSystem();
    expect(await gatherDigestContent(fs, key, PERSON, new Date())).toBeNull();
  });

  it('includes the coaching insight-of-the-week when present', async () => {
    const fs = memFileSystem();
    await seedSynthesis(fs, 'You lean on routine when things get uncertain.');
    const content = await gatherDigestContent(
      fs,
      key,
      PERSON,
      new Date('2026-08-05T12:00:00.000Z'),
    );
    expect(content?.insightOfWeek).toContain('routine');
  });
});

describe('gatherReEngagement (67 §3.2 family D)', () => {
  it('returns null when nothing is waiting', async () => {
    const fs = memFileSystem();
    expect(await gatherReEngagement(fs, key, PERSON, new Date())).toBeNull();
  });

  it('surfaces a stale goal when there is one', async () => {
    const fs = memFileSystem();
    await saveGoal(fs, key, {
      id: 'g1',
      schemaVersion: 1,
      subjectPersonId: PERSON,
      text: 'Walk every morning',
      status: 'open',
      provenance: { at: '2026-06-01T00:00:00.000Z' },
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
      lastTouchedAt: '2026-06-01T00:00:00.000Z', // >21 days before `now` → stale
    });
    const content = await gatherReEngagement(fs, key, PERSON, new Date('2026-08-05T12:00:00.000Z'));
    expect(content?.headline).toMatch(/goal/i);
    expect(content?.detail).toContain('Walk every morning');
  });
});

describe('reconcileEmailSchedule (67 §3.4 / Phase 3)', () => {
  it('NOT_CONFIGURED without a key or from-line', async () => {
    const fs = memFileSystem();
    const res = await reconcileEmailSchedule(baseReconcile(fs, { resendKey: undefined }));
    expect(res).toEqual({ ok: false, reason: 'NOT_CONFIGURED' });
  });

  it('schedules the weekly digest (a scheduled entry with scheduledAt) when opted in + content exists', async () => {
    const fs = await configured();
    await seedSynthesis(fs, 'A steady week of showing up.');
    const prefs = await setEmailPrefs(fs, key, PERSON, {}, false, new Date());
    const fake = schedulingFake();
    const res = await reconcileEmailSchedule(baseReconcile(fs, { email: fake.client, prefs }));
    expect(res.ok).toBe(true);
    // A digest email was scheduled via Resend scheduledAt + logged as a 'scheduled' entry.
    expect(fake.sent.some((s) => s.scheduledAt && /week/i.test(s.subject))).toBe(true);
    const log = await listEmailActivity(fs, key, PERSON);
    const digest = log.find((e) => e.family === 'digest');
    expect(digest?.status).toBe('scheduled');
    expect(digest?.scheduledAt).toBeDefined();
  });

  it('keeps reconciling when the relay tap-drain fails (a stale relay 404s /api/admin/drainTaps)', async () => {
    const fs = await configured();
    await seedSynthesis(fs, 'A steady week of showing up.');
    const prefs = await setEmailPrefs(fs, key, PERSON, {}, false, new Date());
    // A pending token, so the drain is actually attempted (an empty token store short-circuits).
    await mintEmailToken(fs, key, PERSON, {
      token: 'T-pending',
      schemaVersion: 1,
      interactionId: 'ix-1',
      family: 're-engagement',
      kind: 'reaction',
      answer: 'im-here',
      mintedAt: new Date('2026-08-05T11:00:00.000Z').toISOString(),
    });
    const fake = schedulingFake();
    const relay = {
      drainTaps: () =>
        Promise.reject(new Error('Relay request failed (404) for /api/admin/drainTaps')),
    };
    const res = await reconcileEmailSchedule(
      baseReconcile(fs, { email: fake.client, prefs, relay }),
    );
    // The rest of the cadence still ran — the digest was scheduled despite the drain failure.
    expect(res.ok).toBe(true);
    expect(fake.sent.some((s) => s.scheduledAt && /week/i.test(s.subject))).toBe(true);
  });

  it('does NOT schedule the digest under crisis, and cancels an already-scheduled one', async () => {
    const fs = await configured();
    await seedSynthesis(fs, 'Content is present.');
    const prefs = await setEmailPrefs(fs, key, PERSON, {}, false, new Date());
    const fake = schedulingFake();
    // First run schedules the digest.
    await reconcileEmailSchedule(baseReconcile(fs, { email: fake.client, prefs }));
    const scheduledId = fake.sent[0]?.id;
    // A later run under crisis cancels it + schedules nothing new.
    const res = await reconcileEmailSchedule(
      baseReconcile(fs, { email: fake.client, prefs, crisisSuppressed: true }),
    );
    expect(res.ok).toBe(true);
    expect(fake.canceled).toContain(scheduledId);
    const digest = (await listEmailActivity(fs, key, PERSON)).find(
      (e) => e.family === 'digest' && e.status === 'scheduled',
    );
    expect(digest).toBeUndefined(); // none left scheduled
  });

  it('polls Resend status + records delivered/opened onto sent entries', async () => {
    const fs = await configured();
    const fake = schedulingFake();
    // Seed a real 'sent' welcome entry (resendMessageId re-1).
    const prefs = await setEmailPrefs(fs, key, PERSON, {}, false, new Date());
    await sendFamilyEmail({
      fs,
      key,
      email: fake.client,
      resendKey: 're-key',
      personId: PERSON,
      family: 'welcome',
      composed: buildWelcomeEmail({ recipientName: 'Me' }),
      crisisSuppressed: false,
      now: new Date(),
    });
    fake.setStatus('re-1', 'delivered');
    const res = await reconcileEmailSchedule(
      baseReconcile(fs, { email: fake.client, prefs, crisisSuppressed: true }),
    );
    expect(res.ok && res.polled).toBeGreaterThanOrEqual(1);
    const welcome = (await listEmailActivity(fs, key, PERSON)).find((e) => e.family === 'welcome');
    expect(welcome?.status).toBe('delivered');
    expect(welcome?.deliveredAt).toBeDefined();
  });

  it('cancels a questionnaire reminder whose assignment has been answered', async () => {
    const fs = await configured();
    const fake = schedulingFake();
    const now = new Date('2026-08-05T12:00:00.000Z');
    // Schedule a reminder for assignment a1 (logged under the sender = PERSON).
    await scheduleQuestionnaireReminder({
      fs,
      key,
      email: fake.client,
      resendKey: 're-key',
      senderPersonId: PERSON,
      toAddress: 'alex@example.com',
      originalSubject: 'Ben would like your input',
      assignmentId: 'a1',
      now,
    });
    const reminderId = fake.sent[0]?.id;
    expect(fake.sent[0]?.scheduledAt).toBeDefined();
    // Seed the assignment a1 as answered (submitted).
    await writeEncryptedJson(
      fs,
      'questionnaires/sends/a1/assignment.enc',
      {
        id: 'a1',
        schemaVersion: 1,
        questionnaireId: 'q1',
        senderPersonId: PERSON,
        recipient: { kind: 'external', displayName: 'Alex' },
        channel: 'relay',
        privacy: 'private',
        senderVisibleToRecipient: true,
        status: 'submitted',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      key,
    );
    const prefs = await setEmailPrefs(fs, key, PERSON, {}, false, now);
    const res = await reconcileEmailSchedule(
      baseReconcile(fs, { email: fake.client, prefs, crisisSuppressed: true, now }),
    );
    expect(res.ok).toBe(true);
    expect(fake.canceled).toContain(reminderId);
  });

  it('is idempotent on the reminder — a second schedule for the same assignment no-ops', async () => {
    const fs = await configured();
    const fake = schedulingFake();
    const args = {
      fs,
      key,
      email: fake.client,
      resendKey: 're-key' as const,
      senderPersonId: PERSON,
      toAddress: 'alex@example.com',
      originalSubject: 'Ben would like your input',
      assignmentId: 'a1',
      now: new Date(),
    };
    await scheduleQuestionnaireReminder(args);
    await scheduleQuestionnaireReminder(args);
    expect(fake.sent.filter((s) => s.scheduledAt).length).toBe(1);
  });

  it('honors the 14-day re-engagement min-gap — a recently-FIRED nudge blocks a new one', async () => {
    const fs = await configured();
    const fake = schedulingFake();
    const now = new Date('2026-08-20T12:00:00.000Z');
    const prefs = await setEmailPrefs(fs, key, PERSON, {}, false, now);
    // Seed a re-engagement whose scheduledAt is 3 days ago (it FIRED, within the 14-day gap).
    await sendFamilyEmail({
      fs,
      key,
      email: fake.client,
      resendKey: 're-key',
      personId: PERSON,
      family: 're-engagement',
      composed: buildReEngagementEmail({ headline: 'Come back' }),
      crisisSuppressed: false,
      scheduledAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      sourceKey: 'reengagement:pending',
      now,
    });
    // A stale goal so gatherReEngagement WOULD have content if the gap allowed it.
    await saveGoal(fs, key, {
      id: 'g1',
      schemaVersion: 1,
      subjectPersonId: PERSON,
      text: 'Walk every morning',
      status: 'open',
      provenance: { at: '2026-06-01T00:00:00.000Z' },
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
      lastTouchedAt: '2026-06-01T00:00:00.000Z',
    });
    await reconcileEmailSchedule(baseReconcile(fs, { email: fake.client, prefs, now }));
    // Still exactly ONE re-engagement entry — the fired one was neither canceled nor superseded by a new send.
    const reeng = await listEmailActivity(fs, key, PERSON, { family: 're-engagement' });
    expect(reeng).toHaveLength(1);
    expect(reeng[0]?.status).not.toBe('canceled');
  });

  it('never relabels a FIRED scheduled email — a delivered digest stays delivered, not canceled', async () => {
    const fs = await configured();
    await seedSynthesis(fs, 'A steady week.');
    const fake = schedulingFake();
    const now = new Date('2026-08-20T12:00:00.000Z');
    const prefs = await setEmailPrefs(fs, key, PERSON, {}, false, now);
    // Seed a digest scheduled for 2 days ago (already fired) with a resendMessageId (re-1).
    await sendFamilyEmail({
      fs,
      key,
      email: fake.client,
      resendKey: 're-key',
      personId: PERSON,
      family: 'digest',
      composed: buildDigestEmail({ insightOfWeek: 'Last week.' }),
      crisisSuppressed: false,
      scheduledAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      sourceKey: 'digest:old',
      now,
    });
    fake.setStatus('re-1', 'delivered'); // Resend reports it delivered
    await reconcileEmailSchedule(baseReconcile(fs, { email: fake.client, prefs, now }));
    const digests = await listEmailActivity(fs, key, PERSON, { family: 'digest' });
    // The fired one is delivered (from the poll), NOT relabeled canceled; a fresh one is scheduled for next week.
    expect(digests.some((d) => d.status === 'delivered')).toBe(true);
    expect(digests.some((d) => d.status === 'canceled')).toBe(false);
    expect(digests.some((d) => d.status === 'scheduled')).toBe(true);
    expect(fake.canceled).toHaveLength(0);
  });
});

describe('the intimacy suggestion draws on the person’s OWN open ground (71 §5.3)', () => {
  /**
   * The caller-side guard for the defect shipped on 2026-08-13 and fixed on 2026-08-14: `emailSchedule`
   * omitted `openGround` when nothing was open and `generateSuggestion` fell back to the seeded families, so
   * an explicit email nobody reviews first nudged toward the exact areas the person had exhausted. The type
   * now makes omission impossible; this pins that the caller passes their REAL map, which no unit of
   * `generateSuggestion` in isolation can prove.
   */
  it('passes the recipient’s open topics, and never the closed ones', async () => {
    const fs = await configured();
    const partners = await seedIntimacyPartners(fs);
    const at = new Date('2026-08-05T00:00:00.000Z');

    // Oral is worked through; Edge play has never been touched. Both are seeded families on their map.
    await writeLedger(fs, key, {
      ...emptyLedger(partners.a),
      backfilledAt: '2026-07-01T00:00:00.000Z',
      entries: Array.from({ length: SATURATION_ASKS }, (_, i) => ({
        questionId: `q${i}`,
        assignmentId: `a${i}`,
        at: '2026-08-01T00:00:00.000Z',
        type: 'intimacy',
        tier: 'unfiltered' as const,
        topicIds: ['Intimacy:oral'],
        gist: 'oral',
        outcome: 'rich' as const,
      })),
    });

    const systems: string[] = [];
    const capture = {
      send: () => Promise.resolve(''),
      stream: (o: { system?: string }, onDelta: (s: string) => void) => {
        systems.push(o.system ?? '');
        const text = '{"headline":"A small idea","body":"One sentence."}';
        onDelta(text);
        return Promise.resolve({
          text,
          usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
        });
      },
    };
    const prefs = await setEmailPrefs(
      fs,
      key,
      partners.a,
      {
        address: 'ash@example.com',
        // Intimacy families are OFF by default (fail-closed), and the non-intimacy suggestion is tried FIRST
        // and short-circuits the pair — so opt in to the one under test and out of its competitor.
        families: { 'ai-suggestion': false, 'ai-suggestion-intimacy': true },
        intimacyEmailOptIn: true, // the distinct intimacy-email consent (67 §8.2)
      },
      true,
      at,
    );

    await reconcileEmailSchedule(
      baseReconcile(fs, {
        personId: partners.a,
        prefs,
        now: at,
        ai: { client: capture, apiKey: 'sk-x', model: 'claude-sonnet-4-6' },
      }),
    );

    // The intimacy suggestion is the one carrying the explicit framing.
    const system = systems.find((s) => s.includes('Subject matter to draw on')) ?? '';
    expect(system).not.toBe('');
    // Scoped to the GROUND block: the tier directive above it names "oral" as an example of plain language,
    // so asserting over the whole system prompt would always match.
    const ground = system
      .slice(system.indexOf('Subject matter to draw on'))
      .split('\nBoundary:')[0] as string;
    // Their own OPEN ground reaches the prompt…
    expect(ground).toContain('Edge play');
    // …and the worked-through family does not. Falling back to the seeded list would list every family here,
    // which is precisely how an intimacy email came to nudge toward exhausted ground.
    expect(ground).not.toMatch(/\boral\b/i);
  });
});
