import { beforeEach, describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { getConversation } from './conversationService';
import { getExercise } from './guidedCatalog';
import { startGuided } from './guidedSessionService';

const key = generateMasterKey();
const now = new Date('2026-06-15T12:00:00.000Z');
let fs: ReturnType<typeof memFileSystem>;
beforeEach(() => {
  fs = memFileSystem();
});

describe('startGuided', () => {
  it('stamps guideId, titles by the exercise, and seeds the static opener (a chat exercise)', async () => {
    const result = await startGuided({
      fs,
      key,
      personId: 'p1',
      guideId: 'values-clarification',
      now,
    });
    expect(result).not.toBeNull();
    const conversation = await getConversation(fs, key, 'p1', result!.conversationId);
    expect(conversation?.guideId).toBe('values-clarification');
    expect(conversation?.guideStep).toBeUndefined(); // chat exercises have no stepper
    expect(conversation?.title).toBe('Values Clarification');
    expect(conversation?.messages).toHaveLength(1);
    expect(conversation?.messages[0]?.role).toBe('assistant');
    expect(conversation?.messages[0]?.content).toBe(
      getExercise('values-clarification')?.openingMessage,
    );
  });

  it('initializes guideStep to 0 for a structured exercise', async () => {
    const result = await startGuided({
      fs,
      key,
      personId: 'p1',
      guideId: 'grow-goal-setting',
      now,
    });
    const conversation = await getConversation(fs, key, 'p1', result!.conversationId);
    expect(conversation?.guideStep).toBe(0);
  });

  it('rejects an unknown guideId (§7)', async () => {
    expect(await startGuided({ fs, key, personId: 'p1', guideId: 'nope', now })).toBeNull();
  });
});
