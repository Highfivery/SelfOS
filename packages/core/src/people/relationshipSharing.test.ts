import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { saveInsight } from '../insights';
import { confidentialityPreamble } from '../sharing';
import type { Insight, IntakeSession, Person, Relationship } from '../schemas';
import { writeEncryptedJson } from '../vault';
import { buildContext, buildLinkedPeopleContext } from './buildContext';
import { listOutboundSharing } from './outboundSharing';
import { savePerson } from './peopleService';
import { saveRelationship } from './relationshipService';
import { buildSharedIntakeAnswerLines } from './sharedIntakeAnswers';

const key = generateMasterKey();

function person(id: string, displayName: string): Person {
  return {
    id,
    schemaVersion: 2,
    displayName,
    isSubject: true,
    tags: [],
    createdAt: 'now',
    updatedAt: 'now',
  };
}

let relSeq = 0;
function rel(from: string, to: string, type: Relationship['type']): Relationship {
  relSeq += 1;
  return {
    id: `rel${relSeq}`,
    schemaVersion: 2,
    fromPersonId: from,
    toPersonId: to,
    type,
    createdAt: 'now',
    updatedAt: 'now',
  };
}

function insight(over: Partial<Insight> & { id: string; subjectPersonId: string }): Insight {
  return {
    schemaVersion: 1,
    source: 'questionnaire',
    summary: `summary-${over.id}`,
    facts: [],
    confidence: 'medium',
    categories: [],
    approved: true,
    provenance: { at: 'now' },
    createdAt: 'now',
    updatedAt: 'now',
    ...over,
  };
}

function intakeSession(personId: string, over: Partial<IntakeSession> = {}): IntakeSession {
  return {
    id: `intake-${personId}`,
    schemaVersion: 1,
    personId,
    status: 'inProgress',
    sections: [],
    startedAt: 'now',
    updatedAt: 'now',
    ...over,
  };
}

/** Seed: A (data owner) is B's partner and C's sibling. */
async function seedTriad() {
  const fs = memFileSystem();
  await savePerson(fs, key, person('A', 'Alex'));
  await savePerson(fs, key, person('B', 'Bri'));
  await savePerson(fs, key, person('C', 'Cory'));
  await saveRelationship(fs, key, { ...rel('A', 'B', 'partner'), id: 'ab' });
  await saveRelationship(fs, key, { ...rel('A', 'C', 'sibling'), id: 'ac' });
  return fs;
}

describe('relationship-type-scoped context (42 §5.2) — the headline privacy guard', () => {
  it('a partner-scoped fact reaches the PARTNER but not the SIBLING', async () => {
    const fs = await seedTriad();
    await saveInsight(
      fs,
      key,
      insight({
        id: 'i1',
        subjectPersonId: 'A',
        facts: [
          {
            id: 'f1',
            text: 'A is working on intimacy',
            shareable: false,
            shareableTypes: ['partner'],
          },
        ],
      }),
    );

    const partnerCtx = await buildContext(fs, key, 'B');
    expect(partnerCtx).toContain('A is working on intimacy');
    // "Shared ≠ shown" — the confidentiality preamble leads the cross-shared block.
    expect(partnerCtx).toContain(confidentialityPreamble('Bri'));

    const siblingCtx = await buildContext(fs, key, 'C');
    expect(siblingCtx).not.toContain('A is working on intimacy');
    // No cross-shared content → no confidentiality preamble.
    expect(siblingCtx).not.toContain('Treat them as private background');
  });

  it('a RESTRICTED fact reaches NO related person even when type-scoped', async () => {
    const fs = await seedTriad();
    await saveInsight(
      fs,
      key,
      insight({
        id: 'i2',
        subjectPersonId: 'A',
        facts: [
          {
            id: 'f1',
            text: 'a restricted trauma fact',
            shareable: false,
            restricted: true,
            shareableTypes: ['partner'],
          },
        ],
      }),
    );
    expect(await buildContext(fs, key, 'B')).not.toContain('a restricted trauma fact');
  });

  it('removing the partner edge immediately drops the partner-scoped fact (read-time re-gate)', async () => {
    const fs = await seedTriad();
    await saveInsight(
      fs,
      key,
      insight({
        id: 'i3',
        subjectPersonId: 'A',
        facts: [
          { id: 'f1', text: 'a partner thing', shareable: false, shareableTypes: ['partner'] },
        ],
      }),
    );
    expect(await buildContext(fs, key, 'B')).toContain('a partner thing');
    await fs.remove('relationships/ab.enc'); // remove A↔B partner edge
    expect(await buildContext(fs, key, 'B')).not.toContain('a partner thing');
  });

  it('shared intake answers flow into a related person’s context per answerSharing', async () => {
    const fs = await seedTriad();
    await writeEncryptedJson(
      fs,
      'people/A/intake/session.enc',
      intakeSession('A', {
        sections: [
          {
            id: 'health',
            status: 'complete',
            restricted: false,
            messages: [],
            answers: { sleepSchedule: 'Early to bed, early to rise' },
            answerSharing: { sleepSchedule: ['partner'] },
          },
        ],
      }),
      key,
    );
    const partnerCtx = await buildContext(fs, key, 'B');
    expect(partnerCtx).toContain('Early to bed, early to rise');
    // The sibling never sees it (scoped to partner only).
    expect(await buildContext(fs, key, 'C')).not.toContain('Early to bed, early to rise');
  });
});

describe('buildLinkedPeopleContext — the dreams surface honors the same gate (42 §5.2 / audit #1)', () => {
  it('a partner-scoped fact reaches the partner-dreamer, under the confidentiality preamble', async () => {
    const fs = await seedTriad();
    await saveInsight(
      fs,
      key,
      insight({
        id: 'i1',
        subjectPersonId: 'A',
        facts: [
          { id: 'f1', text: 'A craves closeness', shareable: false, shareableTypes: ['partner'] },
        ],
      }),
    );
    // B (A's partner) dreams about A → A's partner-scoped fact informs B's dream coach...
    const partnerDream = await buildLinkedPeopleContext(fs, key, 'B', ['A']);
    expect(partnerDream).toContain('A craves closeness');
    expect(partnerDream).toContain(confidentialityPreamble('Bri')); // "shared ≠ shown" on dreams too
    // ...but C (A's sibling) dreaming about A does NOT see the partner-scoped fact, and gets no preamble.
    const siblingDream = await buildLinkedPeopleContext(fs, key, 'C', ['A']);
    expect(siblingDream).not.toContain('A craves closeness');
    expect(siblingDream).not.toContain('Treat them as private background');
  });

  it('excludes a flagged-inaccurate fact even when broadcast-shareable (the pre-existing leak, now closed)', async () => {
    const fs = await seedTriad();
    await saveInsight(
      fs,
      key,
      insight({
        id: 'i2',
        subjectPersonId: 'A',
        facts: [
          {
            id: 'f1',
            text: 'a corrected claim',
            shareable: true,
            flaggedInaccurate: true,
            flaggedAt: 'now',
          },
        ],
      }),
    );
    expect(await buildLinkedPeopleContext(fs, key, 'B', ['A'])).not.toContain('a corrected claim');
  });

  it('a restricted fact is never surfaced to a dreamer (18 §8.4)', async () => {
    const fs = await seedTriad();
    await saveInsight(
      fs,
      key,
      insight({
        id: 'i3',
        subjectPersonId: 'A',
        facts: [
          {
            id: 'f1',
            text: 'a restricted thing',
            shareable: false,
            restricted: true,
            shareableTypes: ['partner'],
          },
        ],
      }),
    );
    expect(await buildLinkedPeopleContext(fs, key, 'B', ['A'])).not.toContain('a restricted thing');
  });
});

describe('corrupt scope fails closed (42 §7 / audit #3)', () => {
  it('a corrupt shareableTypes degrades a fact to own-only and never crashes a related viewer’s context', async () => {
    const fs = await seedTriad();
    // Write a raw insight whose fact carries an INVALID relationship type — bypassing the schema on write.
    const corrupt: unknown = {
      schemaVersion: 1,
      id: 'ic',
      source: 'questionnaire',
      subjectPersonId: 'A',
      summary: 's',
      facts: [
        {
          id: 'f1',
          text: 'a corrupt-scope fact',
          shareable: false,
          shareableTypes: ['not-a-type'],
        },
      ],
      confidence: 'medium',
      categories: [],
      approved: true,
      provenance: { at: 'now' },
      createdAt: 'now',
      updatedAt: 'now',
    };
    await writeEncryptedJson(fs, 'people/A/insights/ic.enc', corrupt, key);

    // The related viewer's whole context still builds (no throw) and the corrupt fact is NOT shared.
    const partnerCtx = await buildContext(fs, key, 'B');
    expect(partnerCtx).not.toContain('a corrupt-scope fact');
    // The owner still sees it in their OWN context (degraded to own-only, not lost).
    expect(await buildContext(fs, key, 'A')).toContain('a corrupt-scope fact');
  });
});

describe('buildSharedIntakeAnswerLines (42 §5.2)', () => {
  it('returns nothing when no granting types', async () => {
    const fs = await seedTriad();
    expect(await buildSharedIntakeAnswerLines(fs, key, 'A', [])).toEqual([]);
  });

  it('a corrupt intake fails closed (empty), never broadcast', async () => {
    const fs = memFileSystem();
    await writeEncryptedJson(fs, 'people/A/intake/session.enc', { not: 'a session' }, key);
    expect(await buildSharedIntakeAnswerLines(fs, key, 'A', ['partner'])).toEqual([]);
  });
});

describe('listOutboundSharing (42 §5.3) — the transparency read', () => {
  it('reports each shared item with its scope + the concrete people receiving it', async () => {
    const fs = await seedTriad();
    const relationships = [rel('A', 'B', 'partner'), rel('A', 'C', 'sibling')];
    // Re-seed the same relationships used to read (resolved from the live graph by the caller).
    await saveInsight(
      fs,
      key,
      insight({
        id: 'i1',
        subjectPersonId: 'A',
        facts: [
          { id: 'fp', text: 'partner-scoped', shareable: false, shareableTypes: ['partner'] },
          { id: 'fb', text: 'broadcast', shareable: true },
          {
            id: 'fr',
            text: 'restricted',
            shareable: false,
            restricted: true,
            shareableTypes: ['partner'],
          },
          { id: 'fpriv', text: 'private', shareable: false },
        ],
      }),
    );

    const out = await listOutboundSharing(fs, key, 'A', relationships);
    const byId = new Map(out.items.map((i) => [i.id, i]));

    // Partner-scoped → only Bri receives it.
    expect(byId.get('fp')?.recipients.map((r) => r.id)).toEqual(['B']);
    // Broadcast → both related people receive it.
    expect(
      byId
        .get('fb')
        ?.recipients.map((r) => r.id)
        .sort(),
    ).toEqual(['B', 'C']);
    // Restricted + private items are not outbound at all.
    expect(byId.has('fr')).toBe(false);
    expect(byId.has('fpriv')).toBe(false);
  });

  it('includes shared intake answers with their concrete recipients', async () => {
    const fs = await seedTriad();
    const relationships = [rel('A', 'B', 'partner'), rel('A', 'C', 'sibling')];
    await writeEncryptedJson(
      fs,
      'people/A/intake/session.enc',
      intakeSession('A', {
        sections: [
          {
            id: 'health',
            status: 'complete',
            restricted: false,
            messages: [],
            answers: { sleepSchedule: 'Night owl' },
            answerSharing: { sleepSchedule: ['partner'] },
          },
        ],
      }),
      key,
    );
    const out = await listOutboundSharing(fs, key, 'A', relationships);
    const answer = out.items.find((i) => i.kind === 'intakeAnswer');
    expect(answer?.text).toContain('Night owl');
    expect(answer?.recipients.map((r) => r.id)).toEqual(['B']);
  });
});
