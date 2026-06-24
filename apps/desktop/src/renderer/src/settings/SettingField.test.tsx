import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { z } from 'zod';
import { Info } from 'lucide-react';
import { SettingField } from './SettingField';
import { defineSetting } from './types';
import { useSettingsStore } from './settingsStore';
import { __resetRegistry, getDefinition, registerSection, registerSettings } from './registry';
import { __resetBuiltins, registerBuiltinSettings } from './builtins';

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

  it('shows "This device" for a device-scoped setting and "Synced" for a vault-scoped one', () => {
    useSettingsStore.setState({ values: { 'x.device': false, 'x.vault': false } });
    const deviceDef = defineSetting({
      key: 'x.device',
      section: 's',
      label: 'Sidebar collapsed',
      schema: z.boolean(),
      default: false,
      control: { type: 'switch' },
      scope: 'device',
    });
    const { rerender } = render(<SettingField def={deviceDef} />);
    // Meaning is carried in text, and the SR-exposed accessible name is the fuller phrase.
    expect(screen.getByText('This device')).toBeInTheDocument();
    expect(screen.getByLabelText('This device only')).toBeInTheDocument();

    const vaultDef = defineSetting({
      key: 'x.vault',
      section: 's',
      label: 'AI enabled',
      schema: z.boolean(),
      default: false,
      control: { type: 'switch' }, // scope omitted → defaults to 'vault' (synced)
    });
    rerender(<SettingField def={vaultDef} />);
    expect(screen.getByText('Synced')).toBeInTheDocument();
    expect(screen.getByLabelText('Synced across devices')).toBeInTheDocument();
  });

  it('shows both the Admin-only and scope markers, with distinct accessible names', () => {
    useSettingsStore.setState({ values: { 'x.adminVault': false } });
    const def = defineSetting({
      key: 'x.adminVault',
      section: 's',
      label: 'Default questionnaire visibility',
      schema: z.boolean(),
      default: false,
      control: { type: 'switch' },
      adminOnly: true, // a vault setting that's also admin-only → both markers, no collision
    });
    render(<SettingField def={def} />);
    expect(screen.getByText('Admin only')).toBeInTheDocument();
    expect(screen.getByText('Synced')).toBeInTheDocument();
    // Distinct SR names so the two never read as one.
    expect(screen.getByLabelText('Synced across devices')).toBeInTheDocument();
    expect(screen.queryByLabelText('Admin only')).not.toBeInTheDocument(); // AdminOnlyBadge carries visible text, no aria-label
  });

  it('marks the API-key settings as device-local secrets (never "Synced")', () => {
    // Regression: API keys are device-local secrets (00 §6.2), not synced. They MUST read "This device only" —
    // a "Synced" badge next to a secret misleads the user about where their key lives (41 §3.4).
    __resetRegistry();
    __resetBuiltins();
    registerBuiltinSettings();
    for (const key of ['ai.apiKey', 'ai.test', 'dreams.imageApiKey', 'dreams.imageTest']) {
      const def = getDefinition(key);
      expect(def, key).toBeDefined();
      expect(def?.scope, key).toBe('device');
    }
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
