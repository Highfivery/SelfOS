import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Insight } from '@shared/schemas';
import { DEFAULT_ROLES } from '@shared/capabilities';
import { Memory } from './Memory';
import { useInsightStore } from '../../../stores/insightStore';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useConversationStore } from '../../../stores/conversationStore';
import { useDreamStore } from '../../../stores/dreamStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

const activeP1 = {
  id: 'p1',
  schemaVersion: 1 as const,
  displayName: 'Ben',
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
};

function insight(over: Partial<Insight> & { id: string }): Insight {
  return {
    schemaVersion: 1,
    source: 'session',
    subjectPersonId: 'p1',
    summary: `summary-${over.id}`,
    facts: [],
    confidence: 'medium',
    categories: ['Other'],
    approved: true,
    provenance: { conversationId: 'c1', at: '2026-06-11T12:00:00.000Z' },
    createdAt: '2026-06-11T12:00:00.000Z',
    updatedAt: '2026-06-11T12:00:00.000Z',
    ...over,
  };
}

function renderMemory(): void {
  render(
    <MemoryRouter>
      <Memory />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  clearMockBridge();
  useInsightStore.setState({
    insights: [],
    outbound: { items: [] },
    loaded: false,
    lastReconciledAt: undefined,
    proposals: [],
  });
  usePeopleStore.setState({ people: [], loaded: false });
  useConversationStore.setState({ conversations: [] });
  useDreamStore.setState({ dreams: [], loaded: false });
  useSessionStore.setState({ activePerson: null });
});

describe('Memory (flattened, edit-in-place — spec 62)', () => {
  it('shows the empty state + a Start-a-session action; omits it without sessions.own', async () => {
    useSessionStore.setState({
      activePerson: activeP1,
      access: {
        roles: DEFAULT_ROLES,
        accounts: [{ personId: activeP1.id, roleId: 'member', hasPin: false }],
      },
    });
    installMockBridge({ insightsList: () => Promise.resolve([]) });
    renderMemory();
    expect(
      await screen.findByText(/what\s+SelfOS learns about you shows up here/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start a session/i })).toBeInTheDocument();
  });

  it('opens with all life-area sections COLLAPSED; expanding one reveals its insight card', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    installMockBridge({
      insightsList: () =>
        Promise.resolve([
          insight({
            id: 'i1',
            summary: 'Values steady routines',
            categories: ['Health & body'],
          }),
        ]),
    });
    renderMemory();
    const section = await screen.findByRole('button', { name: /Health & body/ });
    expect(section).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Values steady routines')).not.toBeInTheDocument();
    await userEvent.click(section);
    expect(section).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Values steady routines')).toBeInTheDocument();
  });

  it('an own AI insight carries an "About you" chip + a linked source (62 §context)', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    installMockBridge({
      insightsList: () =>
        Promise.resolve([
          insight({ id: 'i1', summary: 'Values steady routines', categories: ['Health & body'] }),
        ]),
    });
    renderMemory();
    await userEvent.click(await screen.findByRole('button', { name: /Health & body/ }));
    expect(screen.getByText('About you')).toBeInTheDocument();
    // The source is shown in the header (a "From a session" link → the session; plain when the source is gone).
    expect(screen.getByText(/From a session/)).toBeInTheDocument();
  });

  it('keeps a sensitive (Intimacy) section collapsed until opened; it carries a count', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    installMockBridge({
      insightsList: () =>
        Promise.resolve([
          insight({
            id: 'i1',
            summary: 'An intimacy insight',
            categories: ['Intimacy'],
            facts: [{ id: 'f1', text: 'A private detail', shareable: false }],
          }),
        ]),
    });
    renderMemory();
    const section = await screen.findByRole('button', { name: /Intimacy/ });
    expect(section).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('A private detail')).not.toBeInTheDocument();
    await userEvent.click(section);
    expect(screen.getByText('A private detail')).toBeInTheDocument();
  });

  it('edits a fact via the "Edit this insight" pencil → Edit mode → Save (65 §3.4)', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    const update = vi.fn((input: unknown) => Promise.resolve(input as Insight));
    installMockBridge({
      insightsList: () =>
        Promise.resolve([
          insight({
            id: 'i1',
            summary: 'Morning person',
            categories: ['Emotions & patterns'],
            facts: [{ id: 'f1', text: 'Likes early starts', shareable: false }],
          }),
        ]),
      insightsUpdate: update,
    });
    renderMemory();
    await userEvent.click(await screen.findByRole('button', { name: /Emotions & patterns/ }));
    // Editing a fact's text lives in Edit mode (opened by the single header pencil), not the read view.
    await userEvent.click(screen.getByRole('button', { name: 'Edit this insight' }));
    const field = screen.getByRole('textbox', { name: 'Edit fact: Likes early starts' });
    await userEvent.clear(field);
    await userEvent.type(field, 'Likes slow mornings');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(update).toHaveBeenCalledTimes(1);
    const [arg] = update.mock.calls[0] ?? [];
    const facts = (arg as { facts: { id: string; text: string }[] } | undefined)?.facts ?? [];
    expect(facts.find((f) => f.id === 'f1')?.text).toBe('Likes slow mornings');
  });

  it('flags an AI-inferred fact "not right about me" in Edit mode (65 §3.4)', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    const flag = vi.fn(() => Promise.resolve(null));
    installMockBridge({
      insightsList: () =>
        Promise.resolve([
          insight({
            id: 'i1',
            summary: 'Dislikes mornings',
            categories: ['Emotions & patterns'],
            facts: [{ id: 'f1', text: 'Dislikes mornings', shareable: false }],
          }),
        ]),
      insightsFlag: flag,
    });
    renderMemory();
    await userEvent.click(await screen.findByRole('button', { name: /Emotions & patterns/ }));
    // The read view is scannable; flagging lives in Edit mode.
    await userEvent.click(screen.getByRole('button', { name: 'Edit this insight' }));
    await userEvent.click(
      screen.getByRole('button', { name: /This isn’t right about me: Dislikes mornings/ }),
    );
    expect(flag).toHaveBeenCalledWith({ insightId: 'i1', factId: 'f1', flagged: true });
  });

  it('read view: a fact carries a tap-to-change sharing chip (Partner → Just me) (65 §3.4)', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    // The read-view chip writes via setFactScope → insightsUpdate (merge-by-id).
    const update = vi.fn((input: unknown) => Promise.resolve(input as Insight));
    installMockBridge({
      insightsList: () =>
        Promise.resolve([
          insight({
            id: 'i1',
            summary: 'Values steady routines',
            categories: ['Emotions & patterns'],
            facts: [
              {
                id: 'f1',
                text: 'Keeps a morning ritual',
                shareable: false,
                shareableTypes: ['partner'],
              },
            ],
          }),
        ]),
      insightsUpdate: update,
    });
    renderMemory();
    await userEvent.click(await screen.findByRole('button', { name: /Emotions & patterns/ }));
    // The read-view chip shows the current preset and taps to cycle (Partner → Close family here).
    const chip = screen.getByRole('button', { name: /Sharing for .*: Partner/ });
    await userEvent.click(chip);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('a heavy card clamps its summary + collapses its facts; a List toggle is offered (65 §3.4)', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    // "Read more" appears only when the clamped summary MEASURABLY overflows; jsdom has no layout, so
    // mock the geometry at the prototype so the clamped element reports a taller scrollHeight (65 §7).
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(80);
    const longSummary =
      'You process stress by planning your way out of it, and you feel calmest once there is a concrete next ' +
      'step written down rather than only turning it over in your head, which is why lists and plans settle you ' +
      'far more reliably than reassurance does, especially in the evenings after a demanding, unpredictable day.';
    installMockBridge({
      insightsList: () =>
        Promise.resolve([
          insight({
            id: 'i1',
            summary: longSummary,
            categories: ['Emotions & patterns'],
            facts: [
              { id: 'f1', text: 'Makes a list when overwhelmed', shareable: false },
              { id: 'f2', text: 'Calmer with a concrete next step', shareable: false },
              { id: 'f3', text: 'Rumination eases once it is written down', shareable: false },
              { id: 'f4', text: 'Prefers to plan the night before', shareable: false },
              { id: 'f5', text: 'Dislikes open-ended ambiguity', shareable: false },
            ],
          }),
        ]),
    });
    renderMemory();
    // The layout toggle (2 columns / List) is offered on the page.
    expect(await screen.findByRole('button', { name: 'List' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Emotions & patterns/ }));
    // A long summary clamps with "Read more"; a heavy fact list collapses behind a disclosure.
    expect(screen.getByRole('button', { name: 'Read more' })).toBeInTheDocument();
    expect(screen.queryByText('Makes a list when overwhelmed')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /5 things SelfOS noted/ }));
    expect(screen.getByText('Makes a list when overwhelmed')).toBeInTheDocument();
  });

  it('shows the portrait hero (narrative); its facts live in a section with the summary hidden', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    installMockBridge({
      insightsList: () =>
        Promise.resolve([
          insight({
            id: 'p',
            source: 'intake',
            summary: 'You are thoughtful and steady, and you carry a lot quietly.',
            categories: ['Other'],
            provenance: { intakeSection: 'basics', at: '2026-06-11T12:00:00.000Z' },
            facts: [{ id: 'f1', text: 'Grew up in Ohio', shareable: false }],
          }),
        ]),
    });
    renderMemory();
    expect(await screen.findByText('Your portrait')).toBeInTheDocument();
    // The hero shows the narrative exactly once.
    expect(screen.getAllByText(/You are thoughtful and steady/)).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Edit your answers/ })).toBeInTheDocument();
    // The portrait's FACTS live in its section (summary hidden there so the narrative isn't duplicated).
    await userEvent.click(screen.getByRole('button', { name: /^Other/ }));
    expect(screen.getByText('Grew up in Ohio')).toBeInTheDocument();
    expect(screen.getAllByText(/You are thoughtful and steady/)).toHaveLength(1);
  });

  it('never displays a related person’s shared facts raw (54)', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    installMockBridge({
      peopleList: () => Promise.resolve([{ ...activeP1, id: 'p2', displayName: 'Sam' }]),
      insightsList: () =>
        Promise.resolve([
          insight({ id: 'own', summary: 'MY OWN NOTE', categories: ['Other'] }),
          insight({
            id: 'rel',
            subjectPersonId: 'p2',
            summary: 'Sam summary',
            facts: [{ id: 'rf', text: 'Sam started a new job', shareable: true }],
          }),
        ]),
    });
    renderMemory();
    await userEvent.click(await screen.findByRole('button', { name: /^Other/ }));
    expect(screen.getByText('MY OWN NOTE')).toBeInTheDocument();
    expect(screen.queryByText('Sam started a new job')).not.toBeInTheDocument();
  });

  it('the "needs you" banner links to the DEDICATED review screen, not an inline queue (65 §3.3)', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    installMockBridge({
      insightsList: () =>
        Promise.resolve([insight({ id: 'd1', approved: false, summary: 'Wants more connection' })]),
    });
    render(
      <MemoryRouter initialEntries={['/memory']}>
        <Routes>
          <Route path="/memory" element={<Memory />} />
          <Route path="/memory/review" element={<div>REVIEW SCREEN</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/1 new insight to review/)).toBeInTheDocument();
    // No inline queue on the Memory page — the review is its own focused screen.
    expect(screen.getByText(/to review/)).toBeInTheDocument(); // the banner text, not a "N of M" queue
    expect(screen.queryByText(/of 1 to review/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Review now' }));
    expect(await screen.findByText('REVIEW SCREEN')).toBeInTheDocument();
  });

  it('search surfaces matching insights as cards', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    installMockBridge({
      insightsList: () =>
        Promise.resolve([
          insight({ id: 'i1', summary: 'Loves hiking outdoors' }),
          insight({ id: 'i2', summary: 'Prefers quiet evenings' }),
        ]),
    });
    renderMemory();
    await userEvent.type(await screen.findByLabelText('Search memory'), 'hiking');
    expect(screen.getByText('Loves hiking outdoors')).toBeInTheDocument();
    expect(screen.queryByText('Prefers quiet evenings')).not.toBeInTheDocument();
  });

  it('deep-links to an insight: opens its section + shows the card; an unknown id stays calm', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    installMockBridge({
      insightsList: () =>
        Promise.resolve([
          insight({ id: 'i-self', summary: 'Steady week.', categories: ['Emotions & patterns'] }),
        ]),
    });
    const { unmount } = render(
      <MemoryRouter initialEntries={[{ pathname: '/memory', state: { insightId: 'i-self' } }]}>
        <Memory />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Steady week.')).toBeInTheDocument();
    unmount();

    installMockBridge({
      insightsList: () => Promise.resolve([insight({ id: 'i1', summary: 'Own insight.' })]),
    });
    render(
      <MemoryRouter initialEntries={[{ pathname: '/memory', state: { insightId: 'missing' } }]}>
        <Memory />
      </MemoryRouter>,
    );
    await screen.findByRole('button', { name: /^Other/ });
    expect(screen.queryByText(/no longer here/)).not.toBeInTheDocument();
  });

  it('runs Refresh memory and shows the calm AI-off note', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    const refresh = vi.fn(() => Promise.resolve({ ok: false, reason: 'AI_OFF' as const }));
    installMockBridge({
      insightsList: () => Promise.resolve([insight({ id: 'i1' })]),
      memoryRefresh: refresh,
    });
    renderMemory();
    await userEvent.click(await screen.findByRole('button', { name: /Refresh/ }));
    expect(refresh).toHaveBeenCalled();
    expect(
      await screen.findByText(/ask the person who set up this household/i),
    ).toBeInTheDocument();
  });

  it('groups responses by recipient in the responses band, expanding to the card (#129)', async () => {
    useSessionStore.setState({ activePerson: activeP1 });
    usePeopleStore.setState({
      people: [activeP1, { ...activeP1, id: 'p2', displayName: 'Angel' }],
      loaded: true,
    });
    installMockBridge({
      peopleList: () =>
        Promise.resolve([activeP1, { ...activeP1, id: 'p2', displayName: 'Angel' }]),
      insightsList: () =>
        Promise.resolve([
          insight({
            id: 'resp',
            source: 'questionnaire',
            summary: 'Angel wants more protected time together',
            categories: ['Relationships'],
            provenance: { assignmentId: 'a1', aboutPersonId: 'p2', at: '2026-06-11T12:00:00.000Z' },
          }),
        ]),
    });
    renderMemory();
    const recipient = await screen.findByRole('button', { name: /Angel/ });
    await userEvent.click(recipient);
    expect(screen.getByText('Angel wants more protected time together')).toBeInTheDocument();
    // The header names who it's about — an "About Angel" chip, never "About you" (62 §context).
    expect(screen.getByText('About Angel')).toBeInTheDocument();
    expect(screen.queryByText('About you')).not.toBeInTheDocument();
  });
});
