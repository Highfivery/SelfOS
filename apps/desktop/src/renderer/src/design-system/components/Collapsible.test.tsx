import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Collapsible } from './Collapsible';

describe('Collapsible', () => {
  it('is collapsed by default and reveals its body on click', async () => {
    render(
      <Collapsible header={<span>Emotions</span>}>
        <p>a hidden fact</p>
      </Collapsible>,
    );
    const trigger = screen.getByRole('button', { name: /Emotions/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('a hidden fact')).not.toBeInTheDocument();

    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('a hidden fact')).toBeInTheDocument();
  });

  it('honors defaultOpen', () => {
    render(
      <Collapsible header={<span>Work</span>} defaultOpen>
        <p>visible now</p>
      </Collapsible>,
    );
    expect(screen.getByRole('button', { name: /Work/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('visible now')).toBeInTheDocument();
  });

  it('supports controlled open + onOpenChange (a deep-link can force it open)', async () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <Collapsible header={<span>Health</span>} open={false} onOpenChange={onOpenChange}>
        <p>controlled body</p>
      </Collapsible>,
    );
    expect(screen.queryByText('controlled body')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Health/ }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    // Still closed until the parent flips `open` (controlled).
    expect(screen.queryByText('controlled body')).not.toBeInTheDocument();

    rerender(
      <Collapsible header={<span>Health</span>} open onOpenChange={onOpenChange}>
        <p>controlled body</p>
      </Collapsible>,
    );
    expect(screen.getByText('controlled body')).toBeInTheDocument();
  });
});
