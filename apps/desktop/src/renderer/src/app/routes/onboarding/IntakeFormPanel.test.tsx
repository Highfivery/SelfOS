import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  canDeepen: true,
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

  it('renders choices as toggle pills and captures an "Other" write-in into the submit', async () => {
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
    // A preset pill (a button, not a checkbox) + the Other write-in.
    fireEvent.click(screen.getByRole('button', { name: 'Music' }));
    fireEvent.click(screen.getByRole('button', { name: 'Other' }));
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

  it('offers an optional "Tell me more" go-deeper chat when the section invites it', async () => {
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
});
