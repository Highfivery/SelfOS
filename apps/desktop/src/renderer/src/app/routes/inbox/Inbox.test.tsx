import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { InboxAssignmentDetail, InboxItem } from '@shared/channels';
import { Inbox } from './Inbox';
import { useInboxStore } from '../../../stores/inboxStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

afterEach(() => {
  clearMockBridge();
  useInboxStore.setState({ items: [], loaded: false });
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
  it('shows the empty state when nothing has been sent', async () => {
    installMockBridge({ assignmentsInbox: () => Promise.resolve([]) });
    render(<Inbox />);
    expect(await screen.findByText(/nothing to answer right now/i)).toBeInTheDocument();
  });

  it('lists an assignment with who sent it and a New chip', async () => {
    installMockBridge({ assignmentsInbox: () => Promise.resolve([item()]) });
    render(<Inbox />);
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
    render(<Inbox />);

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
    render(<Inbox />);

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
    render(<Inbox />);

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
    render(<Inbox />);

    await userEvent.click(await screen.findByRole('button', { name: /Weekly check-in/ }));
    expect(await screen.findByText(/submitted this questionnaire/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
  });

  it('shows the compatibility disclosure derived from the visibility mode', async () => {
    installMockBridge({
      assignmentsInbox: () => Promise.resolve([item()]),
      assignmentsGet: () =>
        Promise.resolve(detail({ compatibility: { visibility: 'eachSeesOwn', report: null } })),
    });
    render(<Inbox />);

    await userEvent.click(await screen.findByRole('button', { name: /Weekly check-in/ }));
    // eachSeesOwn promises the answerer can review their own answers — derived, not hard-coded.
    expect(await screen.findByText(/review your own answers/i)).toBeInTheDocument();
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
    render(<Inbox />);

    await userEvent.click(await screen.findByRole('button', { name: /Weekly check-in/ }));
    expect(await screen.findByText('Your shared report')).toBeInTheDocument();
    expect(screen.getByText('You two are mostly aligned.')).toBeInTheDocument();
    expect(screen.getByText('Aligned')).toBeInTheDocument();
  });
});
