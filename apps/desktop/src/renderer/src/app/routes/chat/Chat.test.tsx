import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '../../../settings/builtins';
import { Chat } from './Chat';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';
import { useConversationStore } from '../../../stores/conversationStore';
import { useSettingsStore } from '../../../settings/settingsStore';

function setAiEnabled(enabled: boolean): void {
  useSettingsStore.setState((state) => ({ values: { ...state.values, 'ai.enabled': enabled } }));
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

describe('Chat', () => {
  it('prompts to set up AI when not configured (crisis footer still present)', async () => {
    installMockBridge({ secretHas: () => Promise.resolve(false) });
    setAiEnabled(false);
    render(<Chat />);
    expect(await screen.findByText('Connect Claude to start')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /get help now/i })).toBeInTheDocument();
  });

  it('sends a message and shows the reply', async () => {
    installMockBridge({ secretHas: () => Promise.resolve(true) });
    setAiEnabled(true);
    render(<Chat />);
    await waitFor(() => expect(screen.getByLabelText('Message')).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText('Message'), 'I had a hard day');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByText('I hear you.')).toBeInTheDocument());
    expect(screen.getByText('I had a hard day')).toBeInTheDocument();
  });

  it('expands crisis resources', async () => {
    installMockBridge({ secretHas: () => Promise.resolve(true) });
    setAiEnabled(true);
    render(<Chat />);
    await userEvent.click(screen.getByRole('button', { name: /get help now/i }));
    expect(screen.getByText(/988/)).toBeInTheDocument();
  });
});
