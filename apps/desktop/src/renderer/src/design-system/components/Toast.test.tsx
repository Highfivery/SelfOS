import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toast } from './Toast';

afterEach(() => {
  vi.useRealTimers();
});

describe('Toast', () => {
  it('renders the title + body and uses role=status for info', () => {
    render(
      <Toast severity="info" title="Heads up" body="Something happened." onClose={() => {}} />,
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Heads up')).toBeInTheDocument();
    expect(screen.getByText('Something happened.')).toBeInTheDocument();
  });

  it('uses role=alert (assertive) for warning', () => {
    render(<Toast severity="warning" title="Conflicts" onClose={() => {}} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('fires the action and the close handlers', async () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    render(
      <Toast
        severity="info"
        title="New responses"
        actionLabel="View"
        onAction={onAction}
        onClose={onClose}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('auto-dismisses after the given delay, but a sticky toast does not', () => {
    vi.useFakeTimers();
    const autoClose = vi.fn();
    const { rerender } = render(
      <Toast severity="info" title="Auto" onClose={autoClose} autoDismissMs={5000} />,
    );
    vi.advanceTimersByTime(5000);
    expect(autoClose).toHaveBeenCalledTimes(1);

    const stickyClose = vi.fn();
    rerender(<Toast severity="warning" title="Sticky" onClose={stickyClose} />);
    vi.advanceTimersByTime(60_000);
    expect(stickyClose).not.toHaveBeenCalled();
  });
});
