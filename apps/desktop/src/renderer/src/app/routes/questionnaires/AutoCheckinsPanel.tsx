import { useEffect, useState } from 'react';
import type { AutoCheckinCadence, AutoCheckinTarget } from '@shared/schemas';
import { useAutoCheckinStore } from '../../../stores/autoCheckinStore';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useSessionStore } from '../../../stores/sessionStore';
import {
  AdminOnlyBadge,
  Banner,
  Button,
  Card,
  Field,
  Heading,
  Inline,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
} from '../../../design-system/components';
import styles from './AutoCheckinsPanel.module.css';

const CADENCES: { value: AutoCheckinCadence; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'few-days', label: 'Every few days' },
  { value: 'weekly', label: 'Weekly' },
];

/**
 * The Auto check-ins config surface on the Questionnaires page (63-auto-checkins §3.1). A master toggle, a
 * per-target stream (yourself + optional other people — owner-only), each with an exploration focus + cadence
 * + an intimacy sub-toggle, and a manual "Run now". Self-hides when the person lacks `questionnaires.autoCheckin`
 * (the bridge returns a null config). Renders NOTHING until the config has loaded, to avoid a flash.
 */
export function AutoCheckinsPanel(): JSX.Element | null {
  const config = useAutoCheckinStore((s) => s.config);
  const incoming = useAutoCheckinStore((s) => s.incoming);
  const loaded = useAutoCheckinStore((s) => s.loaded);
  const running = useAutoCheckinStore((s) => s.running);
  const error = useAutoCheckinStore((s) => s.error);
  const lastRunNote = useAutoCheckinStore((s) => s.lastRunNote);
  const load = useAutoCheckinStore((s) => s.load);
  const setConfig = useAutoCheckinStore((s) => s.setConfig);
  const setBlock = useAutoCheckinStore((s) => s.setBlock);
  const run = useAutoCheckinStore((s) => s.run);

  const can = useSessionStore((s) => s.can);
  const activePersonId = useSessionStore((s) => s.activePerson?.id ?? null);
  const people = usePeopleStore((s) => s.people);
  const peopleLoaded = usePeopleStore((s) => s.loaded);
  const loadPeople = usePeopleStore((s) => s.load);

  const isOwner = can('people.manage');
  // Local drafts for the free-text focus (saved on blur, so we don't persist on every keystroke).
  const [focusDrafts, setFocusDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    // Load the household once (for the owner's add-person picker + person-target names) only if it isn't
    // already loaded — never re-fetch over an already-populated store (that would clobber a recipient picker
    // elsewhere on the page).
    if (isOwner && !peopleLoaded) void loadPeople();
  }, [isOwner, peopleLoaded, loadPeople]);

  // Render once loaded if the person can configure their own streams (has a config) OR someone is sending
  // them check-ins (incoming) — so a person TARGETED by an owner, even without `questionnaires.autoCheckin`,
  // can still see + stop it (§3.3a). Renders nothing until loaded, to avoid a flash.
  if (!loaded || (!config && incoming.length === 0)) return null;

  const targets = config?.targets ?? [];
  const nameFor = (t: AutoCheckinTarget): string => {
    const tk = t.target;
    return tk.kind === 'self'
      ? 'Yourself'
      : (people.find((p) => p.id === tk.personId)?.displayName ?? 'Someone');
  };

  const patchTarget = (id: string, patch: Partial<AutoCheckinTarget>): void => {
    void setConfig({ targets: targets.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  };
  const removeTarget = (id: string): void => {
    void setConfig({ targets: targets.filter((t) => t.id !== id) });
  };
  const addPerson = (personId: string): void => {
    if (!personId) return;
    const target: AutoCheckinTarget = {
      id: crypto.randomUUID(),
      target: { kind: 'person', personId },
      enabled: true,
      includeIntimacy: false,
      explorationFocus: '',
      cadence: 'daily',
    };
    void setConfig({ enabled: true, targets: [...targets, target] });
  };

  const targetedIds = new Set(
    targets.flatMap((t) => (t.target.kind === 'person' ? [t.target.personId] : [])),
  );
  const addable = people.filter(
    (p) => p.isSubject && p.id !== activePersonId && !targetedIds.has(p.id),
  );

  return (
    <section className={styles.panel} aria-label="Auto check-ins">
      <Stack gap={3}>
        {config ? (
          <Card>
            <Stack gap={4}>
              <Inline gap={3} align="start" justify="between">
                <Stack gap={1}>
                  <Heading level={3}>Auto check-ins</Heading>
                  <Text size="sm" tone="secondary">
                    Let SelfOS create short check-ins for you from what it’s learned — never
                    re-asking what it already knows, always something new. Uses your AI allowance,
                    and runs about once a day the app is open.
                  </Text>
                </Stack>
                <Switch
                  checked={config.enabled}
                  onChange={(v) => void setConfig({ enabled: v })}
                  aria-label="Turn auto check-ins on"
                />
              </Inline>

              {config.enabled ? (
                <Stack gap={3}>
                  {targets.map((t) => {
                    const focus = focusDrafts[t.id] ?? t.explorationFocus;
                    const isPerson = t.target.kind === 'person';
                    return (
                      <div key={t.id} className={styles.targetRow}>
                        <Inline gap={2} align="center" justify="between">
                          <Text weight={500}>{nameFor(t)}</Text>
                          <Inline gap={2} align="center">
                            {isPerson ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => removeTarget(t.id)}
                                aria-label={`Remove ${nameFor(t)}`}
                              >
                                Remove
                              </Button>
                            ) : null}
                            <Switch
                              checked={t.enabled}
                              onChange={(v) => patchTarget(t.id, { enabled: v })}
                              aria-label={`Auto check-ins for ${nameFor(t)}`}
                            />
                          </Inline>
                        </Inline>

                        {t.enabled ? (
                          <Stack gap={3} className={styles.rowBody}>
                            <Field label="Anything specific you’d like it to explore? (optional)">
                              {(props) => (
                                <Textarea
                                  {...props}
                                  value={focus}
                                  rows={2}
                                  placeholder="e.g. how I handle stress at work, our communication…"
                                  onChange={(e) =>
                                    setFocusDrafts((d) => ({ ...d, [t.id]: e.target.value }))
                                  }
                                  onBlur={() => patchTarget(t.id, { explorationFocus: focus })}
                                />
                              )}
                            </Field>
                            <Field label="How often">
                              {(props) => (
                                <Select
                                  {...props}
                                  value={t.cadence}
                                  onChange={(e) =>
                                    patchTarget(t.id, {
                                      cadence: e.target.value as AutoCheckinCadence,
                                    })
                                  }
                                >
                                  {CADENCES.map((c) => (
                                    <option key={c.value} value={c.value}>
                                      {c.label}
                                    </option>
                                  ))}
                                </Select>
                              )}
                            </Field>
                            <Inline gap={2} align="start">
                              <Switch
                                checked={t.includeIntimacy}
                                onChange={(v) => patchTarget(t.id, { includeIntimacy: v })}
                                aria-label={`Include unfiltered intimacy check-ins for ${nameFor(t)}`}
                              />
                              <Stack gap={1}>
                                <Text size="sm" weight={500}>
                                  Include unfiltered intimacy check-ins
                                </Text>
                                <Text size="xs" tone="secondary">
                                  {isPerson
                                    ? 'Only sends if they’re your partner and you’ve both confirmed you’re 18+.'
                                    : 'Only sends once you’ve confirmed you’re 18+.'}
                                </Text>
                              </Stack>
                            </Inline>
                          </Stack>
                        ) : null}
                      </div>
                    );
                  })}

                  {isOwner ? (
                    <div className={styles.addRow}>
                      <Inline gap={2} align="center">
                        <Field label="Add someone else">
                          {(props) => (
                            <Select
                              {...props}
                              value=""
                              disabled={addable.length === 0}
                              onChange={(e) => addPerson(e.target.value)}
                            >
                              <option value="">
                                {addable.length === 0 ? 'No one to add' : 'Choose a person…'}
                              </option>
                              {addable.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.displayName}
                                </option>
                              ))}
                            </Select>
                          )}
                        </Field>
                        <AdminOnlyBadge />
                      </Inline>
                      <Text size="xs" tone="secondary">
                        They’ll receive check-ins in their own inbox, shown as auto-generated.
                      </Text>
                    </div>
                  ) : null}

                  <Inline gap={3} align="center">
                    <Button
                      variant="secondary"
                      onClick={() => void run({ auto: false })}
                      disabled={running}
                    >
                      {running ? 'Running…' : 'Run now'}
                    </Button>
                    {lastRunNote ? (
                      <Text size="sm" tone="secondary">
                        {lastRunNote}
                      </Text>
                    ) : null}
                  </Inline>
                  {error ? <Banner tone="warning">{error}</Banner> : null}
                </Stack>
              ) : (
                <Text size="sm" tone="secondary">
                  Turn this on to let SelfOS keep getting to know you between sessions.
                </Text>
              )}
            </Stack>
          </Card>
        ) : null}

        {incoming.length > 0 ? (
          <Card>
            <Stack gap={3}>
              <Stack gap={1}>
                <Heading level={3}>Check-ins others send you</Heading>
                <Text size="sm" tone="secondary">
                  These people have set up occasional auto check-ins for you. You can turn any of
                  them off — they’ll stop, and the sender can’t turn them back on.
                </Text>
              </Stack>
              {incoming.map((s) => (
                <div key={s.senderPersonId} className={styles.targetRow}>
                  <Inline gap={2} align="center" justify="between">
                    <Stack gap={1}>
                      <Text weight={500}>{s.senderName}</Text>
                      <Text size="xs" tone="secondary">
                        {[
                          s.relationshipLabel ? `Your ${s.relationshipLabel}` : null,
                          CADENCES.find((c) => c.value === s.cadence)?.label ?? s.cadence,
                          s.includeIntimacy ? 'includes intimacy check-ins' : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    </Stack>
                    <Inline gap={2} align="center">
                      <Text size="xs" tone="secondary">
                        {s.blocked ? 'Turned off' : 'Receiving'}
                      </Text>
                      <Switch
                        checked={!s.blocked}
                        onChange={(v) => void setBlock(s.senderPersonId, !v)}
                        aria-label={`Receive check-ins from ${s.senderName}`}
                      />
                    </Inline>
                  </Inline>
                </div>
              ))}
            </Stack>
          </Card>
        ) : null}
      </Stack>
    </section>
  );
}
