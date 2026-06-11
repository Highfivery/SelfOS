import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Questionnaires } from './Questionnaires';
import { useQuestionnaireStore } from '../../../stores/questionnaireStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

afterEach(() => {
  clearMockBridge();
  useQuestionnaireStore.setState({ questionnaires: [], loaded: false, customTypes: [] });
});

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
  render(<Questionnaires />);
  await userEvent.click(screen.getByRole('button', { name: 'New' }));
}

describe('Questionnaires', () => {
  it('shows the empty state when there are none', async () => {
    installMockBridge({ questionnairesList: () => Promise.resolve([]) });
    render(<Questionnaires />);
    expect(await screen.findByText(/no questionnaires yet/i)).toBeInTheDocument();
  });

  it('opens the builder and saves a new questionnaire', async () => {
    const save = saveSpy();
    installMockBridge({ questionnairesList: () => Promise.resolve([]), questionnairesSave: save });
    await openNewBuilder();

    await userEvent.type(screen.getByLabelText('Title'), 'Weekly check-in');
    await userEvent.type(screen.getByLabelText('Question 1'), 'How are we doing?');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Weekly check-in',
        sensitivity: 'standard',
        questions: [expect.objectContaining({ prompt: 'How are we doing?', type: 'shortText' })],
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

    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ type: 'Affair recovery' }));
  });

  it('shows an author note for sensitive tiers', async () => {
    installMockBridge({ questionnairesList: () => Promise.resolve([]) });
    await openNewBuilder();

    expect(screen.queryByText(/date of birth and consent/i)).not.toBeInTheDocument();
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
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

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

    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    const firstCall = save.mock.calls.at(0);
    if (!firstCall) throw new Error('save was not called');
    const payload = firstCall[0];
    expect(payload.questions[1].branch).toEqual(
      expect.objectContaining({ equals: 'Yes', action: 'show' }),
    );
    expect(payload.questions[1].branch.whenQuestionId).toBe(payload.questions[0].id);
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

    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    const firstCall = save.mock.calls.at(0);
    if (!firstCall) throw new Error('save was not called');
    expect(firstCall[0].questions[1].branch).toBeUndefined();
  });
});
