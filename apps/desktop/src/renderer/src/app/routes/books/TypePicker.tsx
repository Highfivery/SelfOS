import { Banner, Button, Heading, Text } from '../../../design-system/components';
import { useStoryStore } from '../../../stores/storyStore';
import styles from './Books.module.css';
import type { StoryBookTypeView } from '@shared/schemas';

/**
 * "What kind of book?" (72 §3.2) — the step before the commission.
 *
 * The types split by `truthMode`, because that is the only distinction that changes what the book may DO:
 * a told-true book never invents and asks when the record is silent; a reimagined one treats the life as raw
 * ore. Grouping by anything else (length, subject, audience) would put those two side by side as if they
 * were the same kind of choice.
 *
 * Each card states what it draws on, what shape it takes, and what its interview will ask about — declared
 * by the type itself (§4.1), so a type added later describes itself without touching this screen.
 *
 * A type behind the 18+ acknowledgement is pickable from here and gated at the COMMISSION, where the
 * acknowledgement can actually be given (§8.4). Disabling the card instead would send someone to Settings
 * mid-flow to unlock a thing they just chose — and the bridge re-enforces the gate regardless, so nothing
 * rests on what this screen shows.
 */

const GROUPS: { mode: StoryBookTypeView['truthMode']; title: string; hint: string }[] = [
  {
    mode: 'true',
    title: 'Told true',
    hint: 'never invents — where the record is silent, it asks you',
  },
  {
    mode: 'fictionalized',
    title: 'Reimagined',
    hint: 'real feelings, invented events — your life as the raw ore',
  },
];

export function TypePicker({
  onPick,
  onCancel,
}: {
  onPick: (typeId: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const bookTypes = useStoryStore((s) => s.bookTypes);

  return (
    <div className={styles.pickerPage}>
      <div className={styles.shelfHead}>
        <div>
          <Heading level={1}>What kind of book?</Heading>
          <Text tone="secondary">
            All of them are written from your life and what your connected people share. What
            changes is how far the prose may depart from the record.
          </Text>
        </div>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {GROUPS.map((group) => {
        const types = bookTypes.filter((t) => t.truthMode === group.mode);
        if (types.length === 0) return null;
        return (
          <section key={group.mode} className={styles.pickerGroup} aria-label={group.title}>
            <div className={styles.pickerGroupHead}>
              <span className={styles.pickerGroupTitle}>{group.title}</span>
              <span className={styles.pickerGroupHint}>{group.hint}</span>
            </div>
            <div className={styles.pickerGrid}>
              {types.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={styles.pickerCard}
                  onClick={() => onPick(t.id)}
                >
                  <span className={styles.pickerCardHead}>
                    <span className={styles.pickerCardTitle}>{t.label}</span>
                    {t.gates.adult ? <span className={styles.pickerAdult}>18+</span> : null}
                  </span>
                  <span className={styles.pickerBlurb}>{t.blurb}</span>
                  <span className={styles.pickerFacts}>
                    <b>Draws on</b> {t.summary.drawsOn} · <b>Shape</b> {t.summary.shape} ·{' '}
                    <b>Asks about</b> {t.summary.asksAbout}
                  </span>
                </button>
              ))}
            </div>
          </section>
        );
      })}

      {bookTypes.length === 0 ? (
        <Banner tone="info">No book types are available right now.</Banner>
      ) : null}
    </div>
  );
}
