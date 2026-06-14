import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Dream, DreamAnalysis, Insight } from '@shared/channels';
import { DreamShareControls } from './DreamShareControls';
import { DreamAnalysisPane } from './DreamAnalysisPane';
import { useDreamAnalysisStore } from '../../../stores/dreamAnalysisStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useSettingsStore } from '../../../settings/settingsStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

afterEach(() => {
  clearMockBridge();
  useDreamAnalysisStore.getState().reset();
  useSessionStore.setState({ superAdmin: false });
  useSettingsStore.setState((s) => ({ values: { ...s.values, 'ai.enabled': false } }));
});

const baseDream: Dream = {
  id: 'd1',
  schemaVersion: 1,
  personId: 'owner-1',
  narrative: 'A dream about my partner.',
  lucid: false,
  nightmare: false,
  tags: [],
  people: [],
  sensitivity: 'standard',
  status: 'analyzed',
  analysisId: 'a1',
  createdAt: 'now',
  updatedAt: 'now',
};

const approvedAnalysis: DreamAnalysis = {
  id: 'a1',
  schemaVersion: 1,
  dreamId: 'd1',
  personId: 'owner-1',
  summary: 'A dream of home.',
  emotionalLandscape: 'Tender.',
  wakingLifeConnections: 'A wish to protect.',
  notableImages: 'The house.',
  reflectiveQuestions: [],
  tags: { emotions: [], symbols: [], settings: [], themes: [], people: [] },
  edited: false,
  insightId: 'i1',
  generatedAt: 'now',
  updatedAt: 'now',
};

const insightFixture: Insight = {
  id: 'i1',
  schemaVersion: 1,
  source: 'dream',
  subjectPersonId: 'owner-1',
  summary: 'A dream of home.',
  facts: [
    { id: 'f1', text: 'Feels protective of their partner.', shareable: false },
    { id: 'f2', text: 'Unsettled by change.', shareable: false },
  ],
  confidence: 'medium',
  approved: true,
  provenance: { dreamId: 'd1', at: 'now' },
  createdAt: 'now',
  updatedAt: 'now',
};

const partner = [{ id: 'p2', displayName: 'Partner' }];

describe('DreamShareControls', () => {
  it('renders facts with toggles; toggling calls onSetShare for the selected person', async () => {
    const onSetShare = vi.fn();
    render(
      <DreamShareControls facts={insightFixture.facts} targets={partner} onSetShare={onSetShare} />,
    );
    expect(screen.getByText('Feels protective of their partner.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: /feels protective/i }));
    expect(onSetShare).toHaveBeenCalledWith('f1', 'p2', true);
  });

  it('shows who a fact is already shared with', () => {
    const facts = [
      { id: 'f1', text: 'A shared reflection.', shareable: false, shareableWith: ['p2'] },
    ];
    render(<DreamShareControls facts={facts} targets={partner} onSetShare={vi.fn()} />);
    expect(screen.getByText(/shared with partner/i)).toBeInTheDocument();
  });

  it('renders nothing when there are no related people to share with', () => {
    const { container } = render(
      <DreamShareControls facts={insightFixture.facts} targets={[]} onSetShare={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

function renderPane(dream: Dream = baseDream): void {
  render(
    <MemoryRouter>
      <DreamAnalysisPane dream={dream} onBack={vi.fn()} />
    </MemoryRouter>,
  );
}

describe('DreamAnalysisPane sharing', () => {
  it('shows the share controls on an approved, standard dream and toggles a fact', async () => {
    useSessionStore.setState({ superAdmin: true }); // grants dreams.shareContext
    const setShare = vi.fn(() => Promise.resolve({ ok: true as const }));
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      dreamGetAnalysis: () => Promise.resolve(approvedAnalysis),
      dreamGetInsight: () => Promise.resolve(insightFixture),
      dreamShareTargets: () => Promise.resolve(partner),
      dreamSetFactShare: setShare,
    });
    renderPane();
    await screen.findByText('Share with someone in your life');
    await userEvent.click(screen.getByRole('switch', { name: /feels protective/i }));
    expect(setShare).toHaveBeenCalledWith({
      dreamId: 'd1',
      factId: 'f1',
      withPersonId: 'p2',
      share: true,
    });
  });

  it('now shows share controls for a SENSITIVE dream when informsContext is on (15 §3.2)', async () => {
    useSessionStore.setState({ superAdmin: true });
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      dreamGetAnalysis: () => Promise.resolve(approvedAnalysis),
      dreamGetInsight: () => Promise.resolve(insightFixture),
      dreamShareTargets: () => Promise.resolve(partner),
    });
    renderPane({ ...baseDream, sensitivity: 'explicit' }); // informsContext undefined ⇒ on
    expect(await screen.findByText('Share with someone in your life')).toBeInTheDocument();
  });

  it('hides sharing with a private-journal note when informsContext is off', async () => {
    useSessionStore.setState({ superAdmin: true });
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      dreamGetAnalysis: () => Promise.resolve(approvedAnalysis),
      dreamGetInsight: () => Promise.resolve(null), // a muted dream returns no insight
      dreamShareTargets: () => Promise.resolve(partner),
    });
    renderPane({ ...baseDream, informsContext: false });
    expect(
      await screen.findByText(
        /kept as a private journal entry, so it.+won.t inform coaching context/i,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Share with someone in your life')).not.toBeInTheDocument();
  });

  it('hides sharing entirely without the dreams.shareContext capability', async () => {
    // superAdmin stays false + no access → can('dreams.shareContext') is false.
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      dreamGetAnalysis: () => Promise.resolve(approvedAnalysis),
      dreamGetInsight: () => Promise.resolve(insightFixture),
      dreamShareTargets: () => Promise.resolve(partner),
    });
    renderPane();
    await screen.findByText('Your dream analysis');
    expect(screen.queryByText('Share with someone in your life')).not.toBeInTheDocument();
  });
});
