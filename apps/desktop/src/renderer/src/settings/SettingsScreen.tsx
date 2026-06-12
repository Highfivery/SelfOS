import { useMemo, useState } from 'react';
import { Heading, Stack, Text, TextInput } from '../design-system/components';
import { useSessionStore } from '../stores/sessionStore';
import { getDefinitionsForSection, getSections } from './registry';
import { SettingField } from './SettingField';
import type { SettingDefinition, SettingsSection } from './types';
import styles from './SettingsScreen.module.css';

function matches(def: SettingDefinition, query: string): boolean {
  const haystack =
    `${def.label} ${def.description ?? ''} ${(def.tags ?? []).join(' ')}`.toLowerCase();
  return haystack.includes(query);
}

export function SettingsScreen(): JSX.Element {
  const sections = useMemo(() => getSections(), []);
  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? '');
  const [query, setQuery] = useState('');

  // Admin-only settings (e.g. the disclosure toggle, §8.4) are hidden from non-admins entirely.
  const isAdmin = useSessionStore((s) => s.can('settings.manage'));

  const q = query.trim().toLowerCase();
  const filtered = useMemo<{ section: SettingsSection; defs: SettingDefinition[] }[] | null>(() => {
    if (!q) return null;
    return sections
      .map((section) => ({
        section,
        defs: getDefinitionsForSection(section.id).filter(
          (def) => (!def.adminOnly || isAdmin) && matches(def, q),
        ),
      }))
      .filter((group) => group.defs.length > 0);
  }, [q, sections, isAdmin]);

  const active = sections.find((s) => s.id === activeId);
  const activeDefs = (active ? getDefinitionsForSection(active.id) : []).filter(
    (def) => !def.adminOnly || isAdmin,
  );

  return (
    <div className={styles.screen}>
      <Heading level={1}>Settings</Heading>

      <div className={styles.search}>
        <TextInput
          placeholder="Search settings"
          value={query}
          aria-label="Search settings"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className={styles.layout}>
        <nav className={styles.sections} aria-label="Settings sections">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              className={
                section.id === activeId
                  ? `${styles.sectionItem} ${styles.sectionActive}`
                  : styles.sectionItem
              }
              aria-current={section.id === activeId}
              onClick={() => setActiveId(section.id)}
            >
              <section.icon size={16} aria-hidden="true" />
              <span>{section.title}</span>
            </button>
          ))}
        </nav>

        <div>
          {filtered ? (
            filtered.length === 0 ? (
              <Text tone="secondary">No settings match “{query}”.</Text>
            ) : (
              filtered.map((group) => (
                <section key={group.section.id} className={styles.group}>
                  <Heading level={3}>{group.section.title}</Heading>
                  <div>
                    {group.defs.map((def) => (
                      <SettingField key={def.key} def={def} />
                    ))}
                  </div>
                </section>
              ))
            )
          ) : active ? (
            <section className={styles.group}>
              <Stack gap={1} className={styles.groupHead}>
                <Heading level={3}>{active.title}</Heading>
                {active.description ? <Text tone="secondary">{active.description}</Text> : null}
              </Stack>
              <div className={styles.fields}>
                {activeDefs.map((def) => (
                  <SettingField key={def.key} def={def} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
