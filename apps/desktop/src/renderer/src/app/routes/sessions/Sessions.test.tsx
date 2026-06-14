import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '../../../settings/builtins';
import { Sessions } from './Sessions';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';
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
  useSessionStore.setState({ superAdmin: false });
  setAiEnabled(false);
});

describe('Sessions', () => {
  it('prompts to set up AI when not configured, with a Settings shortcut + crisis footer', async () => {
    installMockBridge({ secretHas: () => Promise.resolve(false) });
    setAiEnabled(false);
    renderSessions();
    expect(await screen.findByText('Connect Claude to start')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /get help now/i })).toBeInTheDocument();
  });

  it('sends a message and shows the reply', async () => {
    installMockBridge({ secretHas: () => Promise.resolve(true) });
    setAiEnabled(true);
    renderSessions();
    await waitFor(() => expect(screen.getByLabelText('Message')).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText('Message'), 'I had a hard day');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByText('I hear you.')).toBeInTheDocument());
    expect(screen.getByText('I had a hard day')).toBeInTheDocument();
  });

  it('renames a conversation', async () => {
    const conversationsRename = vi.fn(() => Promise.resolve());
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      conversationsList: () =>
        Promise.resolve([
          { id: 'c1', title: 'Old title', updatedAt: 'now', status: 'inProgress' as const },
        ]),
      conversationsRename,
    });
    setAiEnabled(true);
    renderSessions();
    await userEvent.click(await screen.findByRole('button', { name: 'Rename Old title' }));
    const input = screen.getByLabelText('Session title');
    await userEvent.clear(input);
    await userEvent.type(input, 'New title{Enter}');
    await waitFor(() =>
      expect(conversationsRename).toHaveBeenCalledWith({ id: 'c1', title: 'New title' }),
    );
  });

  it('expands crisis resources', async () => {
    installMockBridge({ secretHas: () => Promise.resolve(true) });
    setAiEnabled(true);
    renderSessions();
    await userEvent.click(screen.getByRole('button', { name: /get help now/i }));
    expect(screen.getByText(/988/)).toBeInTheDocument();
  });

  it('shows status pills and filters the list by status', async () => {
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      conversationsList: () =>
        Promise.resolve([meta('c1', 'Active one'), meta('c2', 'Done one', 'complete')]),
    });
    setAiEnabled(true);
    renderSessions();

    expect(await screen.findByRole('button', { name: 'Active one' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done one' })).toBeInTheDocument();
    // Status pills (plus the matching filter buttons) render their state as text, not colour alone.
    expect(screen.getAllByText('In progress').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Complete').length).toBeGreaterThanOrEqual(1);

    // Filter to Complete → the in-progress session drops out.
    await userEvent.click(screen.getByRole('button', { name: 'Complete' }));
    expect(screen.queryByRole('button', { name: 'Active one' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done one' })).toBeInTheDocument();
  });

  it('sets a session status from the per-item menu', async () => {
    const sessionsSetStatus = vi.fn(() => Promise.resolve(meta('c1', 'Active one', 'onHold')));
    installMockBridge({
      secretHas: () => Promise.resolve(true),
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
      conversationsList: () => Promise.resolve([meta('c1', 'Active one')]),
      usageSessionCosts: () => Promise.resolve(costs),
    });
    setAiEnabled(true);

    // Admin: dollars + the Admin only badge.
    useSessionStore.setState({ superAdmin: true });
    renderSessions();
    expect(await screen.findByText('$0.42')).toBeInTheDocument();
    expect(screen.getByText('Admin only')).toBeInTheDocument();
  });

  it('hides the $ from a non-admin, showing only a budget bar', async () => {
    const costs: Record<string, SessionCost> = { c1: { tokens: 1200, budgetRatio: 0.1 } };
    installMockBridge({
      secretHas: () => Promise.resolve(true),
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
      approved: true,
      provenance: { conversationId: 'c1', at: 'now' },
      createdAt: 'now',
      updatedAt: 'now',
    };
    installMockBridge({
      secretHas: () => Promise.resolve(true),
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
});
