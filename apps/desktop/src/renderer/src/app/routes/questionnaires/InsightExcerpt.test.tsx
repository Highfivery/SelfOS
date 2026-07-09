import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InsightExcerpt } from './InsightExcerpt';

/**
 * jsdom has no layout, so scrollHeight/clientHeight are 0 — mock them at the prototype so the
 * component's overflow measurement sees a clamped (or fitting) body.
 */
function mockMeasure(scrollHeight: number, clientHeight: number): void {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(scrollHeight);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(clientHeight);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('InsightExcerpt', () => {
  it('shows "Show more" only when the summary actually overflows, and expands in place (§3.1)', async () => {
    mockMeasure(120, 60); // taller than the clamp → truncated
    render(<InsightExcerpt summary="A long insight summary." onViewInMemory={() => {}} />);

    const toggle = screen.getByRole('button', { name: 'Show more' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const body = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(body?.className).toContain('excerptBody');
    expect(body?.className).not.toContain('excerptBodyOpen');

    // Expand: the clamp comes off and the toggle flips to "Show less"…
    await userEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(body?.className).toContain('excerptBodyOpen');

    // …and collapses back.
    await userEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
    expect(body?.className).not.toContain('excerptBodyOpen');
  });

  it('renders no dead "Show more" when the summary fits, while "View in Memory" always shows', async () => {
    mockMeasure(60, 60); // fits within the clamp
    const onViewInMemory = vi.fn();
    render(<InsightExcerpt summary="Short and sweet." onViewInMemory={onViewInMemory} />);

    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /View in Memory/ }));
    expect(onViewInMemory).toHaveBeenCalledTimes(1);
  });

  it('renders the AI summary as rich text, never literal markdown marks (34 §3.4)', () => {
    mockMeasure(60, 60);
    render(
      <InsightExcerpt
        summary="They value **quality time** above gifts."
        onViewInMemory={() => {}}
      />,
    );

    expect(screen.getByText('quality time')).toBeInTheDocument();
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
  });
});
