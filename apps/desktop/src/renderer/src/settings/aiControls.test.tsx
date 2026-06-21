import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ApiKeyControl,
  OpenAiKeyControl,
  OpenAiTestConnectionControl,
  TestConnectionControl,
} from './aiControls';
import { ANTHROPIC_API_KEY_ID, OPENAI_API_KEY_ID } from '@shared/channels';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';
import { useSessionStore } from '../stores/sessionStore';
import type { AccessView, Person } from '@shared/channels';

const sharedStatus = {
  hasSharedKey: true,
  hasDeviceOverride: false,
  resolvedReady: true,
  source: 'shared' as const,
};
const deviceStatus = {
  hasSharedKey: false,
  hasDeviceOverride: true,
  resolvedReady: true,
  source: 'device' as const,
};

/** Make the session store report the active person as the household Owner (settings.manage). */
function signInAsOwner(): void {
  useSessionStore.setState({
    activePerson: { id: 'owner-1', displayName: 'Ben' } as unknown as Person,
    access: {
      roles: [{ id: 'owner', label: 'Owner', capabilities: {} }],
      accounts: [{ personId: 'owner-1', roleId: 'owner', hasPin: false }],
    } as unknown as AccessView,
  });
}

afterEach(() => {
  clearMockBridge();
  useSessionStore.setState({ activePerson: null, access: null });
});

describe('ApiKeyControl', () => {
  it('shows configured status and a Clear action when a key exists', async () => {
    installMockBridge({ secretHas: () => Promise.resolve(true) });
    render(<ApiKeyControl />);
    await waitFor(() => expect(screen.getByText(/key is configured/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
  });

  it('saves a typed key via the bridge without exposing it', async () => {
    const secretSet = vi.fn(() => Promise.resolve());
    installMockBridge({ secretHas: () => Promise.resolve(false), secretSet });
    render(<ApiKeyControl />);
    await userEvent.type(screen.getByLabelText('Claude API key'), 'sk-ant-xyz');
    await userEvent.click(screen.getByRole('button', { name: /save key/i }));
    expect(secretSet).toHaveBeenCalledWith({ id: ANTHROPIC_API_KEY_ID, value: 'sk-ant-xyz' });
  });
});

describe('ApiKeyControl — household sharing (25)', () => {
  it('owner with a device key can share it with the household', async () => {
    const aiShareDeviceKey = vi.fn(() => Promise.resolve());
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () => Promise.resolve(deviceStatus),
      aiShareDeviceKey,
    });
    signInAsOwner();
    render(<ApiKeyControl />);
    await userEvent.click(await screen.findByRole('button', { name: /share with the household/i }));
    expect(aiShareDeviceKey).toHaveBeenCalledWith({ provider: 'anthropic' });
  });

  it('member inherits the household key and can opt into their own', async () => {
    installMockBridge({
      secretHas: () => Promise.resolve(false),
      aiKeyStatus: () => Promise.resolve(sharedStatus),
    });
    render(<ApiKeyControl />); // not signed in as owner → member view
    expect(await screen.findByText(/provided by your household/i)).toBeInTheDocument();
    // No owner-only "Share" control for a member.
    expect(screen.queryByRole('button', { name: /share with the household/i })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /use my own key instead/i }));
    expect(screen.getByLabelText('Claude API key')).toBeInTheDocument();
  });
});

describe('OpenAiKeyControl', () => {
  it('saves a typed OpenAI key under the OpenAI secret id, write-only', async () => {
    const secretSet = vi.fn(() => Promise.resolve());
    installMockBridge({ secretHas: () => Promise.resolve(false), secretSet });
    render(<OpenAiKeyControl />);
    await userEvent.type(screen.getByLabelText('OpenAI API key'), 'sk-openai-xyz');
    await userEvent.click(screen.getByRole('button', { name: /save key/i }));
    expect(secretSet).toHaveBeenCalledWith({ id: OPENAI_API_KEY_ID, value: 'sk-openai-xyz' });
  });
});

describe('TestConnectionControl', () => {
  it('reports a successful connection', async () => {
    installMockBridge({ claudeTest: () => Promise.resolve({ ok: true, text: 'ok' }) });
    render(<TestConnectionControl />);
    await userEvent.click(screen.getByRole('button', { name: /test connection/i }));
    await waitFor(() => expect(screen.getByText('Connected')).toBeInTheDocument());
  });

  it('surfaces the error message on failure', async () => {
    installMockBridge({
      claudeTest: () => Promise.resolve({ ok: false, code: 'AUTH', message: 'Key rejected.' }),
    });
    render(<TestConnectionControl />);
    await userEvent.click(screen.getByRole('button', { name: /test connection/i }));
    await waitFor(() => expect(screen.getByText('Key rejected.')).toBeInTheDocument());
  });

  it('OpenAI test maps a failure message (33 §5.B)', async () => {
    installMockBridge({
      openaiTest: () =>
        Promise.resolve({ ok: false, code: 'AUTH', message: 'That OpenAI key was rejected.' }),
    });
    render(<OpenAiTestConnectionControl />);
    await userEvent.click(screen.getByRole('button', { name: /test connection/i }));
    await waitFor(() =>
      expect(screen.getByText('That OpenAI key was rejected.')).toBeInTheDocument(),
    );
  });
});
