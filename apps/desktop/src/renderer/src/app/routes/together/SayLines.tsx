import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, Copy, Sparkles } from 'lucide-react';
import type { SayLinesPhase } from '@shared/schemas';
import {
  AdminOnlyBadge,
  Banner,
  Button,
  Heading,
  Inline,
  Stack,
  Text,
  Textarea,
} from '../../../design-system/components';
import { useSayLinesStore } from '../../../stores/sayLinesStore';
import { useSessionStore } from '../../../stores/sessionStore';
import styles from './Together.module.css';

/**
 * 75 — "Say something to `<name>`", on the Together → Desire tab.
 *
 * A front door for something the app already does silently: 74 §5.8's `buildPartnerSteer` has always fed a
 * partner's loved language into the other partner's coach prompt. This makes it askable, briefable, and
 * scannable — at exactly the same exposure level (75 §8.1): **lines only**. Never "they like X", never a
 * list of their marks, never a source. Their own phrases may appear INSIDE a line, which is what the silent
 * steer already does and what 74 §8.4 records as a knowing override.
 *
 * The gates are the bridge's (`together.own` + a live partner edge + both 18+ acks, re-checked per call);
 * this component renders what it is handed. Its view carries no marks at all — only whether there is
 * anything to draw on, which is why {@link Empty} cannot leak whether a gate failed or nothing is marked.
 */

/** 75 §3.1 — shortcuts that FILL the brief box, not a taxonomy that replaces it. */
const CHIPS = [
  'Tonight',
  'Right now',
  'About last night',
  'Out of nowhere',
  'Build it up slowly',
] as const;

/** Honest enough that the wait reads as bounded rather than open-ended. One model call, ~1200 tokens. */
const ETA_SEC = 16;

const PHASE_LABEL: Record<Exclude<SayLinesPhase, 'done' | 'error'>, string> = {
  gathering: 'finding their register…',
  writing: 'writing…',
};

export function SayLines({
  partnerId,
  partnerName,
}: {
  partnerId: string;
  partnerName: string;
}): JSX.Element | null {
  const navigate = useNavigate();
  const store = useSayLinesStore();
  const { load, generate } = store;
  // The pre-generation cost HINT needs an explicit check; the cost we actually show afterwards is
  // admin-only by construction (the bridge redacts `costUsd`), so that one needs none.
  const isAdmin = useSessionStore((s) => s.can('budgets.manage'));
  const [brief, setBrief] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const briefRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    void load(partnerId);
  }, [load, partnerId]);

  const prefilled = useRef<string | null>(null);
  /*
   * A brief is about ONE partner, in their own words about their own wanting. The component stays mounted
   * across a partner switch (the picker only changes the prop), so without this the text typed for one
   * partner would sit in the box under another partner's name.
   */
  useEffect(() => {
    setBrief('');
    setCopied(null);
    prefilled.current = null;
  }, [partnerId]);

  // Then refill from what they last asked THIS partner (§11.1-10) — once per partner, and never over
  // something they have started typing, so a slow load can't wipe a brief mid-sentence.
  useEffect(() => {
    if (prefilled.current === partnerId) return;
    if (!store.loaded || store.partnerId !== partnerId) return;
    prefilled.current = partnerId;
    setBrief((current) => (current === '' ? (store.view?.lastBrief ?? '') : current));
  }, [partnerId, store.loaded, store.partnerId, store.view?.lastBrief]);

  const view = store.partnerId === partnerId ? store.view : null;
  const kept = useMemo(() => view?.kept ?? [], [view]);
  const lines = store.partnerId === partnerId ? store.lines : [];

  const addChip = useCallback((chip: string): void => {
    // FILL, don't replace (§3.1) — a chip is a shortcut into their own words, not a category that eats them.
    setBrief((current) => (current.trim() === '' ? chip : `${current.trim()} · ${chip}`));
    briefRef.current?.focus();
  }, []);

  const run = useCallback(
    (nextBrief: string): void => {
      setBrief(nextBrief);
      void generate({ partnerId, brief: nextBrief });
    },
    [generate, partnerId],
  );

  const copy = async (text: string): Promise<void> => {
    await navigator.clipboard?.writeText(text);
    setCopied(text);
    window.setTimeout(() => setCopied((c) => (c === text ? null : c)), 1500);
  };

  /*
   * Tri-state on purpose: `null` is "not known for THIS partner yet". Rendering the generator while the
   * state is still loading briefly offers a live "Write me some lines" button to a partner there is nothing
   * to write from — one click that can only fail, and a jump to the empty state right after it.
   */
  const ready = store.loaded && store.partnerId === partnerId ? view?.ready === true : null;

  return (
    <section className={styles.sayCard} aria-labelledby="sayLinesHead">
      <div className={styles.sayHead}>
        <Heading level={3} id="sayLinesHead">
          Say something to {partnerName}
        </Heading>
        <span className={styles.sayAdultBadge}>18+</span>
      </div>
      <Text tone="secondary" size="sm">
        Ideas written to land for them, in the register they respond to.
      </Text>

      {ready === null ? null : ready === false ? (
        <Empty partnerName={partnerName} onOpenTake={() => navigate('/tests/dirty-talk/take')} />
      ) : (
        <Stack gap={3}>
          <Stack gap={2}>
            <label className={styles.sayLabel} htmlFor="sayBrief">
              Anything particular? — optional
            </label>
            <Textarea
              id="sayBrief"
              ref={briefRef}
              rows={2}
              value={brief}
              maxLength={400}
              placeholder="e.g. wanting them tonight, or something about last night"
              onChange={(e) => setBrief(e.target.value)}
            />
            <div className={styles.sayChips}>
              {CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className={styles.sayChip}
                  onClick={() => addChip(chip)}
                >
                  {chip}
                </button>
              ))}
            </div>
          </Stack>

          <Inline gap={2} align="center" wrap>
            {/*
             * ONE control, whose label carries the state. The mockup drew "Write me some lines" and
             * "Write more" side by side, but generation ALWAYS appends (§3.1 — a shown set is never
             * silently discarded), so a second button would run the identical operation under a different
             * name: the §7 redundant-control failure. Both of the spec's labels survive; only the
             * duplication is gone.
             */}
            <Button variant="primary" disabled={store.busy} onClick={() => run(brief)}>
              {lines.length > 0 ? 'Write more' : 'Write me some lines'}
            </Button>
            {store.costUsd !== null ? (
              <Text tone="secondary" size="sm">
                <AdminOnlyBadge /> ~${store.costUsd.toFixed(3)} so far
              </Text>
            ) : isAdmin ? (
              <Text tone="secondary" size="sm">
                <AdminOnlyBadge /> ~$0.01
              </Text>
            ) : null}
          </Inline>

          {store.busy ? <SayProgress partnerId={partnerId} partnerName={partnerName} /> : null}
          {store.error ? <Banner tone="warning">{store.error}</Banner> : null}

          {lines.length > 0 ? (
            <div className={styles.sayLines}>
              {lines.map((line) => (
                <LineRow
                  key={line}
                  text={line}
                  copied={copied === line}
                  onCopy={() => void copy(line)}
                  starred={kept.some((k) => k.text === line)}
                  busy={store.pending === line}
                  onStar={() => void store.star({ partnerId, text: line, brief })}
                  onMore={() =>
                    run(
                      // Appends rather than replaces, so what was asked stays visible + editable — and what
                      // is remembered as `lastBrief` is still a sentence they can read back (§11.1-10).
                      `${brief.trim() ? `${brief.trim()}\n\n` : ''}More like this: "${line}"`,
                    )
                  }
                />
              ))}
            </div>
          ) : null}
        </Stack>
      )}

      {/*
       * OUTSIDE the ready branch on purpose. A kept line is the person's OWN saved content and §8.3 is
       * explicit that it survives the partner clearing their lexicon — which is precisely the case that
       * turns `ready` false. Hiding the list behind the empty state would make the screen say the saved
       * lines are gone while they sit safe on disk.
       */}
      {kept.length > 0 ? (
        <div className={styles.sayKept}>
          <div className={styles.sayKeptHead}>
            Kept lines <span className={styles.sayCount}>{kept.length}</span>
          </div>
          <div className={styles.sayLines}>
            {kept.map((k) => (
              <LineRow
                key={k.id}
                text={k.text}
                copied={copied === k.text}
                onCopy={() => void copy(k.text)}
                starred
                busy={store.pending === k.id}
                onStar={() => void store.unstar({ partnerId, id: k.id })}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/*
       * Load-bearing (§3.1). It is honest to the reader about where the material comes from, and it states
       * the boundary the whole feature is built to hold — including the part they might otherwise assume the
       * other way round.
       */}
      <p className={styles.sayFoot}>
        {ready === false
          ? `Ideas appear here as soon as ${partnerName} has marked a few things. Nothing you do here is shown to them.`
          : `Written from what ${partnerName} has marked. It never names a source, and they are never told you used this.`}
      </p>
    </section>
  );
}

/**
 * 75 §3.4 / §7.1 — the common case today, and a first-class state rather than an absence.
 *
 * It is deliberately the SAME state for "they have marked nothing" and "you are not entitled to read this"
 * (§5.1): the view carries only `ready`, so this cannot be used to work out which. One link, to the take, so
 * you can show them what it asks — no nudge, no notification, no outbound message (§11.1-7).
 */
function Empty({
  partnerName,
  onOpenTake,
}: {
  partnerName: string;
  onOpenTake: () => void;
}): JSX.Element {
  return (
    <div className={styles.sayEmpty}>
      <h4 className={styles.sayEmptyHead}>{partnerName} hasn’t marked anything yet</h4>
      <Text tone="secondary" size="sm">
        This writes from what they’ve marked in the Dirty Talk bank — what they like hearing, and
        the register that lands. They haven’t marked any of it, so there’s nothing here to write
        from yet.
      </Text>
      <Button variant="secondary" onClick={onOpenTake}>
        See what it asks
      </Button>
    </div>
  );
}

/**
 * 75 §3.5 — realtime progress: a live phase, an elapsed timer, an ETA. A bare spinner is unacceptable for
 * any AI generation (CLAUDE.md §12). The two phases are the two real waits: reading what lands for them,
 * then the model writing.
 */
function SayProgress({
  partnerId,
  partnerName,
}: {
  partnerId: string;
  partnerName: string;
}): JSX.Element {
  const [phase, setPhase] = useState<Exclude<SayLinesPhase, 'done' | 'error'>>('gathering');
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    setPhase('gathering');
    setElapsed(0);
    const off = window.selfos?.onSayLinesProgress((p) => {
      // Only this surface's generation; the terminal phases are the caller's (we unmount on completion).
      if (p.id !== `sayLines:${partnerId}` || p.phase === 'done' || p.phase === 'error') return;
      setPhase(p.phase);
    });
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      500,
    );
    return () => {
      off?.();
      window.clearInterval(timer);
    };
  }, [partnerId]);

  const remaining = ETA_SEC - elapsed;
  const eta = remaining > 3 ? `about ${remaining}s left` : 'almost there…';

  return (
    <div className={styles.sayProgress} role="status" aria-live="polite">
      <div className={styles.sayProgressTop}>
        <Text size="sm" tone="secondary">
          Writing lines for {partnerName} — {PHASE_LABEL[phase]}
        </Text>
        <Text size="sm" tone="secondary">
          {elapsed}s elapsed · {eta}
        </Text>
      </div>
      <div
        className={styles.sayProgressTrack}
        role="progressbar"
        aria-label={`Writing lines — ${PHASE_LABEL[phase]} ${elapsed} seconds elapsed`}
      >
        <span />
      </div>
    </div>
  );
}

/** One line. The line IS the content here (§9) — below the small stop the tools drop under it. */
function LineRow({
  text,
  starred,
  busy,
  copied,
  onStar,
  onCopy,
  onMore,
}: {
  text: string;
  starred: boolean;
  busy: boolean;
  copied: boolean;
  onStar: () => void;
  onCopy: () => void;
  onMore?: () => void;
}): JSX.Element {
  return (
    <div className={styles.sayLine}>
      <p className={styles.sayLineText}>{text}</p>
      <span className={styles.sayTools}>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          aria-pressed={starred}
          aria-label={starred ? `Stop keeping: ${text}` : `Keep this: ${text}`}
          onClick={onStar}
        >
          <Star size={14} aria-hidden="true" />
          {starred ? 'Kept' : 'Keep'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCopy} aria-label={`Copy: ${text}`}>
          <Copy size={14} aria-hidden="true" />
          {copied ? 'Copied' : 'Copy'}
        </Button>
        {onMore ? (
          <Button size="sm" variant="ghost" onClick={onMore} aria-label={`More like: ${text}`}>
            <Sparkles size={14} aria-hidden="true" />
            More like this
          </Button>
        ) : null}
      </span>
    </div>
  );
}
