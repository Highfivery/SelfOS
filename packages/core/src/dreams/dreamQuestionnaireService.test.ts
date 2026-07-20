import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { ClaudeClient } from '../host';
import type { Dream, Person } from '../schemas';
import { savePerson } from '../people';
import { setAutoCheckinBlock } from '../autoCheckins/prefsService';
import { listAssignments, listQuestionnaires } from '../questionnaires';
import { mintDreamQuestionnaires } from './dreamQuestionnaireService';

const key = generateMasterKey();
const NOW = new Date('2026-07-19T10:00:00.000Z');

/** A client that returns a valid generated question set for any generation call. */
function fakeClient(): ClaudeClient {
  return {
    send: () => Promise.resolve(''),
    stream: () =>
      Promise.resolve({
        text: JSON.stringify({
          title: 'A gentle check-in',
          questions: [{ type: 'shortText', prompt: 'What stood out for you?', required: false }],
        }),
        usage: { inputTokens: 10, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
      }),
  };
}

const person = (id: string, displayName: string): Person => ({
  id,
  schemaVersion: 1,
  displayName,
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
});

const dream = (people: Dream['people']): Dream => ({
  id: 'd1',
  schemaVersion: 1,
  personId: 'p1',
  narrative: 'a dream',
  lucid: false,
  nightmare: false,
  tags: [],
  people,
  sensitivity: 'standard',
  status: 'analyzing',
  createdAt: 'now',
  updatedAt: 'now',
});

function deps(fs: ReturnType<typeof memFileSystem>, client: ClaudeClient = fakeClient()) {
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

const PROPOSAL = { title: 'About us', brief: 'How connected we feel lately' };

describe('mintDreamQuestionnaires (66 §3.4)', () => {
  it('sends a self check-in when the proposal is for "me"', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person('p1', 'Alex'));

    const sent = await mintDreamQuestionnaires({
      deps: deps(fs),
      fs,
      key,
      personId: 'p1',
      dream: dream([]),
      analysisId: 'a1',
      proposals: [{ ...PROPOSAL, for: 'me' }],
      now: NOW,
    });

    expect(sent).toHaveLength(1);
    const assignments = await listAssignments(fs, key, { senderPersonId: 'p1' });
    expect(assignments[0]?.recipient).toMatchObject({ kind: 'person', personId: 'p1' });
    // A self check-in is standard — there's no one to keep the answers from.
    expect(assignments[0]?.privacy).toBe('standard');
  });

  it('sends to a dream figure LINKED to the People graph, privately', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person('p1', 'Alex'));
    await savePerson(fs, key, person('p2', 'Sam'));

    const sent = await mintDreamQuestionnaires({
      deps: deps(fs),
      fs,
      key,
      personId: 'p1',
      dream: dream([{ name: 'Sam', personId: 'p2' }]),
      analysisId: 'a1',
      proposals: [{ ...PROPOSAL, for: 'Sam' }],
      now: NOW,
    });

    expect(sent[0]?.recipientPersonId).toBe('p2');
    expect(sent[0]?.recipientName).toBe('Sam');
    const assignments = await listAssignments(fs, key, { senderPersonId: 'p1' });
    // Another person's answers stay private to them (the sender gets the insight, not the raw answers).
    expect(assignments[0]?.privacy).toBe('private');
  });

  it('stamps the dream as the source, without carrying the narrative', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person('p1', 'Alex'));

    await mintDreamQuestionnaires({
      deps: deps(fs),
      fs,
      key,
      personId: 'p1',
      dream: dream([]),
      analysisId: 'a1',
      proposals: [{ ...PROPOSAL, for: 'me' }],
      now: NOW,
    });

    const [q] = await listQuestionnaires(fs, key);
    expect(q?.dreamProvenance).toMatchObject({ dreamId: 'd1', analysisId: 'a1' });
    expect(q?.dreamProvenance?.brief).toBe(PROPOSAL.brief);
    expect(JSON.stringify(q)).not.toContain('a dream'); // the narrative never rides along
  });

  it('skips a dream figure who is only a NAME — an unlinked figure is not a person we can address', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person('p1', 'Alex'));

    const sent = await mintDreamQuestionnaires({
      deps: deps(fs),
      fs,
      key,
      personId: 'p1',
      dream: dream([{ name: 'A stranger' }]),
      analysisId: 'a1',
      proposals: [{ ...PROPOSAL, for: 'A stranger' }],
      now: NOW,
    });

    expect(sent).toHaveLength(0);
    expect(await listQuestionnaires(fs, key)).toHaveLength(0); // nothing persisted
  });

  it('honours the recipient’s own standing opt-out', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person('p1', 'Alex'));
    await savePerson(fs, key, person('p2', 'Sam'));
    // Sam's own choice, stored in Sam's vault — not something the dreamer can override.
    await setAutoCheckinBlock(fs, key, 'p2', 'p1', true);

    const sent = await mintDreamQuestionnaires({
      deps: deps(fs),
      fs,
      key,
      personId: 'p1',
      dream: dream([{ name: 'Sam', personId: 'p2' }]),
      analysisId: 'a1',
      proposals: [{ ...PROPOSAL, for: 'Sam' }],
      now: NOW,
    });

    expect(sent).toHaveLength(0);
    expect(await listAssignments(fs, key, { senderPersonId: 'p1' })).toHaveLength(0);
  });

  it('sends at most one per analysis, whatever the model proposes', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person('p1', 'Alex'));

    const sent = await mintDreamQuestionnaires({
      deps: deps(fs),
      fs,
      key,
      personId: 'p1',
      dream: dream([]),
      analysisId: 'a1',
      proposals: [
        { ...PROPOSAL, for: 'me' },
        { title: 'And another', brief: 'more', for: 'me' },
        { title: 'And a third', brief: 'more still', for: 'me' },
      ],
      now: NOW,
    });

    expect(sent).toHaveLength(1);
  });

  it('persists nothing when generation fails', async () => {
    const fs = memFileSystem();
    await savePerson(fs, key, person('p1', 'Alex'));
    const failing: ClaudeClient = {
      send: () => Promise.resolve(''),
      stream: () => Promise.reject(new Error('no network')),
    };

    const sent = await mintDreamQuestionnaires({
      deps: deps(fs, failing),
      fs,
      key,
      personId: 'p1',
      dream: dream([]),
      analysisId: 'a1',
      proposals: [{ ...PROPOSAL, for: 'me' }],
      now: NOW,
    });

    expect(sent).toHaveLength(0);
    // No orphaned definition left behind — the whole point of validating before saving.
    expect(await listQuestionnaires(fs, key)).toHaveLength(0);
    expect(await listAssignments(fs, key, { senderPersonId: 'p1' })).toHaveLength(0);
  });
});
