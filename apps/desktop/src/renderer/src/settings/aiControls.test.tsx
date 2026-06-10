import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiKeyControl, TestConnectionControl } from './aiControls';
import { ANTHROPIC_API_KEY_ID } from '@shared/channels';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';

afterEach(() => clearMockBridge());

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
});
