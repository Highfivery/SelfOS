import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import {
  ACTIVITY_POINT_LABELS,
  ACTIVITY_LIMIT_LABELS,
  resolveIntakeActivityRows,
} from '@selfos/core/intimacy';
import type { IntakeSection, IntakeSectionMeta } from '@shared/channels';
import { IntakeFormPanel } from './IntakeFormPanel';
import { useIntakeStore } from '../../../stores/intakeStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

const formMeta: IntakeSectionMeta = {
  id: 'basics',
  title: 'The basics',
  blurb: 'Simple things.',
  restricted: false,
  adult: false,
  tier: 'core',
  mode: 'form',
  opener: 'A few quick things.',
  questions: [
    {
      id: 'pronouns',
      type: 'singleChoice',
      prompt: 'Your pronouns',
      required: false,
      options: ['she/her', 'he/him'],
    },
    { id: 'occupation', type: 'shortText', prompt: 'What do you do for work?', required: false },
    {
      id: 'likes',
      type: 'multiChoice',
      prompt: 'What you like',
      required: false,
      options: ['Music', 'Sport', 'Other'],
    },
  ],
};

const intimacyMeta: IntakeSectionMeta = {
  id: 'intimacy',
  title: 'Intimacy & sexuality',
  blurb: 'Optional, 18+.',
  restricted: true,
  adult: true,
  tier: 'invited',
  mode: 'form',
  opener: 'Optional grown-up space.',
  contentNote: 'Adults only.',
  questions: [
    {
      id: 'libido',
      type: 'singleChoice',
      prompt: 'Sex drive',
      required: false,
      options: ['Low', 'High'],
    },
  ],
};

// An intimacy section carrying the 5-point activity matrix (neutral default rows, as the bridge sends them).
const intimacyMatrixMeta: IntakeSectionMeta = {
  id: 'intimacy',
  title: 'Intimacy & sexuality',
  blurb: 'Optional, 18+.',
  restricted: true,
  adult: true,
  tier: 'invited',
  mode: 'form',
  opener: 'Optional grown-up space.',
  questions: [
    {
      id: 'drawnTo',
      type: 'multiChoice',
      prompt: 'Who are you drawn to?',
      required: false,
      options: ['Men', 'Women', 'Everyone', 'Other'],
    },
    {
      id: 'activities',
      type: 'matrix',
      prompt: 'Where do you stand?',
      required: false,
      matrix: {
        rows: resolveIntakeActivityRows(),
        min: 1,
        max: 5,
        pointLabels: [...ACTIVITY_POINT_LABELS],
        limitLabels: [...ACTIVITY_LIMIT_LABELS],
      },
    },
  ],
};

const section = (over: Partial<IntakeSection> = {}): IntakeSection => ({
  id: 'basics',
  status: 'notStarted',
  restricted: false,
  messages: [],
  answers: {},
  ...over,
});

afterEach(() => {
  clearMockBridge();
  useIntakeStore.getState().reset();
});

describe('IntakeFormPanel', () => {
  it('renders the section questions and submits the answers (no AI)', async () => {
    const intakeSubmitForm = vi.fn(() =>
      Promise.resolve({
        session: {} as never,
        sections: [],
        aiAvailable: true,
        adultAcknowledged: false,
      }),
    );
    installMockBridge({ intakeSubmitForm });
    const onAdvance = vi.fn();
    render(
      <IntakeFormPanel
        meta={formMeta}
        section={section()}
        adultAcknowledged={false}
        onAdvance={onAdvance}
      />,
    );
    expect(screen.getByText('Your pronouns')).toBeInTheDocument();
    expect(screen.getByText('What do you do for work?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'she/her' }));
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

    await waitFor(() =>
      expect(intakeSubmitForm).toHaveBeenCalledWith({
        sectionId: 'basics',
        answers: { pronouns: 'she/her' },
      }),
    );
    await waitFor(() => expect(onAdvance).toHaveBeenCalled());
  });

  it('renders choices as option cards and captures an "Other" write-in into the submit', async () => {
    const intakeSubmitForm = vi.fn(() =>
      Promise.resolve({
        session: {} as never,
        sections: [],
        aiAvailable: true,
        adultAcknowledged: false,
      }),
    );
    installMockBridge({ intakeSubmitForm });
    render(
      <IntakeFormPanel
        meta={formMeta}
        section={section()}
        adultAcknowledged={false}
        onAdvance={() => {}}
      />,
    );
    // Multi-choice options are checkbox-role cards + the Other write-in.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Music' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Other' }));
    fireEvent.change(screen.getByLabelText('What you like — other'), {
      target: { value: 'cooking' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await waitFor(() =>
      expect(intakeSubmitForm).toHaveBeenCalledWith({
        sectionId: 'basics',
        answers: { likes: ['Music', 'cooking'] },
      }),
    );
  });

  it('offers an optional "Tell me more" go-deeper chat on every form section', async () => {
    const intakeRunTurn = vi.fn(() =>
      Promise.resolve({ ok: true as const, session: {} as never, usage: {} as never }),
    );
    installMockBridge({ intakeRunTurn });
    render(
      <IntakeFormPanel
        meta={formMeta}
        section={section()}
        adultAcknowledged={false}
        onAdvance={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Tell me more/ }));
    fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'A bit more.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(intakeRunTurn).toHaveBeenCalledWith({ sectionId: 'basics', userText: 'A bit more.' }),
    );
  });

  it('auto-opens the go-deeper chat when the section already has a transcript (resume)', () => {
    installMockBridge({});
    render(
      <IntakeFormPanel
        meta={formMeta}
        section={section({
          status: 'inProgress',
          messages: [
            { role: 'user', content: 'My childhood was complicated.', ts: 'now' },
            { role: 'assistant', content: 'Thank you for trusting me with that.', ts: 'now' },
          ],
        })}
        adultAcknowledged={false}
        onAdvance={() => {}}
      />,
    );
    // The saved transcript shows immediately — no need to click "Tell me more" first.
    expect(screen.getByText('My childhood was complicated.')).toBeInTheDocument();
    expect(screen.getByText('Thank you for trusting me with that.')).toBeInTheDocument();
  });

  it('gates an adult section behind the 18+ acknowledgement (no questions until acked)', () => {
    installMockBridge({});
    render(
      <IntakeFormPanel
        meta={intimacyMeta}
        section={section({ id: 'intimacy', restricted: true })}
        adultAcknowledged={false}
        onAdvance={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /18 or older/ })).toBeInTheDocument();
    expect(screen.queryByText('Sex drive')).not.toBeInTheDocument();
  });

  it('shows the questions once the adult section is acknowledged', () => {
    installMockBridge({});
    render(
      <IntakeFormPanel
        meta={intimacyMeta}
        section={section({ id: 'intimacy', restricted: true })}
        adultAcknowledged={true}
        onAdvance={() => {}}
      />,
    );
    expect(screen.getByText('Sex drive')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /18 or older/ })).not.toBeInTheDocument();
  });

  it('tailors the activity matrix oral rows to gender + the live drawnTo answer (27 §4.2)', () => {
    installMockBridge({});
    render(
      <IntakeFormPanel
        meta={intimacyMatrixMeta}
        section={section({ id: 'intimacy', restricted: true, answers: { drawnTo: ['Women'] } })}
        adultAcknowledged={true}
        profileGender="Man"
        onAdvance={() => {}}
      />,
    );
    // A straight man: gives oral to a vulva-haver + receives a blowjob; never the blowjob-giving variant.
    expect(screen.getByRole('radiogroup', { name: /Going down on her/ })).toBeInTheDocument();
    expect(
      screen.getByRole('radiogroup', { name: /Receiving oral \(blowjob\)/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: /Giving a blowjob/ })).not.toBeInTheDocument();
  });

  it('persists a matrix answer through the submit (it is no longer dropped as an object)', async () => {
    const intakeSubmitForm = vi.fn(() =>
      Promise.resolve({
        session: {} as never,
        sections: [],
        aiAvailable: true,
        adultAcknowledged: true,
      }),
    );
    installMockBridge({ intakeSubmitForm });
    render(
      <IntakeFormPanel
        meta={intimacyMatrixMeta}
        section={section({ id: 'intimacy', restricted: true })}
        adultAcknowledged={true}
        onAdvance={() => {}}
      />,
    );
    // Pick "Love it" (point 5) on the universal "Bondage" row, then Continue.
    const bondage = screen.getByRole('radiogroup', { name: /Bondage/ });
    fireEvent.click(within(bondage).getByRole('radio', { name: 'Love it' }));
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await waitFor(() =>
      expect(intakeSubmitForm).toHaveBeenCalledWith({
        sectionId: 'intimacy',
        answers: { activities: { Bondage: 5 } },
      }),
    );
  });
});
