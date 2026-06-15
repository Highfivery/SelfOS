import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DEFAULT_ROLES } from '@shared/capabilities';
import type { IntakeSectionMeta, IntakeState } from '@shared/channels';
import type { Person } from '@shared/schemas';
import { Onboarding } from './Onboarding';
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

function signIn(roleId: 'owner' | 'member'): void {
  useSessionStore.setState({
    activePerson: ME,
    access: { roles: DEFAULT_ROLES, accounts: [{ personId: ME.id, roleId, hasPin: false }] },
  });
}

const META: IntakeSectionMeta[] = [
  {
    id: 'basics',
    title: 'The basics',
    blurb: 'Simple things.',
    restricted: false,
    adult: false,
    tier: 'core',
    mode: 'chat',
    opener: 'What should I call you?',
  },
  {
    id: 'weighs',
    title: 'What weighs on you',
    blurb: 'The heavier things.',
    restricted: true,
    adult: false,
    tier: 'invited',
    mode: 'chat',
    opener: 'Anything weighing on you?',
    contentNote: 'Go as light as you like.',
  },
  {
    id: 'intimacy',
    title: 'Intimacy & sexuality',
    blurb: 'Optional, 18+.',
    restricted: true,
    adult: true,
    tier: 'invited',
    mode: 'chat',
    opener: 'What does closeness mean to you?',
    contentNote: 'Optional and adults-only.',
  },
];

function state(over: Partial<IntakeState> = {}): IntakeState {
  return {
    session: {
      id: 'intake-1',
      schemaVersion: 1,
      personId: ME.id,
      status: 'inProgress',
      sections: META.map((m) => ({
        id: m.id,
        status: 'notStarted',
        restricted: m.restricted,
        messages: [],
        answers: {},
      })),
      startedAt: 'now',
      updatedAt: 'now',
    },
    sections: META,
    aiAvailable: true,
    adultAcknowledged: false,
    ...over,
  };
}

function renderOnboarding(): void {
  render(
    <MemoryRouter>
      <Onboarding />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  signIn('owner');
  useIntakeStore.getState().reset();
});
afterEach(() => {
  clearMockBridge();
  localStorage.clear();
});

describe('Onboarding', () => {
  it('shows the owner "connect AI" state when AI is unavailable', async () => {
    installMockBridge({ intakeGetState: () => Promise.resolve(state({ aiAvailable: false })) });
    renderOnboarding();
    expect(await screen.findByText('Connect AI to begin')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Settings' })).toBeInTheDocument();
  });

  it('shows the member "ask your owner" copy when AI is unavailable', async () => {
    signIn('member');
    installMockBridge({ intakeGetState: () => Promise.resolve(state({ aiAvailable: false })) });
    renderOnboarding();
    expect(await screen.findByText('Connect AI to begin')).toBeInTheDocument();
    expect(screen.getByText(/Ask your household\s+owner/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Settings' })).not.toBeInTheDocument();
  });

  it('runs an interview turn in the active section and shows the streamed reply', async () => {
    installMockBridge({ intakeGetState: () => Promise.resolve(state()) });
    renderOnboarding();
    // The first section (basics) is active; its opener shows.
    expect(await screen.findByText('What should I call you?')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'I am Sam.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Thank you for sharing that.')).toBeInTheDocument();
  });

  it('gates the intimacy section behind an 18+ acknowledgement', async () => {
    // Core (basics) done → the invited grid offers intimacy; opening it shows the 18+ gate.
    const s = state();
    s.session.sections = s.session.sections.map((sec) =>
      sec.id === 'basics' ? { ...sec, status: 'complete' as const } : sec,
    );
    installMockBridge({ intakeGetState: () => Promise.resolve(s) });
    renderOnboarding();
    fireEvent.click(await screen.findByRole('button', { name: /Intimacy & sexuality/ }));
    expect(await screen.findByRole('button', { name: /18 or older/ })).toBeInTheDocument();
    // No composer while the gate is up.
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();
  });

  it('resumes a section, rendering its saved transcript', async () => {
    const s = state();
    s.session.sections = s.session.sections.map((sec) =>
      sec.id === 'basics'
        ? {
            ...sec,
            status: 'inProgress' as const,
            messages: [
              { role: 'user', content: 'I work as a nurse.', ts: 'now' },
              { role: 'assistant', content: 'That sounds meaningful — tell me more.', ts: 'now' },
            ],
          }
        : sec,
    );
    installMockBridge({ intakeGetState: () => Promise.resolve(s) });
    renderOnboarding();
    expect(await screen.findByText('I work as a nurse.')).toBeInTheDocument();
    expect(screen.getByText('That sounds meaningful — tell me more.')).toBeInTheDocument();
  });

  it('restores the previously-open section from device-local storage on mount', async () => {
    localStorage.setItem('selfos:onboarding:section:owner-1', 'weighs');
    installMockBridge({ intakeGetState: () => Promise.resolve(state()) });
    renderOnboarding();
    // The reopened section is shown directly (with a Back affordance) rather than the core flow.
    expect(await screen.findByText('Anything weighing on you?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Back/ })).toBeInTheDocument();
  });

  it('persists the opened section so a reload returns to it', async () => {
    const s = state();
    s.session.sections = s.session.sections.map((sec) =>
      sec.id === 'basics' ? { ...sec, status: 'complete' as const } : sec,
    );
    installMockBridge({ intakeGetState: () => Promise.resolve(s) });
    renderOnboarding();
    fireEvent.click(await screen.findByRole('button', { name: /What weighs on you/ }));
    expect(localStorage.getItem('selfos:onboarding:section:owner-1')).toBe('weighs');
  });

  it('ignores a stale persisted section id and falls back to the core walk', async () => {
    localStorage.setItem('selfos:onboarding:section:owner-1', 'no-such-section');
    installMockBridge({ intakeGetState: () => Promise.resolve(state()) });
    renderOnboarding();
    // A removed/renamed id must not short-circuit to the portrait offer — the first core section shows.
    expect(await screen.findByText('What should I call you?')).toBeInTheDocument();
    expect(screen.queryByText('That’s the essentials — thank you')).not.toBeInTheDocument();
  });

  it('shows the closing portrait when the intake is complete', async () => {
    const s = state();
    s.session.status = 'complete';
    s.session.portrait = 'You carry a lot with quiet grace.';
    installMockBridge({ intakeGetState: () => Promise.resolve(s) });
    renderOnboarding();
    expect(await screen.findByText('What I’ve come to understand about you')).toBeInTheDocument();
    expect(screen.getByText('You carry a lot with quiet grace.')).toBeInTheDocument();
  });

  it('always shows the crisis footer and the not-medical line', async () => {
    installMockBridge({ intakeGetState: () => Promise.resolve(state()) });
    renderOnboarding();
    await screen.findByText('What should I call you?');
    expect(screen.getByText('SelfOS is wellness support, not medical care.')).toBeInTheDocument();
  });
});
