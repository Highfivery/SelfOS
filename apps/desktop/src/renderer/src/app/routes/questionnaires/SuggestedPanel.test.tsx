import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { QuestionnaireSuggestResult } from '@shared/schemas';
import { SuggestedPanel } from './SuggestedPanel';
import { useSettingsStore } from '../../../settings/settingsStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

afterEach(() => {
  clearMockBridge();
  useSettingsStore.setState({ values: {} });
});

/** Mount the panel with AI ready (enabled + a resolved key) and a stubbed gap-finder result. */
function renderReady(result: QuestionnaireSuggestResult): void {
  useSettingsStore.setState({ values: { 'ai.enabled': true } });
  installMockBridge({
    aiKeyStatus: () =>
      Promise.resolve({
        hasSharedKey: false,
        hasDeviceOverride: true,
        resolvedReady: true,
        source: 'device' as const,
      }),
    gapfinderSuggest: () => Promise.resolve(result),
  });
  render(
    <MemoryRouter>
      <SuggestedPanel onCreate={() => {}} />
    </MemoryRouter>,
  );
}

describe('SuggestedPanel', () => {
  it('renders the returned suggestions (incl. ones whose questions omitted `required`)', async () => {
    renderReady({
      ok: true,
      suggestions: [
        {
          title: 'Weekly partner check-in',
          type: 'role-feedback',
          rationale: 'You value quality time.',
          questions: [{ type: 'rating', prompt: 'How connected this week?' }], // no `required`
        },
      ],
    });
    const button = await screen.findByRole('button', { name: /suggest questionnaires/i });
    await userEvent.click(button);
    expect(await screen.findByText('Weekly partner check-in')).toBeInTheDocument();
    expect(screen.getByText('How connected this week?')).toBeInTheDocument();
  });

  it('renders an honest failure message (never a data blame) when the model output is unusable', async () => {
    renderReady({
      ok: false,
      reason: 'MALFORMED',
      message: 'The suggestions came back in an unexpected shape. Please try again.',
    });
    const button = await screen.findByRole('button', { name: /suggest questionnaires/i });
    await userEvent.click(button);
    expect(await screen.findByText(/came back in an unexpected shape/i)).toBeInTheDocument();
    expect(screen.queryByText(/add more about the people/i)).not.toBeInTheDocument();
  });

  it('shows the calm enable-AI state (no error) when AI is off', async () => {
    installMockBridge();
    render(
      <MemoryRouter>
        <SuggestedPanel onCreate={() => {}} />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByText(/turn on ai in settings to get suggestions/i)).toBeInTheDocument(),
    );
  });
});
