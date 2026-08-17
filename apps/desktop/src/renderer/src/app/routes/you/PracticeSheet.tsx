import { useMemo, useState } from 'react';
import { ArrowRight, Ban, Contrast, Flame } from 'lucide-react';
import type { AdaptiveBankEntryView } from '@shared/schemas';
import { Button, Heading, Text } from '../../../design-system/components';
import adaptive from './Adaptive.module.css';

/**
 * 74 §3.6.1 — the practice sheet: two taps before the deck opens.
 *
 * Three attempts at conveying two rules in prose failed the same way. A band reading "Things YOU SAY TO THEM" is
 * skimmable; a numbered list of rules is a paragraph, and a paragraph is what gets bypassed. So this says almost
 * nothing and makes the person DO it, once in each direction:
 *
 * 1. **The rule leads.** "You're marking the word, not the phrase" is the headline — first thing read, largest
 *    thing on the sheet, and repeated on both beats so it cannot scroll away.
 * 2. **Direction teaches itself by changing.** Beat one is accent `You → Them`; beat two is warm `Them → You`.
 *    Watching the band flip is what conveys "this varies per area" — a sentence saying so does not.
 * 3. **The deck is unreachable until both taps land**, so it is a practice rather than a notice.
 *
 * The two words are REAL bank entries with their real examples, picked by the same orientation the deck uses, so
 * both taps are genuine marks rather than a throwaway demo. (An earlier preview elsewhere hard-coded an example
 * that existed in no entry at all — nothing here invents content.)
 */

/** One beat: a real entry, and which side of it is being asked about. */
export interface PracticeBeat {
  entry: AdaptiveBankEntryView;
  side: 'hear' | 'say';
}

/**
 * Pick the beats: a say-side one then a hear-side one, so the band visibly flips.
 *
 * Two filters carry the teaching, and both are load-bearing:
 *
 * - **`kind: 'word'` only.** The rule being taught is "you're marking the word, not the phrase", so the demo has
 *   to BE a word sitting inside a phrase. Demonstrating it on a phrase-family entry — which is itself the whole
 *   line — would teach the opposite of the sentence above it.
 * - **A quote, and the gentlest available.** Sorted by tier, so the first thing anyone sees in this test is a
 *   tier-1 word rather than whatever the bank happens to declare first.
 *
 * Returns ONE beat when the person's orientation genuinely resolves everything one way (a same-sex configuration
 * can), and none when nothing qualifies. One honest beat beats an invented second.
 */
export function pickBeats(entries: readonly AdaptiveBankEntryView[]): PracticeBeat[] {
  const withQuote = entries
    .filter((entry) => entry.example && entry.kind === 'word')
    .slice()
    .sort((a, b) => a.tier - b.tier);
  const say = withQuote.find((entry) => entry.sides.includes('say'));
  const hear = withQuote.find((entry) => entry.sides.includes('hear') && entry.key !== say?.key);
  const out: PracticeBeat[] = [];
  if (say) out.push({ entry: say, side: 'say' });
  if (hear) out.push({ entry: hear, side: 'hear' });
  return out;
}

/** The word, bolded inside its phrase, so the eye connects the two with no label. */
function Phrase({ quote, term }: { quote: string; term: string }): JSX.Element {
  const at = quote.toLowerCase().indexOf(term.toLowerCase());
  if (at < 0) return <>“{quote}”</>;
  return (
    <>
      “{quote.slice(0, at)}
      <b className={adaptive.saidWord}>{quote.slice(at, at + term.length)}</b>
      {quote.slice(at + term.length)}”
    </>
  );
}

const MARKS = [
  { value: 'love', label: 'love it', Icon: Flame },
  { value: 'okay', label: "it's okay", Icon: Contrast },
  { value: 'never', label: 'never', Icon: Ban },
] as const;

export function PracticeSheet({
  entries,
  onMark,
  onDone,
}: {
  entries: readonly AdaptiveBankEntryView[];
  /** Records a GENUINE mark — the practice taps are real answers, not a demo. */
  onMark: (key: string, mark: 'love' | 'okay' | 'never') => void;
  onDone: () => void;
}): JSX.Element | null {
  const beats = useMemo(() => pickBeats(entries), [entries]);
  const [step, setStep] = useState(0);
  const [tapped, setTapped] = useState<string | null>(null);

  const beat = beats[Math.min(step, Math.max(0, beats.length - 1))];
  // Nothing qualifies (an empty or quote-less bank) — the caller opens the deck rather than showing a practice
  // with nothing in it.
  if (!beat) return null;

  const last = step >= beats.length - 1;
  const hear = beat.side === 'hear';

  const tap = (mark: 'love' | 'okay' | 'never'): void => {
    onMark(beat.entry.key, mark);
    setTapped(mark);
    // A moment to see the mark land, then the band flips — that flip IS the direction lesson.
    if (!last) {
      window.setTimeout(() => {
        setStep((s) => s + 1);
        setTapped(null);
      }, 420);
    }
  };

  return (
    <div
      className={adaptive.practiceScrim}
      role="dialog"
      aria-modal="true"
      aria-labelledby="practice-rule"
    >
      <div className={adaptive.practiceSheet}>
        <div className={adaptive.practiceTop}>
          {/* THE rule: first, largest, identical on both beats. */}
          <Heading level={2} id="practice-rule" className={adaptive.practiceRule}>
            You&rsquo;re marking the <em>word</em>, not the phrase.
          </Heading>
          <Text size="sm" tone="secondary">
            It&rsquo;s your vocabulary we&rsquo;re mapping. The phrase underneath just shows one way
            it gets used.
          </Text>
          <p className={adaptive.practiceAsk}>
            <span className={adaptive.askNum}>{step + 1}</span>
            {step === 0 ? (
              <span>
                <b>Try it</b> — tap how &ldquo;{beat.entry.text}&rdquo; lands.
              </span>
            ) : (
              <span>
                <b>Once more</b> — this time it&rsquo;s them saying it to you.
              </span>
            )}
          </p>
        </div>

        {/* A real band and a real row, lifted from the deck rather than drawn as a diagram. */}
        <div className={adaptive.practiceDemo}>
          <div className={`${adaptive.practiceBand} ${hear ? adaptive.bandHear : ''}`}>
            <span className={`${adaptive.who} ${hear ? adaptive.them : adaptive.me}`}>
              {hear ? 'Them' : 'You'}
            </span>
            <ArrowRight size={14} aria-hidden="true" className={adaptive.arrow} />
            <span className={`${adaptive.who} ${hear ? adaptive.me : adaptive.them}`}>
              {hear ? 'You' : 'Them'}
            </span>
            <span className={adaptive.practiceBandWhat}>
              {hear ? 'they’d say this to you' : 'you’d say this to them'}
            </span>
          </div>
          <div className={`${adaptive.row} ${tapped ? adaptive.rowOn : ''}`}>
            <div className={adaptive.line}>
              <div className={adaptive.rated}>{beat.entry.text}</div>
              <div className={adaptive.said}>
                <span className={adaptive.asIn}>as in</span>{' '}
                <Phrase quote={beat.entry.example ?? ''} term={beat.entry.text} />
              </div>
            </div>
            <span className={adaptive.marks}>
              {MARKS.map(({ value, label, Icon }, i) => (
                <span key={value} className={adaptive.practiceMark}>
                  {/* The boundary stays set apart here too, so the practice matches the real row exactly. */}
                  {i === 2 ? <span className={adaptive.markGap} aria-hidden="true" /> : null}
                  <button
                    type="button"
                    className={`${adaptive.mark} ${adaptive[value]} ${
                      tapped === value ? adaptive.markOn : ''
                    }`}
                    aria-pressed={tapped === value}
                    aria-label={`${beat.entry.text} — ${label}`}
                    onClick={() => tap(value)}
                  >
                    <Icon size={18} aria-hidden="true" />
                  </button>
                </span>
              ))}
            </span>
          </div>
        </div>

        <Text size="sm" tone="tertiary" className={adaptive.practiceNote}>
          The band always says which way an area goes.
        </Text>

        <div className={adaptive.practiceFoot}>
          {/*
           * Required, not optional: until the last beat is answered there is no way into the deck. That is the
           * difference between a practice and a notice — and both taps counted as real marks, so the friction
           * costs nothing.
           */}
          <Button variant="primary" disabled={!(last && tapped)} onClick={onDone}>
            Start marking
          </Button>
        </div>
      </div>
    </div>
  );
}
