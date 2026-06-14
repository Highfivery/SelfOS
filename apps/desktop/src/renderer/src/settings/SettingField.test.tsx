import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { z } from 'zod';
import { Info } from 'lucide-react';
import { SettingField } from './SettingField';
import { defineSetting } from './types';
import { useSettingsStore } from './settingsStore';
import { __resetRegistry, registerSection, registerSettings } from './registry';

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

  it('renders a textarea control full-width and persists typed input', async () => {
    __resetRegistry();
    registerSection({ id: 's', title: 'S', description: '', icon: Info, order: 1 });
    const def = defineSetting({
      key: 'x.notes',
      section: 's',
      label: 'Notes',
      schema: z.string().max(300),
      default: '',
      control: { type: 'textarea', maxLength: 300 },
    });
    registerSettings([def]);
    useSettingsStore.setState({ values: { 'x.notes': '' } });
    render(<SettingField def={def} />);
    const box = screen.getByRole('textbox', { name: 'Notes' });
    expect(box.tagName).toBe('TEXTAREA');
    await userEvent.type(box, 'golden-hour light');
    expect(useSettingsStore.getState().values['x.notes']).toBe('golden-hour light');
    // Once non-default, the reset affordance appears.
    expect(screen.getByRole('button', { name: /reset notes/i })).toBeInTheDocument();
    __resetRegistry();
  });

  it('renders a grouped select as native optgroups', () => {
    useSettingsStore.setState({ values: { 'x.style': 'dreamlike' } });
    const def = defineSetting({
      key: 'x.style',
      section: 's',
      label: 'Style',
      schema: z.string(),
      default: 'dreamlike',
      control: {
        type: 'select',
        groups: [
          { label: 'Painted', options: [{ value: 'watercolor', label: 'Watercolor' }] },
          { label: 'Stylized', options: [{ value: 'dreamlike', label: 'Dreamlike (surreal)' }] },
        ],
      },
    });
    const { container } = render(<SettingField def={def} />);
    const groups = container.querySelectorAll('optgroup');
    expect([...groups].map((g) => g.label)).toEqual(['Painted', 'Stylized']);
    expect(screen.getByRole('option', { name: 'Watercolor' })).toBeInTheDocument();
  });

  it('renders a legacy/unknown stored value as a fallback option in a grouped select', () => {
    useSettingsStore.setState({ values: { 'x.style': 'daguerreotype' } });
    const def = defineSetting({
      key: 'x.style',
      section: 's',
      label: 'Style',
      schema: z.string(),
      default: 'dreamlike',
      control: {
        type: 'select',
        groups: [{ label: 'Stylized', options: [{ value: 'dreamlike', label: 'Dreamlike' }] }],
      },
    });
    render(<SettingField def={def} />);
    const select = screen.getByRole('combobox', { name: 'Style' }) as HTMLSelectElement;
    expect(select.value).toBe('daguerreotype');
    expect(screen.getByRole('option', { name: 'daguerreotype' })).toBeInTheDocument();
  });
});
