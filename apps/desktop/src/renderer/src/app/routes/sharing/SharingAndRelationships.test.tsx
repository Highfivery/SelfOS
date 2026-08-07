import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Insight, OutboundSharing, Relationship } from '@shared/schemas';
import { DEFAULT_ROLES } from '@shared/capabilities';
import { SharingAndRelationships } from './SharingAndRelationships';
import { useInsightStore } from '../../../stores/insightStore';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useSessionStore } from '../../../stores/sessionStore';
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
const partnerP2 = { ...activeP1, id: 'p2', displayName: 'Sam' };

const partnerRel: Relationship = {
  id: 'r1',
  schemaVersion: 1,
  fromPersonId: 'p1',
  toPersonId: 'p2',
  type: 'partner',
  createdAt: 'now',
  updatedAt: 'now',
};

const parentInsight: Insight = {
  schemaVersion: 1,
  id: 'i1',
  source: 'session',
  subjectPersonId: 'p1',
  summary: '',
  facts: [{ id: 'f1', text: 'Values honesty', shareable: false, shareableTypes: ['partner'] }],
  confidence: 'medium',
  categories: ['Values & beliefs'],
  approved: true,
  provenance: { at: '2026-06-20T12:00:00.000Z' },
  createdAt: '2026-06-20T12:00:00.000Z',
  updatedAt: '2026-06-20T12:00:00.000Z',
};

const outbound: OutboundSharing = {
  items: [
    {
      id: 'f1',
      kind: 'fact',
      text: 'Values honesty',
      broadcast: false,
      types: ['partner'],
      personIds: [],
      recipients: [{ id: 'p2', displayName: 'Sam' }],
      lifeArea: 'Values & beliefs',
    },
    {
      id: 'health.sleep',
      kind: 'intakeAnswer',
      text: 'Sleep: 6 hours',
      broadcast: false,
      types: ['partner'],
      personIds: [],
      recipients: [{ id: 'p2', displayName: 'Sam' }],
      category: 'health',
    },
    {
      id: 'field:occupation',
      kind: 'profileField',
      text: 'Occupation: Nurse',
      broadcast: false,
      types: [],
      personIds: [],
      recipients: [{ id: 'p2', displayName: 'Sam' }],
      lifeArea: 'Work & purpose',
    },
    {
      id: 'dreamImage:d1',
      kind: 'dreamImage',
      text: 'Dream image · Flying',
      broadcast: false,
      types: [],
      personIds: ['p2'],
      recipients: [{ id: 'p2', displayName: 'Sam' }],
    },
  ],
  keptPrivateCount: 3,
};

function seedOwner(): void {
  useSessionStore.setState({
    activePerson: activeP1,
    access: {
      roles: DEFAULT_ROLES,
      accounts: [{ personId: activeP1.id, roleId: 'owner', hasPin: false }],
    },
  });
}

function renderPage(): void {
  render(
    <MemoryRouter>
      <SharingAndRelationships />
    </MemoryRouter>,
  );
}

function installBridge(over: Parameters<typeof installMockBridge>[0] = {}): void {
  installMockBridge({
    peopleList: () => Promise.resolve([activeP1, partnerP2]),
    relationshipsList: () => Promise.resolve([partnerRel]),
    relationshipsGetSynthesis: () => Promise.resolve(null),
    insightsList: () => Promise.resolve([parentInsight]),
    memoryOutboundSharing: () => Promise.resolve(outbound),
    ...over,
  });
}

afterEach(() => {
  clearMockBridge();
  useInsightStore.setState({
    insights: [],
    outbound: { items: [], keptPrivateCount: 0 },
    loaded: false,
  });
  usePeopleStore.setState({ people: [], loaded: false });
  useSessionStore.setState({ activePerson: null, access: null });
});

describe('Sharing dashboard (spec 68)', () => {
  it('renders the stats header + groups By person; a per-person dream share reads "Shared with Sam"', async () => {
    seedOwner();
    installBridge();
    renderPage();

    // Stats header: 4 things · 1 person reached · 3 kept private (labels are unique; the numeric split is
    // covered by the summarizeSharingStats unit test — here we assert the tiles render).
    expect(await screen.findByText('Things you share')).toBeInTheDocument();
    expect(screen.getByText('Person reached')).toBeInTheDocument();
    expect(screen.getByText('Kept private')).toBeInTheDocument();
    expect(screen.getByText(/stay yours unless you deliberately share/)).toBeInTheDocument();

    // By person (default): the Sam group with the fact + the dream share label (the §3.9 wart fix).
    expect(screen.getByRole('tab', { name: /By person/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Values honesty')).toBeInTheDocument();
    // The dream image + profile field both read "Shared with Sam" (the §3.9 wart fix) — never "Private".
    expect(screen.getAllByText(/Shared with Sam/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/Private · reaching/)).not.toBeInTheDocument();
  });

  it('switches to Everything and shows exactly one editable intake-answer row (no inert twin)', async () => {
    seedOwner();
    installBridge();
    renderPage();

    await userEvent.click(await screen.findByRole('tab', { name: /Everything/ }));
    // Scope to the tabpanel — "Onboarding answer" also appears as a filter <option>. Exactly one row (no twin).
    const panel = within(screen.getByRole('tabpanel'));
    expect(panel.getAllByText(/Onboarding answer/)).toHaveLength(1);
    // The profile field renders a share/lock affordance.
    expect(screen.getByRole('button', { name: /Occupation: shared/i })).toBeInTheDocument();
  });

  it('By category shows per-group bulk actions that call setScopeBatch after a confirm', async () => {
    seedOwner();
    const setScopeBatch = vi.fn(() => Promise.resolve({ updated: 1 }));
    installBridge({ memorySetScopeBatch: setScopeBatch });
    renderPage();

    await userEvent.click(await screen.findByRole('tab', { name: /By category/ }));
    const shareBtns = await screen.findAllByRole('button', { name: /Share with partner/ });
    await userEvent.click(shareBtns[0]!);
    await userEvent.click(await screen.findByRole('button', { name: /Yes, apply/ }));
    expect(setScopeBatch).toHaveBeenCalledWith(expect.objectContaining({ types: ['partner'] }));
  });

  it('flips a profile field via setProfileFieldShared', async () => {
    seedOwner();
    const setShared = vi.fn(() => Promise.resolve(true));
    installBridge({ memorySetProfileFieldShared: setShared });
    renderPage();

    await userEvent.click(await screen.findByRole('tab', { name: /Everything/ }));
    await userEvent.click(screen.getByRole('button', { name: /Occupation: shared/i }));
    expect(setShared).toHaveBeenCalledWith({ field: 'occupation', shared: false });
  });

  it('unshares a dream image via setDreamImageShare', async () => {
    seedOwner();
    const setImg = vi.fn(() => Promise.resolve({ ok: true as const }));
    installBridge({ dreamSetImageShare: setImg });
    renderPage();

    await userEvent.click(await screen.findByRole('tab', { name: /Everything/ }));
    await userEvent.click(
      screen.getByRole('button', { name: /Stop sharing this dream image with Sam/ }),
    );
    expect(setImg).toHaveBeenCalledWith({ dreamId: 'd1', targetPersonId: 'p2', shared: false });
  });

  it('Reflections tab renders the partner card + generates an observation', async () => {
    seedOwner();
    const synth = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        synthesis: {
          schemaVersion: 1,
          subjectPersonId: 'p1',
          partnerPersonId: 'p2',
          observations: ['You and Sam both value security.'],
          computedAt: '2026-06-26T12:00:00.000Z',
        },
      }),
    );
    installBridge({ relationshipsSynthesize: synth });
    renderPage();

    await userEvent.click(await screen.findByRole('tab', { name: /Reflections/ }));
    expect(await screen.findByText(/You & Sam/)).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: /Reflect on us/ }));
    expect(await screen.findByText('You and Sam both value security.')).toBeInTheDocument();
  });

  it('a memory.own-without-intake.own role sees intake answers read-only (no dead picker, 68 §7)', async () => {
    useSessionStore.setState({
      activePerson: activeP1,
      access: {
        roles: [
          { id: 'reader', name: 'Reader', builtin: false, capabilities: { 'memory.own': true } },
        ],
        accounts: [{ personId: activeP1.id, roleId: 'reader', hasPin: false }],
      },
    });
    installBridge();
    renderPage();

    await userEvent.click(await screen.findByRole('tab', { name: /Everything/ }));
    // The intake answer row shows a read-only chip, not an editable scope picker.
    const row = screen.getByText('Sleep: 6 hours').closest('div')!;
    expect(
      within(row.parentElement as HTMLElement).getByText(/manage in onboarding/),
    ).toBeInTheDocument();
  });

  it('shows the empty state when nothing is shared and nothing is kept private', async () => {
    seedOwner();
    installBridge({
      insightsList: () => Promise.resolve([]),
      memoryOutboundSharing: () => Promise.resolve({ items: [], keptPrivateCount: 0 }),
    });
    renderPage();
    expect(await screen.findByText(/not sharing anything yet/)).toBeInTheDocument();
  });
});
