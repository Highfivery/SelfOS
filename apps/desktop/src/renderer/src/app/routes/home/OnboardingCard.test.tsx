import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DEFAULT_ROLES } from '@shared/capabilities';
import type { IntakeSectionMeta, IntakeState, ProfileUpdateSuggestion } from '@shared/channels';
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

/** A form section's catalog meta with `questions` (so the card's branch-aware question counts compute). */
function formMeta(id: string, questionIds: string[]): IntakeSectionMeta {
  return {
    id,
    title: id,
    blurb: '',
    restricted: false,
    adult: false,
    tier: id === 'basics' ? 'core' : 'invited',
    mode: 'form',
    opener: '',
    questions: questionIds.map((qid) => ({
      id: qid,
      type: 'shortText' as const,
      prompt: qid,
      required: false,
    })),
  };
}

const TWO_DAYS_AGO = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

function baseState(status: 'inProgress' | 'complete'): IntakeState {
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
      updatedAt: TWO_DAYS_AGO,
    },
    sections: [formMeta('basics', ['a', 'b', 'c'])],
    aiAvailable: true,
    adultAcknowledged: false,
  };
}

const PENDING_SUGGESTION: ProfileUpdateSuggestion = {
  id: 'sug-1',
  schemaVersion: 1,
  subjectPersonId: ME.id,
  kind: 'field',
  field: 'occupation',
  observed: 'nurse',
  rationale: 'A recent session mentioned a new job.',
  sourceInsightId: 'ins-1',
  sourceKind: 'session',
  restricted: false,
  status: 'pending',
  createdAt: 'now',
  updatedAt: 'now',
};

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
  it('nudges to start onboarding when nothing has been done yet (no stats)', async () => {
    installMockBridge({ intakeGetState: () => Promise.resolve(baseState('inProgress')) });
    await renderCard();
    expect(await screen.findByRole('button', { name: /start onboarding/i })).toBeInTheDocument();
    // No started sections → no stats row yet.
    expect(screen.queryByText(/answered/)).not.toBeInTheDocument();
  });

  it('shows scannable progress while in progress (questions, sections done, last updated)', async () => {
    const st = baseState('inProgress');
    // basics: 2 of 3 answered + complete; relationships: skipped (excluded from "remaining"); story: chat.
    st.sections = [
      formMeta('basics', ['a', 'b', 'c']),
      formMeta('relationships', ['x', 'y']),
      {
        id: 'story',
        title: 'story',
        blurb: '',
        restricted: false,
        adult: false,
        tier: 'core',
        mode: 'chat',
        opener: '',
      },
    ];
    st.session.sections = [
      {
        id: 'basics',
        status: 'complete',
        restricted: false,
        messages: [],
        answers: { a: 'x', b: 'y' },
      },
      { id: 'relationships', status: 'skipped', restricted: false, messages: [], answers: {} },
      { id: 'story', status: 'notStarted', restricted: false, messages: [], answers: {} },
    ];
    installMockBridge({ intakeGetState: () => Promise.resolve(st) });
    await renderCard();

    expect(await screen.findByRole('button', { name: /continue onboarding/i })).toBeInTheDocument();
    // basics 2/3; relationships skipped (its 2 questions excluded); chat section contributes 0 → 2 of 3.
    expect(screen.getByText('2 of 3 answered')).toBeInTheDocument();
    // basics complete + relationships skipped = 2 done, of 3 sections.
    expect(screen.getByText('2 of 3 done')).toBeInTheDocument();
    expect(screen.getByText('2d ago')).toBeInTheDocument();
  });

  it('self-hides once complete and the portrait is up to date', async () => {
    const st = baseState('complete');
    st.session.portraitAnswerSig = {}; // a portrait exists; no answers changed since → fresh
    installMockBridge({ intakeGetState: () => Promise.resolve(st) });
    await renderCard();
    await waitFor(() => expect(useIntakeStore.getState().loaded).toBe(true));
    expect(screen.queryByText(/profile review/i)).not.toBeInTheDocument();
  });

  it('stays hidden when complete + fresh even if profile suggestions are pending (the freshness card owns those)', async () => {
    const st = baseState('complete');
    st.session.portraitAnswerSig = {}; // fresh
    installMockBridge({
      intakeGetState: () => Promise.resolve(st),
      profileSuggestions: () => Promise.resolve([PENDING_SUGGESTION]),
    });
    await renderCard();
    await waitFor(() => expect(useIntakeStore.getState().loaded).toBe(true));
    // Pending suggestions do NOT resurrect this card — ProfileFreshnessCard surfaces them with actions.
    expect(screen.queryByText(/profile review/i)).not.toBeInTheDocument();
  });

  it('nudges to refresh when the portrait is stale (answers changed since), with the % changed', async () => {
    const st = baseState('complete');
    st.session.sections = [
      { id: 'basics', status: 'complete', restricted: false, messages: [], answers: { a: 'Sam' } },
    ];
    // A snapshot hash that won't match the current answer → the portrait is stale.
    st.session.portraitAnswerSig = { 'basics.a': 999999 };
    installMockBridge({ intakeGetState: () => Promise.resolve(st) });
    await renderCard();
    expect(await screen.findByText(/Time for a quick profile review/)).toBeInTheDocument();
    expect(screen.getByText('Changed since portrait')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /refresh my portrait/i })).toBeInTheDocument();
  });

  it('self-hides for someone without intake.own (a guest)', async () => {
    signIn('guest');
    installMockBridge({ intakeGetState: () => Promise.resolve(baseState('inProgress')) });
    await renderCard();
    await waitFor(() => expect(useIntakeStore.getState().loaded).toBe(true));
    expect(screen.queryByRole('button', { name: /onboarding/i })).not.toBeInTheDocument();
  });
});
