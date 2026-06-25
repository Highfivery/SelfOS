import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Person, SavedSuggestion, SavedSuggestionsResult } from '@shared/schemas';
import type { SelfosBridge } from '@shared/channels';
import { SuggestedPanel } from './SuggestedPanel';
import { useSettingsStore } from '../../../settings/settingsStore';
import { usePeopleStore } from '../../../stores/peopleStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

afterEach(() => {
  clearMockBridge();
  useSettingsStore.setState({ values: {} });
  usePeopleStore.setState({ people: [], relationships: [], loaded: false });
});

const mara: Person = {
  id: 'p1',
  schemaVersion: 1,
  displayName: 'Mara',
  isSubject: true,
  tags: [],
  createdAt: '2026-06-25T00:00:00.000Z',
  updatedAt: '2026-06-25T00:00:00.000Z',
};

const saved = (title: string): SavedSuggestion => ({
  id: `sg-${title}`,
  createdAt: '2026-06-25T00:00:00.000Z',
  title,
  type: 'general',
  rationale: `why ${title}`,
  questions: [{ type: 'rating', prompt: `${title} — how connected this week?` }],
});

/** Mount with AI ready (enabled + a resolved key), Mara in the household, and the given overrides. The
 * people store is seeded directly (deterministic — no async-load race between tests). */
function renderReady(
  overrides: Partial<SelfosBridge> = {},
  onCreate: Parameters<typeof SuggestedPanel>[0]['onCreate'] = () => {},
): void {
  useSettingsStore.setState({ values: { 'ai.enabled': true } });
  usePeopleStore.setState({ people: [mara], relationships: [], loaded: true });
  installMockBridge({
    aiKeyStatus: () =>
      Promise.resolve({
        hasSharedKey: false,
        hasDeviceOverride: true,
        resolvedReady: true,
        source: 'device' as const,
      }),
    peopleList: () => Promise.resolve([mara]),
    ...overrides,
  });
  render(
    <MemoryRouter>
      <SuggestedPanel onCreate={onCreate} />
    </MemoryRouter>,
  );
}

/** Pick Mara in the recipient Select (the recipient-first step, 08 §18.1). */
async function pickMara(): Promise<void> {
  const select = await screen.findByLabelText('Who do you want ideas for?');
  // The people list loads async — wait for Mara's option before choosing it.
  await screen.findByRole('option', { name: 'Mara' });
  await userEvent.selectOptions(select, 'p1');
}

describe('SuggestedPanel', () => {
  it('generates recipient-tailored suggestions and renders the saved set', async () => {
    const result: SavedSuggestionsResult = {
      ok: true,
      added: 1,
      saved: [saved('Weekly partner check-in')],
    };
    renderReady({ questionnaireSuggestionsGenerate: () => Promise.resolve(result) });
    await pickMara();
    // The button names the chosen person (tailoring is for them, 08 §18.2).
    const button = await screen.findByRole('button', { name: /suggest questionnaires for mara/i });
    await userEvent.click(button);
    expect(await screen.findByText('Weekly partner check-in')).toBeInTheDocument();
    expect(
      screen.getByText('Weekly partner check-in — how connected this week?'),
    ).toBeInTheDocument();
  });

  it('reads saved suggestions on recipient select with NO generate (no spend)', async () => {
    const generate = vi.fn(() => Promise.resolve({ ok: true, added: 0, saved: [] }));
    renderReady({
      questionnaireSuggestionsList: () => Promise.resolve([saved('Already saved')]),
      questionnaireSuggestionsGenerate: generate,
    });
    await pickMara();
    // The previously-saved card shows from the list read; "Suggest more" reflects that they exist.
    expect(await screen.findByText('Already saved')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /suggest more/i })).toBeInTheDocument();
    expect(generate).not.toHaveBeenCalled();
  });

  it('“Create from this” runs a full generation and hands back the generated questions (with options, §19.4)', async () => {
    const onCreate = vi.fn();
    renderReady(
      {
        questionnaireSuggestionsList: () => Promise.resolve([saved('Energy & rest')]),
        questionnaireSuggestionMaterialize: () =>
          Promise.resolve({
            ok: true,
            title: 'Energy & rest, deeper',
            questions: [
              {
                id: 'gq1',
                type: 'multiChoice',
                prompt: 'Which drain you?',
                required: false,
                options: ['Meetings', 'Conflict'],
              },
            ],
          }),
      },
      onCreate,
    );
    await pickMara();
    await userEvent.click(await screen.findByRole('button', { name: /create from this/i }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    const arg = onCreate.mock.calls[0]?.[0];
    const q0 = arg?.seed.questions[0];
    // The seed carries the GENERATED questions (with options) — not the optionless sample (§19.4).
    expect(q0?.type).toBe('multiChoice');
    expect(q0?.options).toEqual(['Meetings', 'Conflict']);
    expect(arg?.recipientPersonId).toBe('p1');
  });

  it('falls back to seeding the sample questions if materialize fails (never dead-ends, §19.4)', async () => {
    const onCreate = vi.fn();
    renderReady(
      {
        questionnaireSuggestionsList: () => Promise.resolve([saved('Energy & rest')]),
        questionnaireSuggestionMaterialize: () =>
          Promise.resolve({ ok: false, reason: 'BUDGET', message: 'AI budget reached.' }),
      },
      onCreate,
    );
    await pickMara();
    await userEvent.click(await screen.findByRole('button', { name: /create from this/i }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    // The fallback seeds the suggestion's own sample question (its prompt), so create still opens the builder.
    const arg = onCreate.mock.calls[0]?.[0];
    expect(arg?.seed.questions[0]?.prompt).toContain('Energy & rest');
  });

  it('deletes a saved suggestion', async () => {
    renderReady({
      questionnaireSuggestionsList: () => Promise.resolve([saved('Doomed')]),
      questionnaireSuggestionDelete: () => Promise.resolve([]),
    });
    await pickMara();
    expect(await screen.findByText('Doomed')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /delete suggestion “Doomed”/i }));
    await waitFor(() => expect(screen.queryByText('Doomed')).not.toBeInTheDocument());
  });

  it('shows an honest failure message (never a data blame) on an unusable model reply', async () => {
    renderReady({
      questionnaireSuggestionsGenerate: () =>
        Promise.resolve({
          ok: false,
          reason: 'MALFORMED',
          saved: [],
          added: 0,
          message: 'The suggestion set came back in an unexpected shape. Please try again.',
        }),
    });
    await pickMara();
    await userEvent.click(
      await screen.findByRole('button', { name: /suggest questionnaires for mara/i }),
    );
    expect(await screen.findByText(/came back in an unexpected shape/i)).toBeInTheDocument();
    expect(screen.queryByText(/add more about the people/i)).not.toBeInTheDocument();
  });

  it('shows the calm enable-AI state (no error) after a recipient is picked when AI is off', async () => {
    usePeopleStore.setState({ people: [mara], relationships: [], loaded: true });
    installMockBridge({ peopleList: () => Promise.resolve([mara]) });
    render(
      <MemoryRouter>
        <SuggestedPanel onCreate={() => {}} />
      </MemoryRouter>,
    );
    await pickMara();
    await waitFor(() =>
      expect(screen.getByText(/ask the person who set up this household/i)).toBeInTheDocument(),
    );
  });
});
