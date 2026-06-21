import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { SendResult } from '@shared/schemas';
import { QuestionnaireResults } from './QuestionnaireResults';
import { useResultsStore } from '../../../stores/resultsStore';
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
  useSettingsStore.setState({ values: {} });
});

/** Turn AI on (flag + a stubbed key) so the Analyze action is offered. */
function enableAi(): void {
  useSettingsStore.setState({ values: { 'ai.enabled': true } });
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
  ...over,
});

describe('QuestionnaireResults', () => {
  it('shows the empty state when nothing has been sent', async () => {
    installMockBridge({ assignmentsResults: () => Promise.resolve([]) });
    renderResults();
    expect(await screen.findByText(/haven’t sent this questionnaire yet/i)).toBeInTheDocument();
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
          send({ answers: [{ prompt: 'How are we doing?', answer: 'Doing great' }] }),
        ]),
    });
    renderResults();
    expect(await screen.findByText('How are we doing?')).toBeInTheDocument();
    expect(screen.getByText('Doing great')).toBeInTheDocument();
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
    expect(await screen.findByText(/raw responses stay hidden/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /analyze/i })).toBeInTheDocument();
  });

  it('links an already-analyzed send to Memory instead of Analyze', async () => {
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
      assignmentsResults: () => Promise.resolve([send({ privacy: 'private', analyzed: true })]),
    });
    renderResults();
    expect(await screen.findByText(/insight drafted from this response/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /review it in memory/i })).toHaveAttribute(
      'href',
      '/memory',
    );
    expect(screen.queryByRole('button', { name: /analyze/i })).not.toBeInTheDocument();
  });

  it('analyzes a response and confirms with a Memory pointer', async () => {
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
      assignmentsResults: () => Promise.resolve([send({ privacy: 'private', analyzed })]),
    });
    renderResults();

    await userEvent.click(await screen.findByRole('button', { name: /analyze/i }));
    expect(insightsAnalyze).toHaveBeenCalledWith({ assignmentId: 'a1' });
    // After analyze, the reload reports analyzed → the card collapses to the Memory pointer.
    expect(await screen.findByText(/insight drafted from this response/i)).toBeInTheDocument();
  });

  it('prompts to turn on AI when it is off, with no Analyze action', async () => {
    installMockBridge({
      assignmentsResults: () => Promise.resolve([send()]),
    });
    renderResults();
    await waitFor(() => expect(screen.getByText(/turn on ai/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /analyze/i })).not.toBeInTheDocument();
  });

  it('does not mislabel a Standard send as private when its answers fail to load', async () => {
    installMockBridge({
      // Standard + submitted but no answers (a rare missing/corrupt response) → a neutral message.
      assignmentsResults: () => Promise.resolve([send({ privacy: 'standard' })]),
    });
    renderResults();
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
