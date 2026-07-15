import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { TogetherSessionSummary } from '@shared/schemas';
import { TogetherHomeCard } from './TogetherHomeCard';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

const ME = 'me';

beforeEach(() => installMockBridge());
afterEach(() => clearMockBridge());

const session = (over: Partial<TogetherSessionSummary>): TogetherSessionSummary => ({
  id: 's1',
  pairKey: 'me~angel',
  initiatorPersonId: ME,
  participants: [
    { personId: ME, displayName: 'Me' },
    { personId: 'angel', displayName: 'Angel' },
  ],
  status: 'active',
  yourTurn: false,
  unreadCount: 0,
  createdAt: 'now',
  ...over,
});

function renderCard(sessions: TogetherSessionSummary[]): void {
  render(
    <MemoryRouter>
      <TogetherHomeCard sessions={sessions} myId={ME} />
    </MemoryRouter>,
  );
}

describe('TogetherHomeCard', () => {
  it('features a your-turn session with the partner name and unread count', () => {
    renderCard([session({ yourTurn: true, unreadCount: 2, lastMessageSnippet: 'I hear you' })]);
    expect(screen.getByRole('heading', { name: /Together · Angel/ })).toBeInTheDocument();
    expect(screen.getByText('Your turn')).toBeInTheDocument();
    expect(screen.getByText(/2 unread/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open session/i })).toBeInTheDocument();
  });

  it('prefers a pending invitation and uses invite copy', () => {
    renderCard([
      session({ id: 'inv', initiatorPersonId: 'angel', status: 'invited' }),
      session({ id: 'act', status: 'active', lastMessageAt: '2026-07-10' }),
    ]);
    expect(screen.getByText('Invitation')).toBeInTheDocument();
    expect(screen.getByText(/Angel invited you to a session/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /view invitation/i })).toBeInTheDocument();
  });

  it('shows the partner’s-turn pill and the pulse (Connection ring + desire alignment)', async () => {
    installMockBridge({
      togetherPulse: () =>
        Promise.resolve({
          checkInSeries: [{ label: 'Connection', points: [{ x: 0, y: 0.7 }], direction: 'steady' }],
          sessionSeries: [],
          hasCheckIns: true,
          alignment: { ready: true, yours: 0.6, theirs: 0.65, read: 'aligned' },
        }),
    });
    renderCard([session({ status: 'active', yourTurn: false })]);
    // Whose turn it is, when it's not yours.
    expect(screen.getByText('Angel’s turn')).toBeInTheDocument();
    // The pulse loads asynchronously → a Connection ring (level word + direction) and the desire alignment.
    expect(await screen.findByText(/Connection · steady/)).toBeInTheDocument();
    expect(screen.getByText(/Desire · aligned/)).toBeInTheDocument();
  });

  it('self-hides when there are no live sessions', () => {
    const { container } = render(
      <MemoryRouter>
        <TogetherHomeCard sessions={[session({ status: 'complete' })]} myId={ME} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
