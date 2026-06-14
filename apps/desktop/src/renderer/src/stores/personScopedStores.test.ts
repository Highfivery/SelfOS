// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { useConversationStore } from './conversationStore';
import { useBudgetStore } from './budgetStore';
import { useUsageStore } from './usageStore';

/**
 * On an account switch the active person changes; person-scoped stores must drop the prior account's
 * data so one user's sessions/usage/budget never linger in another's UI (AppShell drives this on
 * `activePerson.id` change). These cover the `reset()` mechanism each store exposes for that.
 */
afterEach(() => {
  useConversationStore.getState().reset();
  useBudgetStore.getState().reset();
  useUsageStore.getState().reset();
});

describe('person-scoped store resets', () => {
  it('conversationStore.reset clears the list + the open session', () => {
    useConversationStore.setState({
      conversations: [{ id: 'a', title: 'A', updatedAt: 'now', status: 'inProgress' }],
      activeId: 'a',
      messages: [{ role: 'user', content: 'hi', ts: 'now' }],
      streaming: 'partial',
      sending: true,
      runningCostUsd: 1.5,
      error: 'boom',
    });
    useConversationStore.getState().reset();
    const s = useConversationStore.getState();
    expect(s.conversations).toEqual([]);
    expect(s.activeId).toBeNull();
    expect(s.messages).toEqual([]);
    expect(s.streaming).toBe('');
    expect(s.sending).toBe(false);
    expect(s.runningCostUsd).toBe(0);
    expect(s.error).toBeNull();
  });

  it('budgetStore.reset clears the cached status (the usage ring)', () => {
    useBudgetStore.setState({
      status: {
        person: { state: 'warn', spentUsd: 5, limitUsd: 10, period: 'week' },
        app: { state: 'none', spentUsd: 0, limitUsd: null, period: null },
      },
    });
    useBudgetStore.getState().reset();
    expect(useBudgetStore.getState().status).toBeNull();
  });

  it('usageStore.reset clears the summary + the admin person-filter', () => {
    useUsageStore.setState({ selectedPersonId: 'someone-else', loaded: true });
    useUsageStore.getState().reset();
    const s = useUsageStore.getState();
    expect(s.selectedPersonId).toBeNull();
    expect(s.summary).toBeNull();
    expect(s.loaded).toBe(false);
  });
});
