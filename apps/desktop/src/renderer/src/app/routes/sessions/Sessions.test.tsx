import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '../../../settings/builtins';
import { Sessions } from './Sessions';
import { clearMockBridge, elevateToOwner, installMockBridge } from '../../../test-utils/bridge';
import { useConversationStore } from '../../../stores/conversationStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useSettingsStore } from '../../../settings/settingsStore';
import type { ConversationMeta, SessionCost } from '@shared/channels';

function meta(
  id: string,
  title: string,
  status: ConversationMeta['status'] = 'inProgress',
): ConversationMeta {
  return { id, title, updatedAt: 'now', status };
}

function setAiEnabled(enabled: boolean): void {
  useSettingsStore.setState((state) => ({ values: { ...state.values, 'ai.enabled': enabled } }));
}

function renderSessions(): void {
  render(
    <MemoryRouter>
      <Sessions />
    </MemoryRouter>,
  );
}

afterEach(() => {
  clearMockBridge();
  useConversationStore.getState().reset();
  useSessionStore.setState({ activePerson: null, access: null });
  setAiEnabled(false);
});

describe('Sessions', () => {
  it('shows the launcher with a calm connect state when AI is off, plus the catalog + crisis footer', async () => {
    installMockBridge({ secretHas: () => Promise.resolve(false) });
    setAiEnabled(false);
    renderSessions();
    // The launcher renders even with AI off — the catalog browses; only chatting needs AI.
    expect(await screen.findByText('What do you want to work through?')).toBeInTheDocument();
    expect(screen.getByText(/browse and start guided sessions below/i)).toBeInTheDocument();
    expect(screen.getByText('Reflective & therapy-informed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /get help now/i })).toBeInTheDocument();
  });

  it('sends a message and shows the reply', async () => {
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
    });
    setAiEnabled(true);
    renderSessions();
    await waitFor(() => expect(screen.getByLabelText('Message')).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText('Message'), 'I had a hard day');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByText('I hear you.')).toBeInTheDocument());
    expect(screen.getByText('I had a hard day')).toBeInTheDocument();
  });

  it('surfaces a failed turn with the error + a working "Try again" (56/05 §4.1)', async () => {
    const okConversation = (userText: string) => ({
      id: 'c1',
      schemaVersion: 1 as const,
      personId: 'owner-1',
      title: userText,
      createdAt: 'now',
      updatedAt: 'now',
      messages: [
        { role: 'user' as const, content: userText, ts: 'now' },
        { role: 'assistant' as const, content: 'Welcome back.', ts: 'now' },
      ],
    });
    const usage = {
      id: 'u',
      schemaVersion: 1 as const,
      type: 'chat' as const,
      personId: 'owner-1',
      model: 'claude-sonnet-4-6',
      at: 'now',
      inputTokens: 100,
      outputTokens: 10,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      costUsd: 0.001,
    };
    // First turn (send) fails empty; the retry goes through chatRetry (reply-only, no re-send) and succeeds.
    const chatStream = vi.fn().mockResolvedValue({
      ok: false,
      reason: 'EMPTY',
      message: 'The coach’s reply came back empty — please try again.',
    });
    const chatRetry = vi
      .fn()
      .mockResolvedValue({ ok: true, conversation: okConversation('I had a hard day'), usage });
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
      chatStream,
      chatRetry,
    });
    setAiEnabled(true);
    renderSessions();
    await waitFor(() => expect(screen.getByLabelText('Message')).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText('Message'), 'I had a hard day');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    // The failure is shown (not swallowed) + the user's message stays on screen; a Try again is offered.
    await waitFor(() => expect(screen.getByText(/came back empty/i)).toBeInTheDocument());
    expect(screen.getByText('I had a hard day')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Try again' });

    // Retrying asks the coach to reply to the existing transcript (chatRetry) → the reply lands, error clears.
    await userEvent.click(retry);
    await waitFor(() => expect(screen.getByText('Welcome back.')).toBeInTheDocument());
    expect(screen.queryByText(/came back empty/i)).not.toBeInTheDocument();
    expect(chatRetry).toHaveBeenCalledTimes(1);
    expect(chatStream).toHaveBeenCalledTimes(1); // NOT re-sent — retry is reply-only
  });

  it('offers "Try again" on RE-OPENING a session that ended on the user\'s message (05 §4.1)', async () => {
    // The reported case: an old session whose last message is the user's, no reply — re-opened with no error.
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
      conversationsList: () =>
        Promise.resolve([{ id: 'c1', title: 'Stuck one', updatedAt: 'now', status: 'inProgress' }]),
      conversationsGet: () =>
        Promise.resolve({
          id: 'c1',
          schemaVersion: 1,
          personId: 'owner-1',
          title: 'Stuck one',
          createdAt: 'now',
          updatedAt: 'now',
          status: 'inProgress',
          messages: [{ role: 'user', content: 'I feel distant lately', ts: 'now' }],
        }),
      chatRetry: () =>
        Promise.resolve({
          ok: true,
          conversation: {
            id: 'c1',
            schemaVersion: 1,
            personId: 'owner-1',
            title: 'Stuck one',
            createdAt: 'now',
            updatedAt: 'now',
            status: 'inProgress' as const,
            messages: [
              { role: 'user' as const, content: 'I feel distant lately', ts: 'now' },
              { role: 'assistant' as const, content: 'That sounds heavy.', ts: 'now' },
            ],
          },
          usage: {
            id: 'u',
            schemaVersion: 1 as const,
            type: 'chat' as const,
            personId: 'owner-1',
            model: 'claude-sonnet-4-6',
            at: 'now',
            inputTokens: 100,
            outputTokens: 10,
            cacheWriteTokens: 0,
            cacheReadTokens: 0,
            costUsd: 0.001,
          },
        }),
    });
    setAiEnabled(true);
    renderSessions();
    // Open the stuck session.
    await userEvent.click(await screen.findByRole('button', { name: 'Stuck one' }));
    // No error, but the last message is the user's → a gentle prompt + a Try again (the previous fix missed this).
    await waitFor(() => expect(screen.getByText(/hasn’t been answered yet/i)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText('That sounds heavy.')).toBeInTheDocument());
    expect(screen.queryByText(/hasn’t been answered yet/i)).not.toBeInTheDocument();
  });

  it('recovers a LEGACY session that dead-ended on a BLANK assistant reply (pre-05 §4.1)', async () => {
    // The pre-fail-safe code persisted an empty assistant bubble on an empty reply, so the transcript ends on
    // that ghost (last.role === 'assistant'), NOT the user's message — which the earlier fix's retry missed.
    // The ghost must not render, and "Try again" must still be offered (and work).
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
      conversationsList: () =>
        Promise.resolve([{ id: 'c1', title: 'Ghosted', updatedAt: 'now', status: 'inProgress' }]),
      conversationsGet: () =>
        Promise.resolve({
          id: 'c1',
          schemaVersion: 1,
          personId: 'owner-1',
          title: 'Ghosted',
          createdAt: 'now',
          updatedAt: 'now',
          status: 'inProgress',
          messages: [
            { role: 'user', content: 'Everything feels off', ts: 'now' },
            { role: 'assistant', content: '', ts: 'now' }, // the legacy blank-reply ghost
          ],
        }),
      chatRetry: () =>
        Promise.resolve({
          ok: true,
          conversation: {
            id: 'c1',
            schemaVersion: 1,
            personId: 'owner-1',
            title: 'Ghosted',
            createdAt: 'now',
            updatedAt: 'now',
            status: 'inProgress' as const,
            messages: [
              { role: 'user' as const, content: 'Everything feels off', ts: 'now' },
              { role: 'assistant' as const, content: 'I’m here with you.', ts: 'now' },
            ],
          },
          usage: {
            id: 'u',
            schemaVersion: 1 as const,
            type: 'chat' as const,
            personId: 'owner-1',
            model: 'claude-sonnet-4-6',
            at: 'now',
            inputTokens: 100,
            outputTokens: 10,
            cacheWriteTokens: 0,
            cacheReadTokens: 0,
            costUsd: 0.001,
          },
        }),
    });
    setAiEnabled(true);
    renderSessions();
    await userEvent.click(await screen.findByRole('button', { name: 'Ghosted' }));
    // The user's message shows; the transcript is treated as awaiting a reply despite the trailing blank ghost.
    await waitFor(() => expect(screen.getByText('Everything feels off')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/hasn’t been answered yet/i)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText('I’m here with you.')).toBeInTheDocument());
    expect(screen.queryByText(/hasn’t been answered yet/i)).not.toBeInTheDocument();
  });

  it('renders a coach reply as Markdown (bold + a list), not literal markdown (34)', async () => {
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
      chatStream: (input) =>
        Promise.resolve({
          ok: true,
          conversation: {
            id: input.conversationId,
            schemaVersion: 1,
            personId: 'owner-1',
            title: input.userText,
            createdAt: 'now',
            updatedAt: 'now',
            messages: [
              { role: 'user', content: input.userText, ts: 'now' },
              {
                role: 'assistant',
                content: 'Try this:\n\n- Name **one** feeling\n- Breathe',
                ts: 'now',
              },
            ],
          },
          usage: {
            id: 'u',
            schemaVersion: 1,
            type: 'chat',
            personId: 'owner-1',
            model: 'claude-sonnet-4-6',
            at: 'now',
            inputTokens: 100,
            outputTokens: 10,
            cacheWriteTokens: 0,
            cacheReadTokens: 0,
            costUsd: 0.001,
          },
        }),
    });
    setAiEnabled(true);
    const { container } = render(
      <MemoryRouter>
        <Sessions />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByLabelText('Message')).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText('Message'), 'help');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(container.querySelector('strong')?.textContent).toBe('one'));
    expect(container.querySelectorAll('li').length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).not.toContain('**');
    // The user message stays plain (not Markdown-parsed).
    expect(screen.getByText('help')).toBeInTheDocument();
  });

  it('renames a conversation', async () => {
    const conversationsRename = vi.fn(() => Promise.resolve());
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
      conversationsList: () =>
        Promise.resolve([
          { id: 'c1', title: 'Old title', updatedAt: 'now', status: 'inProgress' as const },
        ]),
      conversationsRename,
    });
    setAiEnabled(true);
    renderSessions();
    // Rename lives in the per-session kebab now (no standalone icon clutter).
    await userEvent.click(
      await screen.findByRole('button', { name: 'Session options for Old title' }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByLabelText('Session title');
    await userEvent.clear(input);
    await userEvent.type(input, 'New title{Enter}');
    await waitFor(() =>
      expect(conversationsRename).toHaveBeenCalledWith({ id: 'c1', title: 'New title' }),
    );
  });

  it('expands crisis resources', async () => {
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
    });
    setAiEnabled(true);
    renderSessions();
    await userEvent.click(screen.getByRole('button', { name: /get help now/i }));
    expect(screen.getByText(/988/)).toBeInTheDocument();
  });

  it('shows status pills and filters the list by status', async () => {
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
      conversationsList: () =>
        Promise.resolve([meta('c1', 'Active one'), meta('c2', 'Done one', 'complete')]),
    });
    setAiEnabled(true);
    renderSessions();

    expect(await screen.findByRole('button', { name: 'Active one' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done one' })).toBeInTheDocument();
    // Status pills render their state as text, not colour alone.
    expect(screen.getAllByText('In progress').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Complete').length).toBeGreaterThanOrEqual(1);

    // Filter to Complete (via the status Select) → the in-progress session drops out.
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Filter sessions by status' }),
      'complete',
    );
    expect(screen.queryByRole('button', { name: 'Active one' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done one' })).toBeInTheDocument();
  });

  it('sets a session status from the per-item menu', async () => {
    const sessionsSetStatus = vi.fn(() => Promise.resolve(meta('c1', 'Active one', 'onHold')));
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
      conversationsList: () => Promise.resolve([meta('c1', 'Active one')]),
      sessionsSetStatus,
    });
    setAiEnabled(true);
    renderSessions();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Session options for Active one' }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Mark on hold' }));
    expect(sessionsSetStatus).toHaveBeenCalledWith({ conversationId: 'c1', status: 'onHold' });
  });

  it('shows a $ figure with an admin-only badge for admins, a bar for members', async () => {
    const costs: Record<string, SessionCost> = {
      c1: { tokens: 1200, costUsd: 0.42, budgetRatio: 0.1 },
    };
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
      conversationsList: () => Promise.resolve([meta('c1', 'Active one')]),
      usageSessionCosts: () => Promise.resolve(costs),
    });
    setAiEnabled(true);

    // Admin: dollars + the Admin only badge.
    elevateToOwner();
    renderSessions();
    expect(await screen.findByText('$0.42')).toBeInTheDocument();
    expect(screen.getByText('Admin only')).toBeInTheDocument();
  });

  it('hides the $ from a non-admin, showing only a budget bar', async () => {
    const costs: Record<string, SessionCost> = { c1: { tokens: 1200, budgetRatio: 0.1 } };
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
      conversationsList: () => Promise.resolve([meta('c1', 'Active one')]),
      usageSessionCosts: () => Promise.resolve(costs),
    });
    setAiEnabled(true);
    renderSessions(); // not super-admin → member view
    await screen.findByRole('button', { name: 'Active one' });
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: /period allowance/i })).toBeInTheDocument();
  });

  it('shows the AI completion suggestion only after a hinted turn, then summarizes', async () => {
    const summarizeInsight = {
      id: 'ins1',
      schemaVersion: 1,
      source: 'session' as const,
      subjectPersonId: 'p1',
      summary: 'A calm close to the day.',
      facts: [{ id: 'f1', text: 'Goal: rest tonight', shareable: false }],
      metrics: { moodValence: 0.4, moodEnergy: -0.2 },
      confidence: 'medium' as const,
      categories: [] as string[],
      approved: true,
      provenance: { conversationId: 'c1', at: 'now' },
      createdAt: 'now',
      updatedAt: 'now',
    };
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
      chatStream: (input) =>
        Promise.resolve({
          ok: true,
          wrapUpSuggested: true,
          conversation: {
            id: input.conversationId,
            schemaVersion: 1,
            personId: 'p1',
            title: 'today',
            createdAt: 'now',
            updatedAt: 'now',
            status: 'inProgress',
            messages: [
              { role: 'user', content: 'thanks', ts: 'now' },
              { role: 'assistant', content: 'Glad it helped.', ts: 'now' },
            ],
          },
          usage: {
            id: 'u1',
            schemaVersion: 1,
            type: 'chat',
            personId: 'p1',
            model: 'claude-sonnet-4-6',
            at: 'now',
            inputTokens: 1,
            outputTokens: 1,
            cacheWriteTokens: 0,
            cacheReadTokens: 0,
            costUsd: 0.01,
          },
        }),
      sessionsSetStatus: () => Promise.resolve(meta('any', 'today', 'complete')),
      sessionsEndAndSummarize: () =>
        Promise.resolve({ ok: true, insight: summarizeInsight, usage: summarizeInsight as never }),
    });
    setAiEnabled(true);
    renderSessions();

    // No suggestion before a hinted turn.
    expect(screen.queryByText(/feels wrapped up/i)).not.toBeInTheDocument();
    await userEvent.type(await screen.findByLabelText('Message'), 'thanks');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    // After the hinted turn, the suggestion appears; accepting summarizes → the wrap-up card shows.
    expect(await screen.findByText(/feels wrapped up/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Complete & summarize' }));
    expect(await screen.findByText('A calm close to the day.')).toBeInTheDocument();
    expect(screen.getByText('Goal: rest tonight')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /View in Memory/i })).toBeInTheDocument();
  });

  it('offers "Wrap up & reflect" below the composer → ends + summarizes on demand (09 §14.2)', async () => {
    const summarizeInsight = {
      id: 'ins2',
      schemaVersion: 1,
      source: 'session' as const,
      subjectPersonId: 'p1',
      summary: 'You named wanting more connection.',
      facts: [{ id: 'f1', text: 'Goal: one honest conversation', shareable: false }],
      metrics: { moodValence: 0.2, moodEnergy: -0.1 },
      confidence: 'medium' as const,
      categories: [] as string[],
      approved: true,
      provenance: { conversationId: 'c1', at: 'now' },
      createdAt: 'now',
      updatedAt: 'now',
    };
    const sessionsSetStatus = vi.fn(() =>
      Promise.resolve(meta('c1', 'Feeling distant', 'complete')),
    );
    const sessionsEndAndSummarize = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        insight: summarizeInsight,
        usage: summarizeInsight as never,
      }),
    );
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
      conversationsList: () =>
        Promise.resolve([
          { id: 'c1', title: 'Feeling distant', updatedAt: 'now', status: 'inProgress' },
        ]),
      conversationsGet: () =>
        Promise.resolve({
          id: 'c1',
          schemaVersion: 1,
          personId: 'p1',
          title: 'Feeling distant',
          createdAt: 'now',
          updatedAt: 'now',
          status: 'inProgress',
          messages: [
            { role: 'user', content: 'Thanks, that helps', ts: 'now' },
            { role: 'assistant', content: 'Glad to hear it.', ts: 'now' },
          ],
        }),
      sessionsSetStatus,
      sessionsEndAndSummarize,
    });
    setAiEnabled(true);
    renderSessions();
    await userEvent.click(await screen.findByRole('button', { name: 'Feeling distant' }));

    // The manual wrap-up button is offered for an in-progress session with messages.
    const wrapUp = await screen.findByRole('button', { name: 'Wrap up & reflect' });
    await userEvent.click(wrapUp);

    // It completes the session AND generates the summary (same as the ⋯ menu's complete & summarize).
    await waitFor(() =>
      expect(sessionsSetStatus).toHaveBeenCalledWith({ conversationId: 'c1', status: 'complete' }),
    );
    expect(sessionsEndAndSummarize).toHaveBeenCalledWith({ conversationId: 'c1' });
    expect(await screen.findByText('You named wanting more connection.')).toBeInTheDocument();
    // Once complete, the manual wrap-up button is gone (no lingering duplicate control).
    expect(screen.queryByRole('button', { name: 'Wrap up & reflect' })).not.toBeInTheDocument();
  });

  it('hides "Wrap up & reflect" when session memory is off', async () => {
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
      conversationsList: () =>
        Promise.resolve([
          { id: 'c1', title: 'Feeling distant', updatedAt: 'now', status: 'inProgress' },
        ]),
      conversationsGet: () =>
        Promise.resolve({
          id: 'c1',
          schemaVersion: 1,
          personId: 'p1',
          title: 'Feeling distant',
          createdAt: 'now',
          updatedAt: 'now',
          status: 'inProgress',
          messages: [{ role: 'user', content: 'hi', ts: 'now' }],
        }),
    });
    setAiEnabled(true);
    useSettingsStore.setState((state) => ({
      values: { ...state.values, 'sessions.memoryEnabled': false },
    }));
    renderSessions();
    await userEvent.click(await screen.findByRole('button', { name: 'Feeling distant' }));
    // The composer is present, but with memory off there's nothing to analyze → no wrap-up affordance.
    expect(await screen.findByLabelText('Message')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Wrap up & reflect' })).not.toBeInTheDocument();
  });
});
