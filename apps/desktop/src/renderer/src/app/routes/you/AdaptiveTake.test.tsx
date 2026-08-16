import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdaptiveBankView, AdaptiveStateView } from '@shared/schemas';
import { installMockBridge } from '../../../test-utils/bridge';
import { useAdaptiveTestStore } from '../../../stores/adaptiveTestStore';
import { AdaptiveTake } from './AdaptiveTake';

const BANK: AdaptiveBankView = {
  testId: 'dirty-talk',
  families: [
    { id: 'names-power', label: 'Names — power & role', kind: 'word' },
    {
      id: 'taboo',
      label: 'Taboo fantasy & roleplay',
      kind: 'phrase',
      note: 'Every entry here is PRE-AGREED, SAFEWORDED ROLEPLAY between consenting adults.',
    },
  ],
  entries: [
    {
      key: 'names-power:good-girl',
      text: 'good girl',
      kind: 'word',
      family: 'names-power',
      tier: 2,
      directions: ['hear', 'say'],
    },
    {
      key: 'taboo:run-primal',
      text: 'run (primal)',
      kind: 'phrase',
      family: 'taboo',
      tier: 5,
      directions: ['hear', 'say'],
    },
  ],
};

function state(overrides: Partial<AdaptiveStateView> = {}): AdaptiveStateView {
  return {
    testId: 'dirty-talk',
    title: 'Dirty talk',
    blurb: 'What you want said to you.',
    framing: 'A map, not a verdict.',
    estimatedMinutes: 15,
    draft: null,
    latest: null,
    history: [],
    lexicon: {
      schemaVersion: 1,
      personId: 'p1',
      entries: [],
      registers: {},
      contexts: {},
      themes: [],
      wantsToSay: [],
      boundaries: [],
      updatedAt: 'now',
    },
    ambiguitiesLeft: 0,
    staleForRetake: false,
    ...overrides,
  };
}

const DRAFT = {
  id: 'r1',
  schemaVersion: 1,
  testId: 'dirty-talk',
  testVersion: 1,
  subjectPersonId: 'p1',
  answers: [],
  scores: [],
  status: 'draft' as const,
  kind: 'adaptive' as const,
  takenAt: 'now',
  createdAt: 'now',
  updatedAt: 'now',
};

function renderTake(): void {
  render(
    <MemoryRouter initialEntries={['/tests/dirty-talk/take']}>
      <AdaptiveTake />
    </MemoryRouter>,
  );
}

describe('AdaptiveTake (74 §3.2)', () => {
  beforeEach(() => {
    useAdaptiveTestStore.getState().reset();
  });

  it('tells them the steer exists BEFORE they produce any material (74 §8.4)', async () => {
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state()),
    });
    renderTake();
    expect(
      await screen.findByText(/it can quietly shape what their coach suggests to them/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/never tells them what you said/i)).toBeInTheDocument();
  });

  it('is withheld entirely before the 18+ ack — the bridge returns nothing', async () => {
    installMockBridge({
      testsBank: () => Promise.resolve(null),
      testsAdaptiveState: () => Promise.resolve(null),
    });
    renderTake();
    expect(await screen.findByText(/This one is 18\+/i)).toBeInTheDocument();
  });

  it('marks only what lands in pass 1, and shows the boundary rule in plain words', async () => {
    const bankPass = vi.fn(() => Promise.resolve(state({ draft: DRAFT })));
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state()),
      testsAdaptiveStart: () => Promise.resolve(state({ draft: DRAFT })),
      testsAdaptiveBank: bankPass as never,
    });
    renderTake();
    await userEvent.click(await screen.findByRole('button', { name: 'Begin' }));

    expect(await screen.findByText(/nothing in SelfOS will suggest it again/i)).toBeInTheDocument();
    // The taboo family carries its roleplay framing wherever it appears (74 §8.1).
    expect(screen.getByText(/PRE-AGREED, SAFEWORDED ROLEPLAY/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'good girl — love it' }));
    await userEvent.click(screen.getByRole('button', { name: 'run (primal) — never' }));
    expect(screen.getByText('2 marked')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Next — how you want them/i }));
    await waitFor(() =>
      expect(bankPass).toHaveBeenCalledWith(
        expect.objectContaining({
          marks: { 'names-power:good-girl': 'love', 'taboo:run-primal': 'never' },
        }),
      ),
    );
  });

  it('asks the hear/say split ONLY for what was marked, and never for a boundary', async () => {
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state()),
      testsAdaptiveStart: () => Promise.resolve(state({ draft: DRAFT })),
      testsAdaptiveBank: () => Promise.resolve(state({ draft: DRAFT })),
    });
    renderTake();
    await userEvent.click(await screen.findByRole('button', { name: 'Begin' }));
    await userEvent.click(screen.getByRole('button', { name: 'good girl — love it' }));
    await userEvent.click(screen.getByRole('button', { name: 'run (primal) — never' }));
    await userEvent.click(screen.getByRole('button', { name: /Next — how you want them/i }));

    expect(await screen.findByText(/Hearing it, or saying it\?/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'good girl — hear 4 of 4' })).toBeInTheDocument();
    // The one they ruled out is not re-rated.
    expect(screen.queryByRole('button', { name: /run \(primal\) — hear/ })).not.toBeInTheDocument();
  });

  it('shows live progress on an AI phase — never a bare spinner (CLAUDE.md §12)', async () => {
    let resolveLines: (value: {
      ok: boolean;
      lines: string[];
      degraded: boolean;
    }) => void = () => {};
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state({ draft: DRAFT })),
      testsAdaptiveStart: () => Promise.resolve(state({ draft: DRAFT })),
      testsAdaptiveLines: () =>
        new Promise((resolve) => {
          resolveLines = resolve;
        }) as never,
    });
    renderTake();
    // A draft is already in flight, so the intro offers to pick it up rather than begin.
    await userEvent.click(
      await screen.findByRole('button', { name: /Pick up where you left off/i }),
    );
    useAdaptiveTestStore.setState({ phase: 'lines' });
    void useAdaptiveTestStore.getState().loadLines('dirty-talk', 1);

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/Writing lines for you/);
    expect(status).toHaveTextContent(/elapsed/);
    resolveLines({ ok: true, lines: ['good girl, just like that'], degraded: false });
    expect(await screen.findByText(/good girl, just like that/)).toBeInTheDocument();
  });

  it('moves on rather than dead-ending when an AI phase degrades (74 §7)', async () => {
    installMockBridge({
      testsBank: () => Promise.resolve(BANK),
      testsAdaptiveState: () => Promise.resolve(state({ draft: DRAFT })),
      testsAdaptiveLines: () => Promise.resolve({ ok: false, degraded: true }),
    });
    renderTake();
    await useAdaptiveTestStore.getState().load('dirty-talk');
    useAdaptiveTestStore.setState({ phase: 'lines' });
    await useAdaptiveTestStore.getState().loadLines('dirty-talk', 1);
    expect(useAdaptiveTestStore.getState().phase).toBe('probe');
  });
});
