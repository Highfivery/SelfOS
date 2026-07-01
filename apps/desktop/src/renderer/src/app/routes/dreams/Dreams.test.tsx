import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Dream } from '@shared/channels';
import { Dreams } from './Dreams';
import { useDreamStore } from '../../../stores/dreamStore';
import { useDreamPatternStore } from '../../../stores/dreamPatternStore';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

/** Dreams now navigates to /dreams/patterns, so it needs a Router in tests. */
function renderDreams(): void {
  render(
    <MemoryRouter>
      <Dreams />
    </MemoryRouter>,
  );
}

afterEach(() => {
  clearMockBridge();
  useDreamStore.setState({ dreams: [], loaded: false });
  useDreamPatternStore.getState().reset();
  usePeopleStore.setState({ people: [], relationships: [], loaded: false });
  useSessionStore.setState({ activePerson: null });
});

/** An ISO timestamp `n` days before now — so recency grouping is deterministic against the real clock. */
function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

const baseDream: Dream = {
  id: 'd1',
  schemaVersion: 1,
  personId: 'owner-1',
  title: 'Mountain flight',
  narrative: 'I was flying over snowy mountains.',
  lucid: true,
  nightmare: false,
  tags: [],
  people: [],
  sensitivity: 'standard',
  status: 'captured',
  createdAt: '2026-06-11T00:00:00.000Z',
  updatedAt: '2026-06-11T00:00:00.000Z',
};

/** A dreamSave stub that echoes the input back as a saved Dream, so tests can assert the payload. */
function saveSpy(): ReturnType<typeof vi.fn> {
  return vi.fn((input) =>
    Promise.resolve({
      id: input.id ?? 'd1',
      schemaVersion: 1,
      personId: 'owner-1',
      narrative: input.narrative,
      lucid: input.lucid,
      nightmare: input.nightmare,
      tags: input.tags,
      people: input.people,
      sensitivity: input.sensitivity,
      status: 'captured' as const,
      createdAt: 'now',
      updatedAt: 'now',
    }),
  );
}

describe('Dreams', () => {
  it('shows the empty state when there are no dreams', async () => {
    installMockBridge({ dreamsList: () => Promise.resolve([]) });
    renderDreams();
    expect(await screen.findByText(/no dreams yet/i)).toBeInTheDocument();
  });

  it('lists existing dreams by title', async () => {
    installMockBridge({ dreamsList: () => Promise.resolve([baseDream]) });
    renderDreams();
    expect(await screen.findByText('Mountain flight')).toBeInTheDocument();
  });

  it('captures a dream: narrative-first, with optional flags', async () => {
    const save = saveSpy();
    installMockBridge({ dreamsList: () => Promise.resolve([]), dreamSave: save });
    renderDreams();

    await userEvent.click(screen.getByRole('button', { name: 'Log a dream' }));
    await userEvent.type(
      screen.getByLabelText('What happened?'),
      'I was back in my childhood house.',
    );
    await userEvent.click(screen.getByRole('switch', { name: 'Lucid dream' }));
    await userEvent.selectOptions(screen.getByLabelText('Waking mood'), 'Good');
    await userEvent.click(screen.getByRole('button', { name: 'Just save' }));

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        narrative: 'I was back in my childhood house.',
        lucid: true,
        nightmare: false,
        mood: 0.5,
        sensitivity: 'standard',
        informsContext: true, // default on (15-shareability §3.2)
      }),
    );
  });

  it('lets a dream be kept a private journal entry (informsContext off)', async () => {
    const save = saveSpy();
    installMockBridge({ dreamsList: () => Promise.resolve([]), dreamSave: save });
    renderDreams();

    await userEvent.click(screen.getByRole('button', { name: 'Log a dream' }));
    await userEvent.type(screen.getByLabelText('What happened?'), 'A private dream.');
    // The sensitivity help no longer claims sensitive dreams are excluded from sharing.
    expect(screen.queryByText(/kept out of any shared context/i)).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('switch', { name: 'Let this dream inform coaching context' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Just save' }));

    expect(save).toHaveBeenCalledWith(expect.objectContaining({ informsContext: false }));
  });

  it('links a household person to a dream (the payload carries a personId)', async () => {
    const save = saveSpy();
    const person = (id: string, displayName: string) => ({
      id,
      schemaVersion: 1 as const,
      displayName,
      isSubject: true,
      tags: [] as string[],
      createdAt: 'now',
      updatedAt: 'now',
    });
    // The dreamer (owner-1) plus a household person they can link; the dreamer is excluded from the picker.
    usePeopleStore.setState({
      people: [person('owner-1', 'Me'), person('p-sam', 'Sam')],
      relationships: [],
      loaded: true,
    });
    useSessionStore.setState({ activePerson: person('owner-1', 'Me') });
    installMockBridge({ dreamsList: () => Promise.resolve([]), dreamSave: save });
    renderDreams();

    await userEvent.click(screen.getByRole('button', { name: 'Log a dream' }));
    await userEvent.type(screen.getByLabelText('What happened?'), 'Sam was there.');
    // The dreamer is not offered; Sam is.
    const picker = screen.getByLabelText('Link a person you know');
    expect(picker).not.toHaveTextContent('Me');
    await userEvent.selectOptions(picker, 'p-sam');
    await userEvent.click(screen.getByRole('button', { name: 'Just save' }));

    expect(save).toHaveBeenCalledWith(expect.objectContaining({ people: [{ personId: 'p-sam' }] }));
  });

  it('disables Save until a narrative is entered', async () => {
    installMockBridge({ dreamsList: () => Promise.resolve([]) });
    renderDreams();
    await userEvent.click(screen.getByRole('button', { name: 'Log a dream' }));
    expect(screen.getByRole('button', { name: 'Just save' })).toBeDisabled();
  });

  it('surfaces a calm error when saving fails', async () => {
    installMockBridge({
      dreamsList: () => Promise.resolve([]),
      dreamSave: () => Promise.reject(new Error('Not permitted')),
    });
    renderDreams();

    await userEvent.click(screen.getByRole('button', { name: 'Log a dream' }));
    await userEvent.type(screen.getByLabelText('What happened?'), 'A dream.');
    await userEvent.click(screen.getByRole('button', { name: 'Just save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t save this dream/i);
  });

  it('deletes a dream after a confirm step', async () => {
    const remove = vi.fn(() => Promise.resolve());
    installMockBridge({ dreamsList: () => Promise.resolve([baseDream]), dreamDelete: remove });
    renderDreams();

    await userEvent.click(await screen.findByText('Mountain flight'));
    // Delete lives in the editable form now (read-first detail), a step behind "Edit dream" (12 §15.3).
    await userEvent.click(screen.getByRole('button', { name: /edit dream/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    // A confirm step appears before the destructive action runs.
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(remove).toHaveBeenCalledWith('d1');
  });

  it('opening a saved dream leads with the read-first detail; edit is a step away', async () => {
    installMockBridge({ dreamsList: () => Promise.resolve([baseDream]) });
    renderDreams();
    await userEvent.click(await screen.findByText('Mountain flight'));
    expect(screen.getByRole('button', { name: /start reflection/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('What happened?')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /edit dream/i }));
    expect(await screen.findByLabelText('What happened?')).toBeInTheDocument();
  });

  it('the quick filter narrows the grid to one kind of dream', async () => {
    const lucid = {
      ...baseDream,
      id: 'l',
      title: 'Lucid one',
      lucid: true,
      dreamDate: daysAgoIso(2),
    };
    const nightmare = {
      ...baseDream,
      id: 'n',
      title: 'Bad one',
      lucid: false,
      nightmare: true,
      dreamDate: daysAgoIso(3),
    };
    installMockBridge({ dreamsList: () => Promise.resolve([lucid, nightmare]) });
    renderDreams();

    expect(await screen.findByText('Lucid one')).toBeInTheDocument();
    expect(screen.getByText('Bad one')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Nightmares' }));
    expect(screen.getByText('Bad one')).toBeInTheDocument();
    expect(screen.queryByText('Lucid one')).not.toBeInTheDocument();
    // Filtered views drop the create tile (a new dream isn't necessarily this kind).
    expect(screen.queryByRole('button', { name: 'Log a new dream' })).not.toBeInTheDocument();

    // A filter with no matches shows a calm message, not a blank grid.
    await userEvent.click(screen.getByRole('button', { name: 'Analyzed' }));
    expect(screen.getByText(/no analyzed dreams yet/i)).toBeInTheDocument();
  });

  it('groups dreams under recency headers (This week / Earlier)', async () => {
    const recent = { ...baseDream, id: 'r', title: 'Recent one', dreamDate: daysAgoIso(1) };
    const old = { ...baseDream, id: 'o', title: 'Old one', dreamDate: daysAgoIso(200) };
    installMockBridge({ dreamsList: () => Promise.resolve([recent, old]) });
    renderDreams();

    expect(await screen.findByText('This week')).toBeInTheDocument();
    expect(screen.getByText('Earlier')).toBeInTheDocument();
    expect(screen.getByText('Recent one')).toBeInTheDocument();
    expect(screen.getByText('Old one')).toBeInTheDocument();
  });

  it('shows the insight strip from deterministic pattern stats (≥2 dreams)', async () => {
    const a = { ...baseDream, id: 'a', title: 'A', dreamDate: daysAgoIso(2) };
    const b = { ...baseDream, id: 'b', title: 'B', nightmare: true, dreamDate: daysAgoIso(3) };
    installMockBridge({
      dreamsList: () => Promise.resolve([a, b]),
      dreamPatternStats: (input) =>
        Promise.resolve({
          window: input.window,
          dreamCount: 2,
          analyzedCount: 0,
          symbols: [],
          themes: [{ label: 'falling', count: 2 }],
          people: [],
          emotions: [],
          lucidCount: 0,
          nightmareCount: 1,
          moodTrend: [],
          vividnessTrend: [],
          nightmareNudge: false,
        }),
    });
    renderDreams();

    expect(await screen.findByText('falling')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /see patterns/i })).toBeInTheDocument();
  });
});
