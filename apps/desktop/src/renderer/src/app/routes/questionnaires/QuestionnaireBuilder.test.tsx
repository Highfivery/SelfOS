import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Questionnaire } from '@shared/channels';
import { QuestionnaireBuilder } from './QuestionnaireBuilder';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useSettingsStore } from '../../../settings/settingsStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

/** A saved questionnaire bound to a household recipient, with one AI-drafted question to act on. */
const saved: Questionnaire = {
  id: 'q1',
  schemaVersion: 1,
  version: 1,
  title: 'Getting to know you',
  type: 'general',
  sensitivity: 'standard',
  recipient: { kind: 'person', personId: 'p-mara' },
  questions: [{ id: 'qq1', type: 'shortText', prompt: 'What matters to you?', required: false }],
  createdAt: 'now',
  updatedAt: 'now',
};

afterEach(() => {
  clearMockBridge();
  usePeopleStore.setState({ people: [], loaded: false });
  useSettingsStore.setState({ values: {} });
  useSessionStore.setState({});
});

/** AI-ready: enabled flag + a resolved key, plus the recipient in the people store for the header. */
function primeAiReady(overrides: Parameters<typeof installMockBridge>[0] = {}): void {
  useSettingsStore.setState({ values: { 'ai.enabled': true } });
  usePeopleStore.setState({
    people: [
      {
        id: 'p-mara',
        schemaVersion: 1,
        displayName: 'Mara',
        isSubject: true,
        tags: [],
        createdAt: 'now',
        updatedAt: 'now',
      },
    ],
    loaded: true,
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
    ...overrides,
  });
}

const renderBuilder = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <QuestionnaireBuilder questionnaire={saved} onDone={() => {}} />
    </MemoryRouter>,
  );

describe('QuestionnaireBuilder — repetitive/vague question actions (08 §28.2)', () => {
  it('"Too vague" sharpens the question in place', async () => {
    const sharpen = vi.fn(() =>
      Promise.resolve({ ok: true as const, prompt: 'What, specifically, keeps you up at night?' }),
    );
    primeAiReady({ questionnairesSharpenQuestion: sharpen });
    renderBuilder();

    await userEvent.click(await screen.findByRole('button', { name: /Too vague/ }));
    await vi.waitFor(() => expect(sharpen).toHaveBeenCalled());
    const [sharpenArg] = sharpen.mock.calls[0] as unknown as [{ prompt: string }];
    expect(sharpenArg).toMatchObject({ prompt: 'What matters to you?' });
    // The prompt is swapped in place.
    expect(await screen.findByDisplayValue(/keeps you up at night/)).toBeInTheDocument();
  });

  it('"Already answered" records the covered topic AND swaps in a freshly generated question', async () => {
    const markCovered = vi.fn(() => Promise.resolve({ ok: true }));
    const generate = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        questions: [
          {
            id: 'new',
            type: 'shortText' as const,
            prompt: 'What made you laugh today?',
            required: false,
          },
        ],
      }),
    );
    primeAiReady({ questionnairesMarkCovered: markCovered, questionnairesGenerate: generate });
    renderBuilder();

    await userEvent.click(await screen.findByRole('button', { name: /Already answered/ }));
    await vi.waitFor(() => expect(generate).toHaveBeenCalled());
    // The topic was recorded as covered for the bound recipient (so future gens avoid it)…
    expect(markCovered).toHaveBeenCalledWith(
      expect.objectContaining({ recipientPersonId: 'p-mara', note: 'What matters to you?' }),
    );
    // …and a fresh question replaced it in place.
    expect(await screen.findByDisplayValue('What made you laugh today?')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('What matters to you?')).toBeNull();
  });
});
