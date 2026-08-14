import {
  Banner,
  Button,
  Card,
  Heading,
  Inline,
  Stack,
  Text,
} from '../../../design-system/components';
import { useStoryStore } from '../../../stores/storyStore';
import { MemoryCollection } from './MemoryCollection';
import { ShareMemoryPanel } from './ShareMemoryPanel';
import styles from './Story.module.css';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { StoryCompleteness } from '@shared/schemas';
import { LifeMap } from './LifeMap';
import { COMPLETENESS_STAGE } from './SharedWithYou';

/**
 * The open conversation starters (72 §3.7) — a person, a place, a year, a photograph, something hard.
 * They seed the biographer with a direction and nothing more; there is no gap attached and nothing is
 * being closed. The point is that you can tell it something it never thought to ask about.
 */
export const OPEN_STARTERS: { label: string; focus: string }[] = [
  {
    label: 'Someone',
    focus:
      'They want to tell you about a particular person in their life. Ask who, and go to a scene.',
  },
  {
    label: 'A place',
    focus:
      'They want to tell you about a place that matters to them. Ask which, and get the senses of it.',
  },
  {
    label: 'A year',
    focus:
      'They want to tell you about a particular year or period. Ask which, and find the moment in it.',
  },
  {
    label: 'Something hard',
    focus:
      'They want to tell you about something difficult. Go gently, let them set the pace, and do not push for more than they offer.',
  },
  {
    label: 'Something good',
    focus:
      'They want to tell you about something that went well or made them happy. Get the scene of it.',
  },
];
/**
 * The Interview tab (§13.4/§13.6) — the completeness stage + the life map + the biographer's gap invitations
 * ("Ask me about this"), the open check-in, and the answered history. The gaps + coverage render FREE (no AI);
 * "Find what's missing" runs the metered pass.
 */
export function InterviewTab({
  bookId,
  parts,
  completeness,
  busy,
  onFind,
}: {
  bookId: string;
  parts: { id: string; title: string }[];
  completeness: StoryCompleteness | null;
  busy: boolean;
  onFind: () => Promise<string>;
}): JSX.Element {
  const gaps = useStoryStore((s) => s.gaps);
  const loadGaps = useStoryStore((s) => s.loadGaps);
  const askGap = useStoryStore((s) => s.askGap);
  const answered = useStoryStore((s) => s.answeredCheckIns);
  const loadAnswered = useStoryStore((s) => s.loadAnsweredCheckIns);
  const quotes = useStoryStore((s) => s.quotes);
  const loadQuotes = useStoryStore((s) => s.loadQuotes);
  const mineQuotes = useStoryStore((s) => s.mineQuotes);
  const setQuoteStatus = useStoryStore((s) => s.setQuoteStatus);
  const [mining, setMining] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const navigate = useNavigate();

  // "Share a memory" (§14) — an inline biographer chat that swaps the tab body. Driven by the invite card, a
  // gap's "Talk it through", the collection, and the `/story/interview?memory=<id>` deep-link. The collection
  // itself is the shared `MemoryCollection` (§15.1), which owns its own load + delete.
  const [panel, setPanel] = useState<{
    memoryId?: string;
    seedFocus?: string;
    gapId?: string;
  } | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    void loadGaps(bookId);
    void loadAnswered(bookId);
    void loadQuotes(bookId);
  }, [bookId, loadGaps, loadAnswered, loadQuotes]);

  // Deep-link: `?memory=<id>` opens that memory; `?seed=<focus>` starts a new seeded one (the photo entry). The
  // param is consumed once (cleared) so closing the panel doesn't reopen it.
  const memoryParam = searchParams.get('memory');
  const seedParam = searchParams.get('seed');
  useEffect(() => {
    if (memoryParam) {
      setPanel({ memoryId: memoryParam });
      setSearchParams({}, { replace: true });
    } else if (seedParam) {
      setPanel({ seedFocus: seedParam });
      setSearchParams({}, { replace: true });
    }
  }, [memoryParam, seedParam, setSearchParams]);

  // Closing the panel remounts the collection, which reloads itself — so a just-saved memory joins it.
  // Coming back from a conversation, RELOAD (72 §5.5): saving a memory can have closed a gap, and the row
  // would otherwise still read "Ask me about this" for something just answered — the same
  // filed-but-invisible failure the drift proposals had.
  const closePanel = (): void => {
    setPanel(null);
    void loadGaps(bookId);
    void loadAnswered(bookId);
  };

  const hasOpenCheckin = gaps?.hasOpenCheckin ?? false;

  if (panel) {
    return (
      <ShareMemoryPanel
        key={panel.memoryId ?? panel.gapId ?? panel.seedFocus ?? 'new'}
        {...(panel.memoryId ? { memoryId: panel.memoryId } : {})}
        {...(panel.seedFocus ? { seedFocus: panel.seedFocus } : {})}
        {...(panel.gapId ? { gapId: panel.gapId } : {})}
        bookId={bookId}
        onBack={closePanel}
      />
    );
  }

  return (
    <Stack gap={3}>
      <Card>
        <Stack gap={2}>
          <Heading level={2}>Share a memory</Heading>
          <Text tone="secondary" size="sm">
            Tell your biographer about a moment — a place, a person, a turning point — and it will
            ask, listen, and write it into your story in your own words.
          </Text>
          {/* "Talk about anything" (72 §3.7) — the entry that didn't exist. Every way in was tied to a gap
              the biographer had chosen, so there was no way to simply tell it something. */}
          <div className={styles.openStarters} role="group" aria-label="Talk about anything">
            {OPEN_STARTERS.map((starter) => (
              <button
                key={starter.label}
                type="button"
                className={styles.openStarter}
                onClick={() => setPanel({ seedFocus: starter.focus })}
              >
                {starter.label}
              </button>
            ))}
          </div>
          <div className={styles.memInvite}>
            <Button variant="primary" onClick={() => setPanel({})}>
              Share a memory
            </Button>
            {/* Memories are person-level and outlive any book (§15.1) — the standalone route is their home. */}
            <Button variant="ghost" onClick={() => navigate('/story/memories')}>
              See all memories →
            </Button>
          </div>
        </Stack>
      </Card>

      <Card>
        <Stack gap={3}>
          <Heading level={2}>What’s missing</Heading>
          {completeness ? (
            <Text tone="secondary" size="sm">
              Your story is <strong>{COMPLETENESS_STAGE[completeness.stage].toLowerCase()}</strong>.
              Your biographer looks for the thin eras and the scenes it hasn’t heard, and can send
              you a few questions to fill them.
            </Text>
          ) : (
            <Text tone="secondary" size="sm">
              Your biographer can look for the gaps in your story and send you a few questions to
              fill them.
            </Text>
          )}
          <LifeMap parts={parts} coverage={gaps?.partCoverage ?? []} />
          {notice ? <Banner tone="info">{notice}</Banner> : null}
          <Inline>
            {/* Single-flight EVERY mint affordance (§13.6.5): while any find/ask is in flight, disable the rest,
                or a fast second click could mint a second open check-in before the ≤1 flag catches up. */}
            <Button
              variant="primary"
              disabled={busy || asking !== null}
              onClick={async () => setNotice(await onFind())}
            >
              {busy ? 'Looking…' : 'Find what’s missing'}
            </Button>
          </Inline>
        </Stack>
      </Card>

      {gaps && gaps.gaps.length > 0 ? (
        <Card>
          <Stack gap={3}>
            <Heading level={3}>Worth telling next</Heading>
            {hasOpenCheckin ? (
              <Banner tone="info">
                A check-in from your biographer is already open — answer it before asking for more.
              </Banner>
            ) : null}
            <Stack gap={2}>
              {gaps.gaps.map((gap) => (
                <div key={gap.id} className={styles.gapRow}>
                  <div className={styles.gapText}>
                    <Text size="sm" weight={500}>
                      {gap.label}
                    </Text>
                    <Text size="sm" tone="tertiary">
                      {gap.focus}
                    </Text>
                  </div>
                  {/* Lifecycle-aware (§3.7): an answered gap shows "Answered ✓" (never re-offers an identical
                      re-ask that contradicts the "Answered" card below); a gap whose check-in is waiting shows
                      that; only an open gap offers "Ask me about this". */}
                  <Inline gap={2}>
                    {/* Talk it through: open the biographer chat seeded with this gap — a live alternative to
                        (or a companion of) sending questions to the Inbox. */}
                    {/* Talking it through closes the gap exactly as answering a check-in does (72 §5.5) —
                        it used to leave it open and re-proposable. */}
                    <Button
                      variant="ghost"
                      onClick={() => setPanel({ seedFocus: gap.focus, gapId: gap.id })}
                    >
                      Talk it through
                    </Button>
                    {gap.status === 'answered' ? (
                      <Text size="sm" tone="tertiary">
                        Answered <span aria-hidden="true">✓</span>
                      </Text>
                    ) : gap.status === 'asked' ? (
                      <Text size="sm" tone="tertiary">
                        Waiting in your Inbox
                      </Text>
                    ) : (
                      <Button
                        disabled={hasOpenCheckin || busy || asking !== null}
                        onClick={async () => {
                          setAsking(gap.id);
                          setNotice(null);
                          const res = await askGap(bookId, gap.id);
                          setAsking(null);
                          setNotice(
                            res.ok
                              ? 'Your biographer sent a few questions to your Inbox.'
                              : res.message,
                          );
                        }}
                      >
                        {asking === gap.id ? 'Asking…' : 'Ask me about this'}
                      </Button>
                    )}
                  </Inline>
                </div>
              ))}
            </Stack>
          </Stack>
        </Card>
      ) : null}

      {answered.length > 0 ? (
        <Card>
          <Stack gap={2}>
            <Heading level={3}>Answered</Heading>
            <Text tone="tertiary" size="sm">
              The biographer questions you’ve answered — your biographer folds them into your story
              as it writes.
            </Text>
            <Stack gap={1}>
              {answered.map((c) => (
                <div key={c.assignmentId} className={styles.markRow}>
                  <Text size="sm">{c.title}</Text>
                  <Text size="sm" tone="tertiary">
                    {c.wroteIntoChapterTitle
                      ? `wove into “${c.wroteIntoChapterTitle}”`
                      : new Date(c.answeredAt).toLocaleDateString()}
                  </Text>
                </div>
              ))}
            </Stack>
          </Stack>
        </Card>
      ) : null}

      {/* The two memory sections (§14.2), shared verbatim with the book-independent `/story/memories`
          route (§15.1) so they can never drift. */}
      <MemoryCollection onOpen={(memoryId) => setPanel({ memoryId })} />

      {/* In your own words (§17.4) — mine verbatim lines the person said, approve each before it can be
          cited. A pending/rejected candidate never reaches a chapter or an export. */}
      <Card>
        <Stack gap={3}>
          <Heading level={2}>In your own words</Heading>
          <Text tone="secondary" size="sm">
            Your biographer can gather striking lines you actually said — in your coaching sessions
            and with your partner — so your book can quote you word-for-word. Nothing is used until
            you approve it.
          </Text>
          <Inline>
            <Button
              variant="secondary"
              disabled={mining}
              onClick={async () => {
                setMining(true);
                try {
                  await mineQuotes(bookId);
                } finally {
                  setMining(false);
                }
              }}
            >
              {mining ? 'Looking…' : 'Find lines I said'}
            </Button>
          </Inline>
          {(() => {
            const pending = quotes.filter((q) => q.status === 'pending');
            const approved = quotes.filter((q) => q.status === 'approved');
            return (
              <Stack gap={3}>
                {pending.length > 0 ? (
                  <Stack gap={2}>
                    <Text size="sm" className={styles.rowTitle}>
                      To review ({pending.length})
                    </Text>
                    {pending.map((q) => (
                      <div key={q.id} className={styles.quoteRow}>
                        <Text size="sm" className={styles.quoteText}>
                          “{q.text}”
                        </Text>
                        <Inline gap={1}>
                          <Button
                            variant="ghost"
                            onClick={() => void setQuoteStatus(bookId, q.id, 'approved')}
                          >
                            Use it
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => void setQuoteStatus(bookId, q.id, 'rejected')}
                          >
                            Skip
                          </Button>
                        </Inline>
                      </div>
                    ))}
                  </Stack>
                ) : null}
                {approved.length > 0 ? (
                  <Stack gap={2}>
                    <Text size="sm" className={styles.rowTitle}>
                      Your book can quote these ({approved.length})
                    </Text>
                    {approved.map((q) => (
                      <div key={q.id} className={styles.quoteRow}>
                        <Text size="sm" className={styles.quoteText}>
                          “{q.text}”
                        </Text>
                        <Button
                          variant="ghost"
                          onClick={() => void setQuoteStatus(bookId, q.id, 'rejected')}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </Stack>
                ) : null}
                {quotes.length === 0 && !mining ? (
                  <Text tone="tertiary" size="sm">
                    No lines gathered yet. Once you’ve had a few sessions, “Find lines I said” will
                    surface the vivid ones to approve.
                  </Text>
                ) : null}
              </Stack>
            );
          })()}
        </Stack>
      </Card>

      <Text tone="tertiary" size="sm">
        Questions arrive in your Inbox under “Your biographer”. Your answers feed the book as it
        keeps writing.
      </Text>
    </Stack>
  );
}
