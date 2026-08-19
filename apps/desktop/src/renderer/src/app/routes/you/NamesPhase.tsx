import { useMemo, useState } from 'react';
import { Ban, Check, Contrast, Flame } from 'lucide-react';
import type { AdaptiveNameEntryView, AdaptiveNameRegisterView } from '@shared/schemas';
import { Button, Card, Heading, Select, Text } from '../../../design-system/components';
import { useAdaptiveTestStore, type BankMark } from '../../../stores/adaptiveTestStore';
import {
  EMPTY_STATS,
  REGISTER_SORTS,
  intensityOf,
  intensityRange,
  registerStats,
  sortRegisters,
  type RegisterSort,
  type RegisterStats,
} from './registerStats';
import adaptive from './Adaptive.module.css';

/**
 * 74 §3.6.8 — the pet-name phase, which runs before the vocabulary.
 *
 * Three things about it are decisions, not conveniences:
 *
 * 1. **Register-first.** ~2,000 names is ~4,000 marks; nobody walks that, so the phase opens on the registers
 *    as cards carrying how far they go, what is inside them, and how far through them you are — and the
 *    person opens the ones that mean something. A register they never open is simply unasked, which is them
 *    choosing scope rather than the app pre-deciding. Inside a register the WHOLE register is on the page:
 *    the tier lines are signposts, not doors (they already chose to be here).
 * 2. **Two marks per name**, in columns that never look alike — permanent tint, own edge, headers carrying
 *    both people's real names, in the same two colours the §3.6.3 direction band already teaches.
 * 3. **Each name is asked in the direction it can land** (§3.6.3, owner-directed 2026-08-19). A convention —
 *    `slut`, `angel`, `kitten` — is still put to everyone, because who those are "for" is exactly what the
 *    phase exists to let the person decide. A noun that literally names a gender is not a convention: "my
 *    man" is something he can be called and never something he calls her, so it is offered one way. The
 *    filtering is SILENT and the row is unchanged — only the pill that had no answer is gone.
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

function CountChip({ kind, n, label }: { kind: BankMark; n: number; label: string }): JSX.Element {
  const Icon = MARKS.find((mark) => mark.value === kind)?.Icon ?? Flame;
  return (
    <span
      className={`${adaptive.regChip} ${adaptive[`chip_${kind}`]} ${n === 0 ? adaptive.chipZero : ''}`}
    >
      <Icon size={12} aria-hidden="true" />
      <span>{n}</span>
      <span className={adaptive.srOnly}>{label}</span>
    </span>
  );
}

function RegisterCard({
  register,
  stats,
  onOpen,
}: {
  register: AdaptiveNameRegisterView;
  stats: RegisterStats;
  onOpen: () => void;
}): JSX.Element {
  const pct = register.count > 0 ? Math.round((stats.marked / register.count) * 100) : 0;
  const done = stats.marked > 0 && stats.marked >= register.count;
  const started = stats.marked > 0 && !done;
  const name = register.label.replace(/^Names — /, '');
  const range = intensityRange(register.minTier, register.maxTier);
  return (
    <button
      type="button"
      className={`${adaptive.regCard} ${started ? adaptive.regStarted : ''} ${done ? adaptive.regDone : ''}`}
      /*
       * One coherent label, led by the register's own name. Without it the accessible name is every visible
       * string run together — so it began with the intensity eyebrow, and every `^name` locator for this card
       * silently stopped matching the moment the eyebrow was added.
       */
      aria-label={
        stats.marked > 0
          ? `${name} — ${range}. ${stats.marked} of ${register.count} names marked.`
          : `${name} — ${range}. ${register.count} names, none marked yet.`
      }
      onClick={onOpen}
    >
      {/* §12 — the range is an eyebrow ABOVE the title, so neither the title nor the sample names lose
          width to it. It says the span in words because the five-segment meter it replaced encoded a RANGE
          ("tiers 4-5") while reading as an AMOUNT ("2 of 5"). */}
      <span
        className={`${adaptive.regEyebrow} ${adaptive[`heat_${intensityOf(register.maxTier)}`]}`}
        aria-hidden="true"
      >
        {range}
      </span>
      <span className={adaptive.regName}>{name}</span>
      <span className={adaptive.regEg}>{register.samples.join(' · ')}</span>
      <span className={adaptive.regBar}>
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className={adaptive.regMeta}>
        <span className={adaptive.regPct}>{pct}%</span>
        <span className={adaptive.regOf}>
          {stats.marked > 0
            ? `${stats.marked.toLocaleString()} of ${register.count.toLocaleString()} names marked`
            : `${register.count.toLocaleString()} names, none marked yet`}
        </span>
        {done ? (
          <span className={adaptive.regDoneTick}>
            <Check size={13} aria-hidden="true" /> all marked
          </span>
        ) : null}
      </span>
      {stats.marked > 0 ? (
        <span className={adaptive.regCounts}>
          <CountChip kind="love" n={stats.love} label="you love" />
          <CountChip kind="okay" n={stats.okay} label="okay with" />
          <CountChip kind="never" n={stats.never} label="not for you" />
          <span className={adaptive.regLeft}>
            {(register.count - stats.marked).toLocaleString()} left
          </span>
        </span>
      ) : null}
    </button>
  );
}

export function NamesPhase({
  rail,
}: {
  /**
   * The shared step rail (74 §3.6.9), owned by the take so every step shows the SAME one. This phase used to
   * render its own, which meant a person's sense of "where am I" changed between two screens of one test.
   */
  rail: JSX.Element;
}): JSX.Element | null {
  const store = useAdaptiveTestStore();
  const names = store.names;
  const openId = store.openRegister;
  const [sort, setSort] = useState<RegisterSort>('state');

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
  // Live, from the marks this screen already holds — never the number the view was loaded with, which is
  // what made a register marked in this sitting keep reading "Not opened".
  const stats = useMemo(
    () => registerStats(names?.entries ?? [], store.nameMarks),
    [names, store.nameMarks],
  );
  const ordered = useMemo(
    () => sortRegisters(names?.registers ?? [], stats, sort),
    [names, stats, sort],
  );

  if (!names) return null;

  const me = names.selfName ?? 'you';
  const them = names.partnerName ?? 'them';
  const markedHere = rows.filter((entry) => {
    const mark = store.nameMarks[entry.key];
    return mark?.hear !== undefined || mark?.say !== undefined;
  }).length;

  if (!open) {
    const started = names.registers.filter(
      (register) => (stats[register.id] ?? EMPTY_STATS).marked > 0,
    ).length;
    return (
      <div className={adaptive.deck}>
        <div className={adaptive.deckHead}>
          <Heading level={2}>What do you call each other?</Heading>
          <Text tone="secondary" className={adaptive.areaNote}>
            Two answers per name — whether you like being called it, and whether you like calling{' '}
            {them} it. Open the ones that mean something; the rest stay unasked.
          </Text>
        </div>
        <div className={adaptive.deckBody}>
          <div>
            <Text size="sm" tone="tertiary" className={adaptive.regSummary}>
              {started} of {names.registers.length} registers started ·{' '}
              {names.entries.length.toLocaleString()} names in all
            </Text>
            <div className={adaptive.regBar2}>
              <Select
                aria-label="Sort registers"
                value={sort}
                onChange={(event) => setSort(event.target.value as RegisterSort)}
              >
                {REGISTER_SORTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className={adaptive.regGrid}>
              {ordered.map((register) => (
                <RegisterCard
                  key={register.id}
                  register={register}
                  stats={stats[register.id] ?? EMPTY_STATS}
                  onOpen={() => store.setOpenRegister(register.id)}
                />
              ))}
            </div>
          </div>
          {rail}
        </div>
      </div>
    );
  }

  return (
    <div className={adaptive.deck}>
      <div className={`${adaptive.band} ${adaptive.bandNames}`}>
        <span className={adaptive.bandText}>
          {/* This used to open "Both ways, every name" — and my first correction, "Two answers per name",
              was no better: neither is true once names are oriented (§3.6.3), because a straight man is
              asked about "good girl" once, not twice. Both claims are dropped rather than replaced with an
              explanation, since the filtering is silent by decision.

              What remains is exact. A CONVENTION — `slut`, `angel`, `kitten`, `doll`, `baby` — is still put
              to everyone in both directions, and that is precisely what is not filtered: only a noun that
              literally names a gender is, and those are not conventions. So the sentence says something the
              screen still honours, rather than something it used to. */}
          Whether a name is &ldquo;for a girl&rdquo; is a convention &mdash;{' '}
          <b>you decide, not us.</b>
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
      <div className={adaptive.deckBody}>
        <div className={adaptive.rows}>
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
        {/* Inside a register the primary is "Done with this one" — walking straight out of the step from here
            would step past the registers they have not opened (the §3.6.9 walk, finding 3). */}
        <div className={adaptive.railWrap}>
          <Card className={adaptive.railCard}>
            <div className={adaptive.railActions}>
              <Button variant="primary" onClick={() => store.setOpenRegister(null)}>
                Done with this one →
              </Button>
            </div>
          </Card>
          {rail}
        </div>
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
    const current = mark[side];
    const who = side === 'hear' ? `${them} → ${me}` : `${me} → ${them}`;
    return (
      <span className={side === 'hear' ? adaptive.colMe : adaptive.colThem}>
        {/* The label rides WITH its cluster. As a sticky header it detached from the buttons it named and
            hovered mid-list, and two long display names wrapped it onto two lines. */}
        <span className={adaptive.colWho}>
          {who}
          <small>{side === 'hear' ? 'call me this' : 'I call them this'}</small>
        </span>
        <span className={adaptive.marks}>
          {MARKS.map(({ value, label, Icon }, i) => (
            <span key={value} className={adaptive.markSlot}>
              {/* The no is set apart, so it is never a mis-tap neighbour — it is a preference you can
                  change any time, not a door that locks (74 §3.2, amended 2026-08-19). */}
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
        {/* Only the directions this person is actually asked about. Both pills are `flex: 1 1 auto`, so a
            lone survivor stretches across the row on its own — no gap, and nothing to explain. */}
        <div className={adaptive.nameMarksRow}>
          {entry.sides.includes('hear') ? column('hear') : null}
          {entry.sides.includes('say') ? column('say') : null}
        </div>
      </div>
    </>
  );
}
