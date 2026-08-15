import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { DEFAULT_ROLES } from '@shared/capabilities';
import type { BookManifest, Person } from '@shared/schemas';
import { useStoryCadences } from './useStoryCadences';
import { useSessionStore } from '../../stores/sessionStore';
import { clearMockBridge, installMockBridge } from '../../test-utils/bridge';

const ME: Person = {
  id: 'owner-1',
  schemaVersion: 1,
  displayName: 'Ben',
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
};

function asOwner(): void {
  useSessionStore.setState({
    activePerson: ME,
    access: {
      roles: DEFAULT_ROLES,
      accounts: [{ personId: ME.id, roleId: 'owner', hasPin: false }],
    },
  });
}

function book(id: string, autoRefresh: boolean): BookManifest {
  return {
    id,
    schemaVersion: 1,
    personId: 'owner-1',
    type: 'biography',
    title: `Book ${id}`,
    config: {
      voice: 'third',
      style: 'warm',
      length: 'standard',
      autoRefresh,
      typeOptions: {},
      sourceIds: [],
    },
    status: 'ready',
    sharedWith: [],
    editions: [],
    createdAt: 'now',
    updatedAt: 'now',
  };
}

function Harness(): JSX.Element {
  useStoryCadences();
  return <div />;
}

afterEach(() => {
  clearMockBridge();
  useSessionStore.setState({ activePerson: null, access: null });
});

describe('useStoryCadences (64 §18.5, #298 — living-book cadences run app-wide)', () => {
  it('fires refresh + interview (auto) for every autoRefresh book, skipping ones with it off', async () => {
    // Capture the bookId + auto flag each cadence was called with (a side array — the mock's return type then
    // infers concretely, so it stays assignable at the install site, and the param is used, satisfying lint).
    const refreshed: { bookId: string; auto?: boolean }[] = [];
    const interviewed: { bookId: string; auto?: boolean }[] = [];
    const booksRefreshCheck = vi.fn((input: { bookId: string; auto?: boolean }) => {
      refreshed.push(input);
      return Promise.resolve({ staled: 0, rewritten: 0, bundle: null });
    });
    const booksInterviewCheck = vi.fn((input: { bookId: string; auto?: boolean }) => {
      interviewed.push(input);
      return Promise.resolve({ outcome: 'throttled' as const });
    });
    installMockBridge({
      booksList: () => Promise.resolve([book('b1', true), book('b2', false), book('b3', true)]),
      booksRefreshCheck,
      booksInterviewCheck,
    });
    asOwner();
    render(<Harness />);

    // b1 + b3 (autoRefresh on) get both cadences; b2 (off) gets neither, and each is `auto: true`.
    await waitFor(() => expect(refreshed).toHaveLength(2));
    expect(refreshed.map((c) => c.bookId).sort()).toEqual(['b1', 'b3']);
    expect(refreshed.every((c) => c.auto === true)).toBe(true);

    await waitFor(() => expect(interviewed).toHaveLength(2));
    expect(interviewed.map((c) => c.bookId).sort()).toEqual(['b1', 'b3']);
    expect(interviewed.every((c) => c.auto === true)).toBe(true);
  });

  it('does nothing for a person without story.own', async () => {
    const booksRefreshCheck = vi.fn(() =>
      Promise.resolve({ staled: 0, rewritten: 0, bundle: null }),
    );
    installMockBridge({
      booksList: () => Promise.resolve([book('b1', true)]),
      booksRefreshCheck,
    });
    // A Guest role has no story.own.
    useSessionStore.setState({
      activePerson: ME,
      access: {
        roles: DEFAULT_ROLES,
        accounts: [{ personId: ME.id, roleId: 'guest', hasPin: false }],
      },
    });
    render(<Harness />);
    // Give any errant async a tick; the cadence must not fire.
    await new Promise((r) => setTimeout(r, 20));
    expect(booksRefreshCheck).not.toHaveBeenCalled();
  });
});
