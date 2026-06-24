import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import {
  isPersonFieldShared,
  type Dream,
  type Insight,
  type Person,
  type PersonFieldKey,
  type Relationship,
} from '../schemas';
import { saveInsight } from '../insights';
import { saveDream } from '../dreams/dreamService';
import { savePerson } from './peopleService';
import { saveRelationship } from './relationshipService';
import {
  ageFromBirthday,
  buildContext,
  buildDepictionNote,
  buildLinkedPeopleContext,
} from './buildContext';

const key = generateMasterKey();

function person(id: string, displayName: string, extra: Partial<Person> = {}): Person {
  return {
    id,
    schemaVersion: 2,
    displayName,
    isSubject: true,
    tags: [],
    createdAt: 'now',
    updatedAt: 'now',
    ...extra,
  };
}

function relationship(extra: Partial<Relationship> = {}): Relationship {
  return {
    id: 'r1',
    schemaVersion: 2,
    fromPersonId: 'a',
    toPersonId: 'b',
    type: 'partner',
    createdAt: 'now',
    updatedAt: 'now',
    ...extra,
  };
}

function insight(id: string, subjectPersonId: string, over: Partial<Insight> = {}): Insight {
  return {
    id,
    schemaVersion: 1,
    source: 'questionnaire',
    subjectPersonId,
    summary: `summary-${id}`,
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

function dream(id: string, personId: string, extra: Partial<Dream> = {}): Dream {
  return {
    id,
    schemaVersion: 1,
    personId,
    narrative: 'a dream',
    lucid: false,
    nightmare: false,
    tags: [],
    people: [],
    sensitivity: 'standard',
    status: 'analyzed',
    createdAt: 'now',
    updatedAt: 'now',
    ...extra,
  };
}

describe('isPersonFieldShared', () => {
  it('is shared unless the key is in privateFields (absent ⇒ shared)', () => {
    expect(isPersonFieldShared({}, 'notes')).toBe(true);
    expect(isPersonFieldShared({ privateFields: [] }, 'notes')).toBe(true);
    expect(isPersonFieldShared({ privateFields: ['notes'] }, 'notes')).toBe(false);
    expect(isPersonFieldShared({ privateFields: ['notes'] }, 'occupation')).toBe(true);
    expect(isPersonFieldShared({ privateFields: ['healthNotes', 'faith'] }, 'faith')).toBe(false);
  });
});

describe('buildContext', () => {
  it('includes the subject’s own full profile — every populated field, even locked ones', async () => {
    const fs = memFileSystem();
    await savePerson(
      fs,
      key,
      person('a', 'Alex', {
        notes: 'likes hiking',
        occupation: 'nurse',
        healthNotes: 'OWN-HEALTH',
        faith: 'OWN-FAITH',
        // Locking a field hides it from OTHERS, never from the person's own coaching context.
        privateFields: ['healthNotes', 'faith', 'notes'],
      }),
    );

    const ctx = await buildContext(fs, key, 'a');
    expect(ctx).toContain('Alex');
    expect(ctx).toContain('Notes: likes hiking'); // own — locked or not
    expect(ctx).toContain('Occupation: nurse');
    expect(ctx).toContain('OWN-HEALTH');
    expect(ctx).toContain('OWN-FAITH');
  });

  it('includes a related person’s SHARED fields but never a LOCKED one (privacy boundary)', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person('a', 'Alex'));
    // Sam has every category populated; some shared, some locked.
    await savePerson(
      fs,
      key,
      person('b', 'Sam', {
        notes: 'SAM-NOTES',
        occupation: 'SAM-OCCUPATION',
        healthNotes: 'SAM-HEALTH',
        faith: 'SAM-FAITH',
        appearanceDescription: 'SAM-APPEARANCE',
        privateFields: ['notes', 'healthNotes', 'faith'],
      }),
    );
    await saveRelationship(fs, key, relationship({ notes: 'married five years' }));

    const ctx = await buildContext(fs, key, 'a');
    expect(ctx).toContain('Sam');
    expect(ctx).toContain('(married five years)'); // relationship notes shared by default
    expect(ctx).toContain('SAM-OCCUPATION'); // shared field reaches a related person
    expect(ctx).toContain('SAM-APPEARANCE');
    expect(ctx).not.toContain('SAM-NOTES'); // locked
    expect(ctx).not.toContain('SAM-HEALTH'); // locked (health is now controllable, default shared)
    expect(ctx).not.toContain('SAM-FAITH'); // locked
  });

  it('keeps a related person’s notes out when their relationship note is unshared', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person('a', 'Alex'));
    await savePerson(fs, key, person('b', 'Sam'));
    await saveRelationship(fs, key, relationship({ notes: 'REL-SECRET', notesShared: false }));

    const ctx = await buildContext(fs, key, 'a');
    expect(ctx).toContain('Sam');
    expect(ctx).not.toContain('REL-SECRET'); // notesShared: false → withheld from the other's context
  });

  it("appends own approved insights and related people's shareable facts (not their private)", async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person('a', 'Alex'));
    await savePerson(fs, key, person('b', 'Sam'));
    await saveRelationship(fs, key, relationship());

    await saveInsight(fs, key, insight('i1', 'a', { summary: 'Alex values clear communication' }));
    await saveInsight(
      fs,
      key,
      insight('i2', 'b', {
        facts: [
          { id: 'f1', text: 'Sam just got promoted', shareable: true },
          { id: 'f2', text: 'SAM-PRIVATE', shareable: false },
        ],
      }),
    );

    const ctx = await buildContext(fs, key, 'a');
    expect(ctx).toContain('Alex values clear communication');
    expect(ctx).toContain('Sam just got promoted');
    expect(ctx).not.toContain('SAM-PRIVATE');
  });

  it('excludes a dream-sourced insight from own context when the dream’s informsContext is off', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person('a', 'Alex'));
    // The dream is muted from context (a private journal entry).
    await saveDream(fs, key, dream('d1', 'a', { informsContext: false }));
    await saveInsight(
      fs,
      key,
      insight('i1', 'a', {
        source: 'dream',
        summary: 'DREAM-INSIGHT-SUMMARY',
        facts: [{ id: 'f1', text: 'DREAM-FACT', shareable: false }],
        provenance: { at: 'now', dreamId: 'd1' },
      }),
    );

    const ctx = await buildContext(fs, key, 'a');
    expect(ctx).not.toContain('DREAM-INSIGHT-SUMMARY'); // suppressed — informsContext off
    expect(ctx).not.toContain('DREAM-FACT');
  });

  it('includes a dream-sourced insight when informsContext is on (default)', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person('a', 'Alex'));
    await saveDream(fs, key, dream('d1', 'a', { informsContext: true }));
    await saveInsight(
      fs,
      key,
      insight('i1', 'a', {
        source: 'dream',
        summary: 'DREAM-INSIGHT-SUMMARY',
        provenance: { at: 'now', dreamId: 'd1' },
      }),
    );
    const ctx = await buildContext(fs, key, 'a');
    expect(ctx).toContain('DREAM-INSIGHT-SUMMARY');
  });

  it('surfaces the subject’s OWN open commitments as a bounded grounding line (39 §5.2)', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person('a', 'Alex'));
    const { saveGoal } = await import('../goals/goalService');
    const base = {
      schemaVersion: 1 as const,
      subjectPersonId: 'a',
      provenance: { at: '2026-06-20T00:00:00.000Z' },
      createdAt: '2026-06-20T00:00:00.000Z',
      updatedAt: '2026-06-20T00:00:00.000Z',
    };
    await saveGoal(fs, key, { ...base, id: 'g1', text: 'finish the thesis', status: 'open' });
    await saveGoal(fs, key, { ...base, id: 'g2', text: 'a closed one', status: 'done' });

    const ctx = await buildContext(fs, key, 'a');
    expect(ctx).toContain('Open commitments');
    expect(ctx).toContain('finish the thesis');
    expect(ctx).not.toContain('a closed one'); // closed goals aren't grounding
  });

  it('does NOT double-ground goals: a "Goal:" insight fact is dropped from own-context (the commitments line carries it) (39 §4.4)', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person('a', 'Alex'));
    await saveInsight(
      fs,
      key,
      insight('i1', 'a', {
        source: 'session',
        summary: 'A good session',
        facts: [
          { id: 'f1', text: 'Theme: feeling stretched', shareable: false },
          { id: 'f2', text: 'Goal: finish the thesis', shareable: false },
        ],
      }),
    );
    const { saveGoal } = await import('../goals/goalService');
    await saveGoal(fs, key, {
      schemaVersion: 1,
      subjectPersonId: 'a',
      id: 'g1',
      text: 'finish the thesis',
      status: 'open',
      provenance: { at: '2026-06-20T00:00:00.000Z' },
      createdAt: '2026-06-20T00:00:00.000Z',
      updatedAt: '2026-06-20T00:00:00.000Z',
    });

    const ctx = await buildContext(fs, key, 'a');
    // The goal appears exactly once — in the structured commitments line, NOT as a bare "Goal:" own-fact.
    expect(ctx).toContain('Open commitments');
    expect(ctx).toContain('finish the thesis');
    expect(ctx).not.toContain('Goal: finish the thesis'); // the duplicate own-fact form is gone
    expect(ctx).toContain('Theme: feeling stretched'); // non-goal facts still feed context
  });

  it('returns empty for an unknown person', async () => {
    expect(await buildContext(memFileSystem(), key, 'nope')).toBe('');
  });
});

// One privacy-boundary assertion per controllable category that narrates into context: a LOCKED value on a
// related person must never appear in any related-person path (15-shareability §10).
describe('buildContext — locked-field privacy boundary, per key', () => {
  const cases: { key: PersonFieldKey; field: Partial<Person>; marker: string }[] = [
    { key: 'occupation', field: { occupation: 'LOCKED-OCCUPATION' }, marker: 'LOCKED-OCCUPATION' },
    { key: 'location', field: { location: 'LOCKED-LOCATION' }, marker: 'LOCKED-LOCATION' },
    { key: 'goals', field: { goals: 'LOCKED-GOALS' }, marker: 'LOCKED-GOALS' },
    { key: 'notes', field: { notes: 'LOCKED-NOTES' }, marker: 'LOCKED-NOTES' },
    { key: 'healthNotes', field: { healthNotes: 'LOCKED-HEALTH' }, marker: 'LOCKED-HEALTH' },
    { key: 'faith', field: { faith: 'LOCKED-FAITH' }, marker: 'LOCKED-FAITH' },
    { key: 'interests', field: { interests: ['LOCKED-INTEREST'] }, marker: 'LOCKED-INTEREST' },
    // Promoted intake life-facts (18 §14.6) honor the same per-field lock.
    {
      key: 'relationshipStatus',
      field: { relationshipStatus: 'LOCKED-RELSTATUS' },
      marker: 'LOCKED-RELSTATUS',
    },
    {
      key: 'sexualOrientation',
      field: { sexualOrientation: 'LOCKED-ORIENTATION' },
      marker: 'LOCKED-ORIENTATION',
    },
    {
      key: 'relationshipStyle',
      field: { relationshipStyle: 'LOCKED-RELSTYLE' },
      marker: 'LOCKED-RELSTYLE',
    },
  ];
  for (const { key: fieldKey, field, marker } of cases) {
    it(`withholds a locked ${fieldKey} from a related person's block`, async () => {
      const fs = memFileSystem();
      await savePerson(fs, key, person('a', 'Alex'));
      await savePerson(fs, key, person('b', 'Sam', { ...field, privateFields: [fieldKey] }));
      await saveRelationship(fs, key, relationship());
      const ctx = await buildContext(fs, key, 'a');
      expect(ctx).toContain('Sam');
      expect(ctx).not.toContain(marker);
    });
  }
});

describe('buildLinkedPeopleContext', () => {
  it("includes a linked person's shared data + relationship, never a locked field/private fact", async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person('a', 'Alex'));
    await savePerson(
      fs,
      key,
      person('b', 'Sam', {
        occupation: 'a nurse',
        healthNotes: 'SAM-HEALTH',
        privateFields: ['healthNotes'],
      }),
    );
    await saveRelationship(fs, key, relationship({ notes: 'married five years' }));
    await saveInsight(
      fs,
      key,
      insight('i2', 'b', {
        facts: [
          { id: 'f1', text: 'Sam just got promoted', shareable: true },
          { id: 'f2', text: 'SAM-PRIVATE-FACT', shareable: false },
        ],
      }),
    );

    const ctx = await buildLinkedPeopleContext(fs, key, 'a', ['b']);
    expect(ctx).toContain('appeared in this dream');
    expect(ctx).toContain('Sam');
    expect(ctx).toContain('(partner)'); // the relationship type
    expect(ctx).toContain('married five years'); // relationship notes (shared)
    expect(ctx).toContain('a nurse'); // a shared field
    expect(ctx).toContain('Sam just got promoted'); // a shareable fact
    expect(ctx).not.toContain('SAM-HEALTH'); // a locked field — excluded
    expect(ctx).not.toContain('SAM-PRIVATE-FACT'); // a non-shareable fact — excluded
  });

  it('excludes a linked person’s dream-sourced fact when that dream is muted from context', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person('a', 'Alex'));
    await savePerson(fs, key, person('b', 'Sam'));
    await saveDream(fs, key, dream('d1', 'b', { informsContext: false }));
    await saveInsight(
      fs,
      key,
      insight('i2', 'b', {
        source: 'dream',
        facts: [{ id: 'f1', text: 'MUTED-DREAM-FACT', shareable: false, shareableWith: ['a'] }],
        provenance: { at: 'now', dreamId: 'd1' },
      }),
    );
    const ctx = await buildLinkedPeopleContext(fs, key, 'a', ['b']);
    expect(ctx).not.toContain('MUTED-DREAM-FACT');
  });

  it('surfaces a linked NON-relation (shared fields only), still excluding locked data', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person('a', 'Alex'));
    await savePerson(
      fs,
      key,
      person('c', 'Casey', {
        occupation: 'an old colleague',
        notes: 'CASEY-LOCKED',
        privateFields: ['notes'],
      }),
    );
    // No relationship between a and c — but "all household people" are linkable (12 §3.1 decision).
    const ctx = await buildLinkedPeopleContext(fs, key, 'a', ['c']);
    expect(ctx).toContain('Casey');
    expect(ctx).toContain('an old colleague');
    expect(ctx).not.toContain('(partner)'); // no relationship type parenthetical
    expect(ctx).not.toContain('CASEY-LOCKED');
  });

  it('honors per-person targeted (shareableWith) facts and skips unknown ids', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person('a', 'Alex'));
    await savePerson(fs, key, person('b', 'Sam'));
    await saveInsight(
      fs,
      key,
      insight('i3', 'b', {
        facts: [{ id: 'f1', text: 'Sam confided in Alex', shareable: false, shareableWith: ['a'] }],
      }),
    );

    const ctx = await buildLinkedPeopleContext(fs, key, 'a', ['b', 'ghost']);
    expect(ctx).toContain('Sam confided in Alex'); // targeted at the viewer
  });

  it('returns empty for no linked people, only free names, the viewer themself, or unknowns', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person('a', 'Alex'));
    expect(await buildLinkedPeopleContext(fs, key, 'a', [])).toBe('');
    expect(await buildLinkedPeopleContext(fs, key, 'a', ['a'])).toBe(''); // the viewer is not a dream person
    expect(await buildLinkedPeopleContext(fs, key, 'a', ['nobody'])).toBe('');
  });
});

describe('ageFromBirthday', () => {
  const now = new Date('2026-06-12T00:00:00.000Z');
  it('computes exact whole-year age, accounting for whether the birthday has passed', () => {
    expect(ageFromBirthday('1990-01-01', now)).toBe(36); // birthday already passed this year
    expect(ageFromBirthday('1990-12-31', now)).toBe(35); // birthday still ahead this year
  });
  it('returns null for an unparseable or future or absurd birthday', () => {
    expect(ageFromBirthday('not-a-date', now)).toBeNull();
    expect(ageFromBirthday('2030-01-01', now)).toBeNull(); // future
  });
});

describe('buildDepictionNote', () => {
  const now = new Date('2026-06-12T00:00:00.000Z');

  it('assembles appearance + gender + exact age + ethnicity, name-free; never name/private', async () => {
    const fs = memFileSystem();
    await savePerson(
      fs,
      key,
      person('b', 'Alexandra', {
        appearanceDescription: 'tall with curly hair',
        gender: 'female',
        ethnicity: 'Korean',
        birthday: '1990-01-01',
        notes: 'PRIV',
        healthNotes: 'HEALTH',
        faith: 'FAITH',
      }),
    );
    const note = await buildDepictionNote(fs, key, 'b', now);
    expect(note).toContain('tall with curly hair');
    expect(note).toContain('female');
    expect(note).toContain('age 36');
    expect(note).toContain('Korean');
    expect(note).not.toContain('Alexandra'); // never the name
    expect(note).not.toContain('PRIV');
    expect(note).not.toContain('HEALTH');
    expect(note).not.toContain('FAITH');
  });

  it('withholds each depiction part the owner has locked (appearance/gender/ethnicity/age)', async () => {
    const fs = memFileSystem();
    await savePerson(
      fs,
      key,
      person('b', 'Alexandra', {
        appearanceDescription: 'tall with curly hair',
        gender: 'female',
        ethnicity: 'Korean',
        birthday: '1990-01-01',
        // Lock appearance + birthday: those parts must drop; gender + ethnicity remain.
        privateFields: ['appearanceDescription', 'birthday'],
      }),
    );
    const note = await buildDepictionNote(fs, key, 'b', now);
    expect(note).not.toContain('tall with curly hair'); // locked appearance withheld
    expect(note).not.toContain('age 36'); // locked birthday → no age
    expect(note).toContain('female'); // still shared
    expect(note).toContain('Korean');
  });

  it("returns '' when there is nothing depictable, or the person is unknown", async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person('c', 'Casey', { occupation: 'nurse' })); // no depiction fields
    expect(await buildDepictionNote(fs, key, 'c', now)).toBe('');
    expect(await buildDepictionNote(fs, key, 'ghost', now)).toBe('');
  });
});
