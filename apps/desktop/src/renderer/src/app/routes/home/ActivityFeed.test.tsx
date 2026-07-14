import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ActivityEvent } from '@selfos/core/home';

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

// Import AFTER the mock so the component picks up the mocked useNavigate.
const { ActivityFeed } = await import('./ActivityFeed');

const now = new Date().toISOString();
const event = (over: Partial<ActivityEvent>): ActivityEvent => ({
  id: 'e1',
  domain: 'together',
  title: 'Angel replied',
  at: now,
  actionable: true,
  ...over,
});

function renderFeed(events: ActivityEvent[]): void {
  render(
    <MemoryRouter>
      <ActivityFeed events={events} />
    </MemoryRouter>,
  );
}

describe('ActivityFeed', () => {
  it('renders events and navigates on click of a routed entry', () => {
    navigate.mockClear();
    renderFeed([event({ route: '/together', detail: 'Your turn · 2 unread' })]);
    expect(screen.getByText('Angel replied')).toBeInTheDocument();
    expect(screen.getByText('Your turn · 2 unread')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /angel replied/i }));
    expect(navigate).toHaveBeenCalledWith('/together');
  });

  it('renders a routeless actionable entry as a non-clickable row (on-page handled)', () => {
    renderFeed([event({ id: 'c1', domain: 'challenge', title: 'Challenge check-in due' })]);
    expect(screen.getByText('Challenge check-in due')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /challenge check-in due/i })).toBeNull();
  });

  it('self-hides when there is no recent activity', () => {
    const { container } = render(
      <MemoryRouter>
        <ActivityFeed events={[]} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
