import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Field } from './Field';

describe('Field', () => {
  it('associates the label with the control and wires help text', () => {
    render(
      <Field label="Email" help="We never share it.">
        {(props) => <input {...props} />}
      </Field>,
    );
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAccessibleDescription('We never share it.');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('marks the control invalid and announces the error', () => {
    render(
      <Field label="Email" error="Required.">
        {(props) => <input {...props} />}
      </Field>,
    );
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Required.');
    expect(screen.getByRole('alert')).toHaveTextContent('Required.');
  });
});
