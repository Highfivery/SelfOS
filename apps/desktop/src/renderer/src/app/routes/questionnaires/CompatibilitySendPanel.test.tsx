import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Person } from '@shared/channels';
import { CompatibilitySendPanel } from './CompatibilitySendPanel';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useSettingsStore } from '../../../settings/settingsStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

const person = (id: string, displayName: string): Person => ({
  id,
  schemaVersion: 1,
  displayName,
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
});

const sender = person('sender', 'You');
const angel = person('angel', 'Angel');
const bri = person('bri', 'Bri');

afterEach(() => {
  clearMockBridge();
  useSettingsStore.setState({ values: {} });
  useSessionStore.setState({ activePerson: null });
  usePeopleStore.setState({ people: [], relationships: [], loaded: false });
});

const setup = (): void => {
  useSettingsStore.setState({ values: { 'ai.enabled': true } });
  useSessionStore.setState({ activePerson: sender });
  usePeopleStore.setState({ people: [sender, angel, bri], relationships: [], loaded: true });
};

const renderPanel = (onSent = vi.fn()): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <CompatibilitySendPanel
        questionnaireId="q1"
        title="Sexy time"
        visibility="sharedReport"
        onCancel={() => {}}
        onSent={onSent}
      />
    </MemoryRouter>,
  );

describe('CompatibilitySendPanel (§16.1)', () => {
  it('defaults to "you + someone else" with the sender pre-selected, and previews the partner disclosure', async () => {
    installMockBridge({ secretHas: () => Promise.resolve(true) });
    setup();
    renderPanel();

    // The default mode is you+someone-else; the sender is locked in as "You".
    expect(await screen.findByText('Someone else')).toBeInTheDocument();
    expect(screen.queryByText('First person')).not.toBeInTheDocument();

    // Picking the partner shows the disclosure they'll see — naming the sender as the other participant
    // ("neither you nor You"), never as a neutral third party.
    await userEvent.selectOptions(screen.getByLabelText('Someone else'), 'angel');
    expect(await screen.findByText(/neither you nor You/)).toBeInTheDocument();
  });

  it('sends the sender + partner as the two participants', async () => {
    const assignmentsCreateCompatibility = vi.fn(() =>
      Promise.resolve({ ok: true as const, compatibilityGroupId: 'g1' }),
    );
    installMockBridge({ secretHas: () => Promise.resolve(true), assignmentsCreateCompatibility });
    setup();
    renderPanel();

    await userEvent.selectOptions(await screen.findByLabelText('Someone else'), 'angel');
    await userEvent.click(screen.getByRole('button', { name: /Send/ }));
    await waitFor(() =>
      expect(assignmentsCreateCompatibility).toHaveBeenCalledWith({
        questionnaireId: 'q1',
        participantPersonIdA: 'sender',
        participantPersonIdB: 'angel',
      }),
    );
  });

  it('switches to "two other people" and excludes the sender from both pickers', async () => {
    const assignmentsCreateCompatibility = vi.fn(() =>
      Promise.resolve({ ok: true as const, compatibilityGroupId: 'g1' }),
    );
    installMockBridge({ secretHas: () => Promise.resolve(true), assignmentsCreateCompatibility });
    setup();
    renderPanel();

    await userEvent.selectOptions(await screen.findByLabelText("Who's being compared?"), 'others');
    const first = screen.getByLabelText('First person');
    // The sender ("You") is never an option in two-others mode.
    expect(within(first).queryByRole('option', { name: 'You' })).not.toBeInTheDocument();
    await userEvent.selectOptions(first, 'angel');
    await userEvent.selectOptions(screen.getByLabelText('Second person'), 'bri');
    await userEvent.click(screen.getByRole('button', { name: /Send/ }));
    await waitFor(() =>
      expect(assignmentsCreateCompatibility).toHaveBeenCalledWith({
        questionnaireId: 'q1',
        participantPersonIdA: 'angel',
        participantPersonIdB: 'bri',
      }),
    );
  });

  it('shows a calm enable-AI state when AI is off', async () => {
    installMockBridge({ secretHas: () => Promise.resolve(false) });
    useSessionStore.setState({ activePerson: sender });
    usePeopleStore.setState({ people: [sender, angel], relationships: [], loaded: true });
    renderPanel();
    expect(await screen.findByText(/need AI to personalize/)).toBeInTheDocument();
  });
});
