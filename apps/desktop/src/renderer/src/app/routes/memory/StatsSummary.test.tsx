import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatsSummary } from './StatsSummary';

describe('StatsSummary', () => {
  it('renders overview, confidence, and sharing with a working manage link', async () => {
    const onManage = vi.fn();
    render(
      <StatsSummary
        overview={{
          total: 5,
          bySource: [
            { source: 'intake', count: 3 },
            { source: 'session', count: 2 },
          ],
          lastUpdated: '2026-06-22T00:00:00.000Z',
        }}
        confidence={{ high: 2, medium: 1, low: 0, total: 3 }}
        sharing={{ sharedCount: 2, byType: [{ type: 'partner', count: 2 }], broadcastCount: 0 }}
        onManageSharing={onManage}
      />,
    );
    expect(screen.getByText(/SelfOS knows/)).toHaveTextContent('SelfOS knows 5 things about you.');
    expect(screen.getByText('Onboarding 3 · Sessions 2')).toBeInTheDocument();
    expect(screen.getByText(/High/)).toHaveTextContent('High 2 · Medium 1 · Low 0');
    expect(screen.getByText(/You’re sharing/)).toHaveTextContent('You’re sharing 2 things.');
    expect(screen.getByText('Partner 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Manage sharing/ }));
    expect(onManage).toHaveBeenCalled();
  });

  it('shows the not-sharing-anything state', () => {
    render(
      <StatsSummary
        overview={{ total: 1, bySource: [{ source: 'session', count: 1 }], lastUpdated: undefined }}
        confidence={{ high: 0, medium: 1, low: 0, total: 1 }}
        sharing={{ sharedCount: 0, byType: [], broadcastCount: 0 }}
        onManageSharing={vi.fn()}
      />,
    );
    expect(screen.getByText('You’re not sharing anything yet.')).toBeInTheDocument();
  });
});
