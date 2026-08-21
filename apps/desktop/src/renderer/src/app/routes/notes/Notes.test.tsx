import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_ROLES } from '@shared/capabilities';
import { Notes } from './Notes';
import { useNoteStore } from '../../../stores/noteStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

afterEach(() => {
  clearMockBridge();
  useNoteStore.getState().reset();
  useSessionStore.setState({ activePerson: null, access: null });
});

/** Sign in as the Owner — `notes.manage` is owner-only, via the `roleAllows` full-access bypass. */
function asOwner(): void {
  useSessionStore.setState({
    activePerson: {
      id: 'owner-1',
      schemaVersion: 1,
      displayName: 'Ben',
      isSubject: true,
      tags: [],
      createdAt: 'now',
      updatedAt: 'now',
    },
    access: {
      roles: DEFAULT_ROLES,
      accounts: [{ personId: 'owner-1', roleId: 'owner', hasPin: false }],
    },
  });
}

function asMember(): void {
  useSessionStore.setState({
    activePerson: {
      id: 'mem-1',
      schemaVersion: 1,
      displayName: 'Mo',
      isSubject: true,
      tags: [],
      createdAt: 'now',
      updatedAt: 'now',
    },
    access: {
      roles: DEFAULT_ROLES,
      accounts: [{ personId: 'mem-1', roleId: 'member', hasPin: false }],
    },
  });
}

const ANGEL = {
  personId: 'p-angel',
  displayName: 'Angel',
  email: 'angel@example.com',
  reachableByEmail: true,
};
const JONAH = { personId: 'p-jonah', displayName: 'Jonah', reachableByEmail: false };

describe('Notes (76 §3)', () => {
  it('renders nothing for a member — the surface is owner-only', () => {
    asMember();
    installMockBridge({ notesRecipients: () => Promise.resolve([ANGEL]) });
    const { container } = render(<Notes />);
    expect(screen.queryByRole('heading', { name: 'Notes' })).not.toBeInTheDocument();
    expect(container.textContent).toBe('');
  });

  it('walks who → compose → preview → send, and the recipient is chosen FIRST', async () => {
    asOwner();
    const notesSend = vi.fn(() =>
      Promise.resolve({ ok: true as const, noteId: 'n1', emailed: true }),
    );
    const notesDraft = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        subject: 'Something for those late nights',
        body: 'You’ve written most nights this month.',
        answers: [{ label: 'I’m game', stance: 'yes' as const }],
      }),
    );
    installMockBridge({
      notesRecipients: () => Promise.resolve([ANGEL, JONAH]),
      notesList: () => Promise.resolve([]),
      notesDraft,
      notesSend,
    });

    render(<Notes />);
    await userEvent.click(await screen.findByRole('button', { name: 'Write a note' }));

    // Step 1 is the PERSON, before a word of the note exists — and it is single-select by construction.
    expect(screen.getByRole('heading', { name: 'Who is this for?' })).toBeInTheDocument();
    const angel = screen.getByRole('radio', { name: /Angel/ });
    expect(angel).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(angel);
    expect(angel).toHaveAttribute('aria-checked', 'true');
    // Picking one does not select another — a note has exactly one recipient.
    expect(screen.getByRole('radio', { name: /Jonah/ })).toHaveAttribute('aria-checked', 'false');

    await userEvent.click(screen.getByRole('button', { name: /Write for Angel/ }));

    // Step 2 is written FOR them — the header names them, and so does the draft button.
    expect(screen.getByRole('heading', { name: 'A note for Angel' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('What are you thinking?'), 'dream images are live');
    await userEvent.click(screen.getByRole('button', { name: /Draft it for Angel/ }));

    expect(notesDraft).toHaveBeenCalledWith(
      expect.objectContaining({ recipientPersonId: 'p-angel', intent: 'dream images are live' }),
    );
    expect(await screen.findByDisplayValue('Something for those late nights')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^Preview/ }));
    await userEvent.click(screen.getByRole('button', { name: /Send to Angel/ }));

    expect(notesSend).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientPersonId: 'p-angel',
        subject: 'Something for those late nights',
        drafted: 'ai',
      }),
    );
  });

  it('offers to add an address for someone unreachable, and says the note still lands', async () => {
    asOwner();
    const peopleSetEmail = vi.fn(() => Promise.resolve(null));
    installMockBridge({
      notesRecipients: () => Promise.resolve([JONAH]),
      notesList: () => Promise.resolve([]),
      peopleSetEmail,
    });

    render(<Notes />);
    await userEvent.click(await screen.findByRole('button', { name: 'Write a note' }));
    await userEvent.click(screen.getByRole('radio', { name: /Jonah/ }));

    // Honest about reach BEFORE sending, rather than reporting a failure after.
    expect(screen.getByText(/reach their SelfOS inbox only/)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/Email address for Jonah/), 'jonah@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Save to their profile' }));
    expect(peopleSetEmail).toHaveBeenCalledWith({
      personId: 'p-jonah',
      email: 'jonah@example.com',
    });
  });

  it('surfaces a failed draft in place, and does NOT wipe what was already written', async () => {
    asOwner();
    installMockBridge({
      notesRecipients: () => Promise.resolve([ANGEL]),
      notesList: () => Promise.resolve([]),
      notesDraft: () =>
        Promise.resolve({
          ok: false as const,
          reason: 'MALFORMED' as const,
          message: 'That draft spoke as a person. Try again.',
        }),
    });

    render(<Notes />);
    await userEvent.click(await screen.findByRole('button', { name: 'Write a note' }));
    await userEvent.click(screen.getByRole('radio', { name: /Angel/ }));
    await userEvent.click(screen.getByRole('button', { name: /Write for Angel/ }));

    // Write something by hand FIRST, then let an AI draft fail over the top of it.
    await userEvent.click(screen.getByRole('button', { name: 'Write it myself' }));
    await userEvent.type(screen.getByLabelText('Subject'), 'Mine');
    await userEvent.click(screen.getByRole('button', { name: 'Draft something' }));
    await userEvent.type(screen.getByLabelText('What are you thinking?'), 'x');
    await userEvent.click(screen.getByRole('button', { name: /Draft it for Angel/ }));

    expect(await screen.findByText(/spoke as a person/)).toBeInTheDocument();
    // A failed pass must not fold its (empty) payload into the view — the 75 §11.1 lesson.
    expect(screen.getByDisplayValue('Mine')).toBeInTheDocument();
  });

  it('shows delivery as a timeline, and says plainly when a note never emailed', async () => {
    asOwner();
    const base = {
      id: 'n1',
      schemaVersion: 1 as const,
      authorPersonId: 'owner-1',
      recipientPersonId: 'p-angel',
      subject: 'Covers are here',
      body: 'Your books can have covers now.',
      answers: [],
      drafted: 'ai' as const,
      createdAt: '2026-08-21T12:00:00.000Z',
    };
    installMockBridge({
      notesRecipients: () => Promise.resolve([ANGEL]),
      notesList: () =>
        Promise.resolve([
          { note: { ...base, type: 'announcement' as const }, recipientName: 'Angel' },
        ]),
    });

    render(<Notes />);
    expect(await screen.findByText('Covers are here')).toBeInTheDocument();
    expect(screen.getByText(/In SelfOS only — no email address on file/)).toBeInTheDocument();
  });
});
