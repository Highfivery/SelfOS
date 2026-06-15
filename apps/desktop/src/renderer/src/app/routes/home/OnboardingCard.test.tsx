import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DEFAULT_ROLES } from '@shared/capabilities';
import type { IntakeState } from '@shared/channels';
import type { Person } from '@shared/schemas';
import { OnboardingCard } from './OnboardingCard';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';
import { useSessionStore } from '../../../stores/sessionStore';
import { useIntakeStore } from '../../../stores/intakeStore';

const ME: Person = {
  id: 'owner-1',
  schemaVersion: 1,
  displayName: 'Sam',
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
};

function signIn(roleId: 'owner' | 'member' | 'guest'): void {
  useSessionStore.setState({
    activePerson: ME,
    access: { roles: DEFAULT_ROLES, accounts: [{ personId: ME.id, roleId, hasPin: false }] },
  });
}

function intakeState(status: 'inProgress' | 'complete'): IntakeState {
  return {
    session: {
      id: 'intake-1',
      schemaVersion: 1,
      personId: ME.id,
      status,
      sections: [
        { id: 'basics', status: 'notStarted', restricted: false, messages: [], answers: {} },
      ],
      startedAt: 'now',
      updatedAt: 'now',
    },
    sections: [],
    aiAvailable: true,
    adultAcknowledged: false,
  };
}

async function renderCard(): Promise<void> {
  render(
    <MemoryRouter>
      <OnboardingCard />
    </MemoryRouter>,
  );
  await useIntakeStore.getState().load();
}

beforeEach(() => {
  signIn('owner');
  useIntakeStore.getState().reset();
});
afterEach(() => clearMockBridge());

describe('OnboardingCard', () => {
  it('nudges to start onboarding when intake is incomplete', async () => {
    installMockBridge({ intakeGetState: () => Promise.resolve(intakeState('inProgress')) });
    await renderCard();
    expect(await screen.findByRole('button', { name: /onboarding/i })).toBeInTheDocument();
  });

  it('self-hides once the intake is complete', async () => {
    installMockBridge({ intakeGetState: () => Promise.resolve(intakeState('complete')) });
    await renderCard();
    await waitFor(() => expect(useIntakeStore.getState().loaded).toBe(true));
    expect(screen.queryByRole('button', { name: /onboarding/i })).not.toBeInTheDocument();
  });

  it('nudges to refresh when the portrait is out of date (answers changed since)', async () => {
    const st = intakeState('complete');
    st.session.sections = [
      {
        id: 'basics',
        status: 'complete',
        restricted: false,
        messages: [],
        answers: { name: 'Sam' },
      },
    ];
    // A snapshot hash that won't match the current answer → the portrait is stale.
    st.session.portraitAnswerSig = { 'basics.name': 999999 };
    installMockBridge({ intakeGetState: () => Promise.resolve(st) });
    await renderCard();
    expect(await screen.findByText(/Keep your portrait up to date/)).toBeInTheDocument();
  });

  it('self-hides for someone without intake.own (a guest)', async () => {
    signIn('guest');
    installMockBridge({ intakeGetState: () => Promise.resolve(intakeState('inProgress')) });
    await renderCard();
    await waitFor(() => expect(useIntakeStore.getState().loaded).toBe(true));
    expect(screen.queryByRole('button', { name: /onboarding/i })).not.toBeInTheDocument();
  });
});
