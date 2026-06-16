import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AlignmentReport, CompatibilityGroup } from '@shared/schemas';
import { CompatibilityResults } from './CompatibilityResults';
import { useSettingsStore } from '../../../settings/settingsStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

afterEach(() => {
  clearMockBridge();
  useSettingsStore.setState({ values: {} });
});

const enableAi = (): void => useSettingsStore.setState({ values: { 'ai.enabled': true } });

const report = (over: Partial<AlignmentReport> = {}): AlignmentReport => ({
  schemaVersion: 1,
  compatibilityGroupId: 'g1',
  questionnaireId: 'q1',
  personAName: 'Alex',
  personBName: 'Bri',
  summary: 'You two are largely aligned.',
  items: [
    { canonicalId: 'c1', prompt: 'How connected?', agreement: 'aligned', note: 'Both feel close.' },
    { canonicalId: 'c2', prompt: 'More time?', agreement: 'divergent', note: 'You differ here.' },
  ],
  generatedAt: 'now',
  ...over,
});

const group = (over: Partial<CompatibilityGroup> = {}): CompatibilityGroup => ({
  compatibilityGroupId: 'g1',
  questionnaireId: 'q1',
  visibility: 'sharedReport',
  members: [
    { assignmentId: 'a1', recipientName: 'Alex', channel: 'inApp', status: 'submitted' },
    { assignmentId: 'a2', recipientName: 'Bri', channel: 'inApp', status: 'submitted' },
  ],
  bothSubmitted: true,
  report: null,
  analyzed: false,
  canReveal: false,
  ...over,
});

const renderResults = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <CompatibilityResults questionnaireId="q1" />
    </MemoryRouter>,
  );

describe('CompatibilityResults', () => {
  it('waits for both people before offering to align', async () => {
    installMockBridge({
      assignmentsCompatibility: () =>
        Promise.resolve([
          group({
            bothSubmitted: false,
            members: [
              { assignmentId: 'a1', recipientName: 'Alex', channel: 'inApp', status: 'submitted' },
              { assignmentId: 'a2', recipientName: 'Bri', channel: 'inApp', status: 'sent' },
            ],
          }),
        ]),
    });
    enableAi();
    renderResults();
    expect(
      await screen.findByText(/Both people need to answer before you can align/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Generate alignment/ })).not.toBeInTheDocument();
  });

  it('generates an alignment when both have answered', async () => {
    const assignmentsAlign = vi.fn(() =>
      Promise.resolve({ ok: true as const, report: report(), usage: {} as never }),
    );
    installMockBridge({
      assignmentsCompatibility: () => Promise.resolve([group()]),
      assignmentsAlign,
      secretHas: () => Promise.resolve(true),
    });
    enableAi();
    renderResults();
    const button = await screen.findByRole('button', { name: /Generate alignment/ });
    await userEvent.click(button);
    expect(assignmentsAlign).toHaveBeenCalledWith('g1');
  });

  it('renders the report summary + per-question agreement once generated', async () => {
    installMockBridge({
      assignmentsCompatibility: () =>
        Promise.resolve([group({ report: report(), analyzed: true })]),
      secretHas: () => Promise.resolve(true),
    });
    enableAi();
    renderResults();
    expect(await screen.findByText('You two are largely aligned.')).toBeInTheDocument();
    expect(screen.getByText('Aligned')).toBeInTheDocument();
    expect(screen.getByText('Different')).toBeInTheDocument();
    expect(screen.getByText(/Review it in Memory/)).toBeInTheDocument();
  });

  it('contextOnly (§16.2): no report — offers "Update both coaches", then shows the done state', async () => {
    const assignmentsDistillContextOnly = vi.fn(() =>
      Promise.resolve({ ok: true as const, updated: 2, usage: [] }),
    );
    installMockBridge({
      assignmentsCompatibility: () => Promise.resolve([group({ visibility: 'contextOnly' })]),
      assignmentsDistillContextOnly,
      secretHas: () => Promise.resolve(true),
    });
    enableAi();
    renderResults();

    expect(await screen.findByText(/no report is produced/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Generate alignment/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Update both coaches/ }));
    expect(assignmentsDistillContextOnly).toHaveBeenCalledWith('g1');
  });

  it('contextOnly: shows "Both coaches updated" once distilled', async () => {
    installMockBridge({
      assignmentsCompatibility: () =>
        Promise.resolve([group({ visibility: 'contextOnly', analyzed: true })]),
      secretHas: () => Promise.resolve(true),
    });
    enableAi();
    renderResults();
    expect(await screen.findByText(/Both coaches updated/i)).toBeInTheDocument();
    expect(screen.queryByText('You two are largely aligned.')).not.toBeInTheDocument();
  });

  it('offers "Share results" for an external recipient + confirms once shared (§17.12-D)', async () => {
    const assignmentsPublishCompatResult = vi.fn(() =>
      Promise.resolve({ ok: true as const, published: 1 }),
    );
    installMockBridge({
      assignmentsCompatibility: () =>
        Promise.resolve([
          group({
            report: report(),
            members: [
              { assignmentId: 'a1', recipientName: 'You', channel: 'inApp', status: 'submitted' },
              { assignmentId: 'a2', recipientName: 'Alex', channel: 'relay', status: 'submitted' },
            ],
          }),
        ]),
      assignmentsPublishCompatResult,
      secretHas: () => Promise.resolve(true),
    });
    enableAi();
    renderResults();
    const shareBtn = await screen.findByRole('button', { name: /Share results/ });
    await userEvent.click(shareBtn);
    expect(assignmentsPublishCompatResult).toHaveBeenCalledWith('g1');
    expect(await screen.findByText(/Shared with Alex/)).toBeInTheDocument();
  });

  it('does not offer "Share results" when both members are in-app (household)', async () => {
    installMockBridge({
      assignmentsCompatibility: () => Promise.resolve([group({ report: report() })]),
      secretHas: () => Promise.resolve(true),
    });
    enableAi();
    renderResults();
    expect(await screen.findByText('You two are largely aligned.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Share results/ })).not.toBeInTheDocument();
  });

  it('offers an audited reveal only for a senderSeesAll group with readRaw', async () => {
    const assignmentsRevealRaw = vi.fn(() =>
      Promise.resolve([{ prompt: 'How connected?', answer: '4' }]),
    );
    installMockBridge({
      assignmentsCompatibility: () =>
        Promise.resolve([
          group({ visibility: 'senderSeesAll', canReveal: true, report: report() }),
        ]),
      assignmentsRevealRaw,
      secretHas: () => Promise.resolve(true),
    });
    enableAi();
    renderResults();
    const revealBtn = await screen.findByRole('button', { name: /Reveal Alex’s answers/ });
    expect(screen.getByText(/treat them with care/)).toBeInTheDocument();
    await userEvent.click(revealBtn);
    expect(assignmentsRevealRaw).toHaveBeenCalledWith('a1');
    await waitFor(() => expect(screen.getByText('4')).toBeInTheDocument());
  });
});
