import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Completion } from '@selfos/core/recommendations';
import { CelebrationMoment } from './CelebrationMoment';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';
import { useDiscoveryStore } from '../../../stores/discoveryStore';

const COMPLETION: Completion = {
  key: 'goal:g1',
  title: 'You completed a goal',
  body: '“finish the memoir” — nicely done.',
  at: '2026-06-25T06:00:00.000Z',
};

afterEach(() => {
  clearMockBridge();
  useDiscoveryStore.getState().reset();
});

describe('CelebrationMoment', () => {
  it('renders nothing when there is no completion', () => {
    installMockBridge();
    const { container } = render(<CelebrationMoment completion={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('celebrates in TEXT (not motion alone) and records the signature once so a re-visit never re-celebrates', () => {
    const setDismissals = vi.fn(() => Promise.resolve());
    installMockBridge({ setDiscoveryDismissals: setDismissals });

    const { rerender } = render(<CelebrationMoment completion={COMPLETION} />);
    // The meaning is conveyed as text (the message), not via animation alone (§9).
    expect(screen.getByText('You completed a goal')).toBeInTheDocument();
    expect(screen.getByText(/finish the memoir/i)).toBeInTheDocument();

    // The signature is recorded immediately so re-rendering with the same completion doesn't re-record.
    expect(setDismissals).toHaveBeenCalledTimes(1);
    expect(setDismissals).toHaveBeenCalledWith(expect.arrayContaining(['celebrate:goal:g1']));
    rerender(<CelebrationMoment completion={COMPLETION} />);
    expect(setDismissals).toHaveBeenCalledTimes(1);
  });
});
