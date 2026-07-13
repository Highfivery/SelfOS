import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageDayDivider, MessageRow, MessageTime } from './MessageTime';

describe('MessageTime', () => {
  it('renders a <time> with a machine-readable dateTime for a valid ISO', () => {
    const iso = '2026-07-13T15:42:00';
    const { container } = render(<MessageTime iso={iso} />);
    const el = container.querySelector('time');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('datetime')).toBe(iso);
    expect(el?.textContent?.length).toBeGreaterThan(0);
  });

  it('renders nothing for an unparseable ISO', () => {
    const { container } = render(<MessageTime iso="not-a-date" />);
    expect(container.querySelector('time')).toBeNull();
  });

  it('marks the end alignment for a user message', () => {
    const { container } = render(<MessageTime iso="2026-07-13T15:42:00" align="end" />);
    expect(container.querySelector('time')?.getAttribute('data-align')).toBe('end');
  });
});

describe('MessageDayDivider', () => {
  it('renders the label as an accessible separator', () => {
    render(<MessageDayDivider label="Today" />);
    expect(screen.getByRole('separator', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
  });
});

describe('MessageRow', () => {
  it('renders the bubble and a timestamp below it', () => {
    const { container } = render(
      <MessageRow side="coach" iso="2026-07-13T15:42:00">
        <div>Hello there</div>
      </MessageRow>,
    );
    expect(screen.getByText('Hello there')).toBeInTheDocument();
    expect(container.querySelector('time')).not.toBeNull();
    expect(container.querySelector('[data-side="coach"]')).not.toBeNull();
  });

  it('omits the timestamp for an in-flight bubble (no iso)', () => {
    const { container } = render(
      <MessageRow side="coach">
        <div>Coach is thinking…</div>
      </MessageRow>,
    );
    expect(screen.getByText('Coach is thinking…')).toBeInTheDocument();
    expect(container.querySelector('time')).toBeNull();
  });

  it('aligns a user row to the end', () => {
    const { container } = render(
      <MessageRow side="user" iso="2026-07-13T15:42:00">
        <div>Mine</div>
      </MessageRow>,
    );
    expect(container.querySelector('[data-side="user"]')).not.toBeNull();
    expect(container.querySelector('time')?.getAttribute('data-align')).toBe('end');
  });
});
