import { describe, expect, it } from 'vitest';
import { saveChallenge } from '../challenges/challengeService';
import { generateMasterKey } from '../crypto';
import { saveDream } from '../dreams/dreamService';
import { saveGoal } from '../goals/goalService';
import { memFileSystem } from '../host/memFileSystem';
import { saveInsight } from '../insights';
import { buildContext, savePerson, saveRelationship } from '../people';
import {
  type Challenge,
  type Dream,
  type Goal,
  type Insight,
  type InsightFact,
  type Person,
  type Relationship,
} from '../schemas';
import { writeEncryptedJson } from '../vault';
import { saveConversation } from '../conversations/conversationService';
import { buildStoryCorpus, corpusText, getStoryCorpusStats } from './storyCorpus';
import { addPhotoAnswer, addUploadedPhoto, setStoryImageAnalysis } from './storyService';

const key = generateMasterKey();

function fresh(): ReturnType<typeof memFileSystem> {
  return memFileSystem();
}

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

function fact(text: string, over: Partial<InsightFact> = {}): InsightFact {
  return {
    id: `f-${text.slice(0, 8)}-${Math.random().toString(36).slice(2, 6)}`,
    text,
    shareable: false,
    ...over,
  };
}

function insight(id: string, subjectPersonId: string, over: Partial<Insight> = {}): Insight {
  return {
    id,
    schemaVersion: 1,
    source: 'session',
    subjectPersonId,
    summary: `summary-${id}`,
    facts: [],
    confidence: 'medium',
    categories: [],
    approved: true,
    provenance: { at: '2026-05-12T00:00:00.000Z' },
    createdAt: 'now',
    updatedAt: 'now',
    ...over,
  };
}

function dream(id: string, personId: string, over: Partial<Dream> = {}): Dream {
  return {
    id,
    schemaVersion: 1,
    personId,
    title: `dream-${id}`,
    narrative: `narrative-${id}`,
    tags: [],
    people: [],
    lucid: false,
    nightmare: false,
    sensitivity: 'standard',
    status: 'captured',
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...over,
  };
}

function goal(id: string, subjectPersonId: string, over: Partial<Goal> = {}): Goal {
  return {
    id,
    schemaVersion: 1,
    subjectPersonId,
    text: `goal-${id}`,
    status: 'open',
    provenance: { at: '2026-05-01T00:00:00.000Z' },
    createdAt: 'now',
    updatedAt: 'now',
    ...over,
  };
}

function challenge(id: string, subjectPersonId: string, over: Partial<Challenge> = {}): Challenge {
  return {
    id,
    schemaVersion: 1,
    subjectPersonId,
    action: `challenge-${id}`,
    status: 'active',
    comfort: 3,
    provenance: { at: '2026-05-01T00:00:00.000Z' },
    createdAt: 'now',
    updatedAt: 'now',
    ...over,
  };
}

function relationship(from: string, to: string, over: Partial<Relationship> = {}): Relationship {
  return {
    id: `r-${from}-${to}`,
    schemaVersion: 2,
    fromPersonId: from,
    toPersonId: to,
    type: 'partner',
    createdAt: 'now',
    updatedAt: 'now',
    ...over,
  };
}

describe('buildStoryCorpus — the all-data read (64 §5.1)', () => {
  it('returns an empty corpus for an unknown person (never crashes)', async () => {
    const corpus = await buildStoryCorpus(fresh(), key, 'nobody', 'book-1');
    expect(corpus).toEqual({ personName: '', profile: [], items: [] });
  });

  it("includes the subject's OWN restricted facts + locked profile fields (the story exception)", async () => {
    const fs = fresh();
    await savePerson(
      fs,
      key,
      // healthNotes is a controllable field; lock it (privateFields) — buildContext hides it from OTHERS but
      // the subject's own story reads it.
      person('me', 'Ben', { healthNotes: 'a private health note', privateFields: ['healthNotes'] }),
    );
    await saveInsight(
      fs,
      key,
      insight('i-weighs', 'me', {
        source: 'intake',
        summary: 'a heavy season',
        facts: [
          fact('a restricted trauma detail', { restricted: true, lifeArea: 'Emotions & patterns' }),
        ],
      }),
    );
    const text = corpusText(await buildStoryCorpus(fs, key, 'me', 'book-1'));
    expect(text).toContain('a restricted trauma detail'); // own restricted fact IS in the corpus
    expect(text).toContain('a private health note'); // own locked profile field IS in the corpus
  });

  it('the §24 scoping holds: buildContext still withholds the same restricted own fact (no topic)', async () => {
    const fs = fresh();
    await savePerson(fs, key, person('me', 'Ben'));
    // A non-portrait insight with a restricted fact → buildContext relevance-gates it away with no topic
    // (fail-closed), while the story corpus includes it. Proves the corpus is a SEPARATE, more-permissive
    // read that does not relax buildContext.
    await saveInsight(
      fs,
      key,
      insight('i-r', 'me', {
        source: 'session',
        summary: 'session summary',
        facts: [fact('own restricted session fact', { restricted: true, lifeArea: 'Intimacy' })],
      }),
    );
    const ctx = await buildContext(fs, key, 'me');
    expect(ctx).not.toContain('own restricted session fact'); // buildContext unchanged — withheld
    const corpus = corpusText(await buildStoryCorpus(fs, key, 'me', 'book-1'));
    expect(corpus).toContain('own restricted session fact'); // corpus includes it
  });

  it('excludes a flaggedInaccurate fact (wrong, not private)', async () => {
    const fs = fresh();
    await savePerson(fs, key, person('me', 'Ben'));
    await saveInsight(
      fs,
      key,
      insight('i', 'me', {
        summary: 'ok',
        facts: [
          fact('a correct fact'),
          fact('a WRONG fact', { flaggedInaccurate: true, flaggedAt: 'now' }),
        ],
      }),
    );
    const text = corpusText(await buildStoryCorpus(fs, key, 'me', 'book-1'));
    expect(text).toContain('a correct fact');
    expect(text).not.toContain('a WRONG fact');
  });

  it('drops a muted dream (informsContext:false): both its narrative and its insight', async () => {
    const fs = fresh();
    await savePerson(fs, key, person('me', 'Ben'));
    await saveDream(fs, key, dream('d-live', 'me', { narrative: 'a dream that informs' }));
    await saveDream(
      fs,
      key,
      dream('d-mute', 'me', { narrative: 'a muted dream narrative', informsContext: false }),
    );
    // The muted dream's analysis insight must also be suppressed (feedableInsights).
    await saveInsight(
      fs,
      key,
      insight('i-mute', 'me', {
        source: 'dream',
        summary: 'muted dream insight summary',
        provenance: { at: 'now', dreamId: 'd-mute' },
        facts: [fact('a fact from the muted dream')],
      }),
    );
    const text = corpusText(await buildStoryCorpus(fs, key, 'me', 'book-1'));
    expect(text).toContain('a dream that informs');
    expect(text).not.toContain('a muted dream narrative');
    expect(text).not.toContain('a fact from the muted dream');
    expect(text).not.toContain('muted dream insight summary');
  });

  it('never reads raw TestResults, so the internal clinicalKey is structurally absent', async () => {
    const fs = fresh();
    await savePerson(fs, key, person('me', 'Ben'));
    // A raw file in the tests dir carrying the never-shown internal marker. The corpus must not read it.
    await writeEncryptedJson(
      fs,
      'people/me/tests/result-1.enc',
      { marker: 'CLINICAL_KEY_SEVERE_MARKER' },
      key,
    );
    // Test material enters ONLY via the test-sourced insight (display bands / gentle facts).
    await saveInsight(
      fs,
      key,
      insight('i-test', 'me', {
        source: 'test',
        summary: 'a gentle reflection summary',
        facts: [fact('you tend to run anxious before big decisions')],
      }),
    );
    const text = corpusText(await buildStoryCorpus(fs, key, 'me', 'book-1'));
    expect(text).not.toContain('CLINICAL_KEY_SEVERE_MARKER'); // raw TestResult never read
    expect(text).toContain('you tend to run anxious before big decisions'); // the display fact IS present
  });

  it('other people enter ONLY via facts they share to this viewer — private/restricted/flagged never', async () => {
    const fs = fresh();
    await savePerson(fs, key, person('me', 'Ben'));
    await savePerson(fs, key, person('angel', 'Angel'));
    await saveRelationship(fs, key, relationship('me', 'angel', { type: 'partner' }));
    await saveInsight(
      fs,
      key,
      insight('i-angel', 'angel', {
        source: 'session',
        summary: "angel's private summary",
        facts: [
          fact('angel shares this with partners', { shareableTypes: ['partner'] }),
          fact('angel keeps this private'), // shareable:false, no scope → own-only
          fact('angel restricted fact', { restricted: true, shareableTypes: ['partner'] }),
          fact('angel flagged fact', {
            shareableTypes: ['partner'],
            flaggedInaccurate: true,
            flaggedAt: 'now',
          }),
        ],
      }),
    );
    const text = corpusText(await buildStoryCorpus(fs, key, 'me', 'book-1'));
    expect(text).toContain('angel shares this with partners'); // shared to a partner (me) → present
    expect(text).not.toContain('angel keeps this private'); // not shared → absent
    expect(text).not.toContain('angel restricted fact'); // restricted → never shared
    expect(text).not.toContain('angel flagged fact'); // flagged → never shared
    expect(text).not.toContain("angel's private summary"); // a related person's summary never crosses
  });

  it('includes goals and challenges, and does not double-count goal-prefixed insight facts', async () => {
    const fs = fresh();
    await savePerson(fs, key, person('me', 'Ben'));
    await saveGoal(
      fs,
      key,
      goal('g1', 'me', { text: 'run a half marathon', status: 'inProgress' }),
    );
    await saveChallenge(
      fs,
      key,
      challenge('c1', 'me', { action: 'call an old friend', reflection: 'it went well' }),
    );
    await saveInsight(
      fs,
      key,
      insight('i', 'me', {
        summary: 's',
        facts: [fact('Goal: run a half marathon'), fact('a real theme')],
      }),
    );
    const corpus = await buildStoryCorpus(fs, key, 'me', 'book-1');
    const text = corpusText(corpus);
    expect(text).toContain('run a half marathon'); // from the goal
    expect(text).toContain('call an old friend'); // the challenge action
    expect(text).toContain('it went well'); // the challenge reflection
    expect(text).toContain('a real theme');
    // The `Goal:`-prefixed insight fact is dropped so goals aren't double-counted.
    const goalPrefixedItems = corpus.items.filter((i) => i.text.startsWith('Goal: '));
    expect(goalPrefixedItems).toHaveLength(0);
  });

  it('filters exclusions at the corpus boundary (person, source, topic, and profile lines)', async () => {
    const fs = fresh();
    await savePerson(fs, key, person('me', 'Ben', { occupation: 'a nurse who loves sailing' }));
    await savePerson(fs, key, person('ex', 'Sam'));
    await saveRelationship(fs, key, relationship('me', 'ex', { type: 'ex' }));
    await saveInsight(
      fs,
      key,
      insight('i-ex', 'ex', {
        facts: [fact('a shared fact about Sam', { shareable: true })],
      }),
    );
    await saveInsight(
      fs,
      key,
      insight('i-src', 'me', {
        summary: 'a summary from a droppable source',
        facts: [fact('keep me')],
      }),
    );
    await saveInsight(
      fs,
      key,
      insight('i-topic', 'me', { summary: 's', facts: [fact('a note about sailing trips')] }),
    );
    // The subject's OWN mention of the excluded person (by their display name "Sam") must also be dropped —
    // a `person` exclusion is durable, not just a cross-shared-fact filter.
    await saveInsight(
      fs,
      key,
      insight('i-own-sam', 'me', { summary: 's', facts: [fact('a memory of Sam at the lake')] }),
    );

    const corpus = await buildStoryCorpus(fs, key, 'me', 'book-1', [
      { id: 'e1', kind: 'person', value: 'ex', createdAt: 'now' },
      { id: 'e2', kind: 'source', value: 'i-src', createdAt: 'now' },
      { id: 'e3', kind: 'topic', value: 'sailing', createdAt: 'now' },
    ]);
    const text = corpusText(corpus);
    expect(text).not.toContain('a shared fact about Sam'); // person-excluded cross-shared item
    expect(text).not.toContain('a memory of Sam'); // person exclusion drops own name-mentions too
    expect(text).not.toContain('a summary from a droppable source'); // source-excluded (by sourceRef.id)
    expect(text).not.toContain('keep me'); // its facts share the excluded source id too
    expect(text).not.toContain('sailing trips'); // topic-excluded item
    expect(text).not.toContain('loves sailing'); // topic exclusion also filters profile lines
  });

  it('drops a WHOLLY-flagged insight entirely — summary and facts (the corrected-claim leak)', async () => {
    const fs = fresh();
    await savePerson(fs, key, person('me', 'Ben'));
    await saveInsight(
      fs,
      key,
      insight('i-mixed', 'me', {
        summary: 'a mixed summary that stays',
        facts: [
          fact('a live fact that stays'),
          fact('one flagged fact', { flaggedInaccurate: true, flaggedAt: 'now' }),
        ],
      }),
    );
    await saveInsight(
      fs,
      key,
      insight('i-whole', 'me', {
        summary: 'a wholly-flagged summary restating a wrong claim',
        facts: [
          fact('flagged fact one', { flaggedInaccurate: true, flaggedAt: 'now' }),
          fact('flagged fact two', { flaggedInaccurate: true, flaggedAt: 'now' }),
        ],
      }),
    );
    const text = corpusText(await buildStoryCorpus(fs, key, 'me', 'book-1'));
    expect(text).toContain('a mixed summary that stays'); // a MIXED insight keeps its summary + live facts
    expect(text).toContain('a live fact that stays');
    expect(text).not.toContain('one flagged fact');
    expect(text).not.toContain('a wholly-flagged summary'); // the whole insight is dropped, not just its facts
    expect(text).not.toContain('flagged fact one');
  });

  it("includes the subject's own Together insight; a partner's non-shared together fact never crosses", async () => {
    const fs = fresh();
    await savePerson(fs, key, person('me', 'Ben'));
    await savePerson(fs, key, person('angel', 'Angel'));
    await saveRelationship(fs, key, relationship('me', 'angel', { type: 'partner' }));
    // The subject's OWN Together wrap-up twin (subject = me) — asides were excluded from the wrap-up analysis
    // (58 §3.8), so this is safe own data.
    await saveInsight(
      fs,
      key,
      insight('t-me', 'me', {
        source: 'together',
        summary: 'my own reflection on our session',
        facts: [fact('a commitment I want to keep')],
      }),
    );
    // The partner's own Together twin — a non-shared fact must never cross into the subject's corpus.
    await saveInsight(
      fs,
      key,
      insight('t-angel', 'angel', {
        source: 'together',
        summary: "angel's own together reflection",
        facts: [fact('a private together fact of angels')],
      }),
    );
    const text = corpusText(await buildStoryCorpus(fs, key, 'me', 'book-1'));
    expect(text).toContain('a commitment I want to keep'); // own Together twin included
    expect(text).not.toContain('a private together fact of angels'); // partner's non-shared fact absent
    expect(text).not.toContain("angel's own together reflection");
  });

  it('getStoryCorpusStats counts sessions/reflections/dreams + a year span (§13.6.10)', async () => {
    const fs = fresh();
    await savePerson(fs, key, person('me', 'Ben'));
    await saveConversation(fs, key, {
      id: 'conv-1',
      schemaVersion: 1,
      personId: 'me',
      title: 'A session',
      createdAt: '2019-03-01T00:00:00.000Z',
      updatedAt: '2019-03-01T00:00:00.000Z',
      messages: [],
    });
    await saveInsight(
      fs,
      key,
      insight('i-1', 'me', { provenance: { at: '2022-05-01T00:00:00.000Z' } }),
    );
    await saveInsight(
      fs,
      key,
      insight('i-2', 'me', { provenance: { at: '2026-07-01T00:00:00.000Z' } }),
    );
    // A NON-approved insight is not counted (only approved reflections feed the biographer).
    await saveInsight(fs, key, insight('i-draft', 'me', { approved: false }));
    await saveDream(fs, key, dream('d-1', 'me', { dreamDate: '2020-01-01T00:00:00.000Z' }));

    const stats = await getStoryCorpusStats(fs, key, 'me');
    expect(stats.conversations).toBe(1);
    expect(stats.reflections).toBe(2); // the two approved, not the draft
    expect(stats.dreams).toBe(1);
    expect(stats.yearFrom).toBe(2019); // the session
    expect(stats.yearTo).toBe(2026); // the latest insight
  });

  it('getStoryCorpusStats returns zeros + no year span for an empty vault', async () => {
    const fs = fresh();
    await savePerson(fs, key, person('me', 'Ben'));
    const stats = await getStoryCorpusStats(fs, key, 'me');
    expect(stats).toEqual({ conversations: 0, reflections: 0, dreams: 0 });
  });

  it("surfaces the subject's own profile and name", async () => {
    const fs = fresh();
    await savePerson(fs, key, person('me', 'Ben', { occupation: 'teacher', location: 'Denver' }));
    const corpus = await buildStoryCorpus(fs, key, 'me', 'book-1');
    expect(corpus.personName).toBe('Ben');
    expect(corpus.profile.join('\n')).toContain('teacher');
    expect(corpus.profile.join('\n')).toContain('Denver');
  });

  it('feeds an uploaded photo’s caption + answered Q&A into the corpus (§13.6.2 wiring fix)', async () => {
    const fs = fresh();
    await savePerson(fs, key, person('me', 'Ben'));
    const at = new Date('2026-06-01T00:00:00.000Z');
    const photo = await addUploadedPhoto(
      fs,
      key,
      'me',
      'book-1',
      { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' },
      at,
    );
    await setStoryImageAnalysis(fs, key, 'me', 'book-1', photo.id, {
      caption: 'Us on the pier at Lake Michigan',
    });
    await addPhotoAnswer(
      fs,
      key,
      'me',
      'book-1',
      {
        imageId: photo.id,
        question: 'Who took this?',
        answer: 'My grandfather, on his old Nikon.',
      },
      at,
    );
    await addPhotoAnswer(
      fs,
      key,
      'me',
      'book-1',
      {
        imageId: photo.id,
        question: 'What do you remember?',
        answer: 'The smell of the fish fry.',
      },
      at,
    );
    const corpus = await buildStoryCorpus(fs, key, 'me', 'book-1');
    const text = corpusText(corpus);
    expect(text).toContain('Us on the pier at Lake Michigan'); // caption
    expect(text).toContain('My grandfather, on his old Nikon.'); // answer 1
    expect(text).toContain('The smell of the fish fry.'); // answer 2
    // Grouped one item per photo, tagged as photo provenance so a `source` exclusion can drop it.
    const photoItem = corpus.items.find((i) => i.sourceRef.kind === 'photo');
    expect(photoItem?.sourceRef.id).toBe(photo.id);
  });

  it('drops a photo’s Q&A when its image id is source-excluded (§3.3)', async () => {
    const fs = fresh();
    await savePerson(fs, key, person('me', 'Ben'));
    const at = new Date('2026-06-01T00:00:00.000Z');
    const photo = await addUploadedPhoto(
      fs,
      key,
      'me',
      'book-1',
      { bytes: new Uint8Array([1]), mime: 'image/png' },
      at,
    );
    await addPhotoAnswer(
      fs,
      key,
      'me',
      'book-1',
      { imageId: photo.id, question: 'q', answer: 'a private photo memory' },
      at,
    );
    const text = corpusText(
      await buildStoryCorpus(fs, key, 'me', 'book-1', [
        { id: 'e1', kind: 'source', value: photo.id, createdAt: 'now' },
      ]),
    );
    expect(text).not.toContain('a private photo memory');
  });

  it('reads photo answers from the RIGHT book (book-scoped)', async () => {
    const fs = fresh();
    await savePerson(fs, key, person('me', 'Ben'));
    const at = new Date('2026-06-01T00:00:00.000Z');
    const photo = await addUploadedPhoto(
      fs,
      key,
      'me',
      'book-A',
      { bytes: new Uint8Array([1]), mime: 'image/png' },
      at,
    );
    await addPhotoAnswer(
      fs,
      key,
      'me',
      'book-A',
      { imageId: photo.id, question: 'q', answer: 'memory that belongs to book A' },
      at,
    );
    // A different book must not pick up book-A's photo answers.
    expect(corpusText(await buildStoryCorpus(fs, key, 'me', 'book-B'))).not.toContain(
      'memory that belongs to book A',
    );
    expect(corpusText(await buildStoryCorpus(fs, key, 'me', 'book-A'))).toContain(
      'memory that belongs to book A',
    );
  });
});
