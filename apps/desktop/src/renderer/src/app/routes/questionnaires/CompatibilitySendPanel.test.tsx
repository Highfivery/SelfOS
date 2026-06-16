import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Person } from '@shared/channels';
import { CompatibilitySendPanel } from './CompatibilitySendPanel';
import { useSessionStore } from '../../../stores/sessionStore';
import { useSettingsStore } from '../../../settings/settingsStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

const sender: Person = {
  id: 'sender',
  schemaVersion: 1,
  displayName: 'You',
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
};

afterEach(() => {
  clearMockBridge();
  useSettingsStore.setState({ values: {} });
  useSessionStore.setState({ activePerson: null });
});

const renderPanel = (onSent = vi.fn()): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <CompatibilitySendPanel
        questionnaireId="q1"
        title="Sexy time"
        visibility="sharedReport"
        recipientName="Angel"
        onCancel={() => {}}
        onSent={onSent}
      />
    </MemoryRouter>,
  );

describe('CompatibilitySendPanel (§17.12-B)', () => {
  it('has NO participant picker — it compares you + the bound recipient and shows their disclosure', async () => {
    installMockBridge({ secretHas: () => Promise.resolve(true) });
    useSettingsStore.setState({ values: { 'ai.enabled': true } });
    useSessionStore.setState({ activePerson: sender });
    renderPanel();

    // No "Who's being compared?" / "Someone else" / "two other people" pickers anymore (§17.12-B).
    expect(await screen.findByText(/compares/i)).toHaveTextContent(/Angel/);
    expect(screen.queryByLabelText("Who's being compared?")).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Someone else')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('First person')).not.toBeInTheDocument();
    // The recipient's disclosure is previewed (the honesty guard).
    expect(screen.getByText(/Angel will be told/i)).toBeInTheDocument();
  });

  it('sends with no participant ids — the bridge derives sender + the bound recipient', async () => {
    const assignmentsCreateCompatibility = vi.fn(() =>
      Promise.resolve({ ok: true as const, compatibilityGroupId: 'g1' }),
    );
    installMockBridge({ secretHas: () => Promise.resolve(true), assignmentsCreateCompatibility });
    useSettingsStore.setState({ values: { 'ai.enabled': true } });
    useSessionStore.setState({ activePerson: sender });
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: /Send/ }));
    // Exact match proves no participant ids are passed — the bridge derives sender + the bound recipient.
    await waitFor(() =>
      expect(assignmentsCreateCompatibility).toHaveBeenCalledWith({ questionnaireId: 'q1' }),
    );
  });

  it('shows a calm enable-AI state when AI is off', async () => {
    installMockBridge({ secretHas: () => Promise.resolve(false) });
    useSessionStore.setState({ activePerson: sender });
    renderPanel();
    expect(await screen.findByText(/need AI to personalize/)).toBeInTheDocument();
  });
});
