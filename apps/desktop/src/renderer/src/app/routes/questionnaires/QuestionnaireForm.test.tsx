import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Question } from '@shared/schemas';
import type { AnswerMap, AnswerValue } from '@selfos/core/questionnaires';
import { QuestionnaireForm } from '@selfos/answering';
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

  it('renders a 3-point LABELLED matrix (Hard limit · Curious · Into it) and stores the numeric pick (27)', async () => {
    render(
      <Harness
        questions={[
          q({
            id: 'a',
            type: 'matrix',
            prompt: 'Where do you stand?',
            matrix: {
              rows: ['Oral', 'Choking'],
              min: 1,
              max: 3,
              minLabel: 'Hard limit',
              midLabel: 'Curious',
              maxLabel: 'Into it',
            },
          }),
        ]}
      />,
    );
    // Each row offers the three LABELLED options, not bare numbers — one "Into it" radio per row.
    expect(screen.getAllByRole('radio', { name: 'Into it' })).toHaveLength(2);
    expect(screen.queryByRole('radio', { name: '3' })).toBeNull();
    // Picking "Into it" for the Oral row stores it (the row radiogroup is labelled "<prompt> — Oral").
    const oralGroup = screen.getByRole('radiogroup', { name: /Oral/ });
    await userEvent.click(within(oralGroup).getByRole('radio', { name: 'Into it' }));
    expect(within(oralGroup).getByRole('radio', { name: 'Into it' })).toBeChecked();
  });

  it('offers an "Other" write-in when allowOther is set, and stores the typed text (§17.12-C)', async () => {
    render(
      <Harness
        questions={[
          q({
            id: 'a',
            type: 'singleChoice',
            prompt: 'Pick',
            options: ['One', 'Two'],
            allowOther: true,
          }),
        ]}
      />,
    );
    // The "Other" radio appears (from the flag — no literal 'Other' option), revealing a free-text field.
    await userEvent.click(screen.getByRole('radio', { name: 'Other' }));
    const field = await screen.findByLabelText('Pick — other');
    await userEvent.type(field, 'My own answer');
    expect(field).toHaveValue('My own answer');
  });

  it('preserves spaces while typing a multi-choice "Other" write-in (multi-word entries)', async () => {
    render(
      <Harness
        questions={[
          q({
            id: 'a',
            type: 'multiChoice',
            prompt: 'Hobbies',
            options: ['Reading'],
            allowOther: true,
          }),
        ]}
      />,
    );
    await userEvent.click(screen.getByRole('checkbox', { name: 'Other' }));
    const field = await screen.findByLabelText('Hobbies — other');
    // Typing a space mid-entry must NOT be trimmed away on each keystroke (the regression we fixed).
    await userEvent.type(field, 'rock climbing');
    expect(field).toHaveValue('rock climbing');
  });

  it('reveals a question when a multi-choice trigger CONTAINS the branch value', async () => {
    render(
      <Harness
        questions={[
          q({
            id: 'used',
            type: 'multiChoice',
            prompt: 'Which?',
            options: ['Cannabis', 'Cocaine'],
          }),
          q({
            id: 'freq',
            type: 'singleChoice',
            prompt: 'Cannabis — how often?',
            options: ['Rarely', 'Daily'],
            branch: { whenQuestionId: 'used', equals: 'Cannabis', action: 'show' },
          }),
        ]}
      />,
    );
    expect(screen.queryByText('Cannabis — how often?')).toBeNull();
    // Multi-choice options are now checkbox-role cards (was an implicit-role button pill).
    await userEvent.click(screen.getByRole('checkbox', { name: 'Cannabis' }));
    expect(screen.getByText('Cannabis — how often?')).toBeInTheDocument();
  });

  it('captures structured label+date rows for a dateList question (add, type, remove)', async () => {
    render(<Harness questions={[q({ id: 'd', type: 'dateList', prompt: 'Important dates' })]} />);
    // No rows until you add one.
    expect(screen.queryByLabelText('Important dates — label 1')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '+ Add a date' }));
    const label = screen.getByLabelText('Important dates — label 1');
    await userEvent.type(label, 'Wedding day'); // multi-word label types fine
    expect(label).toHaveValue('Wedding day');
    expect(screen.getByLabelText('Important dates — date 1')).toBeInTheDocument();
    // Remove drops the row.
    await userEvent.click(screen.getByRole('button', { name: /Remove Wedding day/ }));
    expect(screen.queryByLabelText('Important dates — label 1')).toBeNull();
  });

  it('captures roster rows with configurable columns (add, fill text + select + date, remove)', async () => {
    render(
      <Harness
        questions={[
          q({
            id: 'kids',
            type: 'roster',
            prompt: 'Your kids',
            roster: [
              { key: 'name', label: 'Name', type: 'text', placeholder: 'e.g. Emma' },
              { key: 'gender', label: 'Gender', type: 'select', options: ['Girl', 'Boy'] },
              // A date-of-birth column renders a native date picker (a DOB, not a stale age).
              { key: 'dob', label: 'Date of birth', type: 'date' },
            ],
          }),
        ]}
      />,
    );
    expect(screen.queryByLabelText('Your kids — Name 1')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '+ Add' }));
    const name = screen.getByLabelText('Your kids — Name 1');
    await userEvent.type(name, 'Emma');
    expect(name).toHaveValue('Emma');
    await userEvent.selectOptions(screen.getByLabelText('Your kids — Gender 1'), 'Girl');
    expect(screen.getByLabelText('Your kids — Gender 1')).toHaveValue('Girl');
    const dob = screen.getByLabelText('Your kids — Date of birth 1');
    expect(dob).toHaveAttribute('type', 'date');
    await userEvent.type(dob, '2018-05-14');
    expect(dob).toHaveValue('2018-05-14');
    await userEvent.click(screen.getByRole('button', { name: 'Remove #1' }));
    expect(screen.queryByLabelText('Your kids — Name 1')).toBeNull();
  });

  it('renders a rating question as a slider over its min→max scale (#3)', async () => {
    render(
      <Harness
        questions={[q({ id: 'a', type: 'rating', prompt: 'Rate', scale: { min: 1, max: 5 } })]}
      />,
    );
    // Scale questions render as a labelled slider now — never a grid of number buttons.
    const slider = screen.getByRole('slider', { name: 'Rate' });
    expect(slider).toHaveAttribute('min', '1');
    expect(slider).toHaveAttribute('max', '5');
    expect(screen.queryByRole('radio', { name: '4' })).toBeNull();
  });

  it('does NOT auto-answer an untouched optional slider; commits only when moved (28)', () => {
    const onChange = vi.fn();
    render(
      <QuestionnaireForm
        questions={[q({ id: 'a', type: 'slider', prompt: 'Energy', scale: { min: 0, max: 10 } })]}
        answers={{}}
        onChange={onChange}
      />,
    );
    // No mount-time commit — an untouched optional slider records nothing (no false-neutral fact, §28).
    expect(onChange).not.toHaveBeenCalled();
    // Moving it commits a real numeric value.
    fireEvent.change(screen.getByRole('slider', { name: 'Energy' }), { target: { value: '7' } });
    expect(onChange).toHaveBeenCalledWith('a', 7);
  });

  it('renders an attached image (decrypted via loadImage) with its alt text', async () => {
    const questions = [
      q({
        id: 'a',
        type: 'shortText',
        prompt: 'Look at this',
        media: { imagePath: 'questionnaires/media/x.enc', alt: 'a sunset', mime: 'image/png' },
      }),
    ];
    render(
      <QuestionnaireForm
        questions={questions}
        answers={{}}
        onChange={() => {}}
        loadImage={() => Promise.resolve('QUJD')}
      />,
    );
    const img = await screen.findByRole('img', { name: 'a sunset' });
    expect(img).toHaveAttribute('src', 'data:image/png;base64,QUJD');
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
