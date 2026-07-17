import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { SendResult } from '@shared/schemas';
import { QuestionnaireResults, formatLinkExpiry } from './QuestionnaireResults';
import { useResultsStore } from '../../../stores/resultsStore';
import { useNotificationStore } from '../../../stores/notificationStore';
import { useSettingsStore } from '../../../settings/settingsStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

const renderResults = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <QuestionnaireResults questionnaireId="q1" compatibility={null} />
    </MemoryRouter>,
  );

afterEach(() => {
  clearMockBridge();
  useResultsStore.setState({
    questionnaireId: null,
    results: [],
    trends: [],
    loaded: false,
    loading: false,
  });
  useNotificationStore.getState().reset();
  useSettingsStore.setState({ values: {} });
});

/** Turn AI on (flag + a stubbed key) so the Analyze action is offered. */
function enableAi(): void {
  useSettingsStore.setState({ values: { 'ai.enabled': true } });
}

/**
 * The "Who answered" rows are collapsed by default (§21.4); expand them all so their bodies (answers /
 * insight / actions / declined note / expiry / reshare) render. Waits for the rows to load first.
 */
async function expandRows(): Promise<void> {
  const toggles = await screen.findAllByRole('button', { name: /^Expand / });
  for (const t of toggles) await userEvent.click(t);
}

const send = (over: Partial<SendResult> = {}): SendResult => ({
  assignmentId: 'a1',
  recipientName: 'Mara',
  channel: 'inApp',
  relayLinked: false,
  status: 'submitted',
  privacy: 'standard',
  createdAt: 'now',
  analyzed: false,
  analysisStale: false,
  ...over,
});

describe('QuestionnaireResults', () => {
  it('renders nothing when there are no sends (the tab is hidden upstream, §20.6)', async () => {
    installMockBridge({ assignmentsResults: () => Promise.resolve([]) });
    const { container } = renderResults();
    // No stale empty card; the builder gates the whole Results tab on there being ≥1 send.
    await waitFor(() => expect(useResultsStore.getState().loaded).toBe(true));
    expect(screen.queryByText(/haven’t sent this questionnaire yet/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Results' })).not.toBeInTheDocument();
    expect(container.textContent).toBe('');
  });

  it('shows a summary band + status-grouped cards for multiple recipients (§20.6)', async () => {
    installMockBridge({
      assignmentsResults: () =>
        Promise.resolve([
          send({ assignmentId: 'a1', recipientName: 'Angel', status: 'submitted' }),
          send({ assignmentId: 'a2', recipientName: 'Sam', status: 'sent' }),
        ]),
    });
    renderResults();
    // Summary band: 2 recipients (a stat tile) + status group headers for the non-empty groups.
    expect(await screen.findByText('recipients')).toBeInTheDocument();
    // "Awaiting" is a unique group header (a 'sent' send's own badge reads "Sent — waiting").
    expect(screen.getByText('Awaiting')).toBeInTheDocument();
    // "Answered" is both the group header AND the submitted send's status badge → at least two.
    expect(screen.getAllByText('Answered').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Angel')).toBeInTheDocument();
    expect(screen.getByText('Sam')).toBeInTheDocument();
  });

  it('renders the "At a glance" aggregate — a distribution + a numeric average (§20.7)', async () => {
    installMockBridge({
      assignmentsResults: () => Promise.resolve([send({ status: 'submitted' })]),
      assignmentsAggregate: () =>
        Promise.resolve({
          questions: [
            {
              questionId: 'pick',
              prompt: 'Best word?',
              responseCount: 3,
              skipped: 0,
              unclear: 0,
              kind: 'distribution',
              options: [
                { label: 'Calm', count: 2 },
                { label: 'Tense', count: 1 },
              ],
            },
            {
              questionId: 'rate',
              prompt: 'How connected?',
              responseCount: 3,
              // Two people skipped this, one flagged it unclear → the author sees a reword nudge (§25.5).
              skipped: 2,
              unclear: 1,
              kind: 'average',
              average: 3.5,
              min: 1,
              max: 5,
            },
          ],
        }),
    });
    renderResults();
    expect(await screen.findByText('At a glance')).toBeInTheDocument();
    expect(screen.getByText('Best word?')).toBeInTheDocument();
    expect(screen.getByText('Calm')).toBeInTheDocument();
    // The value is shown as text (never colour-only, §9).
    expect(screen.getByText('3.5')).toBeInTheDocument();
    expect(screen.getByText(/scale 1–5/)).toBeInTheDocument();
    // The skip/"unclear" signal surfaces on the question people struggled with (§25.5).
    expect(screen.getByText(/1 found it unclear/)).toBeInTheDocument();
    expect(screen.getByText(/2 skipped · consider rewording/)).toBeInTheDocument();
  });

  const aiReadyBridge = {
    secretHas: () => Promise.resolve(true),
    aiKeyStatus: () =>
      Promise.resolve({
        hasSharedKey: false,
        hasDeviceOverride: true,
        resolvedReady: true,
        source: 'device' as const,
      }),
  };

  it('private send (§21.5): shows NOTHING from the answers — a calm explainer + a "Draw an insight" CTA', async () => {
    enableAi();
    installMockBridge({
      ...aiReadyBridge,
      assignmentsResults: () =>
        Promise.resolve([
          send({ recipientName: 'Angel', status: 'submitted', privacy: 'private' }),
        ]),
    });
    renderResults();
    await expandRows();
    // The calm explainer — the answers (words AND numbers) are never shown — and the only action: draw an insight.
    expect(
      await screen.findByText(/answers are never shown here — they quietly inform your coaching/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Draw an insight/i })).toBeInTheDocument();
    // No numeric bars, no answer list, no inline excerpt on a private card.
    expect(screen.queryByText('Ratings you can see')).not.toBeInTheDocument();
    expect(screen.queryByText('Insight')).not.toBeInTheDocument();
  });

  it('an analyzed PRIVATE send links to Memory, and never shows the insight excerpt inline (§21.5)', async () => {
    enableAi();
    installMockBridge({
      ...aiReadyBridge,
      assignmentsResults: () =>
        Promise.resolve([
          send({
            recipientName: 'Angel',
            status: 'submitted',
            privacy: 'private',
            analyzed: true,
            insightSummary: 'They feel connected but carry something unspoken.',
            insightId: 'insight-1',
          }),
        ]),
    });
    renderResults();
    await expandRows();
    // A private card links to Memory; it does NOT render the insight excerpt (the private surface stays answer-free).
    expect(
      await screen.findByRole('button', { name: /View insight in Memory/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/They feel connected but carry something unspoken/i),
    ).not.toBeInTheDocument();
  });

  it('an analyzed STANDARD send shows the Insight excerpt inline with a Memory deep-link (§20.8)', async () => {
    enableAi();
    installMockBridge({
      ...aiReadyBridge,
      assignmentsResults: () =>
        Promise.resolve([
          send({
            recipientName: 'Angel',
            status: 'submitted',
            privacy: 'standard',
            analyzed: true,
            answers: [{ prompt: 'How?', answer: 'Great' }],
            insightSummary: 'They feel connected but carry something unspoken.',
            insightId: 'insight-1',
          }),
        ]),
    });
    renderResults();
    await expandRows();
    expect(
      await screen.findByText(/They feel connected but carry something unspoken/i),
    ).toBeInTheDocument();
    expect(screen.getByText('Insight')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /View in Memory/i })).toBeInTheDocument();
  });

  it('omits the "At a glance" band when there are no aggregated questions', async () => {
    installMockBridge({
      assignmentsResults: () => Promise.resolve([send({ status: 'submitted' })]),
      assignmentsAggregate: () => Promise.resolve({ questions: [] }),
    });
    renderResults();
    await screen.findByRole('heading', { name: 'Results' });
    expect(screen.queryByText('At a glance')).not.toBeInTheDocument();
  });

  it('marks the responses-arrived notification seen on open (38 §3.1)', async () => {
    installMockBridge({ assignmentsResults: () => Promise.resolve([]) });
    await useNotificationStore.getState().load();
    useNotificationStore.getState().setCandidates([
      {
        kind: 'responses-arrived',
        coalesceKey: 'responses-arrived:q1',
        signature: '1',
        title: 'Angel answered “Our week”',
      },
    ]);
    const slot = (): boolean | undefined =>
      useNotificationStore
        .getState()
        .notifications.find((n) => n.coalesceKey === 'responses-arrived:q1')?.read;
    expect(slot()).toBe(false); // unread before the sender opens Results
    renderResults();
    await waitFor(() => expect(slot()).toBe(true)); // opening Results = "seen"
  });

  it('exports results to a file outside the vault and confirms the path (38 §3.7)', async () => {
    const assignmentsExportResults = vi.fn(() => Promise.resolve('/tmp/our-week.csv'));
    installMockBridge({
      assignmentsExportResults,
      assignmentsResults: () =>
        Promise.resolve([send({ status: 'submitted', answers: [{ prompt: 'Q', answer: 'A' }] })]),
    });
    renderResults();
    await expandRows();
    await screen.findByText('Mara');
    await userEvent.click(screen.getByRole('button', { name: /export csv/i }));
    expect(assignmentsExportResults).toHaveBeenCalledWith({ questionnaireId: 'q1', format: 'csv' });
    expect(await screen.findByText(/outside your encrypted vault/i)).toBeInTheDocument();
  });

  it('surfaces a relay link’s expiry on an open send (38 §3.6)', async () => {
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    installMockBridge({
      assignmentsResults: () =>
        Promise.resolve([
          send({ relayLinked: true, channel: 'relay', status: 'sent', expiresAt: future }),
        ]),
    });
    renderResults();
    await expandRows();
    expect(await screen.findByText(/link expires in 3 days/i)).toBeInTheDocument();
  });

  it('shows the raw answers for a Standard, submitted send', async () => {
    enableAi();
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
      assignmentsResults: () =>
        Promise.resolve([
          send({
            answers: [
              { prompt: 'How are we doing?', answer: 'Doing great' },
              // A skipped question renders as a distinct "Skipped" chip + reason, not a plain answer (§25.5).
              {
                prompt: 'What worries you?',
                answer: 'Skipped — Prefer not to say',
                declined: true,
                declineReason: 'Prefer not to say',
              },
            ],
          }),
        ]),
    });
    renderResults();
    await expandRows();
    expect(await screen.findByText('How are we doing?')).toBeInTheDocument();
    expect(screen.getByText('Doing great')).toBeInTheDocument();
    // The skip shows the "Skipped" chip + its reason (not the "Skipped — …" string blob).
    expect(screen.getByText('Skipped')).toBeInTheDocument();
    expect(screen.getByText('Prefer not to say')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /analyze/i })).toBeInTheDocument();
  });

  it('hides raw answers for a Private send, offering only Analyze', async () => {
    enableAi();
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
      assignmentsResults: () => Promise.resolve([send({ privacy: 'private' })]),
    });
    renderResults();
    await expandRows();
    // A Private send never shows raw answers — the calm explainer + a "Draw an insight" CTA (§21.5).
    expect(
      await screen.findByText(/answers are never shown here — they quietly inform your coaching/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Draw an insight/i })).toBeInTheDocument();
  });

  it('an analyzed private send links to Memory, no Analyze/Draw action (§21.5)', async () => {
    enableAi();
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
      assignmentsResults: () =>
        Promise.resolve([send({ privacy: 'private', analyzed: true, insightId: 'insight-9' })]),
    });
    renderResults();
    await expandRows();
    expect(
      await screen.findByRole('button', { name: /View insight in Memory/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Draw an insight/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Analyze/i })).not.toBeInTheDocument();
  });

  it('flags a stale analysis (recipient edited) with a Re-analyze action (56)', async () => {
    enableAi();
    const insightsAnalyze = vi.fn(() => Promise.resolve({ ok: true as const }));
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
      assignmentsResults: () =>
        Promise.resolve([
          send({ privacy: 'private', analyzed: true, analysisStale: true, revision: 2 }),
        ]),
      insightsAnalyze,
    });
    renderResults();
    await expandRows();
    // A stale private insight prompts to draw a fresh one (§21.5) — no raw answers, no "analysis" wording.
    expect(await screen.findByText(/answers updated since your last insight/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Draw a fresh insight/i }));
    expect(insightsAnalyze).toHaveBeenCalledWith({ assignmentId: 'a1' });
  });

  it('draws an insight from a private response, then links to Memory (§21.5)', async () => {
    enableAi();
    let analyzed = false;
    const insightsAnalyze = vi.fn(() => {
      analyzed = true;
      return Promise.resolve({ ok: true as const });
    });
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
      insightsAnalyze,
      assignmentsResults: () =>
        Promise.resolve([send({ privacy: 'private', analyzed, insightId: 'insight-1' })]),
    });
    renderResults();
    await expandRows();

    await userEvent.click(await screen.findByRole('button', { name: /Draw an insight/i }));
    expect(insightsAnalyze).toHaveBeenCalledWith({ assignmentId: 'a1' });
    // After drawing, the reload reports analyzed → the card links to Memory (no answers shown).
    expect(
      await screen.findByRole('button', { name: /View insight in Memory/i }),
    ).toBeInTheDocument();
  });

  it('prompts to turn on AI when it is off, with no Analyze action', async () => {
    installMockBridge({
      assignmentsResults: () => Promise.resolve([send()]),
    });
    renderResults();
    await expandRows();
    await waitFor(() => expect(screen.getByText(/isn.t set up yet/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /analyze/i })).not.toBeInTheDocument();
  });

  it('does not mislabel a Standard send as private when its answers fail to load', async () => {
    installMockBridge({
      // Standard + submitted but no answers (a rare missing/corrupt response) → a neutral message.
      assignmentsResults: () => Promise.resolve([send({ privacy: 'standard' })]),
    });
    renderResults();
    await expandRows();
    expect(await screen.findByText(/couldn’t load these answers/i)).toBeInTheDocument();
    expect(screen.queryByText(/raw responses stay hidden/i)).not.toBeInTheDocument();
  });

  it('deletes a send after an inline confirm', async () => {
    const assignmentsDelete = vi.fn(() => Promise.resolve());
    installMockBridge({
      assignmentsResults: () => Promise.resolve([send()]),
      assignmentsDelete,
    });
    renderResults();

    await userEvent.click(await screen.findByRole('button', { name: /delete this send/i }));
    expect(assignmentsDelete).not.toHaveBeenCalled(); // gated behind the confirm
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(assignmentsDelete).toHaveBeenCalledWith('a1');
  });

  it('renders a Trends section with a chart when sends have re-asks', async () => {
    installMockBridge({
      assignmentsResults: () => Promise.resolve([send()]),
      assignmentsTrends: () =>
        Promise.resolve([
          {
            questionId: 'q1',
            prompt: 'How connected do you feel?',
            series: [
              {
                label: 'Mara',
                points: [
                  { at: '2026-01-01', value: 3 },
                  { at: '2026-02-01', value: 5 },
                ],
              },
            ],
          },
        ]),
    });
    renderResults();
    await expandRows();
    expect(await screen.findByRole('heading', { name: 'Trends' })).toBeInTheDocument();
    expect(screen.getByText('How connected do you feel?')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /trend over time for/i })).toBeInTheDocument();
  });

  it('shows a declined send with its note', async () => {
    installMockBridge({
      assignmentsResults: () =>
        Promise.resolve([send({ status: 'declined', declineNote: 'Not now' })]),
    });
    renderResults();
    await expandRows();
    expect(await screen.findByText(/Not now/)).toBeInTheDocument();
  });

  it('offers "Check for responses" + revoke for an open external (relay) send', async () => {
    let drained = false;
    installMockBridge({
      assignmentsResults: () =>
        Promise.resolve([
          send({ channel: 'relay', relayLinked: true, status: 'sent', recipientName: 'Alex' }),
        ]),
      assignmentsDrain: () => {
        drained = true;
        return Promise.resolve({ drained: 1, declined: 0 });
      },
    });
    renderResults();
    await screen.findByText('Alex');
    // External, still-open send → drain + revoke affordances appear.
    expect(screen.getByRole('button', { name: /check for responses/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /revoke the link sent to Alex/i }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /check for responses/i }));
    await waitFor(() => expect(drained).toBe(true));
  });

  // The #3 regression: a HOUSEHOLD ('inApp') send that ALSO minted a relay link (§17.13) must surface the
  // same drain + revoke affordances — the bug was gating them on `channel === 'relay'`, which hid the link
  // for household sends so a relay response could never be retrieved.
  it('offers "Check for responses" + revoke for an open household send that minted a link', async () => {
    let drained = false;
    installMockBridge({
      assignmentsResults: () =>
        Promise.resolve([
          send({ channel: 'inApp', relayLinked: true, status: 'sent', recipientName: 'Mara' }),
        ]),
      assignmentsDrain: () => {
        drained = true;
        return Promise.resolve({ drained: 1, declined: 0 });
      },
    });
    renderResults();
    await expandRows();
    await screen.findByText('Mara');
    expect(screen.getByRole('button', { name: /check for responses/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /revoke the link sent to Mara/i }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /check for responses/i }));
    await waitFor(() => expect(drained).toBe(true));
  });

  // A household send WITHOUT a relay link (Inbox-only, no relay connected) shows no revoke affordance, but
  // CAN still mint a link via "Create a link" (e.g. a relay was connected after the send).
  it('shows "Create a link" (not revoke) for an Inbox-only open household send', async () => {
    installMockBridge({
      assignmentsResults: () =>
        Promise.resolve([
          send({ channel: 'inApp', relayLinked: false, status: 'sent', recipientName: 'Mara' }),
        ]),
    });
    renderResults();
    await screen.findByText('Mara');
    await expandRows();
    expect(
      screen.queryByRole('button', { name: /revoke the link sent to Mara/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create a link/i })).toBeInTheDocument();
  });

  // §17.14: an open relay-linked send can be re-shared — minting a fresh link + PIN into the delivery UI.
  it('reshares an open send: mints a fresh link + PIN into the delivery UI', async () => {
    const assignmentsReshare = vi.fn(() =>
      Promise.resolve({ link: 'https://x.workers.dev/q/tok9#k=key9', pin: '112233' }),
    );
    installMockBridge({
      assignmentsResults: () =>
        Promise.resolve([
          send({ channel: 'inApp', relayLinked: true, status: 'sent', recipientName: 'Mara' }),
        ]),
      assignmentsReshare,
    });
    renderResults();
    await expandRows();
    await screen.findByText('Mara');
    await userEvent.click(screen.getByRole('button', { name: /resend link/i }));
    expect(assignmentsReshare).toHaveBeenCalledWith('a1');
    expect(
      await screen.findByDisplayValue('https://x.workers.dev/q/tok9#k=key9'),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue('112233')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^email$/i })).toBeInTheDocument();
  });
});

describe('formatLinkExpiry (38 §3.6)', () => {
  const now = Date.UTC(2026, 5, 23);
  it('counts down days, names today, and reports an expired link', () => {
    expect(formatLinkExpiry(new Date(now + 3 * 864e5).toISOString(), now)).toBe(
      'Link expires in 3 days',
    );
    expect(formatLinkExpiry(new Date(now + 1000).toISOString(), now)).toBe('Link expires today');
    expect(formatLinkExpiry(new Date(now - 864e5).toISOString(), now)).toBe('Link expired');
  });
});
