import { create } from 'zustand';
import type {
  ContributionInvite,
  ContributionInviteView,
  ContributionKind,
  ContributionReview,
  ContributionView,
} from '@shared/schemas';

/**
 * Household contributions (73) — both halves of the model in one per-person store.
 *
 * The two sides are deliberately separate state: `invitations`/`mine` are what the ACTIVE person was offered
 * and has offered, while `invites`/`reviews` are what their OWN book has open and waiting. Everything here
 * is per-person, so it is reset on a person switch like the story store beside it.
 */
interface ContributionState {
  /** Contributor side: books other people have opened to me. */
  invitations: ContributionInviteView[];
  /** Contributor side: what I've offered, and where each stands. Never the book behind it. */
  mine: ContributionView[];
  /** Author side, per book: who I've invited. */
  invites: ContributionInvite[];
  /** Author side, per book: what's waiting on my decision (and what I've already decided). */
  reviews: ContributionReview[];
  busy: boolean;
  loadMine: () => Promise<void>;
  loadForBook: (bookId: string) => Promise<void>;
  invite: (bookId: string, personId: string, note?: string) => Promise<void>;
  revoke: (bookId: string, personId: string) => Promise<void>;
  submit: (input: {
    invitationId: string;
    kind: ContributionKind;
    text: string;
    chapterId?: string;
  }) => Promise<ContributionView | null>;
  withdraw: (contributionId: string) => Promise<void>;
  decide: (
    bookId: string,
    contributionId: string,
    status: 'accepted' | 'declined',
    attributed?: boolean,
  ) => Promise<void>;
  reset: () => void;
}

export const useContributionStore = create<ContributionState>((set, get) => ({
  invitations: [],
  mine: [],
  invites: [],
  reviews: [],
  busy: false,

  loadMine: async () => {
    const [invitations, mine] = await Promise.all([
      window.selfos?.booksMyInvitations() ?? Promise.resolve([]),
      window.selfos?.booksMyContributions() ?? Promise.resolve([]),
    ]);
    set({ invitations, mine });
  },

  loadForBook: async (bookId) => {
    const [reviews, invites] = await Promise.all([
      window.selfos?.booksBookContributions({ bookId }) ?? Promise.resolve([]),
      window.selfos?.booksContributionInvites({ bookId }) ?? Promise.resolve([]),
    ]);
    set({ reviews, invites });
  },

  invite: async (bookId, personId, note) => {
    set({ busy: true });
    try {
      await window.selfos?.booksInviteContribution({
        bookId,
        personId,
        ...(note?.trim() ? { note: note.trim() } : {}),
      });
      await get().loadForBook(bookId);
    } finally {
      set({ busy: false });
    }
  },

  revoke: async (bookId, personId) => {
    set({ busy: true });
    try {
      await window.selfos?.booksRevokeContributionInvite({ bookId, personId });
      await get().loadForBook(bookId);
    } finally {
      set({ busy: false });
    }
  },

  submit: async (input) => {
    set({ busy: true });
    try {
      const created = (await window.selfos?.booksSubmitContribution(input)) ?? null;
      await get().loadMine();
      return created;
    } finally {
      set({ busy: false });
    }
  },

  withdraw: async (contributionId) => {
    set({ busy: true });
    try {
      const mine = (await window.selfos?.booksWithdrawContribution({ contributionId })) ?? [];
      set({ mine });
    } finally {
      set({ busy: false });
    }
  },

  decide: async (bookId, contributionId, status, attributed) => {
    set({ busy: true });
    try {
      const reviews =
        (await window.selfos?.booksDecideContribution({
          bookId,
          contributionId,
          status,
          ...(attributed === undefined ? {} : { attributed }),
        })) ?? [];
      set({ reviews });
    } finally {
      set({ busy: false });
    }
  },

  reset: () => set({ invitations: [], mine: [], invites: [], reviews: [], busy: false }),
}));
