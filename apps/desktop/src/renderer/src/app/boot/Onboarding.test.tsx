import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Onboarding } from './Onboarding';
import { useAppStore } from '../../stores/appStore';

afterEach(() => {
  useAppStore.setState({ phase: 'starting', vaultPath: null, busy: false });
});

describe('Onboarding', () => {
  it('welcomes the user and offers to choose a vault folder', () => {
    render(<Onboarding />);
    expect(screen.getByRole('heading', { name: /a calm space for yourself/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /choose a folder/i })).toBeEnabled();
  });

  it('disables the action while busy', () => {
    useAppStore.setState({ busy: true });
    render(<Onboarding />);
    expect(screen.getByRole('button', { name: /setting up/i })).toBeDisabled();
  });
});
