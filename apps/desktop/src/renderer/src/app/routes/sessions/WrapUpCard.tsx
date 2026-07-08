import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Circle,
  HelpCircle,
  Lightbulb,
  Target,
  Users,
  X,
} from 'lucide-react';
import type { Insight } from '@shared/schemas';
import {
  Banner,
  Button,
  Heading,
  IconButton,
  Markdown,
  Text,
} from '../../../design-system/components';
import { groupWrapUpFacts, type WrapUpFact } from './wrapUpGroups';
import styles from './sessionLifecycle.module.css';

/** Themes beyond this many collapse behind a "+N more" chip (condensed, user decision 2026-07-08). */
const THEME_PREVIEW = 6;

function moodLabel(value: number, low: string, high: string, mid: string): string {
  if (value <= -0.33) return low;
  if (value >= 0.33) return high;
  return mid;
}

/** A chip list (themes / people) — compact, wraps, no clicks needed to scan. */
function Chips({ items }: { items: WrapUpFact[] }): JSX.Element {
  return (
    <div className={styles.chips}>
      {items.map((item) => (
        <span key={item.id} className={styles.chip}>
          <Markdown inline>{item.text}</Markdown>
        </span>
      ))}
    </div>
  );
}

/**
 * The inline wrap-up card shown after a session is summarized (09 §3.1). Leads with crisis resources if the
 * analysis flagged a concern (§7), then the summary and mood, then the facts GROUPED into scannable sections —
 * Goals first (your takeaways), then Themes (chips), Follow-ups (collapsed), and People (chips) — rather than
 * one flat bullet wall. The durable record lives in Memory; a link points there. Dismissible.
 */
export function WrapUpCard({
  insight,
  onDismiss,
}: {
  insight: Insight;
  onDismiss: () => void;
}): JSX.Element {
  const navigate = useNavigate();
  const valence = insight.metrics?.moodValence;
  const energy = insight.metrics?.moodEnergy;
  const groups = groupWrapUpFacts(insight.facts);

  const [themesExpanded, setThemesExpanded] = useState(false);
  const [followUpsOpen, setFollowUpsOpen] = useState(false);
  const visibleThemes = themesExpanded ? groups.themes : groups.themes.slice(0, THEME_PREVIEW);
  const hiddenThemes = groups.themes.length - THEME_PREVIEW;
  const hasMoreThemes = hiddenThemes > 0;

  return (
    <section className={styles.wrapCard} aria-live="polite" aria-label="Session summary">
      <div className={styles.wrapHead}>
        <Heading level={3}>Session summary</Heading>
        <IconButton aria-label="Dismiss summary" onClick={onDismiss}>
          <X size={16} aria-hidden="true" />
        </IconButton>
      </div>

      {insight.crisisFlag ? (
        <Banner tone="warning">
          It sounds like things are really heavy right now. You deserve support from someone who can
          help directly — please consider reaching out to a crisis line (US &amp; Canada: call or
          text <strong>988</strong>) or your local emergency services.
        </Banner>
      ) : null}

      <Markdown>{insight.summary}</Markdown>

      {valence !== undefined || energy !== undefined ? (
        <div className={styles.moodRow}>
          {valence !== undefined ? (
            <span className={styles.moodChip}>
              Mood · {moodLabel(valence, 'low', 'positive', 'mixed')}
            </span>
          ) : null}
          {energy !== undefined ? (
            <span className={styles.moodChip}>
              Energy · {moodLabel(energy, 'flat', 'high', 'steady')}
            </span>
          ) : null}
        </div>
      ) : null}

      {groups.goals.length > 0 ? (
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <Target size={15} aria-hidden="true" className={styles.sectionIconAccent} />
            <span>Goals &amp; commitments</span>
            <span className={styles.sectionCount}>{groups.goals.length}</span>
          </div>
          <ul className={styles.checklist}>
            {groups.goals.map((goal) => (
              <li key={goal.id} className={styles.checkItem}>
                <Circle size={14} aria-hidden="true" className={styles.checkIcon} />
                <span>
                  <Markdown inline>{goal.text}</Markdown>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {groups.themes.length > 0 ? (
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <Lightbulb size={15} aria-hidden="true" className={styles.sectionIcon} />
            <span>Themes</span>
            <span className={styles.sectionCount}>{groups.themes.length}</span>
          </div>
          <div className={styles.chips}>
            {visibleThemes.map((theme) => (
              <span key={theme.id} className={styles.chip}>
                <Markdown inline>{theme.text}</Markdown>
              </span>
            ))}
            {hasMoreThemes ? (
              <button
                type="button"
                className={styles.chipButton}
                aria-expanded={themesExpanded}
                onClick={() => setThemesExpanded((open) => !open)}
              >
                {themesExpanded ? 'Show fewer' : `+${hiddenThemes} more`}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {groups.followUps.length > 0 ? (
        <div className={styles.section}>
          <button
            type="button"
            className={styles.collapseBtn}
            aria-expanded={followUpsOpen}
            onClick={() => setFollowUpsOpen((open) => !open)}
          >
            {followUpsOpen ? (
              <ChevronDown size={15} aria-hidden="true" className={styles.sectionIcon} />
            ) : (
              <ChevronRight size={15} aria-hidden="true" className={styles.sectionIcon} />
            )}
            <span>Follow-ups for next time</span>
            <span className={styles.sectionCount}>{groups.followUps.length}</span>
          </button>
          {followUpsOpen ? (
            <ul className={styles.followList}>
              {groups.followUps.map((item) => (
                <li key={item.id}>
                  <Markdown inline>{item.text}</Markdown>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {groups.people.length > 0 ? (
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <Users size={15} aria-hidden="true" className={styles.sectionIcon} />
            <span>People mentioned</span>
          </div>
          <Chips items={groups.people} />
        </div>
      ) : null}

      {groups.other.length > 0 ? (
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <HelpCircle size={15} aria-hidden="true" className={styles.sectionIcon} />
            <span>Also noted</span>
          </div>
          <ul className={styles.followList}>
            {groups.other.map((item) => (
              <li key={item.id}>
                <Markdown inline>{item.text}</Markdown>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Text size="xs" tone="tertiary" className={styles.footerNote}>
        This is a reflective summary, not medical advice. You can edit or delete it any time.
      </Text>

      <Button variant="secondary" onClick={() => navigate('/memory')}>
        View in Memory
        <ArrowRight size={16} aria-hidden="true" />
      </Button>
    </section>
  );
}
