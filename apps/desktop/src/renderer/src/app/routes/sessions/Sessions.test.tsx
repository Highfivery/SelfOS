import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '../../../settings/builtins';
import { Sessions } from './Sessions';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';
import { useConversationStore } from '../../../stores/conversationStore';
import { useSettingsStore } from '../../../settings/settingsStore';

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
  useConversationStore.setState({
    conversations: [],
    activeId: null,
    messages: [],
    streaming: '',
    sending: false,
    runningCostUsd: 0,
    budget: null,
    error: null,
  });
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
        Promise.resolve([{ id: 'c1', title: 'Old title', updatedAt: 'now' }]),
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
});
