import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QuickActionDock } from './QuickActionDock';

function renderDock(caps: string[]): void {
  render(
    <MemoryRouter>
      <QuickActionDock capabilities={new Set(caps)} />
    </MemoryRouter>,
  );
}

describe('QuickActionDock', () => {
  it('renders only the actions the person is permitted to take', () => {
    renderDock(['sessions.own', 'dreams.own']);
    expect(screen.getByRole('button', { name: /start a session/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /log a dream/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ask someone/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /check in/i })).toBeNull();
  });

  it('self-hides when the person can do none of them (no dead actions)', () => {
    const { container } = render(
      <MemoryRouter>
        <QuickActionDock capabilities={new Set()} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
