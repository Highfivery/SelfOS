import { useMemo } from 'react';
import { Ban, Contrast, Flame } from 'lucide-react';
import type { AdaptiveNameEntryView, AdaptiveNameRegisterView } from '@shared/schemas';
import { Button, Card, Heading, Text } from '../../../design-system/components';
import { useAdaptiveTestStore, type BankMark } from '../../../stores/adaptiveTestStore';
import adaptive from './Adaptive.module.css';

/**
 * 74 §3.6.8 — the pet-name phase, which runs before the vocabulary.
 *
 * Two things about it are decisions, not conveniences:
 *
 * 1. **Register-first.** 2,215 names is 4,430 marks; nobody walks that, so the phase opens on the registers as
 *    cards carrying their size, their intensity span and three real names, and the person opens the ones that
 *    mean something. A register they never open is simply unasked — that is them choosing scope, which is the
 *    opposite of the app pre-deciding. Inside a register the WHOLE register is on the page: the tier lines are
 *    signposts, not doors (they already chose to be here).
 * 2. **Two marks per name**, in columns that never look alike — permanent tint, own edge, sticky headers
 *    carrying both people's real names, in the same two colours the §3.6.3 direction band already teaches.
 *    Whether a name is "for a girl" is a convention, so nothing is filtered by orientation here.
 */

const MARKS: { value: BankMark; label: string; Icon: typeof Flame }[] = [
  { value: 'love', label: 'love it', Icon: Flame },
  { value: 'okay', label: "it's okay", Icon: Contrast },
  { value: 'never', label: 'never', Icon: Ban },
];

/** The word, bolded inside its own example, so the row shows what is being marked without saying it. */
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

function RegisterCard({
  register,
  onOpen,
}: {
  register: AdaptiveNameRegisterView;
  onOpen: () => void;
}): JSX.Element {
  const done = register.marked > 0;
  return (
    <button
      type="button"
      className={`${adaptive.regCard} ${done ? adaptive.regCardDone : ''}`}
      onClick={onOpen}
    >
      <span className={adaptive.regTop}>
        <span className={adaptive.regName}>{register.label.replace(/^Names — /, '')}</span>
        <span className={adaptive.regCount}>{register.count}</span>
      </span>
      <span className={adaptive.regEg}>{register.samples.join(' · ')}</span>
      <span className={adaptive.regState}>
        {done ? (
          `${register.marked} marked`
        ) : (
          <>
            Not opened{' '}
            <span className={adaptive.heat}>
              {[1, 2, 3, 4, 5].map((tier) => (
                <i
                  key={tier}
                  className={tier <= register.maxTier ? adaptive.heatOn : ''}
                  aria-hidden="true"
                />
              ))}
              {/* §9 — the meter is never the only cue. */}
              <span className={adaptive.srOnly}>
                intensity {register.minTier} to {register.maxTier} of 5
              </span>
            </span>
          </>
        )}
      </span>
    </button>
  );
}

export function NamesPhase({ testId }: { testId: string }): JSX.Element | null {
  const store = useAdaptiveTestStore();
  const names = store.names;
  const openId = store.openRegister;

  const open = useMemo(
    () => names?.registers.find((register) => register.id === openId) ?? null,
    [names, openId],
  );
  const rows = useMemo(
    () =>
      openId
        ? (names?.entries.filter((entry) => entry.family === openId) ?? [])
            .slice()
            .sort((a, b) => a.tier - b.tier)
        : [],
    [names, openId],
  );

  const totals = useMemo(() => {
    const out: Record<BankMark, number> = { love: 0, okay: 0, never: 0 };
    for (const mark of Object.values(store.nameMarks)) {
      for (const side of ['hear', 'say'] as const) {
        const value = mark[side];
        if (value) out[value] += 1;
      }
    }
    return out;
  }, [store.nameMarks]);

  // Live, not the number the view was loaded with: that one said "0 of 72" while the rail counted two marks.
  const markedHere = rows.filter((entry) => {
    const mark = store.nameMarks[entry.key];
    return mark?.hear !== undefined || mark?.say !== undefined;
  }).length;

  if (!names) return null;

  const me = names.selfName ?? 'you';
  const them = names.partnerName ?? 'them';
  const openedCount = names.registers.filter((register) => register.marked > 0).length;

  if (!open) {
    return (
      <div className={adaptive.deck}>
        <div className={adaptive.deckHead}>
          <Heading level={2}>What do you call each other?</Heading>
          <Text tone="secondary" className={adaptive.areaNote}>
            Two answers per name — whether you like being called it, and whether you like calling{' '}
            {them} it. Open the ones that mean something; the rest stay unasked.
          </Text>
          <Text size="sm" tone="tertiary" className={adaptive.deckNote}>
            {names.entries.length.toLocaleString()} names in all — nobody works through them in
            order, and you&rsquo;re not meant to. Every tap saves itself.
          </Text>
        </div>
        <div className={adaptive.regGrid}>
          {names.registers.map((register) => (
            <RegisterCard
              key={register.id}
              register={register}
              onOpen={() => store.setOpenRegister(register.id)}
            />
          ))}
        </div>
        <div className={adaptive.deckFoot}>
          <Text size="sm" tone="tertiary">
            {openedCount} of {names.registers.length} registers started ·{' '}
            {Object.keys(store.nameMarks).length} names marked
          </Text>
          <Button
            variant="primary"
            disabled={store.busy}
            onClick={() => void store.finishNames(testId)}
          >
            Done with names →
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={adaptive.deck}>
      <div className={`${adaptive.band} ${adaptive.bandNames}`}>
        <span className={adaptive.bandText}>
          <b>Both ways, every name.</b> Whether a name is &ldquo;for a girl&rdquo; is a convention —
          you decide, not us.
        </span>
      </div>
      <div className={adaptive.deckHead}>
        <div className={adaptive.headTop}>
          <div className={adaptive.deckHeadTitle}>
            <Heading level={2}>{open.label.replace(/^Names — /, '')}</Heading>
          </div>
          <Text size="sm" tone="tertiary">
            {markedHere} of {open.count} marked
          </Text>
        </div>
        {open.note ? (
          <Text tone="secondary" className={adaptive.areaNote}>
            {open.note}
          </Text>
        ) : null}
      </div>
      <div className={`${adaptive.deckBody} ${adaptive.nameBody}`}>
        <div className={adaptive.rows}>
          <div className={adaptive.colHead}>
            <span className={adaptive.colLead}>Gentlest first. Mark what does something.</span>
            <span className={`${adaptive.colTag} ${adaptive.colTagMe}`}>
              {them} → {me}
              <small>call me this</small>
            </span>
            <span className={`${adaptive.colTag} ${adaptive.colTagThem}`}>
              {me} → {them}
              <small>I call them this</small>
            </span>
          </div>
          {rows.map((entry, index) => (
            <NameRow
              key={entry.key}
              entry={entry}
              me={me}
              them={them}
              /** A tier line whenever the intensity steps up — a signpost, never a gate. */
              tierBreak={index === 0 || rows[index - 1]?.tier !== entry.tier}
              mark={store.nameMarks[entry.key] ?? {}}
              onMark={(side, value) => store.markName(entry.key, side, value)}
            />
          ))}
        </div>
        <aside className={adaptive.rail} aria-label="Your marks and where to go next">
          <Card className={adaptive.railCard}>
            <div className={adaptive.railHead}>Marked so far</div>
            <div className={adaptive.tally}>
              {MARKS.map(({ value, label }) => (
                <div key={value} className={adaptive.tallyRow} data-testid={`name-tally-${value}`}>
                  <span className={`${adaptive.dot} ${adaptive[value]}`} aria-hidden="true" />
                  <span className={adaptive.tallyLabel}>{label}</span>
                  <b>{totals[value]}</b>
                </div>
              ))}
            </div>
          </Card>
          <Card className={adaptive.railCard}>
            <div className={adaptive.railActions}>
              <Button variant="primary" onClick={() => store.setOpenRegister(null)}>
                Done with this one →
              </Button>
              {/* The SAME action as the grid's, with the same label — two names for one thing is how a
                  flow starts reading as two different things (the §7 coherence rule). */}
              <Button
                variant="ghost"
                disabled={store.busy}
                onClick={() => void store.finishNames(testId)}
              >
                Done with names →
              </Button>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function NameRow({
  entry,
  me,
  them,
  tierBreak,
  mark,
  onMark,
}: {
  entry: AdaptiveNameEntryView;
  me: string;
  them: string;
  tierBreak: boolean;
  mark: { hear?: BankMark; say?: BankMark };
  onMark: (side: 'hear' | 'say', mark: BankMark) => void;
}): JSX.Element {
  const column = (side: 'hear' | 'say'): JSX.Element => {
    const settled = side === 'hear' ? entry.settledHear : entry.settledSay;
    const current = mark[side];
    const who = side === 'hear' ? `${them} → ${me}` : `${me} → ${them}`;
    return (
      <span className={side === 'hear' ? adaptive.colMe : adaptive.colThem} data-label={who}>
        {settled ? (
          <span className={adaptive.settled}>off the table</span>
        ) : (
          <span className={adaptive.marks}>
            {MARKS.map(({ value, label, Icon }, i) => (
              <span key={value} className={adaptive.markSlot}>
                {/* The boundary is set apart, so a hard no is never a mis-tap neighbour. */}
                {i === 2 ? <span className={adaptive.markGap} aria-hidden="true" /> : null}
                <button
                  type="button"
                  className={`${adaptive.mark} ${adaptive[value]} ${
                    current === value ? adaptive.markOn : ''
                  }`}
                  aria-pressed={current === value}
                  aria-label={`${entry.text} — ${who} — ${label}`}
                  onClick={() => onMark(side, value)}
                >
                  <Icon size={17} aria-hidden="true" />
                </button>
              </span>
            ))}
          </span>
        )}
      </span>
    );
  };

  return (
    <>
      {tierBreak ? (
        <div className={adaptive.tierLine}>
          <span>Tier {entry.tier}</span>
          <hr />
        </div>
      ) : null}
      <div
        className={`${adaptive.row} ${adaptive.nameRow} ${
          mark.hear || mark.say ? adaptive.rowOn : ''
        }`}
      >
        <div className={adaptive.line}>
          <div className={adaptive.rated}>{entry.text}</div>
          <div className={adaptive.said}>
            <span className={adaptive.asIn}>as in</span>{' '}
            <Phrase quote={entry.example} term={entry.text} />
          </div>
        </div>
        {column('hear')}
        {column('say')}
      </div>
    </>
  );
}
