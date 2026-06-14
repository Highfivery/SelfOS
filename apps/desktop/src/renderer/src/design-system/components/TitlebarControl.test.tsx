import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TitlebarControl } from './TitlebarControl';

describe('TitlebarControl', () => {
  it('renders a labelled button that defaults to type="button" and fires onClick', async () => {
    const onClick = vi.fn();
    render(
      <TitlebarControl aria-label="Do thing" onClick={onClick}>
        <span>icon</span>
      </TitlebarControl>,
    );
    const button = screen.getByRole('button', { name: 'Do thing' });
    expect(button).toHaveAttribute('type', 'button');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('forwards a ref to the underlying button (so callers can manage focus)', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <TitlebarControl aria-label="Ref target" ref={ref}>
        x
      </TitlebarControl>,
    );
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Ref target' }));
  });

  it('passes through standard button props (aria-expanded, disabled)', () => {
    render(
      <TitlebarControl aria-label="Menu" aria-expanded={true} disabled>
        x
      </TitlebarControl>,
    );
    const button = screen.getByRole('button', { name: 'Menu' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toBeDisabled();
  });
});
