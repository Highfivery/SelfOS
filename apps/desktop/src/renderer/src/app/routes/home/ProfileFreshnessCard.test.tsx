import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ProfileUpdateSuggestion } from '@shared/channels';
import { ProfileFreshnessCard } from './ProfileFreshnessCard';
import { useSessionStore } from '../../../stores/sessionStore';
import { clearMockBridge, elevateToOwner, installMockBridge } from '../../../test-utils/bridge';

const suggestion = (over: Partial<ProfileUpdateSuggestion> = {}): ProfileUpdateSuggestion => ({
  id: 's1',
  schemaVersion: 1,
  subjectPersonId: 'owner-1',
  kind: 'field',
  field: 'occupation',
  observed: 'teacher',
  current: 'nurse',
  rationale: 'a recent session mentioned a new teaching job',
  sourceInsightId: 'i1',
  sourceKind: 'session',
  restricted: false,
  status: 'pending',
  createdAt: 'now',
  updatedAt: 'now',
  ...over,
});

afterEach(() => {
  clearMockBridge();
  useSessionStore.setState({ activePerson: null, access: null });
});

describe('ProfileFreshnessCard', () => {
  it('self-hides when there are no pending suggestions', async () => {
    elevateToOwner();
    installMockBridge({ profileSuggestions: () => Promise.resolve([]) });
    const { container } = render(<ProfileFreshnessCard />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('lists pending suggestions and accepts one (writes the field)', async () => {
    elevateToOwner();
    const profileAcceptSuggestion = vi.fn(() => Promise.resolve([]));
    installMockBridge({
      profileSuggestions: () => Promise.resolve([suggestion()]),
      profileAcceptSuggestion,
    });
    render(<ProfileFreshnessCard />);
    expect(await screen.findByText(/Occupation: teacher/)).toBeInTheDocument();
    expect(screen.getByText(/new teaching job/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Update/ }));
    await waitFor(() => expect(profileAcceptSuggestion).toHaveBeenCalledWith('s1'));
  });

  it('dismisses a suggestion', async () => {
    elevateToOwner();
    const profileDismissSuggestion = vi.fn(() => Promise.resolve([]));
    installMockBridge({
      profileSuggestions: () => Promise.resolve([suggestion()]),
      profileDismissSuggestion,
    });
    render(<ProfileFreshnessCard />);
    fireEvent.click(await screen.findByRole('button', { name: /Dismiss/ }));
    await waitFor(() => expect(profileDismissSuggestion).toHaveBeenCalledWith('s1'));
  });
});
