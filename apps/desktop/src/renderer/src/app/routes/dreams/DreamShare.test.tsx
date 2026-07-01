import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Dream, DreamAnalysis, Insight } from '@shared/channels';
import { DreamShareControls } from './DreamShareControls';
import { DreamAnalysisPane } from './DreamAnalysisPane';
import { useDreamAnalysisStore } from '../../../stores/dreamAnalysisStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useSettingsStore } from '../../../settings/settingsStore';
import { clearMockBridge, elevateToOwner, installMockBridge } from '../../../test-utils/bridge';

afterEach(() => {
  clearMockBridge();
  useDreamAnalysisStore.getState().reset();
  useSessionStore.setState({ activePerson: null, access: null });
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
  categories: [],
  approved: true,
  provenance: { dreamId: 'd1', at: 'now' },
  createdAt: 'now',
  updatedAt: 'now',
};

const partner = [{ id: 'p2', displayName: 'Partner' }];

describe('DreamShareControls', () => {
  it('shows a person chip per reflection; tapping it shares that fact with the person', async () => {
    const onSetShare = vi.fn();
    render(
      <DreamShareControls facts={insightFixture.facts} targets={partner} onSetShare={onSetShare} />,
    );
    expect(screen.getByText('Feels protective of their partner.')).toBeInTheDocument();
    // Each reflection has its own recipient chips; scope to the first fact's group.
    const group = screen.getByRole('group', { name: /feels protective/i });
    await userEvent.click(within(group).getByRole('button', { name: 'Partner' }));
    expect(onSetShare).toHaveBeenCalledWith('f1', 'p2', true);
  });

  it('supports multiple recipients — pressed chips reflect sharing; adding a second calls onSetShare', async () => {
    const two = [
      { id: 'p2', displayName: 'Angel' },
      { id: 'p3', displayName: 'Bob' },
    ];
    const facts = [{ id: 'f1', text: 'A reflection.', shareable: false, shareableWith: ['p2'] }];
    const onSetShare = vi.fn();
    render(<DreamShareControls facts={facts} targets={two} onSetShare={onSetShare} />);
    // Already shared with Angel → her chip is pressed; Bob's is not.
    expect(screen.getByRole('button', { name: 'Angel' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Bob' })).toHaveAttribute('aria-pressed', 'false');
    // Add Bob too — a second recipient.
    await userEvent.click(screen.getByRole('button', { name: 'Bob' }));
    expect(onSetShare).toHaveBeenCalledWith('f1', 'p3', true);
  });

  it('titles known reflections, renders markdown, and collapses the body until expanded', async () => {
    const facts = [
      {
        id: 'ins-1:emotional',
        text: 'A **fierce** protectiveness, and underneath it *fear*.',
        shareable: false,
      },
    ];
    render(<DreamShareControls facts={facts} targets={partner} onSetShare={vi.fn()} />);
    // A friendly section title, not the raw reflection.
    expect(screen.getByText('Emotional landscape')).toBeInTheDocument();
    // Collapsed by default → the reflection body isn't shown yet.
    expect(screen.queryByText(/fierce/)).not.toBeInTheDocument();
    // Expand → the reflection renders as MARKDOWN (a <strong>, never a literal "**fierce**").
    await userEvent.click(screen.getByRole('button', { name: /emotional landscape/i }));
    const bold = await screen.findByText('fierce');
    expect(bold.tagName).toBe('STRONG');
    expect(screen.queryByText(/\*\*fierce\*\*/)).not.toBeInTheDocument();
  });

  it('marks an already-shared person with a pressed chip', () => {
    const facts = [
      { id: 'f1', text: 'A shared reflection.', shareable: false, shareableWith: ['p2'] },
    ];
    render(<DreamShareControls facts={facts} targets={partner} onSetShare={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Partner' })).toHaveAttribute('aria-pressed', 'true');
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
    elevateToOwner();
    const setShare = vi.fn(() => Promise.resolve({ ok: true as const }));
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
      dreamGetAnalysis: () => Promise.resolve(approvedAnalysis),
      dreamGetInsight: () => Promise.resolve(insightFixture),
      dreamShareTargets: () => Promise.resolve(partner),
      dreamSetFactShare: setShare,
    });
    renderPane();
    await screen.findByText('Share with people in your life');
    const group = screen.getByRole('group', { name: /feels protective/i });
    await userEvent.click(within(group).getByRole('button', { name: 'Partner' }));
    expect(setShare).toHaveBeenCalledWith({
      dreamId: 'd1',
      factId: 'f1',
      withPersonId: 'p2',
      share: true,
    });
  });

  it('now shows share controls for a SENSITIVE dream when informsContext is on (15 §3.2)', async () => {
    elevateToOwner();
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
      dreamGetAnalysis: () => Promise.resolve(approvedAnalysis),
      dreamGetInsight: () => Promise.resolve(insightFixture),
      dreamShareTargets: () => Promise.resolve(partner),
    });
    renderPane({ ...baseDream, sensitivity: 'explicit' }); // informsContext undefined ⇒ on
    expect(await screen.findByText('Share with people in your life')).toBeInTheDocument();
  });

  it('hides sharing with a private-journal note when informsContext is off', async () => {
    elevateToOwner();
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
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
    expect(screen.queryByText('Share with people in your life')).not.toBeInTheDocument();
  });

  it('hides sharing entirely without the dreams.shareContext capability', async () => {
    // superAdmin stays false + no access → can('dreams.shareContext') is false.
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
      dreamGetAnalysis: () => Promise.resolve(approvedAnalysis),
      dreamGetInsight: () => Promise.resolve(insightFixture),
      dreamShareTargets: () => Promise.resolve(partner),
    });
    renderPane();
    await screen.findByText('Your dream analysis');
    expect(screen.queryByText('Share with people in your life')).not.toBeInTheDocument();
  });
});
