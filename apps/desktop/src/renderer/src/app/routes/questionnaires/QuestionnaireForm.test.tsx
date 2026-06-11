import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Question } from '@shared/schemas';
import type { AnswerMap, AnswerValue } from '@selfos/core/questionnaires';
import { QuestionnaireForm } from './QuestionnaireForm';
import { QuestionnairePreview } from './QuestionnairePreview';

function q(over: Partial<Question> & Pick<Question, 'id' | 'type' | 'prompt'>): Question {
  return { required: false, ...over };
}

/** A stateful host for the controlled renderer (mirrors how the builder drives it). */
function Harness({ questions }: { questions: Question[] }): JSX.Element {
  const [answers, setAnswers] = useState<AnswerMap>({});
  return (
    <QuestionnaireForm
      questions={questions}
      answers={answers}
      onChange={(id: string, value: AnswerValue) =>
        setAnswers((prev) => ({ ...prev, [id]: value }))
      }
    />
  );
}

describe('QuestionnaireForm', () => {
  it('always shows the crisis affordance and not-medical line', () => {
    render(<Harness questions={[q({ id: 'a', type: 'shortText', prompt: 'Hi?' })]} />);
    expect(screen.getByRole('button', { name: /get help now/i })).toBeInTheDocument();
    expect(screen.getByText(/not medical care/i)).toBeInTheDocument();
  });

  it('renders a text control and reflects typing', async () => {
    render(<Harness questions={[q({ id: 'a', type: 'shortText', prompt: 'Your name?' })]} />);
    const input = screen.getByLabelText('Your name?');
    await userEvent.type(input, 'Sam');
    expect(input).toHaveValue('Sam');
  });

  it('selects a single-choice option', async () => {
    render(
      <Harness
        questions={[q({ id: 'a', type: 'singleChoice', prompt: 'Pick', options: ['One', 'Two'] })]}
      />,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'One' }));
    expect(screen.getByRole('radio', { name: 'One' })).toBeChecked();
  });

  it('picks a rating point on its min→max scale', async () => {
    render(
      <Harness
        questions={[q({ id: 'a', type: 'rating', prompt: 'Rate', scale: { min: 1, max: 5 } })]}
      />,
    );
    const four = screen.getByRole('radio', { name: '4' });
    await userEvent.click(four);
    expect(four).toHaveAttribute('aria-checked', 'true');
  });

  it('reveals a branched question only once its trigger matches', async () => {
    const questions = [
      q({ id: 'q1', type: 'singleChoice', prompt: 'Partnered?', options: ['Yes', 'No'] }),
      q({
        id: 'q2',
        type: 'shortText',
        prompt: 'Tell us about them',
        branch: { whenQuestionId: 'q1', equals: 'Yes', action: 'show' },
      }),
    ];
    render(<Harness questions={questions} />);
    expect(screen.queryByText('Tell us about them')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Yes' }));
    expect(screen.getByText('Tell us about them')).toBeInTheDocument();
  });
});

describe('QuestionnairePreview (test-on-self)', () => {
  const questions = [
    q({ id: 'a', type: 'shortText', prompt: 'How are we doing?', required: true }),
  ];

  it('blocks Finish until required questions are answered', async () => {
    render(<QuestionnairePreview questions={questions} />);
    await userEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(screen.getByText(/answer the 1 required question to finish/i)).toBeInTheDocument();
  });

  it('confirms nothing was saved once required questions are answered', async () => {
    render(<QuestionnairePreview questions={questions} />);
    await userEvent.type(screen.getByLabelText('How are we doing?'), 'Great');
    await userEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(screen.getByText(/nothing you entered was saved/i)).toBeInTheDocument();
  });
});
