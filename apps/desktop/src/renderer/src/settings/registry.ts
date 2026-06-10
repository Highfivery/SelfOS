import type { SettingDefinition, SettingsSection } from './types';

const sections = new Map<string, SettingsSection>();
const definitions = new Map<string, SettingDefinition>();

export function registerSection(section: SettingsSection): void {
  sections.set(section.id, section);
}

export function registerSettings(defs: ReadonlyArray<SettingDefinition>): void {
  for (const def of defs) {
    if (definitions.has(def.key)) throw new Error(`Duplicate setting key: ${def.key}`);
    if (!sections.has(def.section))
      throw new Error(`Unknown section "${def.section}" for ${def.key}`);
    definitions.set(def.key, def);
  }
}

export function getSections(): SettingsSection[] {
  return [...sections.values()].sort((a, b) => a.order - b.order);
}

export function getAllDefinitions(): SettingDefinition[] {
  return [...definitions.values()];
}

export function getDefinitionsForSection(sectionId: string): SettingDefinition[] {
  return getAllDefinitions()
    .filter((def) => def.section === sectionId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function getDefinition(key: string): SettingDefinition | undefined {
  return definitions.get(key);
}

export function getDefaults(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const def of definitions.values()) out[def.key] = def.default;
  return out;
}

/** Test-only: clear the registry so suites don't leak registrations into each other. */
export function __resetRegistry(): void {
  sections.clear();
  definitions.clear();
}
