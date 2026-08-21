import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { NoteRead } from './NoteRead';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

afterEach(clearMockBridge);

const NOTE = {
  id: 'n1',
  authorPersonId: 'owner-1',
  subject: 'Worth a try',
  body: 'Something small this week.',
  answers: [
    { label: 'I’m game', stance: 'yes' as const },
    { label: 'Not now', stance: 'no' as const },
  ],
  createdAt: '2026-08-21T12:00:00.000Z',
};

function renderAt(): void {
  render(
    <MemoryRouter initialEntries={['/inbox/note/owner-1/n1']}>
      <Routes>
        <Route path="/inbox/note/:authorPersonId/:noteId" element={<NoteRead />} />
        <Route path="/inbox" element={<div>Inbox screen</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('NoteRead (76 §3.6)', () => {
  it('reads the note and answers it — and never names who sent it', async () => {
    const notesAnswer = vi.fn(() => Promise.resolve({ ...NOTE, answered: 'I’m game' }));
    installMockBridge({ notesGetForMe: () => Promise.resolve(NOTE), notesAnswer });

    renderAt();
    expect(await screen.findByRole('heading', { name: 'Worth a try' })).toBeInTheDocument();
    expect(screen.getByText('Something small this week.')).toBeInTheDocument();
    // A note is unattributed on BOTH surfaces — nothing here may name the author.
    expect(screen.queryByText(/from/i)).not.toBeInTheDocument();

    const game = screen.getByRole('button', { name: 'I’m game' });
    expect(game).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(game);

    expect(notesAnswer).toHaveBeenCalledWith({
      authorPersonId: 'owner-1',
      noteId: 'n1',
      label: 'I’m game',
    });
    expect(await screen.findByText('You answered:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'I’m game' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Answering is not a one-way door — a person may change their mind about a question asked once.
    expect(screen.getByText(/change your mind/)).toBeInTheDocument();
  });

  it('an announcement offers nothing to tap', async () => {
    installMockBridge({
      notesGetForMe: () => Promise.resolve({ ...NOTE, answers: [] }),
    });
    renderAt();
    expect(await screen.findByRole('heading', { name: 'Worth a try' })).toBeInTheDocument();
    expect(screen.queryByText('What do you think?')).not.toBeInTheDocument();
  });

  it('says plainly when the note is gone, rather than rendering an empty shell', async () => {
    installMockBridge({ notesGetForMe: () => Promise.resolve(null) });
    renderAt();
    expect(await screen.findByText(/isn’t here any more/)).toBeInTheDocument();
  });

  it('surfaces a refused answer instead of silently doing nothing', async () => {
    installMockBridge({
      notesGetForMe: () => Promise.resolve(NOTE),
      notesAnswer: () => Promise.resolve(null),
    });
    renderAt();
    await userEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be saved/);
  });
});
