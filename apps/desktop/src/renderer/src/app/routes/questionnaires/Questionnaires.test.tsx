import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Questionnaires } from './Questionnaires';
import { useQuestionnaireStore } from '../../../stores/questionnaireStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

afterEach(() => {
  clearMockBridge();
  useQuestionnaireStore.setState({ questionnaires: [], loaded: false });
});

describe('Questionnaires', () => {
  it('shows the empty state when there are none', async () => {
    installMockBridge({ questionnairesList: () => Promise.resolve([]) });
    render(<Questionnaires />);
    expect(await screen.findByText(/no questionnaires yet/i)).toBeInTheDocument();
  });

  it('opens the builder and saves a new questionnaire', async () => {
    const save = vi.fn((input) =>
      Promise.resolve({
        id: 'q1',
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
    installMockBridge({ questionnairesList: () => Promise.resolve([]), questionnairesSave: save });
    render(<Questionnaires />);

    await userEvent.click(screen.getByRole('button', { name: 'New' }));
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
    render(<Questionnaires />);

    await userEvent.click(screen.getByRole('button', { name: 'New' }));
    await userEvent.type(screen.getByLabelText('Title'), 'Q');
    await userEvent.type(screen.getByLabelText('Question 1'), 'Pick one');
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));

    expect(await screen.findByText(/needs at least two options/i)).toBeInTheDocument();
  });
});
