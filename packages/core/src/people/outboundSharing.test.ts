import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { getInsight, saveInsight } from '../insights';
import { saveDream } from '../dreams/dreamService';
import type {
  Dream,
  Insight,
  IntakeSession,
  Person,
  Relationship,
  RelationshipType,
} from '../schemas';
import { writeEncryptedJson } from '../vault';
import { getIntakeSession } from '../intake/intakeService';
import { applyScopeBatch, listOutboundSharing, sharingItemCategory } from './outboundSharing';
import { savePerson } from './peopleService';
import { saveRelationship } from './relationshipService';

const key = generateMasterKey();

function person(id: string, displayName: string, over: Partial<Person> = {}): Person {
  return {
    id,
    schemaVersion: 2,
    displayName,
    isSubject: true,
    tags: [],
    createdAt: 'now',
    updatedAt: 'now',
    ...over,
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

function dream(id: string, over: Partial<Dream> = {}): Dream {
  return {
    id,
    schemaVersion: 1,
    personId: 'A',
    narrative: 'a dream',
    lucid: false,
    nightmare: false,
    tags: [],
    people: [],
    sensitivity: 'standard',
    status: 'captured',
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: 'now',
    ...over,
  };
}

const relationships = [rel('A', 'B', 'partner'), rel('A', 'C', 'sibling')];

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

describe('listOutboundSharing — 68 extensions', () => {
  it('fills lifeArea on a fact + keeps restricted out of items while counting keptPrivateCount', async () => {
    const fs = await seedTriad();
    await saveInsight(
      fs,
      key,
      insight({
        id: 'i1',
        subjectPersonId: 'A',
        facts: [
          {
            id: 'fp',
            text: 'values honesty',
            shareable: false,
            shareableTypes: ['partner'],
            lifeArea: 'Values & beliefs',
          },
          { id: 'fr', text: 'a trauma thing', shareable: false, restricted: true },
          { id: 'fr2', text: 'another private wound', shareable: false, restricted: true },
        ],
      }),
    );
    const out = await listOutboundSharing(fs, key, 'A', relationships);
    const fact = out.items.find((i) => i.id === 'fp');
    expect(fact?.lifeArea).toBe('Values & beliefs');
    expect(out.items.some((i) => i.id === 'fr' || i.id === 'fr2')).toBe(false);
    expect(out.keptPrivateCount).toBe(2);
  });

  it('skips intake-sourced insight facts from items but STILL counts their restricted facts (68 §3.9/§4.2)', async () => {
    const fs = await seedTriad();
    await saveInsight(
      fs,
      key,
      insight({
        id: 'portrait',
        subjectPersonId: 'A',
        source: 'intake',
        facts: [
          { id: 'ft', text: 'from onboarding', shareable: true },
          { id: 'ftr', text: 'a trauma answer', shareable: false, restricted: true },
        ],
      }),
    );
    const out = await listOutboundSharing(fs, key, 'A', relationships);
    // The shareable intake fact is NOT an item (answer-owned; the intakeAnswer row is the control).
    expect(out.items.some((i) => i.id === 'ft')).toBe(false);
    // But the intake-sourced restricted fact IS counted (onboarding is where restricted facts originate).
    expect(out.keptPrivateCount).toBe(1);
  });

  it('emits a profileField item for each populated, non-locked field reaching ALL related people', async () => {
    const fs = memFileSystem();
    await savePerson(
      fs,
      key,
      person('A', 'Alex', {
        occupation: 'Nurse',
        healthNotes: 'runs daily',
        faith: 'agnostic',
        privateFields: ['healthNotes'], // locked → must NOT surface
      }),
    );
    await savePerson(fs, key, person('B', 'Bri'));
    await savePerson(fs, key, person('C', 'Cory'));
    await saveRelationship(fs, key, { ...rel('A', 'B', 'partner'), id: 'ab' });
    await saveRelationship(fs, key, { ...rel('A', 'C', 'sibling'), id: 'ac' });

    const out = await listOutboundSharing(fs, key, 'A', relationships);
    const occ = out.items.find((i) => i.id === 'field:occupation');
    expect(occ?.kind).toBe('profileField');
    expect(occ?.text).toBe('Occupation: Nurse');
    expect(occ?.lifeArea).toBe('Work & purpose');
    // Reaches ALL related people (broadcast-to-related, 15-shareability §2).
    expect(occ?.recipients.map((r) => r.id).sort()).toEqual(['B', 'C']);
    // Locked field is absent; unmapped-life-area field still present.
    expect(out.items.some((i) => i.id === 'field:healthNotes')).toBe(false);
    expect(out.items.some((i) => i.id === 'field:faith')).toBe(true);
  });

  it('emits a dreamImage item for a shared standard-tier image; a sensitive one never shares', async () => {
    const fs = await seedTriad();
    await saveDream(
      fs,
      key,
      dream('d1', {
        title: 'Flying',
        image: {
          style: 's',
          mime: 'image/png',
          generatedAt: 'g',
          model: 'm',
          shareableWith: ['B'],
        },
      }),
    );
    await saveDream(
      fs,
      key,
      dream('d2', {
        title: 'Nightmare',
        sensitivity: 'explicit',
        image: {
          style: 's',
          mime: 'image/png',
          generatedAt: 'g',
          model: 'm',
          shareableWith: ['B'],
        },
      }),
    );
    const out = await listOutboundSharing(fs, key, 'A', relationships);
    const img = out.items.find((i) => i.id === 'dreamImage:d1');
    expect(img?.kind).toBe('dreamImage');
    expect(img?.text).toBe('Dream image · Flying');
    expect(img?.recipients.map((r) => r.id)).toEqual(['B']);
    expect(out.items.some((i) => i.id === 'dreamImage:d2')).toBe(false); // sensitive → never outbound
  });
});

describe('sharingItemCategory (68 §3.5) — display bucket resolution', () => {
  const base = {
    text: 't',
    broadcast: false,
    types: [] as RelationshipType[],
    personIds: [] as string[],
    recipients: [] as { id: string; displayName: string }[],
  };
  it('resolves a bucket for every kind', () => {
    expect(sharingItemCategory({ id: '1', kind: 'fact', ...base, lifeArea: 'Health & body' })).toBe(
      'Health & body',
    );
    expect(sharingItemCategory({ id: '2', kind: 'fact', ...base })).toBe('Other');
    expect(sharingItemCategory({ id: '3', kind: 'intakeAnswer', ...base, category: 'work' })).toBe(
      'Work & purpose',
    );
    expect(sharingItemCategory({ id: '4', kind: 'profileField', ...base, lifeArea: 'Faith' })).toBe(
      'Faith',
    );
    expect(sharingItemCategory({ id: '5', kind: 'dreamImage', ...base })).toBe('Dreams');
  });
});

describe('applyScopeBatch (68 §6)', () => {
  async function seedFacts(fs: ReturnType<typeof memFileSystem>) {
    await saveInsight(
      fs,
      key,
      insight({
        id: 'i1',
        subjectPersonId: 'A',
        facts: [
          { id: 'f1', text: 'one', shareable: false, shareableTypes: ['friend'] },
          {
            id: 'f2',
            text: 'two (sibling, keep me)',
            shareable: false,
            shareableTypes: ['sibling'],
          },
          {
            id: 'f3',
            text: 'restricted keep',
            shareable: false,
            restricted: true,
            shareableTypes: ['partner'],
          },
        ],
      }),
    );
  }

  it('REPLACES the scope of the targeted facts, preserving siblings + restricted flags', async () => {
    const fs = memFileSystem();
    await seedFacts(fs);
    const res = await applyScopeBatch({
      fs,
      key,
      personId: 'A',
      types: ['partner'],
      factTargets: [{ insightId: 'i1', factId: 'f1' }],
      answerTargets: [],
      includeAnswers: true,
      now: new Date('2026-02-01T00:00:00.000Z'),
    });
    expect(res.updated).toBe(1);
    const after = await getInsight(fs, key, 'A', 'i1');
    expect(after?.facts.find((f) => f.id === 'f1')?.shareableTypes).toEqual(['partner']);
    // Sibling fact untouched; restricted flag preserved.
    expect(after?.facts.find((f) => f.id === 'f2')?.shareableTypes).toEqual(['sibling']);
    expect(after?.facts.find((f) => f.id === 'f3')?.restricted).toBe(true);
    expect(after?.facts.find((f) => f.id === 'f3')?.shareableTypes).toEqual(['partner']);
  });

  it('empty types ⇒ Private (drops shareableTypes)', async () => {
    const fs = memFileSystem();
    await seedFacts(fs);
    await applyScopeBatch({
      fs,
      key,
      personId: 'A',
      types: [],
      factTargets: [{ insightId: 'i1', factId: 'f1' }],
      answerTargets: [],
      includeAnswers: true,
      now: new Date(),
    });
    const after = await getInsight(fs, key, 'A', 'i1');
    expect(after?.facts.find((f) => f.id === 'f1')?.shareableTypes).toBeUndefined();
  });

  it('applies to intake answers, and SKIPS them when the caller lacks intake.own', async () => {
    const fs = memFileSystem();
    await writeEncryptedJson(
      fs,
      'people/A/intake/session.enc',
      {
        id: 'intake-A',
        schemaVersion: 1,
        personId: 'A',
        status: 'inProgress',
        sections: [
          {
            id: 'health',
            status: 'complete',
            restricted: false,
            messages: [],
            answers: { sleepSchedule: 'Night owl' },
            answerSharing: { sleepSchedule: ['sibling'] },
          },
        ],
        startedAt: 'now',
        updatedAt: 'now',
      } satisfies IntakeSession,
      key,
    );
    const target = { sectionId: 'health', questionId: 'sleepSchedule' };

    // includeAnswers false → answer target skipped.
    const skipped = await applyScopeBatch({
      fs,
      key,
      personId: 'A',
      types: ['partner'],
      factTargets: [],
      answerTargets: [target],
      includeAnswers: false,
      now: new Date(),
    });
    expect(skipped.updated).toBe(0);
    expect(
      (await getIntakeSession(fs, key, 'A'))?.sections[0]?.answerSharing?.sleepSchedule,
    ).toEqual(['sibling']);

    // includeAnswers true → replaced.
    const applied = await applyScopeBatch({
      fs,
      key,
      personId: 'A',
      types: ['partner'],
      factTargets: [],
      answerTargets: [target],
      includeAnswers: true,
      now: new Date(),
    });
    expect(applied.updated).toBe(1);
    expect(
      (await getIntakeSession(fs, key, 'A'))?.sections[0]?.answerSharing?.sleepSchedule,
    ).toEqual(['partner']);
  });
});
