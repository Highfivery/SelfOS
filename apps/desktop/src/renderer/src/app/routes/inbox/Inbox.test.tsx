import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  questionCount: 1,
  status: 'sent',
  privacy: 'private',
  senderName: 'Ben',
  createdAt: '2026-06-11T00:00:00.000Z',
  answerable: true,
  hasDraft: false,
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
    // Private mode tells the recipient their raw answers stay hidden, and crisis help is always present.
    expect(await screen.findByText(/won’t see your individual responses/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /get help now/i })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('How are we doing?'), 'Pretty well');
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(submit).toHaveBeenCalledWith({
      assignmentId: 'a1',
      answers: [{ questionId: 'qq1', value: 'Pretty well' }],
    });
  });

  it('blocks submit until required questions are answered', async () => {
    const submit = vi.fn(() => Promise.resolve());
    installMockBridge({
      assignmentsInbox: () => Promise.resolve([item()]),
      assignmentsGet: () => Promise.resolve(detail()),
      assignmentsSubmit: submit,
    });
    renderInbox();

    await userEvent.click(await screen.findByRole('button', { name: /Weekly check-in/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Submit' }));

    expect(screen.getByText(/required question/i)).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
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

  it('locks a submitted assignment (no answer review)', async () => {
    installMockBridge({
      assignmentsInbox: () => Promise.resolve([item({ status: 'submitted', answerable: false })]),
      assignmentsGet: () => Promise.resolve(detail({ status: 'submitted', answerable: false })),
    });
    renderInbox();

    await userEvent.click(await screen.findByRole('button', { name: /Weekly check-in/ }));
    expect(await screen.findByText(/submitted this questionnaire/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
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
