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
    const fingering = screen.getByRole('radiogroup', { name: /Fingering/ });
    fireEvent.click(within(fingering).getByRole('radio', { name: 'Love it' }));
    expect(screen.queryByRole('radiogroup', { name: /Giving a blowjob/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Cock (penis)' }));
    expect(screen.getByRole('radiogroup', { name: /Giving a blowjob/ })).toBeInTheDocument();
    // The Fingering rating survives the row re-resolution (keyed by its stable key, not the label).
    const fingeringAfter = screen.getByRole('radiogroup', { name: /Fingering/ });
    expect(within(fingeringAfter).getByRole('radio', { name: 'Love it' })).toHaveAttribute(
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
    // Pick "Love it" (point 5) on the universal "Fingering" row, then Continue. It persists under the stable
    // slug key, not the display label.
    const fingering = screen.getByRole('radiogroup', { name: /Fingering/ });
    fireEvent.click(within(fingering).getByRole('radio', { name: 'Love it' }));
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await waitFor(() =>
      expect(intakeSubmitForm).toHaveBeenCalledWith({
        sectionId: 'intimacy',
        answers: { activities: { fingering: 5 } },
        // The restricted intimacy section defaults every question to Private (43 §8).
        sharing: { ownAnatomy: [], partnerAnatomy: [], activities: [] },
      }),
    );
  });

  it('renders the activity matrix GROUPED by category, every group OPEN to the bottom (49 §3.1, no collapsed accordion)', () => {
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
    // Category headers render, sensual→extreme.
    expect(screen.getByRole('heading', { name: 'Sensual & sensory' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Power exchange / D-s' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Taboo fantasy' })).toBeInTheDocument();
    // The FULL surface renders to the bottom — a row from the FIRST and the LAST category are both present,
    // and NO group is hidden in a default-collapsed accordion (CLAUDE.md §7/§12).
    expect(screen.getByRole('radiogroup', { name: /Sensual massage/ })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: /Pet play/ })).toBeInTheDocument();
    expect(document.querySelectorAll('details:not([open])')).toHaveLength(0);
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

  it('shares a sensitive answer on ONE tap (no confirm) and auto-saves a completed section', async () => {
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
        section={section({ id: 'intimacy', restricted: true, status: 'complete' })}
        adultAcknowledged={true}
        onAdvance={() => {}}
      />,
    );
    // The libido chip starts Private (sensitive). Pick Partner → it applies on ONE tap, no confirm.
    fireEvent.click(screen.getByRole('button', { name: /Sex drive: private/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Partner' }));
    expect(screen.queryByText(/is sensitive — share it/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share it' })).not.toBeInTheDocument();
    // No Save click — the completed section auto-saves the new scope (debounced).
    await waitFor(
      () =>
        expect(intakeSubmitForm).toHaveBeenCalledWith(
          expect.objectContaining({
            sectionId: 'intimacy',
            sharing: expect.objectContaining({ libido: ['partner'] }),
          }),
        ),
      { timeout: 2000 },
    );
  });

  it('bulk "share all → partner" on a completed section auto-saves every scope, no confirm (the reported bug)', async () => {
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
        section={section({ id: 'intimacy', restricted: true, status: 'complete' })}
        adultAcknowledged={true}
        onAdvance={() => {}}
      />,
    );
    // Open the per-section bulk control and add Partner → applies to EVERY question on one tap, no confirm.
    fireEvent.click(screen.getByRole('button', { name: /this whole section/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Partner' }));
    expect(screen.queryByText(/includes sensitive answers/i)).not.toBeInTheDocument();
    // No Save click — it auto-saves the bulk scope across the section's questions.
    await waitFor(
      () =>
        expect(intakeSubmitForm).toHaveBeenCalledWith(
          expect.objectContaining({
            sectionId: 'intimacy',
            sharing: expect.objectContaining({ libido: ['partner'] }),
          }),
        ),
      { timeout: 2000 },
    );
  });

  it('does NOT auto-save a first-time (incomplete) section — that still rides the explicit Continue', async () => {
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
        section={section({ id: 'intimacy', restricted: true })} // no status:'complete' → first-time
        adultAcknowledged={true}
        onAdvance={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /this whole section/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Partner' }));
    // Give the debounce window time to pass — a first-time section must NOT auto-submit.
    await new Promise((r) => setTimeout(r, 800));
    expect(intakeSubmitForm).not.toHaveBeenCalled();
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
