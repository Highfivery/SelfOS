import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import {
  ACTIVITY_POINT_LABELS,
  ACTIVITY_LIMIT_LABELS,
  resolveIntakeActivityRows,
} from '@selfos/core/intimacy';
import { defaultScopeForQuestion } from '@selfos/core/intake';
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

// Every basics question shares by default per its category preset (none restricted) — what the panel submits.
const formSharing = Object.fromEntries(
  formMeta.questions!.map((q) => [q.id, defaultScopeForQuestion('basics', q.id)]),
);

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

// A NON-restricted section (health) that nonetheless holds a restricted question (substancesUsed) — the
// catalog decides `restricted`, so the synthetic question ids must be real health ids (43 §8 bulk-confirm).
const healthMeta: IntakeSectionMeta = {
  id: 'health',
  title: 'Health & body',
  blurb: 'Body & wellbeing.',
  restricted: false,
  adult: false,
  tier: 'invited',
  mode: 'form',
  opener: 'A few about your body.',
  questions: [
    {
      id: 'sleepSchedule',
      type: 'singleChoice',
      prompt: 'Sleep schedule',
      required: false,
      options: ['Early', 'Late'],
    },
    {
      id: 'substancesUsed',
      type: 'multiChoice',
      prompt: 'Substances you use',
      required: false,
      options: ['Cannabis / weed', 'None'],
    },
  ],
};

// An intimacy section carrying the anatomy questions + the 5-point activity matrix (neutral default rows, as
// the bridge sends them). The renderer re-resolves the matrix's oral rows live from the anatomy answers (46).
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
      id: 'ownAnatomy',
      type: 'singleChoice',
      prompt: 'What are you packing down there?',
      required: false,
      options: ['Cock (penis)', 'Pussy (vulva)', 'Both or intersex', 'Rather not say'],
    },
    {
      id: 'partnerAnatomy',
      type: 'multiChoice',
      prompt: 'What do you like a partner to have down there?',
      required: false,
      options: ['Cock (penis)', 'Pussy (vulva)', "Don't mind"],
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
        sharing: formSharing,
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
        sharing: formSharing,
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

  it('tailors the activity matrix oral rows to the live ANATOMY answers (46 §5)', () => {
    installMockBridge({});
    render(
      <IntakeFormPanel
        meta={intimacyMatrixMeta}
        section={section({
          id: 'intimacy',
          restricted: true,
          answers: { ownAnatomy: 'Cock (penis)', partnerAnatomy: ['Pussy (vulva)'] },
        })}
        adultAcknowledged={true}
        onAdvance={() => {}}
      />,
    );
    // Own penis + partner vulva: he receives a blowjob + goes down on her; never the blowjob-giving variant.
    expect(screen.getByRole('radiogroup', { name: /Going down on her/ })).toBeInTheDocument();
    expect(
      screen.getByRole('radiogroup', { name: /Receiving oral \(blowjob\)/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: /Giving a blowjob/ })).not.toBeInTheDocument();
  });

  it('adds a giving row live when partner anatomy changes, WITHOUT dropping an existing rating (46 §7)', () => {
    installMockBridge({});
    render(
      <IntakeFormPanel
        meta={intimacyMatrixMeta}
        section={section({
          id: 'intimacy',
          restricted: true,
          answers: { partnerAnatomy: ['Pussy (vulva)'] },
        })}
        adultAcknowledged={true}
        onAdvance={() => {}}
      />,
    );
    // Rate a universal row, then add penis to partner anatomy → a new "Giving a blowjob" row appears.
    const bondage = screen.getByRole('radiogroup', { name: /Bondage/ });
    fireEvent.click(within(bondage).getByRole('radio', { name: 'Love it' }));
    expect(screen.queryByRole('radiogroup', { name: /Giving a blowjob/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Cock (penis)' }));
    expect(screen.getByRole('radiogroup', { name: /Giving a blowjob/ })).toBeInTheDocument();
    // The Bondage rating survives the row re-resolution (keyed by its stable key, not the label).
    const bondageAfter = screen.getByRole('radiogroup', { name: /Bondage/ });
    expect(within(bondageAfter).getByRole('radio', { name: 'Love it' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('persists a matrix answer under its STABLE key through the submit (46 §4.2)', async () => {
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
    // Pick "Love it" (point 5) on the universal "Bondage" row, then Continue. It persists under the stable
    // slug key, not the display label.
    const bondage = screen.getByRole('radiogroup', { name: /Bondage/ });
    fireEvent.click(within(bondage).getByRole('radio', { name: 'Love it' }));
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await waitFor(() =>
      expect(intakeSubmitForm).toHaveBeenCalledWith({
        sectionId: 'intimacy',
        answers: { activities: { bondage: 5 } },
        // The restricted intimacy section defaults every question to Private (43 §8).
        sharing: { ownAnatomy: [], partnerAnatomy: [], activities: [] },
      }),
    );
  });
});

describe('IntakeFormPanel — per-question sharing (43)', () => {
  it('renders the in-context explainer and a sharing chip per question, defaulted by category', () => {
    installMockBridge({ relationshipsList: () => Promise.resolve([]) });
    render(
      <IntakeFormPanel
        meta={formMeta}
        section={section()}
        adultAcknowledged={false}
        onAdvance={() => {}}
      />,
    );
    // The honest "informs their AI, never shown to them" explainer is present (43 §3.3).
    expect(screen.getByText(/inform their AI coaching/i)).toBeInTheDocument();
    // A non-restricted basics question shares by default (the preset includes a partner) — the chip reads
    // "shared with …", not Private. (Each chip's accessible name is "<prompt>: shared with …".)
    expect(screen.getByRole('button', { name: /Your pronouns: shared with/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /What do you do for work\?: shared with/i }),
    ).toBeInTheDocument();
  });

  it('shows a per-section bulk control, "Mixed" when questions differ', () => {
    installMockBridge({ relationshipsList: () => Promise.resolve([]) });
    render(
      <IntakeFormPanel
        meta={formMeta}
        // Seed a saved scope that differs across questions → the bulk chip reads "Mixed".
        section={section({
          answerSharing: { pronouns: ['partner'], occupation: [], likes: ['partner', 'friend'] },
        })}
        adultAcknowledged={false}
        onAdvance={() => {}}
      />,
    );
    expect(screen.getByText('Sharing for this section')).toBeInTheDocument();
    expect(screen.getByText('Mixed')).toBeInTheDocument();
  });

  it('confirms before sharing a sensitive (restricted) answer, then carries the scope into the submit', async () => {
    const intakeSubmitForm = vi.fn(() =>
      Promise.resolve({
        session: {} as never,
        sections: [],
        aiAvailable: true,
        adultAcknowledged: true,
      }),
    );
    installMockBridge({ intakeSubmitForm, relationshipsList: () => Promise.resolve([]) });
    render(
      <IntakeFormPanel
        meta={intimacyMeta}
        section={section({ id: 'intimacy', restricted: true })}
        adultAcknowledged={true}
        onAdvance={() => {}}
      />,
    );
    // The libido chip starts Private (sensitive). Open it and pick Partner → a confirm appears, not applied yet.
    fireEvent.click(screen.getByRole('button', { name: /Sex drive: private/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Partner' }));
    expect(await screen.findByText(/is sensitive — share it/i)).toBeInTheDocument();
    // The confirm renders INLINE in the question's sharing slot (44 audit): it REPLACES the picker — the
    // checkbox is gone — so it's co-located with the click, not a disconnected top banner.
    expect(screen.queryByRole('checkbox', { name: 'Partner' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Share it' }));

    fireEvent.click(screen.getByRole('button', { name: /Save changes|Continue/ }));
    await waitFor(() =>
      expect(intakeSubmitForm).toHaveBeenCalledWith(
        expect.objectContaining({
          sectionId: 'intimacy',
          sharing: expect.objectContaining({ libido: ['partner'] }),
        }),
      ),
    );
  });

  it('confirms a bulk share when a non-restricted section holds a sensitive question (health/substances)', async () => {
    installMockBridge({ relationshipsList: () => Promise.resolve([]) });
    render(
      <IntakeFormPanel
        meta={healthMeta}
        section={section({ id: 'health' })}
        adultAcknowledged={false}
        onAdvance={() => {}}
      />,
    );
    // Open the per-section bulk control and add Partner → because `substancesUsed` is restricted, the §8
    // confirm must appear before anything is shared (the bulk control must not bypass it).
    fireEvent.click(screen.getByRole('button', { name: /this whole section/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Partner' }));
    expect(await screen.findByText(/includes sensitive answers/i)).toBeInTheDocument();
  });

  it('offers the one-tap "refresh your portrait" once an edit makes the portrait stale', () => {
    installMockBridge({ relationshipsList: () => Promise.resolve([]) });
    render(
      <IntakeFormPanel
        meta={formMeta}
        section={section({ status: 'complete' })}
        adultAcknowledged={false}
        portraitStale={true}
        onAdvance={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /Refresh your portrait/i })).toBeInTheDocument();
  });
});
