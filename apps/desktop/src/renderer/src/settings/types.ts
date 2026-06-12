import type { ComponentType } from 'react';
import type { ZodType } from 'zod';
import type { LucideIcon } from 'lucide-react';
import type { SettingScope } from '@shared/channels';

export type { SettingScope };

export interface SelectOption {
  value: string;
  label: string;
}

export type SettingControl =
  | { type: 'switch' }
  | { type: 'segmented'; options: ReadonlyArray<SelectOption> }
  | { type: 'select'; options: ReadonlyArray<SelectOption> }
  | { type: 'slider'; min: number; max: number; step: number; format?: (value: number) => string }
  | { type: 'text'; placeholder?: string }
  | { type: 'custom'; render: ComponentType };

/** One declarative setting — the single source of truth (03-settings §4.1). */
export interface SettingDefinition<T = unknown> {
  key: string;
  section: string;
  label: string;
  description?: string;
  schema: ZodType<T>;
  default: T;
  control: SettingControl;
  scope?: SettingScope; // default 'vault'
  order?: number;
  visibleWhen?: (values: Readonly<Record<string, unknown>>) => boolean;
  /** Visible only to an Owner / super-admin, and rendered with an "Admin only" marker (CLAUDE.md §12). */
  adminOnly?: boolean;
  tags?: string[];
}

export interface SettingsSection {
  id: string;
  title: string;
  description?: string;
  icon: LucideIcon;
  order: number;
}

/** Preserves the value type `T` when declaring a setting. */
export function defineSetting<T>(definition: SettingDefinition<T>): SettingDefinition<T> {
  return definition;
}

/**
 * End-to-end typing: features augment this map (`key → value type`) via declaration merging, so
 * `useSetting('appearance.theme')` infers the exact type (03-settings §5.1).
 */

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- augmented by features via declaration merging
export interface SettingsTypeMap {}

export type SettingKey = keyof SettingsTypeMap & string;
export type SettingValueOf<K extends SettingKey> = SettingsTypeMap[K];
