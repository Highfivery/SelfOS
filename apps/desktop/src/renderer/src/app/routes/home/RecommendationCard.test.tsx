import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RecommendationCard } from './RecommendationCard';

describe('RecommendationCard', () => {
  it('renders the label as an h2, the reason as text, and a keyboard-operable dismiss', () => {
    const onDismiss = vi.fn();
    render(
      <RecommendationCard
        domain="memory"
        label="Refresh your portrait"
        reason="A few things have changed since your last portrait."
        onDismiss={onDismiss}
      >
        <button type="button">Refresh my portrait</button>
      </RecommendationCard>,
    );

    expect(
      screen.getByRole('heading', { level: 2, name: /refresh your portrait/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/a few things have changed/i)).toBeInTheDocument();
    // The primary action (children) is present.
    expect(screen.getByRole('button', { name: 'Refresh my portrait' })).toBeInTheDocument();

    const dismiss = screen.getByRole('button', { name: /refresh your portrait.*for now/i });
    expect(dismiss).toBeInTheDocument(); // a real, named control (not an icon-only button)
    fireEvent.click(dismiss);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
