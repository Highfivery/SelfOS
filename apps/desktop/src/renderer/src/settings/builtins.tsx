import { z } from 'zod';
import { Database, Info, Palette, Sparkles } from 'lucide-react';
import { registerSection, registerSettings } from './registry';
import { defineSetting } from './types';
import { AboutDisclaimer, AboutVersion, RevealVaultRow, VaultLocationValue } from './customRows';
import { ApiKeyControl, TestConnectionControl } from './aiControls';

declare module './types' {
  interface SettingsTypeMap {
    'appearance.theme': 'system' | 'light' | 'dark';
    'appearance.density': 'comfortable' | 'compact';
    'appearance.textScale': number;
    'appearance.reduceMotion': boolean;
    'ai.enabled': boolean;
    'ai.model': 'claude-sonnet-4-6' | 'claude-opus-4-8';
  }
}

const aiEnabled = (values: Readonly<Record<string, unknown>>): boolean =>
  values['ai.enabled'] === true;

let registered = false;

/** Register the built-in sections and settings (idempotent). */
export function registerBuiltinSettings(): void {
  if (registered) return;
  registered = true;

  registerSection({
    id: 'appearance',
    title: 'Appearance',
    description: 'How SelfOS looks and feels.',
    icon: Palette,
    order: 1,
  });
  registerSection({
    id: 'ai',
    title: 'AI',
    description: 'Connect Claude to power conversations.',
    icon: Sparkles,
    order: 2,
  });
  registerSection({
    id: 'vault',
    title: 'Vault',
    description: 'Where your data is stored.',
    icon: Database,
    order: 3,
  });
  registerSection({ id: 'about', title: 'About', icon: Info, order: 4 });

  registerSettings([
    defineSetting({
      key: 'appearance.theme',
      section: 'appearance',
      label: 'Theme',
      description: 'Follow the system, or choose light or dark.',
      schema: z.enum(['system', 'light', 'dark']),
      default: 'system',
      control: {
        type: 'segmented',
        options: [
          { value: 'system', label: 'System' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ],
      },
      order: 1,
      tags: ['dark', 'light', 'appearance'],
    }),
    defineSetting({
      key: 'appearance.density',
      section: 'appearance',
      label: 'Density',
      description: 'Comfortable spacing, or a more compact layout.',
      schema: z.enum(['comfortable', 'compact']),
      default: 'comfortable',
      control: {
        type: 'segmented',
        options: [
          { value: 'comfortable', label: 'Comfortable' },
          { value: 'compact', label: 'Compact' },
        ],
      },
      order: 2,
    }),
    defineSetting({
      key: 'appearance.textScale',
      section: 'appearance',
      label: 'Text size',
      description: 'Scale all text up or down.',
      schema: z.number().min(0.9).max(1.3),
      default: 1,
      control: {
        type: 'slider',
        min: 0.9,
        max: 1.3,
        step: 0.05,
        format: (n) => `${Math.round(n * 100)}%`,
      },
      order: 3,
    }),
    defineSetting({
      key: 'appearance.reduceMotion',
      section: 'appearance',
      label: 'Reduce motion',
      description: 'Minimize animations and transitions.',
      schema: z.boolean(),
      default: false,
      control: { type: 'switch' },
      order: 4,
    }),
    defineSetting({
      key: 'ai.enabled',
      section: 'ai',
      label: 'Enable AI',
      description:
        'Turn on AI features. When on, your messages are sent to Anthropic (Claude) to generate responses. SelfOS is wellness support, not medical care.',
      schema: z.boolean(),
      default: false,
      control: { type: 'switch' },
      order: 1,
    }),
    defineSetting({
      key: 'ai.model',
      section: 'ai',
      label: 'Model',
      description: 'Sonnet is faster and cheaper; Opus is the most capable.',
      schema: z.enum(['claude-sonnet-4-6', 'claude-opus-4-8']),
      default: 'claude-sonnet-4-6',
      control: {
        type: 'select',
        options: [
          { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 — faster' },
          { value: 'claude-opus-4-8', label: 'Claude Opus 4.8 — most capable' },
        ],
      },
      order: 2,
      visibleWhen: aiEnabled,
    }),
    defineSetting({
      key: 'ai.apiKey',
      section: 'ai',
      label: 'Claude API key',
      schema: z.null(),
      default: null,
      control: { type: 'custom', render: ApiKeyControl },
      order: 3,
      visibleWhen: aiEnabled,
    }),
    defineSetting({
      key: 'ai.test',
      section: 'ai',
      label: 'Connection',
      schema: z.null(),
      default: null,
      control: { type: 'custom', render: TestConnectionControl },
      order: 4,
      visibleWhen: aiEnabled,
    }),
    defineSetting({
      key: 'vault.location',
      section: 'vault',
      label: 'Location',
      schema: z.null(),
      default: null,
      control: { type: 'custom', render: VaultLocationValue },
      order: 1,
    }),
    defineSetting({
      key: 'vault.reveal',
      section: 'vault',
      label: 'Vault folder',
      schema: z.null(),
      default: null,
      control: { type: 'custom', render: RevealVaultRow },
      order: 2,
    }),
    defineSetting({
      key: 'about.version',
      section: 'about',
      label: 'Version',
      schema: z.null(),
      default: null,
      control: { type: 'custom', render: AboutVersion },
      order: 1,
    }),
    defineSetting({
      key: 'about.disclaimer',
      section: 'about',
      label: 'About SelfOS',
      schema: z.null(),
      default: null,
      control: { type: 'custom', render: AboutDisclaimer },
      order: 2,
    }),
  ]);
}

registerBuiltinSettings();
