import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Dream, DreamAnalysis } from '@shared/channels';
import { Dreams } from './Dreams';
import { DreamAnalysisPane } from './DreamAnalysisPane';
import { useDreamStore } from '../../../stores/dreamStore';
import { useDreamAnalysisStore } from '../../../stores/dreamAnalysisStore';
import { useSettingsStore } from '../../../settings/settingsStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

afterEach(() => {
  clearMockBridge();
  useDreamStore.setState({ dreams: [], loaded: false });
  useDreamAnalysisStore.getState().reset();
  useSettingsStore.setState((s) => ({ values: { ...s.values, 'ai.enabled': false } }));
});

const baseDream: Dream = {
  id: 'd1',
  schemaVersion: 1,
  personId: 'owner-1',
  narrative: 'I was flying over snowy mountains.',
  lucid: false,
  nightmare: false,
  tags: [],
  people: [],
  sensitivity: 'standard',
  status: 'captured',
  createdAt: '2026-06-11T00:00:00.000Z',
  updatedAt: '2026-06-11T00:00:00.000Z',
};

const analysisFixture: DreamAnalysis = {
  id: 'a1',
  schemaVersion: 1,
  dreamId: 'd1',
  personId: 'owner-1',
  summary: 'A dream of flight.',
  emotionalLandscape: 'Freedom and lightness.',
  wakingLifeConnections: 'A wish for release.',
  notableImages: 'Open sky as possibility.',
  reflectiveQuestions: ['Where do you long for more freedom?'],
  coachingPrompt: 'Take one small leap today.',
  tags: { emotions: [], symbols: [], settings: [], themes: [], people: [] },
  edited: false,
  generatedAt: 'now',
  updatedAt: 'now',
};

/** Turn AI on (enabled + a stored key present) for the analysis-bearing surfaces. */
function enableAi(): void {
  useSettingsStore.setState((s) => ({
    values: { ...s.values, 'ai.enabled': true, 'dreams.memoryEnabled': true },
  }));
}

function renderPane(dream: Dream = baseDream): { onBack: ReturnType<typeof vi.fn> } {
  const onBack = vi.fn();
  render(
    <MemoryRouter>
      <DreamAnalysisPane dream={dream} onBack={onBack} />
    </MemoryRouter>,
  );
  return { onBack };
}

describe('Dreams analysis UI', () => {
  it('shows a status-aware analyze entry on a saved dream', async () => {
    installMockBridge({
      dreamsList: () => Promise.resolve([{ ...baseDream, status: 'analyzed' }]),
    });
    render(
      <MemoryRouter>
        <Dreams />
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByText(/i was flying/i));
    expect(screen.getByRole('button', { name: /view analysis/i })).toBeInTheDocument();
  });

  it('shows a calm connect-Claude state when AI is off, never blocking the journal', async () => {
    installMockBridge({ secretHas: () => Promise.resolve(false) });
    renderPane();
    expect(await screen.findByText(/connect claude to analyze/i)).toBeInTheDocument();
    // No chat composer or synthesize action when unconfigured.
    expect(screen.queryByRole('button', { name: 'Create analysis' })).not.toBeInTheDocument();
  });

  it('runs a guided turn and shows the streamed reply', async () => {
    enableAi();
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      dreamGetAnalysis: () => Promise.resolve(null),
    });
    renderPane();
    const input = await screen.findByLabelText('Message');
    await userEvent.type(input, 'It felt freeing.');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('It felt freeing.')).toBeInTheDocument();
    expect(await screen.findByText(/tell me more about how it felt/i)).toBeInTheDocument();
  });

  it('synthesizes the dream into a structured analysis card', async () => {
    enableAi();
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      dreamGetAnalysis: () => Promise.resolve(null),
    });
    renderPane();
    await userEvent.click(await screen.findByRole('button', { name: 'Create analysis' }));
    expect(await screen.findByText('Your dream analysis')).toBeInTheDocument();
    expect(screen.getByText('A dream of shifting rooms.')).toBeInTheDocument();
  });

  it('edits a section and saves the change', async () => {
    enableAi();
    const update = vi.fn((input: { dreamId: string; edits: { summary?: string } }) =>
      Promise.resolve({ ...analysisFixture, summary: input.edits.summary ?? '', edited: true }),
    );
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      dreamGetAnalysis: () => Promise.resolve(analysisFixture),
      dreamUpdateAnalysis: update,
    });
    renderPane();
    await screen.findByText('A dream of flight.');
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const summaryField = screen.getByLabelText('Summary');
    await userEvent.clear(summaryField);
    await userEvent.type(summaryField, 'My own retelling.');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        dreamId: 'd1',
        edits: expect.objectContaining({ summary: 'My own retelling.' }),
      }),
    );
  });

  it('approves an analysis into the coaching context and shows the badge', async () => {
    enableAi();
    const approve = vi.fn(() => Promise.resolve({ ok: true as const, insightId: 'i1' }));
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      dreamGetAnalysis: () => Promise.resolve(analysisFixture),
      dreamApprove: approve,
    });
    renderPane();
    await screen.findByText('A dream of flight.');
    await userEvent.click(screen.getByRole('button', { name: /add to my coaching context/i }));
    expect(approve).toHaveBeenCalledWith({ dreamId: 'd1' });
    expect(await screen.findByText(/in your coaching context/i)).toBeInTheDocument();
  });

  it('removes an approved analysis from context', async () => {
    enableAi();
    const remove = vi.fn(() => Promise.resolve());
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      dreamGetAnalysis: () => Promise.resolve({ ...analysisFixture, insightId: 'i1' }),
      dreamRemoveFromContext: remove,
    });
    renderPane();
    expect(await screen.findByText(/in your coaching context/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /remove from context/i }));
    expect(remove).toHaveBeenCalledWith({ dreamId: 'd1' });
    await waitFor(() =>
      expect(screen.queryByText(/in your coaching context/i)).not.toBeInTheDocument(),
    );
  });

  it('disables Approve with a hint when dream memory is off', async () => {
    useSettingsStore.setState((s) => ({
      values: { ...s.values, 'ai.enabled': true, 'dreams.memoryEnabled': false },
    }));
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      dreamGetAnalysis: () => Promise.resolve(analysisFixture),
    });
    renderPane();
    await screen.findByText('A dream of flight.');
    expect(screen.getByRole('button', { name: /add to my coaching context/i })).toBeDisabled();
    expect(screen.getByText(/turn on dream memory in settings/i)).toBeInTheDocument();
  });

  it('re-approves on edit when the analysis already feeds the coaching context', async () => {
    enableAi();
    const approved = { ...analysisFixture, insightId: 'i1' };
    const approve = vi.fn(() => Promise.resolve({ ok: true as const, insightId: 'i1' }));
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      dreamGetAnalysis: () => Promise.resolve(approved),
      // updateAnalysis preserves the insightId (as the core does), so the store re-approves to keep
      // the coaching context in sync with the edit.
      dreamUpdateAnalysis: (input: { dreamId: string; edits: { summary?: string } }) =>
        Promise.resolve({
          ...approved,
          summary: input.edits.summary ?? approved.summary,
          edited: true,
        }),
      dreamApprove: approve,
    });
    renderPane();
    await screen.findByText(/in your coaching context/i); // it starts approved
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const summaryField = screen.getByLabelText('Summary');
    await userEvent.clear(summaryField);
    await userEvent.type(summaryField, 'Refined wording.');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(approve).toHaveBeenCalledWith({ dreamId: 'd1' }));
  });
});
