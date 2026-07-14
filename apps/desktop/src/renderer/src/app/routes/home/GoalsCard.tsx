import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Flag, Handshake, Plus, RotateCw, Sparkles, X } from 'lucide-react';
import { effectiveGoalStatus, type GoalSuggestion } from '@shared/schemas';
import { goalsSummary } from '@selfos/core/home';
import { useGoalStore } from '../../../stores/goalStore';
import { useTogetherStore } from '../../../stores/togetherStore';
import {
  Button,
  Card,
  GoalStatusChip,
  Heading,
  IconButton,
  ProportionBar,
  Stack,
  Text,
  TextInput,
} from '../../../design-system/components';
import styles from './Home.module.css';

/** A short "Jun 3" / "Jun 3, 2027" due-date label (year only when it isn't the current one). */
function formatDue(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === now.getFullYear()
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' };
  return d.toLocaleDateString(undefined, opts);
}

/**
 * The Goals bento card (60-home-dashboard §3.1.3) — encourages a person to SET, SEE, MOVE, and COMPLETE
 * goals, all from Home. Shows a completion bar + the active goals that most want attention (each with a
 * one-tap "Done" / "Still on it"), an inline "+ New goal", and (AI-configured) a metered "Suggest goals" tap
 * that proposes 2-3 tailored goals to accept/dismiss (no per-load spend, persists nothing). An empty state
 * invites the first goal. "See all" opens the full Goals management in Memory. Crisis softens it: the
 * completion bar + the AI suggest are hidden (no gamification, §8), leaving the calm list + create.
 */
export function GoalsCard({
  configured,
  crisis,
}: {
  configured: boolean;
  crisis: boolean;
}): JSX.Element {
  const navigate = useNavigate();
  const goals = useGoalStore((s) => s.goals);
  const create = useGoalStore((s) => s.create);
  const setStatus = useGoalStore((s) => s.setStatus);
  const suggest = useGoalStore((s) => s.suggest);
  const commitments = useTogetherStore((s) => s.myAgreements);
  const setAgreementStatus = useTogetherStore((s) => s.setAgreementStatus);

  const now = new Date();
  const summary = goalsSummary(goals, now, 2);
  const total = summary.activeCount + summary.doneCount;

  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);

  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<GoalSuggestion[] | null>(null);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);

  const resetForm = (): void => {
    setText('');
    setDue('');
    setAdding(false);
  };

  const add = async (): Promise<void> => {
    if (!text.trim() || busy) return;
    setBusy(true);
    await create({ text: text.trim(), ...(due ? { due } : {}) });
    setBusy(false);
    resetForm();
  };

  const runSuggest = async (): Promise<void> => {
    setSuggesting(true);
    setSuggestNote(null);
    const r = await suggest();
    setSuggesting(false);
    if (r.ok && r.suggestions && r.suggestions.length > 0) setSuggestions(r.suggestions);
    else setSuggestNote(r.message ?? 'No suggestions right now.');
  };

  const accept = async (s: GoalSuggestion): Promise<void> => {
    await create({ text: s.text, ...(s.lifeArea ? { lifeArea: s.lifeArea } : {}) });
    setSuggestions((prev) => (prev ? prev.filter((x) => x !== s) : prev));
  };

  const dismiss = (s: GoalSuggestion): void =>
    setSuggestions((prev) => (prev ? prev.filter((x) => x !== s) : prev));

  const empty = goals.length === 0;

  return (
    <Card>
      <Stack gap={3}>
        <div className={styles.cardHead}>
          <Heading level={2} className={styles.sectionTitle}>
            <Flag size={16} aria-hidden="true" /> Goals
          </Heading>
          {!empty ? (
            <button type="button" className={styles.cardLink} onClick={() => navigate('/goals')}>
              See all
            </button>
          ) : null}
        </div>

        {commitments.length > 0 ? (
          <div className={styles.commitments}>
            <div className={styles.commitmentsHead}>
              <Handshake size={14} aria-hidden="true" />
              <span className={styles.commitmentsTitle}>Together commitments</span>
              {commitments.length > 2 ? (
                <button
                  type="button"
                  className={styles.cardLink}
                  onClick={() => navigate('/goals')}
                >
                  See all
                </button>
              ) : null}
            </div>
            <ul className={styles.goalList}>
              {commitments.slice(0, 2).map(({ agreement, partnerPersonId, partnerName }) => (
                <li key={agreement.id} className={styles.goalItem}>
                  <div className={styles.goalMain}>
                    <span className={styles.goalText}>{agreement.text}</span>
                    <div className={styles.goalMeta}>
                      <span className={styles.commitmentWith}>
                        <Handshake size={11} aria-hidden="true" /> {partnerName}
                      </span>
                    </div>
                  </div>
                  <div className={styles.goalActions}>
                    <IconButton
                      aria-label={`Mark done: ${agreement.text}`}
                      onClick={() => void setAgreementStatus(partnerPersonId, agreement.id, 'done')}
                    >
                      <Check size={16} aria-hidden="true" />
                    </IconButton>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {empty ? (
          <Text tone="secondary" size="sm">
            Set a goal you want to move toward — small and doable. Goals also form on their own from
            your sessions.
          </Text>
        ) : (
          <>
            {!crisis && total > 0 ? (
              <ProportionBar label="Completed" value={summary.doneCount} total={total} />
            ) : null}
            <ul className={styles.goalList}>
              {summary.top.map((g) => (
                <li key={g.id} className={styles.goalItem}>
                  <div className={styles.goalMain}>
                    <span className={styles.goalText}>{g.text}</span>
                    <div className={styles.goalMeta}>
                      <GoalStatusChip status={effectiveGoalStatus(g, now)} />
                      {g.due ? (
                        <span className={styles.goalDue}>due {formatDue(g.due, now)}</span>
                      ) : g.horizon ? (
                        <span className={styles.goalDue}>{g.horizon}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className={styles.goalActions}>
                    <IconButton
                      aria-label={`Mark “${g.text}” done`}
                      onClick={() => void setStatus(g.id, 'done')}
                    >
                      <Check size={16} aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      aria-label={`Still working on “${g.text}”`}
                      onClick={() => void setStatus(g.id, 'inProgress')}
                    >
                      <RotateCw size={16} aria-hidden="true" />
                    </IconButton>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {adding ? (
          <div className={styles.goalForm}>
            <TextInput
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What do you want to move toward?"
              aria-label="New goal"
              autoFocus
            />
            <div className={styles.goalFormRow}>
              <input
                type="date"
                className={styles.goalDate}
                value={due}
                onChange={(e) => setDue(e.target.value)}
                aria-label="Due date (optional)"
              />
              <div className={styles.goalFormActions}>
                <Button size="sm" onClick={() => void add()} disabled={!text.trim() || busy}>
                  Add goal
                </Button>
                <Button variant="ghost" size="sm" onClick={resetForm}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.goalCta}>
            <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
              <Plus size={15} aria-hidden="true" /> New goal
            </Button>
            {!crisis && configured ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void runSuggest()}
                disabled={suggesting}
              >
                <Sparkles size={15} aria-hidden="true" />{' '}
                {suggesting ? 'Thinking…' : 'Suggest goals'}
              </Button>
            ) : null}
          </div>
        )}

        {suggestNote ? (
          <Text size="xs" tone="tertiary">
            {suggestNote}
          </Text>
        ) : null}
        {suggestions && suggestions.length > 0 ? (
          <div className={styles.suggestList}>
            <Text size="xs" tone="tertiary">
              Add one you like:
            </Text>
            {suggestions.map((s, i) => (
              <div key={i} className={styles.suggestItem}>
                <div className={styles.suggestBody}>
                  <span className={styles.goalText}>{s.text}</span>
                  {s.rationale ? (
                    <Text size="xs" tone="tertiary">
                      {s.rationale}
                    </Text>
                  ) : null}
                </div>
                <div className={styles.goalActions}>
                  <IconButton aria-label={`Add “${s.text}”`} onClick={() => void accept(s)}>
                    <Plus size={16} aria-hidden="true" />
                  </IconButton>
                  <IconButton aria-label={`Dismiss “${s.text}”`} onClick={() => dismiss(s)}>
                    <X size={16} aria-hidden="true" />
                  </IconButton>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </Stack>
    </Card>
  );
}
