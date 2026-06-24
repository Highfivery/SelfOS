import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScopeBadge } from './ScopeBadge';

describe('ScopeBadge', () => {
  it('renders the synced (vault) signal with a screen-reader-friendly name', () => {
    render(<ScopeBadge scope="vault" />);
    expect(screen.getByText('Synced')).toBeInTheDocument();
    expect(screen.getByLabelText('Synced across devices')).toBeInTheDocument();
  });

  it('renders the device-only signal with a screen-reader-friendly name', () => {
    render(<ScopeBadge scope="device" />);
    expect(screen.getByText('This device')).toBeInTheDocument();
    expect(screen.getByLabelText('This device only')).toBeInTheDocument();
  });
});
