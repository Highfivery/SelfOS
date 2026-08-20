import { useEffect, useMemo, useState } from 'react';
import { Ban, Contrast, Flame } from 'lucide-react';
import type { AdaptiveNameEntryView, AdaptiveNameRegisterView } from '@shared/schemas';
import { Heading, Select, Text } from '../../../design-system/components';
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
import { MarkFilter, isStillUnmarked, type MarkFilterValue } from './MarkFilter';
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
  /*
   * 74 §3.6.29 — counts up, never a fraction of a whole (the durable no-completion rule, narrowed
   * 2026-08-18: "the line is the DENOMINATOR").
   *
   * This card used to carry a percentage, a filling bar, "N of M names marked", "all marked ✓" and "N left"
   * — four ways of saying the register is finishable. It is not: the bank GROWS. `names-rough-mild` went
   * 130 → 132 in this very change, so anyone who had marked all 130 would open the app to "98% · 2 left"
   * having done nothing, which is precisely the lie the rule exists to prevent. What the card shows now is
   * what HAPPENED — how many they marked, and how those marks fell.
   */
  const started = stats.marked > 0;
  const name = register.label.replace(/^Names — /, '');
  const range = intensityRange(register.minTier, register.maxTier);
  return (
    <button
      type="button"
      className={`${adaptive.regCard} ${started ? adaptive.regStarted : ''}`}
      /*
       * One coherent label, led by the register's own name. Without it the accessible name is every visible
       * string run together — so it began with the intensity eyebrow, and every `^name` locator for this card
       * silently stopped matching the moment the eyebrow was added.
       */
      aria-label={
        stats.marked > 0
          ? `${name} — ${range}. ${stats.marked} marked, of ${register.count} names in it.`
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
      <span className={adaptive.regMeta}>
        {/* The register's SIZE is inventory, not a denominator — it says how much is in here, and the
            marked count beside it says what they did. Neither is a fraction of the other. */}
        <span className={adaptive.regOf}>
          {stats.marked > 0
            ? `${stats.marked.toLocaleString()} marked · ${register.count.toLocaleString()} names`
            : `${register.count.toLocaleString()} names, none marked yet`}
        </span>
      </span>
      {stats.marked > 0 ? (
        <span className={adaptive.regCounts}>
          <CountChip kind="love" n={stats.love} label="you love" />
          <CountChip kind="okay" n={stats.okay} label="okay with" />
          <CountChip kind="never" n={stats.never} label="not for you" />
        </span>
      ) : null}
    </button>
  );
}

export function NamesPhase({
  rail,
  headingRef,
  onGoToRegister,
}: {
  /**
   * The shared step rail (74 §3.6.9), owned by the take so every step shows the SAME one. This phase used to
   * render its own, which meant a person's sense of "where am I" changed between two screens of one test.
   */
  rail: JSX.Element;
  /** 74 §3.6.34 — focus lands here on a register change, exactly as it does on an area change. */
  headingRef: React.RefObject<HTMLDivElement>;
  /** Move register-to-register without going back to the grid — the words step's Previous/Next area. */
  onGoToRegister: (index: number) => void;
}): JSX.Element | null {
  const store = useAdaptiveTestStore();
  const names = store.names;
  const openId = store.openRegister;
  const [sort, setSort] = useState<RegisterSort>('state');
  /* 74 §3.6.34 — the same "still unmarked" the words step has, in the same place, in the same words. */
  const [showOnly, setShowOnly] = useState<MarkFilterValue>('all');

  const open = useMemo(
    () => names?.registers.find((register) => register.id === openId) ?? null,
    [names, openId],
  );
  useEffect(() => {
    setShowOnly('all');
  }, [openId]);
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
  const openIndex = names.registers.findIndex((register) => register.id === open?.id);
  const visibleRows =
    showOnly === 'all'
      ? rows
      : rows.filter((entry) => isStillUnmarked(entry.sides, store.nameMarks[entry.key]));
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
            Whether you like being called it, and whether you like calling {them} it. Open the ones
            that mean something; the rest stay unasked.
          </Text>
          {/*
            74 §3.6.29 — say it plainly, because the shape of this is not obvious and the old card design
            implied the opposite. There are ~2,400 lines across the whole test; nobody marks them all, the
            bank keeps growing, and there is no finishing it. Every mark makes the read sharper, and that is
            the whole contract — so the cards count UP and never show a fraction of a whole.
          */}
          <Text size="sm" tone="tertiary" className={adaptive.areaNote}>
            There is no finishing this — it is a bank you dip into, and it grows. Mark what you have
            an opinion about; the more you mark, the sharper the read.
          </Text>
        </div>
        <div className={adaptive.deckBody}>
          <div>
            <Text size="sm" tone="tertiary" className={adaptive.regSummary}>
              {/* 74 §3.6.29 — counts, never a fraction. "0 of 21 registers started" is the same denominator
                  shape just removed from the cards: it implies 21 is a number you are meant to reach. */}
              {names.entries.length.toLocaleString()} names across {names.registers.length}{' '}
              registers
              {started > 0 ? ` · ${started} started` : ''}
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
          {/* Focus target for a register change (see `goToRegister`) — the words step's `areaHeadingRef`. */}
          <div ref={headingRef} tabIndex={-1} className={adaptive.deckHeadTitle}>
            <Heading level={2}>{open.label.replace(/^Names — /, '')}</Heading>
          </div>
          <Text size="sm" tone="tertiary">
            Register {openIndex + 1} of {names.registers.length} · {markedHere} marked ·{' '}
            {open.count} names
          </Text>
          <span className={adaptive.headSpacer} />
          {/*
           * 74 §3.6.34 — go straight to a register, the way the words step has gone straight to an area
           * since §3.6.22. A full-width `Select`, not a row of chips: nine labels of any length would wrap
           * into a pile or scroll sideways, and §12 says a control that does not fit gets a space-filling
           * component rather than a wrap.
           */}
          <Select
            aria-label="Go to a register"
            className={adaptive.areaJump}
            value={String(openIndex)}
            onChange={(event) => onGoToRegister(Number(event.currentTarget.value))}
          >
            {names.registers.map((register, index) => {
              const marked = stats[register.id]?.marked ?? 0;
              return (
                <option key={register.id} value={index}>
                  {index + 1}. {register.label.replace(/^Names — /, '')}
                  {marked > 0 ? ` · ${marked} marked` : ''}
                </option>
              );
            })}
          </Select>
        </div>
        {open.note ? (
          <Text tone="secondary" className={adaptive.areaNote}>
            {open.note}
          </Text>
        ) : null}
      </div>
      <div className={adaptive.deckBody}>
        <div className={adaptive.rows}>
          <MarkFilter
            value={showOnly}
            onChange={setShowOnly}
            total={rows.length}
            shown={visibleRows.length}
            noun="names"
          />
          {visibleRows.length === 0 ? (
            <Text tone="secondary">
              Every name in here is marked. Switch to <b>Everything</b> to change one.
            </Text>
          ) : null}
          {visibleRows.map((entry, index) => (
            <NameRow
              key={entry.key}
              entry={entry}
              me={me}
              them={them}
              /** A tier line whenever the intensity steps up — a signpost, never a gate. */
              tierBreak={index === 0 || visibleRows[index - 1]?.tier !== entry.tier}
              mark={store.nameMarks[entry.key] ?? {}}
              onMark={(side, value) => store.markName(entry.key, side, value)}
            />
          ))}
        </div>
        {/* 74 §3.6.34 — the register's verbs live in the SHARED rail now (Next register / Previous
            register / All registers), which is where the words step has always kept its area verbs. The
            separate card above the rail was the last thing making these two screens different shapes. */}
        {rail}
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
