import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GuidedCatalog } from './GuidedCatalog';

function setup(adultAcknowledged = false): void {
  render(
    <GuidedCatalog
      onPick={vi.fn()}
      adultAcknowledged={adultAcknowledged}
      onAcknowledgeAdult={vi.fn()}
    />,
  );
}

describe('GuidedCatalog — expanded groups + search', () => {
  it('shows the Family group and the fuller therapy/coaching sets', () => {
    setup();
    expect(screen.getByText('Family & relationships')).toBeInTheDocument();
    expect(screen.getByText('Your Family Role')).toBeInTheDocument();
    expect(screen.getByText('Urge Surfing')).toBeInTheDocument(); // a new reflective entry
    expect(screen.getByText('Building a Habit')).toBeInTheDocument(); // a new coaching entry
  });

  it('filters across groups by name/framework/topic; non-matching groups disappear', async () => {
    setup();
    await userEvent.type(screen.getByLabelText('Search guided sessions'), 'sibling');
    expect(screen.getByText('Sibling Dynamics')).toBeInTheDocument();
    // A non-matching group's cards are gone.
    expect(screen.queryByText('Building a Habit')).not.toBeInTheDocument();
    expect(screen.queryByText('Your Family Role')).not.toBeInTheDocument();
  });

  it('NEVER reveals gated intimacy content via search before the 18+ ack', async () => {
    setup(false);
    await userEvent.type(screen.getByLabelText('Search guided sessions'), 'sensate');
    // The intimacy match's CARD is withheld — no leak (the empty state echoes the query, so assert the
    // actual card title, not the raw word).
    expect(screen.queryByText('Sensate Focus')).not.toBeInTheDocument();
    expect(screen.getByText(/No sessions match/)).toBeInTheDocument();
  });

  it('shows a calm empty state when nothing matches', async () => {
    setup();
    await userEvent.type(screen.getByLabelText('Search guided sessions'), 'zzznotathing');
    expect(screen.getByText(/No sessions match/)).toBeInTheDocument();
  });
});
