import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RelayMessagesControl } from './RelayMessagesControl';
import { registerBuiltinSettings } from './builtins';
import { useSettingsStore } from './settingsStore';
import { DEFAULT_RELAY_MESSAGES } from '../app/routes/questionnaires/relayMessages';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';

// Persisting an edit needs the setting registered so the store finds its definition + schema.
beforeAll(() => registerBuiltinSettings());

afterEach(() => {
  clearMockBridge();
  useSettingsStore.setState({ values: {} });
});

describe('RelayMessagesControl', () => {
  it('renders the three templates seeded from the setting', () => {
    installMockBridge();
    useSettingsStore.setState({
      values: { 'questionnaires.defaultMessages': DEFAULT_RELAY_MESSAGES },
    });
    render(<RelayMessagesControl />);
    expect(screen.getByLabelText('Email subject')).toHaveValue(DEFAULT_RELAY_MESSAGES.emailSubject);
    expect(screen.getByLabelText('Email message')).toHaveValue(DEFAULT_RELAY_MESSAGES.emailBody);
    expect(screen.getByLabelText('Text message')).toHaveValue(DEFAULT_RELAY_MESSAGES.smsBody);
  });

  it('edits the email subject and persists it through the settings store', async () => {
    installMockBridge();
    useSettingsStore.setState({
      values: { 'questionnaires.defaultMessages': DEFAULT_RELAY_MESSAGES },
    });
    render(<RelayMessagesControl />);
    const subject = screen.getByLabelText('Email subject');
    await userEvent.clear(subject);
    await userEvent.type(subject, 'A quick note for you');
    await waitFor(() =>
      expect(
        (
          useSettingsStore.getState().values['questionnaires.defaultMessages'] as {
            emailSubject: string;
          }
        ).emailSubject,
      ).toBe('A quick note for you'),
    );
  });

  it('resets to the defaults', async () => {
    installMockBridge();
    useSettingsStore.setState({
      values: {
        'questionnaires.defaultMessages': { ...DEFAULT_RELAY_MESSAGES, smsBody: 'changed' },
      },
    });
    render(<RelayMessagesControl />);
    await userEvent.click(screen.getByRole('button', { name: /reset to defaults/i }));
    await waitFor(() =>
      expect(useSettingsStore.getState().values['questionnaires.defaultMessages']).toEqual(
        DEFAULT_RELAY_MESSAGES,
      ),
    );
  });
});
