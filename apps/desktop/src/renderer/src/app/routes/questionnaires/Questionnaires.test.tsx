import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Questionnaires } from './Questionnaires';
import { useQuestionnaireStore } from '../../../stores/questionnaireStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useSettingsStore } from '../../../settings/settingsStore';
import { clearMockBridge, elevateToOwner, installMockBridge } from '../../../test-utils/bridge';

/** The screen uses `useNavigate` (the AI panel links to Settings), so render inside a router. */
const renderApp = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <Questionnaires />
    </MemoryRouter>,
  );

afterEach(() => {
  clearMockBridge();
  useQuestionnaireStore.setState({ questionnaires: [], loaded: false, customTypes: [] });
  useSettingsStore.setState({ values: {} });
  useSessionStore.setState({});
});

/** Turn AI on for the renderer (settings flag + a stubbed key) so the AI surfaces become ready. */
function enableAi(): void {
  useSettingsStore.setState({ values: { 'ai.enabled': true } });
}

/** Capture the payload the builder saves so tests can assert its shape. */
function saveSpy(): ReturnType<typeof vi.fn> {
  return vi.fn((input) =>
    Promise.resolve({
      id: input.id ?? 'q1',
      schemaVersion: 1,
      version: 1,
      title: input.title,
      type: input.type,
      sensitivity: input.sensitivity,
      questions: input.questions,
      createdAt: 'now',
      updatedAt: 'now',
    }),
  );
}

async function openNewBuilder(): Promise<void> {
  renderApp();
  await userEvent.click(screen.getByRole('button', { name: 'New' }));
}

describe('Questionnaires', () => {
  it('shows the empty state when there are none', async () => {
    installMockBridge({ questionnairesList: () => Promise.resolve([]) });
    renderApp();
    expect(await screen.findByText(/no questionnaires yet/i)).toBeInTheDocument();
  });

  it('opens the builder and saves a new questionnaire', async () => {
    const save = saveSpy();
    installMockBridge({ questionnairesList: () => Promise.resolve([]), questionnairesSave: save });
    await openNewBuilder();

    await userEvent.type(screen.getByLabelText('Title'), 'Weekly check-in');
    await userEvent.type(screen.getByLabelText('Question 1'), 'How are we doing?');
    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Weekly check-in',
        sensitivity: 'standard',
        questions: [expect.objectContaining({ prompt: 'How are we doing?', type: 'shortText' })],
      }),
    );
  });

  it('authors a compatibility questionnaire (visibility picker + canonicalId stamping)', async () => {
    const save = saveSpy();
    installMockBridge({ questionnairesList: () => Promise.resolve([]), questionnairesSave: save });
    await openNewBuilder();

    await userEvent.type(screen.getByLabelText('Title'), 'Compatibility check');
    await userEvent.type(screen.getByLabelText('Question 1'), 'How connected do you feel?');

    // The visibility picker is hidden until Compatibility is turned on.
    expect(screen.queryByLabelText('Who sees what')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('switch', { name: 'Compatibility questionnaire' }));
    const visibility = await screen.findByLabelText('Who sees what');
    // Without `questionnaires.readRaw`, the senderSeesAll option is not selectable (§15.3 reworded copy).
    const senderSeesAll = screen.getByRole('option', {
      name: /You see their answers/,
    }) as HTMLOptionElement;
    expect(senderSeesAll.disabled).toBe(true);
    await userEvent.selectOptions(visibility, 'eachSeesOwn');

    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        compatibility: { enabled: true, visibility: 'eachSeesOwn' },
        questions: [expect.objectContaining({ canonicalId: expect.any(String) })],
      }),
    );
  });

  it('surfaces validation problems via Check', async () => {
    installMockBridge({
      questionnairesList: () => Promise.resolve([]),
      questionnairesValidate: () => Promise.resolve(['"Pick one" needs at least two options.']),
    });
    await openNewBuilder();

    await userEvent.type(screen.getByLabelText('Title'), 'Q');
    await userEvent.type(screen.getByLabelText('Question 1'), 'Pick one');
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));

    expect(await screen.findByText(/needs at least two options/i)).toBeInTheDocument();
  });

  it('adds a custom type and saves the questionnaire under it', async () => {
    const save = saveSpy();
    const addType = vi.fn((name: string) => Promise.resolve([name]));
    installMockBridge({
      questionnairesList: () => Promise.resolve([]),
      questionnairesSave: save,
      questionnairesAddType: addType,
    });
    await openNewBuilder();

    await userEvent.type(screen.getByLabelText('Title'), 'Recovery check-in');
    await userEvent.type(screen.getByLabelText('Question 1'), 'How was this week?');
    await userEvent.click(screen.getByRole('button', { name: 'New type' }));
    await userEvent.type(screen.getByLabelText('New type name'), 'Affair recovery');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(addType).toHaveBeenCalledWith('Affair recovery');
    // The new type is selected and now appears in the picker.
    expect(screen.getByLabelText('Type')).toHaveValue('Affair recovery');

    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ type: 'Affair recovery' }));
  });

  it('shows an author note for sensitive tiers', async () => {
    installMockBridge({ questionnairesList: () => Promise.resolve([]) });
    await openNewBuilder();

    expect(screen.queryByText(/date of birth and consent/i)).not.toBeInTheDocument();
    // The Sensitivity picker only appears once the type can carry it (§15.2) — switch to Intimacy.
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'intimacy');
    await userEvent.selectOptions(screen.getByLabelText('Sensitivity'), 'explicit');
    expect(screen.getByText(/date of birth and consent/i)).toBeInTheDocument();
  });

  it('authors a matrix question with rows and a scale', async () => {
    const save = saveSpy();
    installMockBridge({ questionnairesList: () => Promise.resolve([]), questionnairesSave: save });
    await openNewBuilder();

    await userEvent.type(screen.getByLabelText('Title'), 'Habits');
    await userEvent.type(screen.getByLabelText('Question 1'), 'Rate each habit');
    await userEvent.selectOptions(screen.getByLabelText('Answer type'), 'matrix');
    await userEvent.type(screen.getByLabelText('Row 1'), 'Mornings');
    await userEvent.type(screen.getByLabelText('Row 2'), 'Evenings');
    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        questions: [
          expect.objectContaining({
            type: 'matrix',
            matrix: expect.objectContaining({ rows: ['Mornings', 'Evenings'], min: 1, max: 5 }),
          }),
        ],
      }),
    );
  });

  it('branches a later question on an earlier single-choice answer', async () => {
    const save = saveSpy();
    installMockBridge({ questionnairesList: () => Promise.resolve([]), questionnairesSave: save });
    await openNewBuilder();

    await userEvent.type(screen.getByLabelText('Title'), 'Branching');
    // Q1: single choice with options (a valid branch trigger).
    await userEvent.type(screen.getByLabelText('Question 1'), 'Are you partnered?');
    await userEvent.selectOptions(screen.getByLabelText('Answer type'), 'singleChoice');
    await userEvent.type(screen.getByLabelText('Option 1'), 'Yes');
    await userEvent.type(screen.getByLabelText('Option 2'), 'No');

    // Q2 branches on Q1.
    await userEvent.click(screen.getByRole('button', { name: 'Add question' }));
    await userEvent.type(screen.getByLabelText('Question 2'), 'Tell us about them');
    const trigger = screen.getByLabelText('Only show this question');
    await userEvent.selectOptions(
      trigger,
      screen.getByRole('option', { name: /When question 1 answered/ }),
    );
    // The value picker now offers Q1's options; it defaults to the first ("Yes").
    expect(screen.getByLabelText('…equals')).toHaveValue('Yes');

    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    const firstCall = save.mock.calls.at(0);
    if (!firstCall) throw new Error('save was not called');
    const payload = firstCall[0];
    expect(payload.questions[1].branch).toEqual(
      expect.objectContaining({ equals: 'Yes', action: 'show' }),
    );
    expect(payload.questions[1].branch.whenQuestionId).toBe(payload.questions[0].id);
  });

  it('generates questions with AI and appends them as editable AI drafts', async () => {
    enableAi();
    installMockBridge({
      questionnairesList: () => Promise.resolve([]),
      secretHas: () => Promise.resolve(true),
      questionnairesGenerate: () =>
        Promise.resolve({
          ok: true,
          title: 'A gentle weekly check-in',
          questions: [
            {
              id: 'g1',
              type: 'shortText',
              prompt: 'What felt hardest this week?',
              required: false,
            },
          ],
        }),
    });
    await openNewBuilder();

    await userEvent.click(await screen.findByRole('button', { name: /draft with ai/i }));
    await userEvent.click(screen.getByRole('button', { name: /generate questions/i }));

    expect(await screen.findByDisplayValue('What felt hardest this week?')).toBeInTheDocument();
    expect(screen.getByText(/ai draft/i)).toBeInTheDocument();
    // §16.4: the AI title fills the empty Title field.
    expect(screen.getByLabelText('Title')).toHaveValue('A gentle weekly check-in');
    // The untouched starter blank is dropped, so the generated question becomes Question 1 (no leading
    // empty question), and there's no second, blank question input.
    expect(screen.getByLabelText('Question 1')).toHaveValue('What felt hardest this week?');
    expect(screen.queryByLabelText('Question 2')).not.toBeInTheDocument();
  });

  it('shows live drafting progress (a status region + elapsed timer) while generating', async () => {
    enableAi();
    let resolveGen: (v: { ok: true; questions: never[] }) => void = () => {};
    installMockBridge({
      questionnairesList: () => Promise.resolve([]),
      secretHas: () => Promise.resolve(true),
      questionnairesGenerate: () =>
        new Promise((res) => {
          resolveGen = res as typeof resolveGen;
        }),
    });
    await openNewBuilder();
    await userEvent.click(await screen.findByRole('button', { name: /draft with ai/i }));
    await userEvent.click(screen.getByRole('button', { name: /generate questions/i }));

    // While the (still-pending) call runs, the button is replaced by a live status region — clearly working.
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/Drafting your questions/i);
    expect(status).toHaveTextContent(/usually 10–30 seconds/i);
    expect(screen.queryByRole('button', { name: /generate questions/i })).not.toBeInTheDocument();

    resolveGen({ ok: true, questions: [] });
  });

  it('keeps the author’s title when AI also returns one (§16.4: never clobbers)', async () => {
    enableAi();
    installMockBridge({
      questionnairesList: () => Promise.resolve([]),
      secretHas: () => Promise.resolve(true),
      questionnairesGenerate: () =>
        Promise.resolve({
          ok: true,
          title: 'AI title',
          questions: [
            { id: 'g1', type: 'shortText', prompt: 'A drafted question?', required: false },
          ],
        }),
    });
    await openNewBuilder();

    await userEvent.type(screen.getByLabelText('Title'), 'My own title');
    await userEvent.click(await screen.findByRole('button', { name: /draft with ai/i }));
    await userEvent.click(screen.getByRole('button', { name: /generate questions/i }));
    await screen.findByDisplayValue('A drafted question?');
    expect(screen.getByLabelText('Title')).toHaveValue('My own title'); // unchanged
  });

  it('§16.3: Save keeps you on the saved questionnaire and only then offers Send', async () => {
    const save = saveSpy();
    installMockBridge({ questionnairesList: () => Promise.resolve([]), questionnairesSave: save });
    await openNewBuilder();

    // A brand-new draft offers "Create draft", NOT Send.
    expect(screen.getByRole('button', { name: 'Create draft' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Title'), 'Weekly check-in');
    await userEvent.type(screen.getByLabelText('Question 1'), 'How are we doing?');
    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));

    // It stays on the saved questionnaire (no close), now headed "Edit questionnaire", and Send appears.
    expect(await screen.findByText(/Saved\. You can send it now/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Edit questionnaire' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('rewords a question via the per-question AI assist (gated on AI being ready)', async () => {
    enableAi();
    installMockBridge({
      questionnairesList: () => Promise.resolve([]),
      secretHas: () => Promise.resolve(true),
      questionnairesImproveQuestion: () =>
        Promise.resolve({ ok: true, prompt: 'How are we really doing lately?' }),
    });
    await openNewBuilder();

    await userEvent.type(screen.getByLabelText('Question 1'), 'how r we');
    // The reword assist only appears once AI is ready.
    await userEvent.click(await screen.findByRole('button', { name: 'Warmer' }));
    expect(await screen.findByDisplayValue('How are we really doing lately?')).toBeInTheDocument();
  });

  it('suggests questionnaires and creates one from a suggestion', async () => {
    enableAi();
    installMockBridge({
      questionnairesList: () => Promise.resolve([]),
      secretHas: () => Promise.resolve(true),
      gapfinderSuggest: () =>
        Promise.resolve({
          ok: true,
          suggestions: [
            {
              title: 'Partner check-in',
              type: 'role-feedback',
              rationale: 'You value quality time.',
              questions: [
                { type: 'rating', prompt: 'How was this week together?', required: true },
              ],
            },
          ],
        }),
    });
    renderApp();

    await userEvent.click(screen.getByRole('button', { name: 'Suggested' }));
    expect(screen.getByRole('heading', { name: /suggested for you/i })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: /suggest questionnaires/i }));
    expect(await screen.findByText('Partner check-in')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /create from this/i }));
    expect(screen.getByLabelText('Title')).toHaveValue('Partner check-in');
    expect(screen.getByDisplayValue('How was this week together?')).toBeInTheDocument();
  });

  it('previews the in-progress draft as the recipient would see it', async () => {
    installMockBridge({ questionnairesList: () => Promise.resolve([]) });
    await openNewBuilder();

    await userEvent.type(screen.getByLabelText('Question 1'), 'How was your week?');
    // Switch to Preview — the authored question renders in the answering form, with the crisis footer.
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByText(/exactly what your recipient sees/i)).toBeInTheDocument();
    expect(screen.getByLabelText('How was your week?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /get help now/i })).toBeInTheDocument();
  });

  it('attaches an image to a question and requires alt text', async () => {
    const store = vi.fn((input: { base64: string; mime: string }) =>
      Promise.resolve({ imagePath: 'questionnaires/media/x.enc', mime: input.mime }),
    );
    installMockBridge({
      questionnairesList: () => Promise.resolve([]),
      questionnairesStoreImage: store,
    });
    await openNewBuilder();
    await userEvent.type(screen.getByLabelText('Question 1'), 'What do you see?');

    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'pic.png', {
      type: 'image/png',
    });
    await userEvent.upload(screen.getByLabelText('Add image'), file);

    // Once attached, an alt-text field + a remove control appear.
    expect(store).toHaveBeenCalledWith(expect.objectContaining({ mime: 'image/png' }));
    const alt = await screen.findByLabelText('Image description (alt text)');
    expect(screen.getByRole('button', { name: /remove image/i })).toBeInTheDocument();

    // Check flags the missing alt text (accessibility).
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText(/needs a description \(alt text\)/i)).toBeInTheDocument();

    // Provide alt → the warning clears on the next Check.
    await userEvent.type(alt, 'A sunset over the bay');
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(screen.queryByText(/needs a description \(alt text\)/i)).not.toBeInTheDocument();
  });

  it('drops a branch when its trigger loses the chosen option', async () => {
    const save = saveSpy();
    installMockBridge({ questionnairesList: () => Promise.resolve([]), questionnairesSave: save });
    await openNewBuilder();

    await userEvent.type(screen.getByLabelText('Title'), 'Stale branch');
    await userEvent.type(screen.getByLabelText('Question 1'), 'Partnered?');
    await userEvent.selectOptions(screen.getByLabelText('Answer type'), 'singleChoice');
    await userEvent.type(screen.getByLabelText('Option 1'), 'Yes');
    await userEvent.type(screen.getByLabelText('Option 2'), 'No');

    await userEvent.click(screen.getByRole('button', { name: 'Add question' }));
    await userEvent.type(screen.getByLabelText('Question 2'), 'Details');
    await userEvent.selectOptions(
      screen.getByLabelText('Only show this question'),
      screen.getByRole('option', { name: /When question 1 answered/ }),
    );

    // Now clear the trigger's options — the branch can no longer reference a real value, so the
    // builder hides it and it must not be saved (it would never match an answer otherwise).
    await userEvent.clear(screen.getByLabelText('Option 1'));
    await userEvent.clear(screen.getByLabelText('Option 2'));
    expect(screen.queryByLabelText('Only show this question')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    const firstCall = save.mock.calls.at(0);
    if (!firstCall) throw new Error('save was not called');
    expect(firstCall[0].questions[1].branch).toBeUndefined();
  });

  it('sends to a household person from the builder, defaulting to Private', async () => {
    const save = saveSpy();
    const assignmentsCreate = vi.fn((input: { recipientPersonId: string }) =>
      Promise.resolve({
        id: 'a1',
        schemaVersion: 1,
        questionnaireId: 'q1',
        senderPersonId: 'owner-1',
        recipient: { kind: 'person' as const, personId: input.recipientPersonId },
        channel: 'inApp' as const,
        privacy: 'private' as const,
        senderVisibleToRecipient: true,
        status: 'sent' as const,
        createdAt: 'now',
        updatedAt: 'now',
      }),
    );
    const person = (id: string, displayName: string) => ({
      id,
      schemaVersion: 1,
      displayName,
      isSubject: true,
      tags: [],
      createdAt: 'now',
      updatedAt: 'now',
    });
    installMockBridge({
      questionnairesList: () => Promise.resolve([]),
      questionnairesSave: save,
      peopleList: () => Promise.resolve([person('p-mara', 'Mara'), person('p-ben', 'Ben')]),
      assignmentsCreate,
    });
    await openNewBuilder();

    await userEvent.type(screen.getByLabelText('Title'), 'Weekly check-in');
    await userEvent.type(screen.getByLabelText('Question 1'), 'How are we doing?');

    // §16.3 two-step: Save the draft first (Send only appears on a saved questionnaire), then Send.
    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    // Open the send panel (validates + saves any edits first), pick a recipient, and send.
    await userEvent.click(await screen.findByRole('button', { name: 'Send' }));
    await userEvent.selectOptions(await screen.findByLabelText('Send to'), 'p-mara');
    // Private is the default privacy mode (break-glass).
    expect(screen.getByRole('button', { name: 'Private' })).toHaveAttribute('aria-pressed', 'true');

    const sendButtons = screen.getAllByRole('button', { name: 'Send' });
    await userEvent.click(sendButtons[sendButtons.length - 1] as HTMLElement);

    expect(assignmentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        questionnaireId: 'q1',
        recipientPersonId: 'p-mara',
        privacy: 'private',
      }),
    );
    expect(await screen.findByText(/sent to mara/i)).toBeInTheDocument();
  });

  it('offers a Results tab on a saved questionnaire (gated by viewResults)', async () => {
    elevateToOwner();
    installMockBridge({
      questionnairesList: () =>
        Promise.resolve([
          {
            id: 'q1',
            schemaVersion: 1,
            version: 1,
            title: 'Weekly check-in',
            type: 'role-feedback',
            sensitivity: 'standard',
            questions: [{ id: 'qq1', type: 'shortText', prompt: 'How?', required: true }],
            createdAt: 'now',
            updatedAt: 'now',
          },
        ]),
      assignmentsResults: () => Promise.resolve([]),
    });
    renderApp();

    await userEvent.click(await screen.findByRole('button', { name: /Weekly check-in/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Results' }));
    expect(await screen.findByText(/haven’t sent this questionnaire yet/i)).toBeInTheDocument();
  });

  it('confirms before deleting a saved questionnaire', async () => {
    const questionnairesDelete = vi.fn(() => Promise.resolve());
    installMockBridge({
      questionnairesList: () =>
        Promise.resolve([
          {
            id: 'q1',
            schemaVersion: 1,
            version: 1,
            title: 'Weekly check-in',
            type: 'role-feedback',
            sensitivity: 'standard',
            questions: [{ id: 'qq1', type: 'shortText', prompt: 'How?', required: true }],
            createdAt: 'now',
            updatedAt: 'now',
          },
        ]),
      questionnairesDelete,
    });
    renderApp();

    await userEvent.click(await screen.findByRole('button', { name: /Weekly check-in/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete questionnaire' }));
    // The destructive action is gated behind an inline confirm — nothing deleted yet.
    expect(questionnairesDelete).not.toHaveBeenCalled();
    expect(screen.getByText(/can’t be undone/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(questionnairesDelete).toHaveBeenCalledWith('q1');
  });

  // --- 2026-06 authoring-UX amendment (§15) ---

  it('defaults a new questionnaire to General with no Sensitivity picker (§15.1/§15.2)', async () => {
    installMockBridge({ questionnairesList: () => Promise.resolve([]) });
    await openNewBuilder();

    expect(screen.getByLabelText('Type')).toHaveValue('general');
    // General can't carry sensitivity — the picker is hidden.
    expect(screen.queryByLabelText('Sensitivity')).not.toBeInTheDocument();
  });

  it('shows intimacy tiers only (no Standard) and seeds intimacyGeneral (§15.2)', async () => {
    const save = saveSpy();
    installMockBridge({ questionnairesList: () => Promise.resolve([]), questionnairesSave: save });
    await openNewBuilder();

    await userEvent.type(screen.getByLabelText('Title'), 'Closeness');
    await userEvent.type(screen.getByLabelText('Question 1'), 'How connected do you feel?');
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'intimacy');

    const sensitivity = screen.getByLabelText('Sensitivity');
    // No Standard option for an intimacy questionnaire; it seeds to Intimacy — General.
    expect(screen.queryByRole('option', { name: 'Standard' })).not.toBeInTheDocument();
    expect(sensitivity).toHaveValue('intimacyGeneral');

    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ sensitivity: 'intimacyGeneral' }));
  });

  it('lets Scenario stay Standard but escalate to a tier (§15.2)', async () => {
    const save = saveSpy();
    installMockBridge({ questionnairesList: () => Promise.resolve([]), questionnairesSave: save });
    await openNewBuilder();

    await userEvent.type(screen.getByLabelText('Title'), 'A tricky moment');
    await userEvent.type(screen.getByLabelText('Question 1'), 'What happened?');
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'scenario');

    const sensitivity = screen.getByLabelText('Sensitivity');
    // Scenario keeps Standard as the default but offers the intimacy tiers to escalate.
    expect(sensitivity).toHaveValue('standard');
    expect(screen.getByRole('option', { name: 'Standard' })).toBeInTheDocument();
    await userEvent.selectOptions(sensitivity, 'explicit');

    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ sensitivity: 'explicit' }));
  });

  it('forces sensitivity back to standard when leaving a sensitive type (§15.2/§15.6)', async () => {
    const save = saveSpy();
    installMockBridge({ questionnairesList: () => Promise.resolve([]), questionnairesSave: save });
    await openNewBuilder();

    await userEvent.type(screen.getByLabelText('Title'), 'Switcheroo');
    await userEvent.type(screen.getByLabelText('Question 1'), 'How are things?');
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'intimacy');
    await userEvent.selectOptions(screen.getByLabelText('Sensitivity'), 'explicit');
    // Switch to a type that can't carry sensitivity — the picker disappears and the value resets.
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'role-feedback');
    expect(screen.queryByLabelText('Sensitivity')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ sensitivity: 'standard' }));
  });

  it('uses plain visibility copy + the raw-answers note for senderSeesAll (§15.3)', async () => {
    // The Owner has readRaw, so senderSeesAll is selectable.
    elevateToOwner();
    installMockBridge({ questionnairesList: () => Promise.resolve([]) });
    await openNewBuilder();

    await userEvent.click(screen.getByRole('switch', { name: 'Compatibility questionnaire' }));
    const visibility = await screen.findByLabelText('Who sees what');
    // Reworded labels (no "break-glass"/"audited"; "each sees their own" → explicit added thing).
    expect(screen.getByRole('option', { name: 'Shared report only' })).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'Shared report + your own answers' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/break-glass|audited/i)).not.toBeInTheDocument();

    await userEvent.selectOptions(visibility, 'senderSeesAll');
    expect(screen.getByText(/read their raw answers/i)).toBeInTheDocument();
  });

  it('drops the "Use my information" toggle; generation still uses author context (§15.4)', async () => {
    enableAi();
    const generate = vi.fn<
      (input: Record<string, unknown>) => Promise<{ ok: boolean; questions: never[] }>
    >(() => Promise.resolve({ ok: true, questions: [] }));
    installMockBridge({
      questionnairesList: () => Promise.resolve([]),
      secretHas: () => Promise.resolve(true),
      questionnairesGenerate: generate,
    });
    await openNewBuilder();

    await userEvent.click(await screen.findByRole('button', { name: /draft with ai/i }));
    expect(screen.queryByLabelText('Use my information')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /generate questions/i }));

    expect(generate).toHaveBeenCalledTimes(1);
    // The author flag is gone from the payload (the bridge always includes author context now).
    expect(generate.mock.calls[0]?.[0]).not.toHaveProperty('includeAuthor');
  });

  it('shows a live inline per-question preview that updates with the answer type (§15.5)', async () => {
    installMockBridge({ questionnairesList: () => Promise.resolve([]) });
    await openNewBuilder();

    await userEvent.type(screen.getByLabelText('Question 1'), 'Are you happy?');
    // The first question's preview is expanded by default — its control mirrors the answer type.
    expect(screen.getByLabelText('Are you happy?')).toBeInTheDocument(); // shortText input
    await userEvent.selectOptions(screen.getByLabelText('Answer type'), 'yesNo');
    // The preview now renders Yes/No pills (only the preview has these — the editor doesn't).
    expect(screen.getByRole('radio', { name: 'Yes' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'No' })).toBeInTheDocument();

    // It's collapsible — hiding it removes the preview control.
    await userEvent.click(screen.getByRole('button', { name: 'Hide preview' }));
    expect(screen.queryByRole('radio', { name: 'Yes' })).not.toBeInTheDocument();
  });
});
