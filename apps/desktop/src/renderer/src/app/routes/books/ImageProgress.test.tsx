import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { ImageGenProgress } from '@shared/schemas';
import { ImageProgress } from './ImageProgress';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

afterEach(() => {
  clearMockBridge();
  vi.useRealTimers();
});

describe('ImageProgress (§12 — realtime AI-image progress)', () => {
  it('shows a phase label, a live elapsed timer, and an ETA; updates phase on a stream event', () => {
    vi.useFakeTimers();
    // Capture the image-progress listener so the test can push phase events.
    let listener: ((p: ImageGenProgress) => void) | null = null;
    installMockBridge({
      onImageProgress: (l) => {
        listener = l as (p: ImageGenProgress) => void;
        return () => {};
      },
    });

    render(<ImageProgress id="story:b1:cover" label="Creating your cover" />);

    // Starts in the composing phase with a 0s timer.
    expect(screen.getByText(/Creating your cover — Composing the scene…/)).toBeInTheDocument();
    expect(screen.getByText('0s elapsed')).toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: 'Image generation progress' }),
    ).toBeInTheDocument();

    // The timer ticks (renderer-side, real elapsed).
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('1s elapsed')).toBeInTheDocument();

    // A render-phase event upgrades the label in realtime — only for THIS surface's id.
    act(() => listener?.({ id: 'story:other:cover', phase: 'rendering' }));
    expect(screen.getByText(/Composing the scene…/)).toBeInTheDocument(); // ignored (different id)
    act(() => listener?.({ id: 'story:b1:cover', phase: 'rendering' }));
    expect(screen.getByText(/Creating your cover — Painting the image…/)).toBeInTheDocument();
  });

  it('uses the vision label + phase for a photo analysis', () => {
    installMockBridge({});
    render(<ImageProgress id="photo:b1:p1" kind="vision" />);
    expect(screen.getByText(/Looking at your photo — Reading your photo…/)).toBeInTheDocument();
  });
});
