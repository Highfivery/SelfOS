import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { SendResult } from '@shared/schemas';
import { QuestionnaireResults } from './QuestionnaireResults';
import { useResultsStore } from '../../../stores/resultsStore';
import { useSettingsStore } from '../../../settings/settingsStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

const renderResults = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <QuestionnaireResults questionnaireId="q1" />
    </MemoryRouter>,
  );

afterEach(() => {
  clearMockBridge();
  useResultsStore.setState({ questionnaireId: null, results: [], loaded: false, loading: false });
  useSettingsStore.setState({ values: {} });
});

/** Turn AI on (flag + a stubbed key) so the Analyze action is offered. */
function enableAi(): void {
  useSettingsStore.setState({ values: { 'ai.enabled': true } });
}

const send = (over: Partial<SendResult> = {}): SendResult => ({
  assignmentId: 'a1',
  recipientName: 'Mara',
  status: 'submitted',
  privacy: 'standard',
  createdAt: 'now',
  analyzed: false,
  ...over,
});

describe('QuestionnaireResults', () => {
  it('shows the empty state when nothing has been sent', async () => {
    installMockBridge({ assignmentsResults: () => Promise.resolve([]) });
    renderResults();
    expect(await screen.findByText(/haven’t sent this questionnaire yet/i)).toBeInTheDocument();
  });

  it('shows the raw answers for a Standard, submitted send', async () => {
    enableAi();
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      assignmentsResults: () =>
        Promise.resolve([
          send({ answers: [{ prompt: 'How are we doing?', answer: 'Doing great' }] }),
        ]),
    });
    renderResults();
    expect(await screen.findByText('How are we doing?')).toBeInTheDocument();
    expect(screen.getByText('Doing great')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /analyze/i })).toBeInTheDocument();
  });

  it('hides raw answers for a Private send, offering only Analyze', async () => {
    enableAi();
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      assignmentsResults: () => Promise.resolve([send({ privacy: 'private' })]),
    });
    renderResults();
    expect(await screen.findByText(/raw responses stay hidden/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /analyze/i })).toBeInTheDocument();
  });

  it('links an already-analyzed send to Memory instead of Analyze', async () => {
    enableAi();
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      assignmentsResults: () => Promise.resolve([send({ privacy: 'private', analyzed: true })]),
    });
    renderResults();
    expect(await screen.findByText(/insight drafted from this response/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /review it in memory/i })).toHaveAttribute(
      'href',
      '/memory',
    );
    expect(screen.queryByRole('button', { name: /analyze/i })).not.toBeInTheDocument();
  });

  it('analyzes a response and confirms with a Memory pointer', async () => {
    enableAi();
    let analyzed = false;
    const insightsAnalyze = vi.fn(() => {
      analyzed = true;
      return Promise.resolve({ ok: true as const });
    });
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      insightsAnalyze,
      assignmentsResults: () => Promise.resolve([send({ privacy: 'private', analyzed })]),
    });
    renderResults();

    await userEvent.click(await screen.findByRole('button', { name: /analyze/i }));
    expect(insightsAnalyze).toHaveBeenCalledWith({ assignmentId: 'a1' });
    // After analyze, the reload reports analyzed → the card collapses to the Memory pointer.
    expect(await screen.findByText(/insight drafted from this response/i)).toBeInTheDocument();
  });

  it('prompts to turn on AI when it is off, with no Analyze action', async () => {
    installMockBridge({
      assignmentsResults: () => Promise.resolve([send()]),
    });
    renderResults();
    await waitFor(() => expect(screen.getByText(/turn on ai/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /analyze/i })).not.toBeInTheDocument();
  });

  it('does not mislabel a Standard send as private when its answers fail to load', async () => {
    installMockBridge({
      // Standard + submitted but no answers (a rare missing/corrupt response) → a neutral message.
      assignmentsResults: () => Promise.resolve([send({ privacy: 'standard' })]),
    });
    renderResults();
    expect(await screen.findByText(/couldn’t load these answers/i)).toBeInTheDocument();
    expect(screen.queryByText(/raw responses stay hidden/i)).not.toBeInTheDocument();
  });

  it('shows a declined send with its note', async () => {
    installMockBridge({
      assignmentsResults: () =>
        Promise.resolve([send({ status: 'declined', declineNote: 'Not now' })]),
    });
    renderResults();
    expect(await screen.findByText(/Not now/)).toBeInTheDocument();
  });
});
