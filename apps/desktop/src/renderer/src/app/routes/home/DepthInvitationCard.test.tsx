import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { IntakeSectionMeta, IntakeState, ProfileUpdateSuggestion } from '@shared/channels';
import { DepthInvitationCard } from './DepthInvitationCard';
import { useSessionStore } from '../../../stores/sessionStore';
import { useIntakeStore } from '../../../stores/intakeStore';
import { clearMockBridge, elevateToOwner, installMockBridge } from '../../../test-utils/bridge';

const depth = (over: Partial<ProfileUpdateSuggestion> = {}): ProfileUpdateSuggestion => ({
  id: 'd1',
  schemaVersion: 1,
  subjectPersonId: 'owner-1',
  kind: 'depth',
  sectionId: 'family',
  lifeArea: 'Family',
  theme: 'your father',
  observed: 'your father',
  rationale: 'family has come up a few times',
  sourceInsightId: 'i1',
  sourceKind: 'session',
  restricted: false,
  status: 'pending',
  createdAt: 'now',
  updatedAt: 'now',
  ...over,
});

const sectionMeta = (id: string, title: string): IntakeSectionMeta => ({
  id,
  title,
  blurb: '',
  restricted: false,
  adult: false,
  tier: 'invited',
  mode: 'form',
  opener: '',
});

function seedSections(sections: IntakeSectionMeta[]): void {
  const state: IntakeState = {
    session: {
      id: 's1',
      schemaVersion: 1,
      personId: 'owner-1',
      status: 'complete',
      sections: [],
      startedAt: 'now',
      updatedAt: 'now',
    },
    sections,
    aiAvailable: true,
    adultAcknowledged: false,
  };
  useIntakeStore.setState({ state });
}

afterEach(() => {
  clearMockBridge();
  useSessionStore.setState({ activePerson: null, access: null });
  useIntakeStore.setState({ state: null });
});

const renderCard = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <DepthInvitationCard />
    </MemoryRouter>,
  );

describe('DepthInvitationCard (29)', () => {
  it('self-hides when there are no pending depth invitations', async () => {
    elevateToOwner();
    installMockBridge({ profileSuggestions: () => Promise.resolve([]) });
    const { container } = renderCard();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('shows the invitation with the section title + theme, and Go deeper / Not now', async () => {
    elevateToOwner();
    seedSections([sectionMeta('family', 'Family & roots')]);
    installMockBridge({ profileSuggestions: () => Promise.resolve([depth()]) });
    renderCard();
    expect(await screen.findByText(/Family & roots/)).toBeInTheDocument();
    expect(screen.getByText(/family has come up a few times/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Go deeper/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Not now/ })).toBeInTheDocument();
  });

  it('Go deeper accepts the invitation', async () => {
    elevateToOwner();
    seedSections([sectionMeta('family', 'Family & roots')]);
    const profileAcceptSuggestion = vi.fn(() => Promise.resolve([]));
    installMockBridge({
      profileSuggestions: () => Promise.resolve([depth()]),
      profileAcceptSuggestion,
    });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /Go deeper/ }));
    await waitFor(() => expect(profileAcceptSuggestion).toHaveBeenCalledWith('d1'));
  });

  it('Not now dismisses the invitation', async () => {
    elevateToOwner();
    seedSections([sectionMeta('family', 'Family & roots')]);
    const profileDismissSuggestion = vi.fn(() => Promise.resolve([]));
    installMockBridge({
      profileSuggestions: () => Promise.resolve([depth()]),
      profileDismissSuggestion,
    });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /Not now/ }));
    await waitFor(() => expect(profileDismissSuggestion).toHaveBeenCalledWith('d1'));
  });
});
