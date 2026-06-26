import { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import type { IntimacyTopicsView } from '@shared/channels';
import {
  Banner,
  Button,
  Field,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '../design-system/components';
import { useSessionStore } from '../stores/sessionStore';
import styles from './IntimacyTopicsControl.module.css';

type Kind = 'activities' | 'fantasies';
/** A reviewable suggestion in the checklist: its kind, whether it's ticked, and the (editable) label. */
type Pick = { kind: Kind; checked: boolean; text: string };

const EMPTY_VIEW: IntimacyTopicsView = {
  builtIn: { activities: [], fantasies: [] },
  custom: { activities: [], fantasies: [] },
};

/**
 * Owner-only management of the shared **intimacy topic inventory** (08-questionnaires §16.5a). The Owner
 * adds/removes custom activities + fantasies (household-wide, vault-stored); the merged inventory (built-in
 * + custom) seeds AI generation for intimacy questionnaires AND the personal intake. Built-ins are shown
 * read-only; only custom additions are removable. The Owner can also **suggest topics with AI** — name a
 * subject (or leave it blank for a varied mix), review the deduped suggestions in a checklist (tick + edit),
 * then add the chosen ones. 18+ / consensual-adult only — additions are trusted free text (the Owner is the
 * full-access role); the boundary is enforced by the prompt + the model. Add/suggest is **owner-only**
 * (`people.manage`); a non-owner admin sees the list read-only.
 */
export function IntimacyTopicsControl(): JSX.Element {
  const canManage = useSessionStore((s) => s.can('people.manage'));
  const [view, setView] = useState<IntimacyTopicsView | null>(null);
  // One textarea per kind — the Owner types a topic and adds it; topics are added one at a time.
  const [drafts, setDrafts] = useState<Record<Kind, string>>({ activities: '', fantasies: '' });
  const [busy, setBusy] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);

  // AI suggestions.
  const [subject, setSubject] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<{
    activities: string[];
    fantasies: string[];
  } | null>(null);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [addingSelected, setAddingSelected] = useState(false);

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
    const name = drafts[kind].trim();
    if (name === '' || busy) return;
    setBusy(kind);
    setError(null);
    try {
      const next = await window.selfos?.questionnairesAddIntimacyTopic({ kind, name });
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

  const onSuggest = async (): Promise<void> => {
    if (suggesting) return;
    setSuggesting(true);
    setSuggestError(null);
    setSuggestions(null);
    try {
      const res = await window.selfos?.questionnairesSuggestIntimacyTopics({
        subject: subject.trim(),
      });
      if (!res) {
        setSuggestError('Suggestions aren’t available right now.');
        return;
      }
      if (!res.ok) {
        setSuggestError(res.message);
        return;
      }
      setSuggestions(res.suggestions);
      const init: Record<string, Pick> = {};
      for (const kind of ['activities', 'fantasies'] as const)
        for (const text of res.suggestions[kind])
          init[`${kind}:${text}`] = { kind, checked: true, text };
      setPicks(init);
    } catch {
      setSuggestError('Couldn’t get suggestions. Only the household owner can use this.');
    } finally {
      setSuggesting(false);
    }
  };

  const selected = Object.values(picks).filter((p) => p.checked && p.text.trim() !== '');

  const onAddSelected = async (): Promise<void> => {
    if (addingSelected || selected.length === 0) return;
    setAddingSelected(true);
    setError(null);
    try {
      let latest: IntimacyTopicsView | undefined;
      for (const p of selected) {
        latest = await window.selfos?.questionnairesAddIntimacyTopic({
          kind: p.kind,
          name: p.text.trim(),
        });
      }
      if (latest) setView(latest);
      setSuggestions(null);
      setPicks({});
      setSubject('');
    } catch {
      setError('Couldn’t add the selected topics.');
    } finally {
      setAddingSelected(false);
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

      {canManage ? (
        <Stack gap={2} className={styles.suggestBox}>
          <Text weight={600}>
            <Sparkles size={14} aria-hidden="true" /> Suggest with AI
          </Text>
          <Text size="sm" tone="tertiary">
            Name a theme to explore (or leave it blank for a varied mix). SelfOS proposes fresh
            topics — review and edit them before adding.
          </Text>
          <Field label="Subject (optional)">
            {(props) => (
              <Textarea
                {...props}
                rows={1}
                value={subject}
                placeholder="e.g. sensory play, role-play"
                onChange={(e) => setSubject(e.target.value)}
              />
            )}
          </Field>
          <div>
            <Button variant="secondary" onClick={() => void onSuggest()} disabled={suggesting}>
              {suggesting ? 'Thinking…' : 'Suggest with AI'}
            </Button>
          </div>
          {suggestError ? <Banner tone="warning">{suggestError}</Banner> : null}
          {suggestions ? (
            <Stack gap={3} className={styles.suggestions}>
              {(['activities', 'fantasies'] as const).map((kind) =>
                suggestions[kind].length > 0 ? (
                  <Stack key={kind} gap={1}>
                    <Text size="sm" weight={600}>
                      {kind === 'activities' ? 'Suggested activities' : 'Suggested fantasies'}
                    </Text>
                    {suggestions[kind].map((orig) => {
                      const id = `${kind}:${orig}`;
                      const pick = picks[id];
                      return (
                        <div key={id} className={styles.pickRow}>
                          <input
                            type="checkbox"
                            className={styles.pickCheck}
                            checked={pick?.checked ?? false}
                            aria-label={`Include ${orig}`}
                            onChange={(e) =>
                              setPicks((p) => ({
                                ...p,
                                [id]: {
                                  kind,
                                  checked: e.target.checked,
                                  text: p[id]?.text ?? orig,
                                },
                              }))
                            }
                          />
                          <TextInput
                            value={pick?.text ?? orig}
                            aria-label={`Edit suggestion: ${orig}`}
                            onChange={(e) =>
                              setPicks((p) => ({
                                ...p,
                                [id]: {
                                  kind,
                                  checked: p[id]?.checked ?? true,
                                  text: e.target.value,
                                },
                              }))
                            }
                          />
                        </div>
                      );
                    })}
                  </Stack>
                ) : null,
              )}
              <div>
                <Button
                  onClick={() => void onAddSelected()}
                  disabled={addingSelected || selected.length === 0}
                >
                  {addingSelected ? 'Adding…' : `Add selected (${selected.length})`}
                </Button>
              </div>
            </Stack>
          ) : null}
        </Stack>
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
            <Field label={kind === 'activities' ? 'Add an activity' : 'Add a fantasy'}>
              {(props) => (
                <Stack gap={2}>
                  <Textarea
                    {...props}
                    rows={2}
                    value={drafts[kind]}
                    placeholder={kind === 'activities' ? 'e.g. Wax play' : 'e.g. Pirate roleplay'}
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
