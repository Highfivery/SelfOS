import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { z } from 'zod';
import { SettingField } from './SettingField';
import { defineSetting } from './types';
import { useSettingsStore } from './settingsStore';

function CustomBody(): JSX.Element {
  return <p>custom-content-here</p>;
}

afterEach(() => useSettingsStore.setState({ values: {} }));

describe('SettingField', () => {
  it('renders a custom row stacked: label + content, no reset', () => {
    useSettingsStore.setState({ values: { 'x.info': null } });
    const def = defineSetting({
      key: 'x.info',
      section: 's',
      label: 'My Info',
      schema: z.null(),
      default: null,
      control: { type: 'custom', render: CustomBody },
    });
    render(<SettingField def={def} />);
    expect(screen.getByText('My Info')).toBeInTheDocument();
    expect(screen.getByText('custom-content-here')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reset/i })).not.toBeInTheDocument();
  });

  it('renders a value control with a reset affordance when changed from default', () => {
    useSettingsStore.setState({ values: { 'x.flag': true } });
    const def = defineSetting({
      key: 'x.flag',
      section: 's',
      label: 'Flag',
      schema: z.boolean(),
      default: false,
      control: { type: 'switch' },
    });
    render(<SettingField def={def} />);
    expect(screen.getByRole('switch', { name: 'Flag' })).toBeChecked();
    expect(screen.getByRole('button', { name: /reset flag/i })).toBeInTheDocument();
  });

  it('hides the reset affordance when the value equals the default', () => {
    useSettingsStore.setState({ values: { 'x.flag': false } });
    const def = defineSetting({
      key: 'x.flag',
      section: 's',
      label: 'Flag',
      schema: z.boolean(),
      default: false,
      control: { type: 'switch' },
    });
    render(<SettingField def={def} />);
    expect(screen.queryByRole('button', { name: /reset flag/i })).not.toBeInTheDocument();
  });
});
