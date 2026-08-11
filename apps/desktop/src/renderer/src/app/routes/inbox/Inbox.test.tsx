import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { InboxAssignmentDetail, InboxItem } from '@shared/channels';
import { DEFAULT_ROLES } from '@shared/capabilities';
import type { Person } from '@shared/schemas';
import { Inbox } from './Inbox';
import { useInboxStore } from '../../../stores/inboxStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

const renderInbox = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <Inbox />
    </MemoryRouter>,
  );

const ME: Person = {
  id: 'me-1',
  schemaVersion: 1,
  displayName: 'Ben',
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
};

/** Set the active person's role so the empty-state's capability-gated action reflects it. */
function signIn(roleId: 'owner' | 'member'): void {
  useSessionStore.setState({
    activePerson: ME,
    access: { roles: DEFAULT_ROLES, accounts: [{ personId: ME.id, roleId, hasPin: false }] },
  });
}

afterEach(() => {
  clearMockBridge();
  useInboxStore.setState({ items: [], loaded: false });
  useSessionStore.getState().reset();
});

const item = (over: Partial<InboxItem> = {}): InboxItem => ({
  assignmentId: 'a1',
  title: 'Weekly check-in',
  type: 'general',
  questionCount: 1,
  status: 'sent',
  privacy: 'private',
  senderName: 'Ben',
  createdAt: '2026-06-11T00:00:00.000Z',
  favorite: false,
  answerable: true,
  hasDraft: false,
  fromSelf: false,
  ...over,
});

const detail = (over: Partial<InboxAssignmentDetail> = {}): InboxAssignmentDetail => ({
  assignmentId: 'a1',
  questionnaire: {
    id: 'q1',
    schemaVersion: 1,
    version: 1,
    title: 'Weekly check-in',
    type: 'role-feedback',
    sensitivity: 'standard',
    questions: [{ id: 'qq1', type: 'shortText', prompt: 'How are we doing?', required: true }],
    createdAt: 'now',
    updatedAt: 'now',
  },
  status: 'sent',
  privacy: 'private',
  senderName: 'Ben',
  answers: [],
  answerable: true,
  fromSelf: false,
  ...over,
});

describe('Inbox', () => {
  it('shows the empty state, with no create action when the person cannot create questionnaires', async () => {
    installMockBridge({ assignmentsInbox: () => Promise.resolve([]) });
    renderInbox(); // no role signed in → can('questionnaires.create') is false
    expect(await screen.findByText(/nothing to answer right now/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /create a questionnaire/i }),
    ).not.toBeInTheDocument();
  });

  it('offers "Create a questionnaire" in the empty state when the person can create them', async () => {
    signIn('owner');
    installMockBridge({ assignmentsInbox: () => Promise.resolve([]) });
    renderInbox();
    expect(await screen.findByText(/nothing to answer right now/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create a questionnaire/i })).toBeInTheDocument();
  });

  it('lists an assignment with who sent it and a New chip', async () => {
    installMockBridge({ assignmentsInbox: () => Promise.resolve([item()]) });
    renderInbox();
    expect(await screen.findByText('Weekly check-in')).toBeInTheDocument();
    expect(screen.getByText(/From Ben/)).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
  });

  it('shows a "Your biographer" eyebrow on a Your Story interview send (64 §5.5)', async () => {
    installMockBridge({
      assignmentsInbox: () => Promise.resolve([item({ fromBiographer: true })]),
    });
    renderInbox();
    expect(await screen.findByText(/Your biographer · From Ben/)).toBeInTheDocument();
  });

  it('opens an assignment, shows the privacy promise + crisis footer, and submits answers', async () => {
    const submit = vi.fn(() => Promise.resolve());
    installMockBridge({
      assignmentsInbox: () => Promise.resolve([item()]),
      assignmentsGet: () => Promise.resolve(detail()),
      assignmentsOpen: () => Promise.resolve(),
      assignmentsSubmit: submit,
    });
    renderInbox();

    await userEvent.click(await screen.findByRole('button', { name: /Weekly check-in/ }));
    // Private mode tells the recipient their raw answers stay hidden — the shared derived
    // `externalSendDisclosure` wording (one source with the relay page + the landing privacy chips, §8.4) —
    // and crisis help is always present.
    expect(await screen.findByText(/won’t see your written answers/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /get help now/i })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('How are we doing?'), 'Pretty well');
    // Last step → Review & send → Send answers (the unlocked wizard, §25.1).
    await userEvent.click(screen.getByRole('button', { name: 'Review & send' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send answers' }));

    expect(submit).toHaveBeenCalledWith({
      assignmentId: 'a1',
      answers: [{ questionId: 'qq1', value: 'Pretty well' }],
    });
  });

  it('removes a self check-in from the Inbox with a confirm — "Delete" (#350)', async () => {
    const dismiss = vi.fn(() => Promise.resolve());
    installMockBridge({
      assignmentsInbox: () => Promise.resolve([item()]),
      assignmentsGet: () => Promise.resolve(detail({ fromSelf: true })),
      assignmentsDismiss: dismiss,
    });
    renderInbox();

    await userEvent.click(await screen.findByRole('button', { name: /Weekly check-in/ }));
    // A self check-in offers outright deletion (not "Remove from my Inbox").
    await userEvent.click(await screen.findByRole('button', { name: 'Delete this check-in' }));
    expect(screen.getByText(/removes it for good/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(dismiss).toHaveBeenCalledWith('a1');
  });

  it('removes a send from someone else with a confirm — "Remove from my Inbox" (#350)', async () => {
    const dismiss = vi.fn(() => Promise.resolve());
    installMockBridge({
      assignmentsInbox: () => Promise.resolve([item()]),
      assignmentsGet: () => Promise.resolve(detail({ fromSelf: false })),
      assignmentsDismiss: dismiss,
    });
    renderInbox();

    await userEvent.click(await screen.findByRole('button', { name: /Weekly check-in/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Remove from my Inbox' }));
    // The confirm makes clear the sender keeps their copy — a dismiss, not a delete.
    expect(screen.getByText(/Ben keeps their copy/i)).toBeInTheDocument();
    // "Keep it" backs out without calling the IPC.
    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(dismiss).not.toHaveBeenCalled();
    // Re-open the confirm and go through with it.
    await userEvent.click(screen.getByRole('button', { name: 'Remove from my Inbox' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(dismiss).toHaveBeenCalledWith('a1');
  });

  it('“That’s not right about me” rewrites the question AND its answers, quoting the source (§32)', async () => {
    const corrected = {
      id: 'qq1',
      type: 'singleChoice' as const,
      prompt: 'How did turning 41 feel?',
      required: false,
      // A genuine rewrite: FEWER options than the original three, and wording that drops the wrong fact.
      options: ['Good', 'Hard'],
    };
    const correctFact = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        problem: 'wrongFact' as const,
        question: corrected,
        source: 'insight' as const,
        sourceLabel: 'your Memory',
        sourceText: 'Turned 39 last May',
        insightFlagged: true,
      }),
    );
    const submit = vi.fn(() => Promise.resolve());
    // The host rewrites the send's snapshot, so re-reading it returns the CORRECTED question.
    let asked = {
      id: 'qq1',
      type: 'singleChoice' as const,
      prompt: 'How did turning 39 feel?',
      required: false,
      options: ['Good at 39', 'Hard at 39', 'Same as 35'],
    };
    installMockBridge({
      assignmentsInbox: () => Promise.resolve([item()]),
      assignmentsGet: () =>
        Promise.resolve(
          detail({
            questionnaire: {
              id: 'q1',
              schemaVersion: 1,
              version: 1,
              title: 'Weekly check-in',
              type: 'role-feedback',
              sensitivity: 'standard',
              questions: [asked],
              createdAt: 'now',
              updatedAt: 'now',
            },
          }),
        ),
      assignmentsCorrectFact: () => {
        asked = corrected;
        return correctFact();
      },
      assignmentsSubmit: submit,
    });
    renderInbox();

    await userEvent.click(await screen.findByRole('button', { name: /Weekly check-in/ }));
    expect(await screen.findByText('How did turning 39 feel?')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /That’s not right about me/ }));
    await userEvent.type(
      screen.getByLabelText(/what’s wrong about this question/i),
      'I turned 41, not 39.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Fix it' }));

    expect(correctFact).toHaveBeenCalled();
    expect(await screen.findByText('How did turning 41 feel?')).toBeInTheDocument();
    // §32.4 — the source is QUOTED in place, not a row of section buttons.
    expect(screen.getByText(/Turned 39 last May/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Onboarding' })).not.toBeInTheDocument();

    // §32.3 — the ANSWERS are genuinely replaced, and the answer is recorded against the CORRECTED
    // question. No mapping back to a wording the person never chose.
    await userEvent.click(screen.getByRole('button', { name: 'Answer the rewritten question' }));
    expect(await screen.findByRole('radio', { name: 'Good' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Good at 39' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Good' }));
    await userEvent.click(screen.getByRole('button', { name: 'Review & send' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send answers' }));
    expect(submit).toHaveBeenCalledWith({
      assignmentId: 'a1',
      answers: [{ questionId: 'qq1', value: 'Good' }],
    });
  });

  it('“the answers don’t fit” REPLACES the answers, and never asks which record is wrong (§32.7)', async () => {
    // The member-reported regression: objecting to the ANSWERS showed a wall of "which of your records is
    // wrong?" buttons — answering a question they never asked — and left the answers untouched.
    const corrected = {
      id: 'qq1',
      type: 'singleChoice' as const,
      prompt: 'Which pull is stronger right now?',
      required: false,
      options: ['Staying in control', 'Handing it over', 'Neither, it varies'],
    };
    let asked = {
      id: 'qq1',
      type: 'singleChoice' as const,
      prompt: 'Which pull is stronger right now?',
      required: false,
      options: ['Nothing to do with this', 'Also unrelated'],
    };
    const submit = vi.fn(() => Promise.resolve());
    installMockBridge({
      assignmentsInbox: () => Promise.resolve([item()]),
      assignmentsGet: () =>
        Promise.resolve(
          detail({
            questionnaire: {
              id: 'q1',
              schemaVersion: 1,
              version: 1,
              title: 'Weekly check-in',
              type: 'role-feedback',
              sensitivity: 'standard',
              questions: [asked],
              createdAt: 'now',
              updatedAt: 'now',
            },
          }),
        ),
      assignmentsCorrectFact: () => {
        asked = corrected;
        return Promise.resolve({
          ok: true as const,
          problem: 'answersDontFit' as const,
          question: corrected,
          source: 'unknown' as const,
        });
      },
      assignmentsSubmit: submit,
    });
    renderInbox();

    await userEvent.click(await screen.findByRole('button', { name: /Weekly check-in/ }));
    await userEvent.click(await screen.findByRole('button', { name: /That’s not right about me/ }));
    await userEvent.type(
      screen.getByLabelText(/what’s wrong about this question/i),
      'the answers dont match the question',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Fix it' }));

    // No record picker — they weren't disputing anything on file.
    expect(await screen.findByText(/Rewrote this question/)).toBeInTheDocument();
    expect(screen.queryByText(/which one is wrong/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/your onboarding answers/)).not.toBeInTheDocument();

    // The answers are genuinely replaced, including an honest "neither".
    await userEvent.click(screen.getByRole('button', { name: 'Answer the rewritten question' }));
    expect(await screen.findByRole('radio', { name: 'Neither, it varies' })).toBeInTheDocument();
    expect(
      screen.queryByRole('radio', { name: 'Nothing to do with this' }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Neither, it varies' }));
    await userEvent.click(screen.getByRole('button', { name: 'Review & send' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send answers' }));
    expect(submit).toHaveBeenCalledWith({
      assignmentId: 'a1',
      answers: [{ questionId: 'qq1', value: 'Neither, it varies' }],
    });
  });

  it('a profile match offers an inline confirm, and “Leave it” actually dismisses it (§32.4)', async () => {
    const applyFix = vi.fn(() => Promise.resolve({ ok: true }));
    installMockBridge({
      assignmentsInbox: () => Promise.resolve([item()]),
      assignmentsGet: () => Promise.resolve(detail()),
      assignmentsCorrectFact: () =>
        Promise.resolve({
          ok: true as const,
          problem: 'wrongFact' as const,
          question: {
            id: 'qq1',
            type: 'shortText' as const,
            prompt: 'How did your last birthday feel?',
            required: false,
          },
          source: 'profile' as const,
          sourceLabel: 'your birthday',
          sourceText: 'age: 39 (born 1987-05-14)',
          profileFix: {
            field: 'birthday' as const,
            label: 'Your birthday',
            currentValue: '1987-05-14',
            proposedValue: '1985-05-14',
          },
        }),
      assignmentsApplyProfileFix: applyFix,
    });
    renderInbox();

    await userEvent.click(await screen.findByRole('button', { name: /Weekly check-in/ }));
    await userEvent.click(await screen.findByRole('button', { name: /That’s not right about me/ }));
    await userEvent.type(screen.getByLabelText(/what’s wrong about this question/i), 'I’m 41.');
    await userEvent.click(screen.getByRole('button', { name: 'Fix it' }));

    // Proposed, never applied on its own — nothing is written until the explicit tap.
    const confirm = await screen.findByRole('button', { name: /Change it to 1985-05-14/ });
    expect(applyFix).not.toHaveBeenCalled();

    // "Leave it" must actually dismiss the control (it used to be a no-op).
    await userEvent.click(screen.getByRole('button', { name: 'Leave it' }));
    expect(confirm).not.toBeInTheDocument();
    expect(applyFix).not.toHaveBeenCalled();
  });

  it('required = answer or skip: Send is disabled on review until a required question is answered (§25.3)', async () => {
    const submit = vi.fn(() => Promise.resolve());
    installMockBridge({
      assignmentsInbox: () => Promise.resolve([item()]),
      assignmentsGet: () => Promise.resolve(detail()),
      assignmentsSubmit: submit,
    });
    renderInbox();

    await userEvent.click(await screen.findByRole('button', { name: /Weekly check-in/ }));
    // Go to review WITHOUT answering the single required question → Send is disabled, submit not called.
    await userEvent.click(await screen.findByRole('button', { name: 'Review & send' }));
    expect(screen.getByRole('button', { name: 'Send answers' })).toBeDisabled();
    expect(submit).not.toHaveBeenCalled();

    // Edit it (via the review row) → answer → back to review → Send enabled → submits.
    const row = screen.getByText('How are we doing?').closest('li') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    await userEvent.type(screen.getByLabelText('How are we doing?'), 'Pretty well');
    await userEvent.click(screen.getByRole('button', { name: 'Review & send' }));
    const send = screen.getByRole('button', { name: 'Send answers' });
    expect(send).toBeEnabled();
    await userEvent.click(send);
    expect(submit).toHaveBeenCalled();
  });

  it('steps through multiple questions with FREE Back/Next — no blocking gate (§25.1)', async () => {
    const submit = vi.fn(() => Promise.resolve());
    const twoQ = detail({
      questionnaire: {
        ...detail().questionnaire,
        questions: [
          { id: 'qq1', type: 'shortText', prompt: 'How are we doing?', required: true },
          { id: 'qq2', type: 'shortText', prompt: 'Anything else?', required: false },
        ],
      },
    });
    installMockBridge({
      assignmentsInbox: () => Promise.resolve([item({ questionCount: 2 })]),
      assignmentsGet: () => Promise.resolve(twoQ),
      assignmentsSubmit: submit,
    });
    renderInbox();

    await userEvent.click(await screen.findByRole('button', { name: /Weekly check-in/ }));
    expect(await screen.findByText('Question 1 of 2')).toBeInTheDocument();
    // Next advances FREELY even though the required first question is empty (no block, §25.1).
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Question 2 of 2')).toBeInTheDocument();
    expect(screen.queryByText(/answer this question before continuing/i)).not.toBeInTheDocument();
    // Back returns to step 1; answering it and stepping preserves the value.
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Question 1 of 2')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('How are we doing?'), 'Well');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('How are we doing?')).toHaveValue('Well');
  });

  it('declines with an optional note', async () => {
    const decline = vi.fn(() => Promise.resolve());
    installMockBridge({
      assignmentsInbox: () => Promise.resolve([item()]),
      assignmentsGet: () => Promise.resolve(detail()),
      assignmentsDecline: decline,
    });
    renderInbox();

    await userEvent.click(await screen.findByRole('button', { name: /Weekly check-in/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Decline' }));
    await userEvent.type(screen.getByLabelText(/decline note/i), 'Not a good time');
    await userEvent.click(screen.getByRole('button', { name: 'Decline' }));

    expect(decline).toHaveBeenCalledWith({ assignmentId: 'a1', note: 'Not a good time' });
  });

  it('reviews a submitted assignment + offers Edit answers (56)', async () => {
    installMockBridge({
      assignmentsInbox: () => Promise.resolve([item({ status: 'submitted', answerable: false })]),
      assignmentsGet: () =>
        Promise.resolve(
          detail({
            status: 'submitted',
            answerable: false,
            answers: [{ questionId: 'qq1', value: 'Pretty well' }],
          }),
        ),
    });
    renderInbox();

    await userEvent.click(await screen.findByRole('button', { name: /Weekly check-in/ }));
    expect(await screen.findByText(/submitted this questionnaire/i)).toBeInTheDocument();
    // The recipient sees their own answer + an Edit affordance (56 §3.1); no live Submit.
    expect(screen.getByRole('heading', { name: 'Your answers' })).toBeInTheDocument();
    expect(screen.getByText('Pretty well')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit answers' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
  });

  it('edits + resends a submitted assignment → reopen then submit (56)', async () => {
    const reopen = vi.fn(() => Promise.resolve());
    const submit = vi.fn(() => Promise.resolve());
    installMockBridge({
      assignmentsInbox: () => Promise.resolve([item({ status: 'submitted', answerable: false })]),
      assignmentsGet: () =>
        Promise.resolve(
          detail({
            status: 'submitted',
            answerable: false,
            answers: [{ questionId: 'qq1', value: 'Pretty well' }],
          }),
        ),
      assignmentsReopen: reopen,
      assignmentsSubmit: submit,
    });
    renderInbox();

    await userEvent.click(await screen.findByRole('button', { name: /Weekly check-in/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Edit answers' }));

    // The form appears, pre-filled with the submitted answer.
    const field = screen.getByLabelText('How are we doing?');
    expect(field).toHaveValue('Pretty well');
    await userEvent.clear(field);
    await userEvent.type(field, 'Actually, much better');
    // Last step → Review & send → the host's "Update answers" label lands on the review Send button.
    await userEvent.click(screen.getByRole('button', { name: 'Review & send' }));
    await userEvent.click(screen.getByRole('button', { name: 'Update answers' }));

    // Update = re-open the submitted send, then submit the edited answers.
    expect(reopen).toHaveBeenCalledWith('a1');
    expect(submit).toHaveBeenCalledWith({
      assignmentId: 'a1',
      answers: [{ questionId: 'qq1', value: 'Actually, much better' }],
    });
  });

  it('does NOT offer Edit answers on a submitted compatibility send (56)', async () => {
    installMockBridge({
      assignmentsInbox: () => Promise.resolve([item({ status: 'submitted', answerable: false })]),
      assignmentsGet: () =>
        Promise.resolve(
          detail({
            status: 'submitted',
            answerable: false,
            compatibility: {
              visibility: 'sharedReport',
              otherParticipantName: 'Bri',
              viewerIsSender: false,
              report: null,
            },
          }),
        ),
    });
    renderInbox();
    await userEvent.click(await screen.findByRole('button', { name: /Weekly check-in/ }));
    expect(await screen.findByText(/submitted this questionnaire/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit answers' })).not.toBeInTheDocument();
  });

  it('shows the compatibility disclosure derived from the visibility mode', async () => {
    installMockBridge({
      assignmentsInbox: () => Promise.resolve([item()]),
      assignmentsGet: () =>
        Promise.resolve(
          detail({
            compatibility: {
              visibility: 'eachSeesOwn',
              report: null,
              otherParticipantName: 'Bri',
              viewerIsSender: false,
            },
          }),
        ),
    });
    renderInbox();

    await userEvent.click(await screen.findByRole('button', { name: /Weekly check-in/ }));
    // eachSeesOwn promises the answerer can review their own answers, and names the OTHER participant
    // (§16.1), not the sender as a neutral third party — derived, not hard-coded.
    expect(await screen.findByText(/review your own answers/i)).toBeInTheDocument();
    expect(screen.getByText(/Bri won't see them/i)).toBeInTheDocument();
  });

  it('shows the answerer their joint report once they’ve submitted a compatibility send', async () => {
    installMockBridge({
      assignmentsInbox: () => Promise.resolve([item({ status: 'submitted', answerable: false })]),
      assignmentsGet: () =>
        Promise.resolve(
          detail({
            status: 'submitted',
            answerable: false,
            compatibility: {
              visibility: 'sharedReport',
              otherParticipantName: 'Bri',
              viewerIsSender: false,
              report: {
                schemaVersion: 1,
                compatibilityGroupId: 'g1',
                questionnaireId: 'q1',
                personAName: 'Alex',
                personBName: 'Bri',
                summary: 'You two are mostly aligned.',
                items: [
                  { canonicalId: 'c1', prompt: 'How connected?', agreement: 'aligned', note: '' },
                ],
                generatedAt: 'now',
              },
            },
          }),
        ),
    });
    renderInbox();

    await userEvent.click(await screen.findByRole('button', { name: /Weekly check-in/ }));
    expect(await screen.findByText('Your shared report')).toBeInTheDocument();
    expect(screen.getByText('You two are mostly aligned.')).toBeInTheDocument();
    expect(screen.getByText('Aligned')).toBeInTheDocument();
  });

  it('contextOnly (§16.2): the recipient is told there is no report, before and after submitting', async () => {
    const compatibility = {
      visibility: 'contextOnly' as const,
      report: null,
      otherParticipantName: 'Bri',
      viewerIsSender: false,
    };
    // Before submitting: the disclosure promises no report + no one sees the answers.
    installMockBridge({
      assignmentsInbox: () => Promise.resolve([item()]),
      assignmentsGet: () => Promise.resolve(detail({ compatibility })),
    });
    const { unmount } = renderInbox();
    await userEvent.click(await screen.findByRole('button', { name: /Weekly check-in/ }));
    expect(
      await screen.findByText(/no one in this exchange sees your answers/i),
    ).toBeInTheDocument();
    unmount();
    useInboxStore.setState({ items: [], loaded: false });

    // After submitting: still no report — just the "helps your own coach" note.
    installMockBridge({
      assignmentsInbox: () => Promise.resolve([item({ status: 'submitted', answerable: false })]),
      assignmentsGet: () =>
        Promise.resolve(detail({ status: 'submitted', answerable: false, compatibility })),
    });
    renderInbox();
    await userEvent.click(await screen.findByRole('button', { name: /Weekly check-in/ }));
    expect(await screen.findByText(/there’s no report for this one/i)).toBeInTheDocument();
    expect(screen.queryByText('Your shared report')).not.toBeInTheDocument();
  });
});
