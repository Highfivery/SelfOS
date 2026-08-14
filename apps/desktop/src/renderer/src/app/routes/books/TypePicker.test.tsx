import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoryBookTypeView } from '@shared/schemas';
import { useStoryStore } from '../../../stores/storyStore';
import { TypePicker } from './TypePicker';

/** "What kind of book?" (72 §3.2) — the step before the commission. */

function type(over: Partial<StoryBookTypeView> = {}): StoryBookTypeView {
  return {
    id: 'biography',
    label: 'Biography',
    blurb: 'Your whole life so far.',
    truthMode: 'true',
    summary: { drawsOn: 'everything on record', shape: 'life eras', asksAbout: 'scenes' },
    gates: { adult: false },
    castPolicy: 'realNames' as const,
    unit: { one: 'chapter', many: 'chapters' },
    options: [],
    structures: [],
    stylePresets: [],
    ...over,
  };
}

function renderPicker(types: StoryBookTypeView[], onPick = vi.fn()): { onPick: typeof onPick } {
  useStoryStore.setState({ bookTypes: types });
  render(<TypePicker onPick={onPick} onCancel={vi.fn()} />);
  return { onPick };
}

afterEach(() => useStoryStore.getState().reset());

describe('TypePicker (72 §3.2)', () => {
  it('splits the kinds by whether they may depart from the record', () => {
    renderPicker([
      type(),
      type({ id: 'dreamBook', label: 'The dream book', truthMode: 'fictionalized' }),
    ]);

    expect(screen.getByRole('region', { name: 'Told true' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Reimagined' })).toBeInTheDocument();
  });

  it('omits a group nothing belongs to rather than showing an empty heading', () => {
    renderPicker([type()]);

    expect(screen.getByRole('region', { name: 'Told true' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Reimagined' })).not.toBeInTheDocument();
  });

  it('each card says what it draws on, its shape, and what it will ask about', () => {
    renderPicker([type()]);

    const card = screen.getByRole('button', { name: /^Biography/ });
    expect(card).toHaveTextContent('everything on record');
    expect(card).toHaveTextContent('life eras');
    expect(card).toHaveTextContent('scenes');
  });

  it('an 18+ kind is marked and still pickable — the gate lives at the commission, not here', async () => {
    const { onPick } = renderPicker([
      type({ id: 'erotica', label: 'Erotica', truthMode: 'fictionalized', gates: { adult: true } }),
    ]);

    expect(screen.getByText('18+')).toBeInTheDocument();
    const card = screen.getByRole('button', { name: /^Erotica/ });
    expect(card).toBeEnabled(); // disabling it would send someone to Settings mid-flow
    await userEvent.click(card);
    expect(onPick).toHaveBeenCalledWith('erotica');
  });

  it('picking a kind passes it on', async () => {
    const { onPick } = renderPicker([type(), type({ id: 'memoir', label: 'Memoir' })]);

    await userEvent.click(screen.getByRole('button', { name: /^Memoir/ }));

    expect(onPick).toHaveBeenCalledWith('memoir');
  });
});
