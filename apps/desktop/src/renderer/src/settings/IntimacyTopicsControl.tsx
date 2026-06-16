import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { IntimacyTopicsView } from '@shared/channels';
import { Banner, Button, Field, Stack, Text, Textarea } from '../design-system/components';
import { useSessionStore } from '../stores/sessionStore';
import styles from './IntimacyTopicsControl.module.css';

type Kind = 'activities' | 'fantasies';

const EMPTY_VIEW: IntimacyTopicsView = {
  builtIn: { activities: [], fantasies: [] },
  custom: { activities: [], fantasies: [] },
};

/**
 * Owner-only management of the shared **intimacy topic inventory** (08-questionnaires §16.5a). The Owner
 * adds/removes custom activities + fantasies (household-wide, vault-stored); the merged inventory (built-in
 * + custom) seeds AI generation for intimacy questionnaires AND the personal intake. Built-ins are shown
 * read-only; only custom additions are removable. 18+ / consensual-adult only — additions are trusted free
 * text (the Owner is the full-access role); the boundary is enforced by the generation prompt + the model.
 * Add/remove is **owner-only** (`people.manage`); a non-owner admin sees the list read-only.
 */
export function IntimacyTopicsControl(): JSX.Element {
  const canManage = useSessionStore((s) => s.can('people.manage'));
  const [view, setView] = useState<IntimacyTopicsView | null>(null);
  // One textarea per kind — each line is a topic, so several can be added at once.
  const [drafts, setDrafts] = useState<Record<Kind, string>>({ activities: '', fantasies: '' });
  const [busy, setBusy] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = (): void => {
    void window.selfos
      ?.questionnairesIntimacyTopics()
      .then(setView)
      // Defensive: the read returns an empty view rather than throwing for in-scope callers, but never
      // strand the control on "Loading…" if it does reject.
      .catch(() => setView(EMPTY_VIEW));
  };
  useEffect(load, []);

  const onAdd = async (kind: Kind): Promise<void> => {
    const names = drafts[kind]
      .split('\n')
      .map((n) => n.trim())
      .filter(Boolean);
    if (names.length === 0 || busy) return;
    setBusy(kind);
    setError(null);
    try {
      let next: IntimacyTopicsView | undefined;
      for (const name of names) {
        next = await window.selfos?.questionnairesAddIntimacyTopic({ kind, name });
      }
      if (next) setView(next);
      setDrafts((d) => ({ ...d, [kind]: '' }));
    } catch {
      setError('Couldn’t add that topic. Only the household owner can manage the list.');
    } finally {
      setBusy(null);
    }
  };

  const onRemove = async (kind: Kind, name: string): Promise<void> => {
    setError(null);
    try {
      const next = await window.selfos?.questionnairesRemoveIntimacyTopic({ kind, name });
      if (next) setView(next);
    } catch {
      setError('Couldn’t remove that topic.');
    }
  };

  if (!view) return <Text tone="tertiary">Loading…</Text>;

  return (
    <Stack gap={4}>
      <Banner tone="info">
        18+ only. These topics seed AI-drafted questions for intimacy questionnaires and the
        personal intake. Add only consensual-adult topics (taboo themes as fantasy/roleplay) — never
        minors, real non-consent, or anything illegal.
      </Banner>
      {!canManage ? (
        <Text size="sm" tone="tertiary">
          Only the household owner can add or remove topics.
        </Text>
      ) : null}

      {(['activities', 'fantasies'] as const).map((kind) => (
        <Stack key={kind} gap={2}>
          <Text weight={600}>{kind === 'activities' ? 'Activities' : 'Fantasies'}</Text>

          {view.custom[kind].length > 0 ? (
            <div className={styles.chips}>
              {view.custom[kind].map((topic) => (
                <span key={topic} className={styles.chip}>
                  {topic}
                  {canManage ? (
                    <button
                      type="button"
                      className={styles.remove}
                      aria-label={`Remove ${topic}`}
                      onClick={() => void onRemove(kind, topic)}
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  ) : null}
                </span>
              ))}
            </div>
          ) : (
            <Text size="sm" tone="tertiary">
              No custom {kind} yet — {view.builtIn[kind].length} built-in topics are always
              included.
            </Text>
          )}

          {canManage ? (
            <Field
              label={`Add ${kind === 'activities' ? 'activities' : 'fantasies'} (one per line)`}
            >
              {(props) => (
                <Stack gap={2}>
                  <Textarea
                    {...props}
                    rows={2}
                    value={drafts[kind]}
                    placeholder={
                      kind === 'activities'
                        ? 'e.g. Wax play\nSensory deprivation'
                        : 'e.g. Pirate roleplay\nMasquerade'
                    }
                    onChange={(e) => setDrafts((d) => ({ ...d, [kind]: e.target.value }))}
                  />
                  <div>
                    <Button
                      variant="secondary"
                      onClick={() => void onAdd(kind)}
                      disabled={busy === kind || drafts[kind].trim() === ''}
                    >
                      {busy === kind ? 'Adding…' : 'Add'}
                    </Button>
                  </div>
                </Stack>
              )}
            </Field>
          ) : null}
        </Stack>
      ))}

      {error ? <Banner tone="warning">{error}</Banner> : null}
    </Stack>
  );
}
