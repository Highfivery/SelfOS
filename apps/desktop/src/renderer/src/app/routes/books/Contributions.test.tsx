import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type {
  ContributionInvite,
  ContributionInviteView,
  ContributionReview,
  ContributionView,
  Person,
  Relationship,
} from '@shared/schemas';
import { ContributeRoute } from './ContributeRoute';
import { ContributionsPanel } from './ContributionsPanel';
import { useContributionStore } from '../../../stores/contributionStore';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

function person(id: string, displayName: string): Person {
  return {
    id,
    schemaVersion: 2,
    displayName,
    isSubject: true,
    tags: [],
    createdAt: 'now',
    updatedAt: 'now',
  };
}

const ME = person('me', 'Ben');
const ANGEL = person('angel', 'Angel');
/** The relationship IS the standing grant (72 §5.8) — an unrelated household member is not invitable. */
const PARTNER: Relationship = {
  id: 'rel',
  schemaVersion: 2,
  fromPersonId: 'me',
  toPersonId: 'angel',
  type: 'partner',
  createdAt: 'now',
  updatedAt: 'now',
};

const invitation: ContributionInviteView = {
  id: 'inv-1',
  bookId: 'b1',
  authorPersonId: 'ben',
  authorName: 'Ben',
  note: 'Anything about the Denver years?',
  canRead: false,
};

afterEach(() => {
  clearMockBridge();
  useContributionStore.getState().reset();
  vi.restoreAllMocks();
});

describe('contributing to someone else’s book (73 §3.2)', () => {
  function renderContribute(overrides: Parameters<typeof installMockBridge>[0] = {}): void {
    installMockBridge({
      booksMyInvitations: () => Promise.resolve([invitation]),
      booksMyContributions: () => Promise.resolve([]),
      ...overrides,
    });
    render(
      <MemoryRouter initialEntries={['/contribute/inv-1']}>
        <Routes>
          <Route path="/contribute/:invitationId" element={<ContributeRoute />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('shows what was asked and sends one offering', async () => {
    const submit = vi.fn(
      (): Promise<ContributionView> =>
        Promise.resolve({
          id: 'c1',
          bookId: 'b1',
          kind: 'memory',
          text: 'the porch',
          status: 'pending',
          createdAt: 'now',
        }),
    );
    renderContribute({ booksSubmitContribution: submit });

    expect(await screen.findByText(/Ben asked you to add to their book/)).toBeInTheDocument();
    expect(screen.getByText(/Anything about the Denver years/)).toBeInTheDocument();

    await userEvent.type(
      screen.getByLabelText('What you want to add'),
      'He rebuilt the porch that summer.',
    );
    await userEvent.click(screen.getByRole('button', { name: /Send it to Ben/ }));

    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({
        invitationId: 'inv-1',
        kind: 'memory',
        text: 'He rebuilt the porch that summer.',
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(/Sent/);
  });

  /** A correction is about something they READ — offering it on a book they can't open would be a dead end. */
  it('offers a correction only when the book is actually shared with them', async () => {
    renderContribute();
    await screen.findByText(/Ben asked you to add/);
    expect(screen.queryByRole('option', { name: 'A correction' })).not.toBeInTheDocument();

    clearMockBridge();
    useContributionStore.getState().reset();
    renderContribute({
      booksMyInvitations: () => Promise.resolve([{ ...invitation, canRead: true }]),
    });
    expect(await screen.findByRole('option', { name: 'A correction' })).toBeInTheDocument();
  });

  it('a revoked invitation is a calm dead end, and what they gave is still theirs to take back', async () => {
    const withdraw = vi.fn((): Promise<ContributionView[]> => Promise.resolve([]));
    installMockBridge({
      booksMyInvitations: () => Promise.resolve([]), // revoked, or the edge is gone
      booksMyContributions: () =>
        Promise.resolve([
          {
            id: 'c1',
            bookId: 'b1',
            kind: 'memory',
            text: 'the porch',
            status: 'accepted',
            createdAt: 'now',
          },
        ] as ContributionView[]),
      booksWithdrawContribution: withdraw,
    });
    render(
      <MemoryRouter initialEntries={['/contribute/inv-1']}>
        <Routes>
          <Route path="/contribute/:invitationId" element={<ContributeRoute />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/isn’t open any more/)).toBeInTheDocument();
    // Withdrawal is unconditional — it stays available after the author accepted it.
    await userEvent.click(screen.getByRole('button', { name: 'Take it back' }));
    await waitFor(() => expect(withdraw).toHaveBeenCalledWith({ contributionId: 'c1' }));
  });

  it('never names the book it belongs to — the contributor sees only their own words', async () => {
    renderContribute({
      booksMyContributions: () =>
        Promise.resolve([
          {
            id: 'c1',
            bookId: 'b1',
            kind: 'memory',
            text: 'the porch',
            status: 'pending',
            createdAt: 'now',
          },
        ] as ContributionView[]),
    });
    await screen.findByText(/Ben asked you to add/);
    expect(screen.getByText('waiting for them to read it')).toBeInTheDocument();
    // The view type carries no title, so there is nothing here that could name it.
    expect(document.body.textContent).not.toContain('b1');
  });
});

describe('the author’s side (73 §3.1/§3.4)', () => {
  function renderPanel(
    overrides: Parameters<typeof installMockBridge>[0] = {},
    relationships: Relationship[] = [PARTNER],
  ): void {
    useSessionStore.setState({ activePerson: ME } as never);
    usePeopleStore.setState({ people: [ME, ANGEL], relationships } as never);
    installMockBridge({
      peopleList: () => Promise.resolve([ME, ANGEL]),
      // The panel loads people itself, so the mock has to serve the edge — seeding the store alone is
      // overwritten by that load.
      relationshipsList: () => Promise.resolve(relationships),
      booksContributionInvites: () => Promise.resolve([]),
      booksBookContributions: () => Promise.resolve([]),
      ...overrides,
    });
    render(<ContributionsPanel bookId="b1" />);
  }

  it('invites one related person, never yourself, and says nobody can see the book yet', async () => {
    const invite = vi.fn(
      (): Promise<ContributionInvite> =>
        Promise.resolve({
          schemaVersion: 1,
          id: 'inv-1',
          personId: 'angel',
          bookId: 'b1',
          invitedAt: 'now',
        }),
    );
    renderPanel({ booksInviteContribution: invite });

    expect(await screen.findByText(/isn’t open to anyone yet/)).toBeInTheDocument();
    // Yourself is not offerable — you can't contribute to your own book.
    expect(screen.queryByRole('option', { name: 'Ben' })).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Who to invite'), 'angel');
    await userEvent.type(screen.getByLabelText('What to ask them about'), 'The Denver years?');
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }));

    await waitFor(() =>
      expect(invite).toHaveBeenCalledWith({
        bookId: 'b1',
        personId: 'angel',
        note: 'The Denver years?',
      }),
    );
  });

  it('only offers people you are actually related to', async () => {
    // Angel is in the household but not linked to Ben — the bridge would refuse her, so she isn't offered.
    renderPanel({}, []);
    expect(await screen.findByText(/Add someone under People and link them/)).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Angel' })).not.toBeInTheDocument();
  });

  it('says so when an invite is refused instead of appearing to do nothing', async () => {
    // The edge can go between render and click; the bridge re-checks and returns null.
    renderPanel({ booksInviteContribution: () => Promise.resolve(null) });
    await screen.findByText(/isn’t open to anyone yet/);
    await userEvent.selectOptions(screen.getByLabelText('Who to invite'), 'angel');
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/didn’t go through/);
  });

  function pendingPanel(decide: ReturnType<typeof vi.fn>): void {
    const pending: ContributionReview[] = [
      {
        id: 'c1',
        contributorId: 'angel',
        contributorName: 'Angel',
        kind: 'memory',
        text: 'He rebuilt the porch that summer.',
        status: 'pending',
        createdAt: 'now',
      },
    ];
    renderPanel({
      booksContributionInvites: () =>
        Promise.resolve([
          { schemaVersion: 1, id: 'inv-1', personId: 'angel', bookId: 'b1', invitedAt: 'now' },
        ] as ContributionInvite[]),
      booksBookContributions: () => Promise.resolve(pending),
      booksDecideContribution: decide,
    });
  }

  it('accepting credits them by name', async () => {
    const decide = vi.fn((): Promise<ContributionReview[]> => Promise.resolve([]));
    pendingPanel(decide);
    expect(await screen.findByText('He rebuilt the porch that summer.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Accept, credit Angel' }));
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith({
        bookId: 'b1',
        contributionId: 'c1',
        status: 'accepted',
        attributed: true,
      }),
    );
  });

  it('…or absorbs it as material, with their name left off', async () => {
    const decide = vi.fn((): Promise<ContributionReview[]> => Promise.resolve([]));
    pendingPanel(decide);
    expect(await screen.findByText('He rebuilt the porch that summer.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Accept without naming them' }));
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith({
        bookId: 'b1',
        contributionId: 'c1',
        status: 'accepted',
        attributed: false,
      }),
    );
  });

  it('an accepted contribution can be taken back out later', async () => {
    const decide = vi.fn((): Promise<ContributionReview[]> => Promise.resolve([]));
    renderPanel({
      booksContributionInvites: () =>
        Promise.resolve([
          { schemaVersion: 1, id: 'inv-1', personId: 'angel', bookId: 'b1', invitedAt: 'now' },
        ] as ContributionInvite[]),
      booksBookContributions: () =>
        Promise.resolve([
          {
            id: 'c1',
            contributorId: 'angel',
            contributorName: 'Angel',
            kind: 'memory',
            text: 'the porch',
            status: 'accepted',
            attributed: true,
            createdAt: 'now',
          },
        ] as ContributionReview[]),
      booksDecideContribution: decide,
    });

    expect(await screen.findByText(/Angel · accepted/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Take it back out' }));
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith({
        bookId: 'b1',
        contributionId: 'c1',
        status: 'declined',
      }),
    );
  });
});
