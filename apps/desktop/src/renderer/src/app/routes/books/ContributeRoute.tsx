import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button,
  Card,
  Heading,
  Select,
  Stack,
  Text,
  Textarea,
} from '../../../design-system/components';
import type { ContributionKind } from '@shared/schemas';
import { useContributionStore } from '../../../stores/contributionStore';
import styles from './Books.module.css';

/**
 * Contributing to someone else's book (73 §3.2) — the contributor's whole surface.
 *
 * Deliberately its own small page with no Books chrome: this person is not writing a book, they are adding
 * one thing to someone else's, and dropping them into a Studio would imply an authorship they don't have.
 * They never see the book — only what they were asked and what they've offered (§8.2).
 */
export function ContributeRoute(): JSX.Element {
  const { invitationId = '' } = useParams();
  const navigate = useNavigate();
  const invitations = useContributionStore((s) => s.invitations);
  const mine = useContributionStore((s) => s.mine);
  const busy = useContributionStore((s) => s.busy);
  const loadMine = useContributionStore((s) => s.loadMine);
  const submit = useContributionStore((s) => s.submit);
  const withdraw = useContributionStore((s) => s.withdraw);

  const [loaded, setLoaded] = useState(false);
  const [kind, setKind] = useState<ContributionKind>('memory');
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);

  useEffect(() => {
    void loadMine().finally(() => setLoaded(true));
  }, [loadMine]);

  const invitation = invitations.find((i) => i.id === invitationId);
  // Scoped to THIS book, so someone invited to two books sees the right list on each page.
  const theirs = useMemo(
    () => (invitation ? mine.filter((c) => c.bookId === invitation.bookId) : []),
    [mine, invitation],
  );

  if (!loaded) {
    return (
      <Stack gap={4} className={styles.contributePage}>
        <Text tone="secondary">Opening…</Text>
      </Stack>
    );
  }

  // Revoked, never invited, or the relationship is gone — all one calm state. The bridge refuses a submit
  // regardless of what this screen shows, so there is nothing to be careful about here beyond being kind.
  if (!invitation) {
    return (
      <Stack gap={4} className={styles.contributePage}>
        <Card>
          <Stack gap={3}>
            <Heading level={1}>This isn’t open any more</Heading>
            <Text tone="secondary">
              Whatever you’ve already shared is safe, and you can still take it back from here.
            </Text>
            <Button onClick={() => navigate('/')}>Back to SelfOS</Button>
          </Stack>
        </Card>
        {/* Everything they've offered, not just this book's: with the invitation gone there is no book to
            scope by, and the point of this screen is that taking things back still works. */}
        {mine.length > 0 ? <Offered mine={mine} busy={busy} onWithdraw={withdraw} /> : null}
      </Stack>
    );
  }

  return (
    <Stack gap={4} className={styles.contributePage}>
      <Card>
        <Stack gap={3}>
          <Heading level={1}>{invitation.authorName} asked you to add to their book</Heading>
          {invitation.note ? (
            <Text className={styles.contributeAsk}>“{invitation.note}”</Text>
          ) : null}
          <Text tone="secondary" size="sm">
            {invitation.authorName} decides what goes in, and you can take yours back at any time.
            You won’t see their book — only what you’ve added.
          </Text>

          <Select
            aria-label="What kind of thing this is"
            value={kind}
            onChange={(e) => setKind(e.target.value as ContributionKind)}
          >
            <option value="memory">A memory of them</option>
            <option value="question">Something you think they should be asked</option>
            <option value="quote">Something they said</option>
            {/* Correcting something needs a book you can actually read — the bridge refuses it otherwise. */}
            {invitation.canRead ? <option value="correction">A correction</option> : null}
          </Select>
          <Textarea
            aria-label="What you want to add"
            rows={6}
            placeholder={PLACEHOLDER[kind]}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setSent(false);
            }}
          />
          <Button
            variant="primary"
            disabled={busy || text.trim().length === 0}
            onClick={() => {
              void submit({ invitationId, kind, text: text.trim() }).then((created) => {
                if (!created) return;
                setText('');
                setSent(true);
              });
            }}
          >
            Send it to {invitation.authorName}
          </Button>
          {sent ? (
            <div role="status">
              <Text size="sm" tone="secondary">
                Sent. {invitation.authorName} will see it when they next open their book.
              </Text>
            </div>
          ) : null}
        </Stack>
      </Card>

      {theirs.length > 0 ? <Offered mine={theirs} busy={busy} onWithdraw={withdraw} /> : null}
    </Stack>
  );
}

/** What this person has offered, and where each one stands — never the book behind it. */
function Offered({
  mine,
  busy,
  onWithdraw,
}: {
  mine: { id: string; text: string; status: string }[];
  busy: boolean;
  onWithdraw: (id: string) => void | Promise<void>;
}): JSX.Element {
  // Withdrawn rows are kept out of the live list — they aren't actionable, and a page that only ever grows
  // makes the things you CAN still take back harder to find. They're summarised below instead.
  const live = mine.filter((c) => c.status !== 'withdrawn');
  const withdrawn = mine.length - live.length;
  return (
    <Card>
      <Stack gap={3}>
        <Heading level={2}>What you’ve added</Heading>
        {live.map((c) => (
          <div key={c.id} className={styles.peopleRow}>
            <span className={styles.peopleWho}>
              <span className={styles.peopleName}>{c.text}</span>
              <span className={styles.peopleMeta}>{STATUS_LABEL[c.status] ?? c.status}</span>
            </span>
            {c.status === 'withdrawn' ? null : (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void onWithdraw(c.id)}
              >
                Take it back
              </Button>
            )}
          </div>
        ))}
        {withdrawn > 0 ? (
          <Text size="sm" tone="tertiary">
            {withdrawn === 1 ? 'You took one thing back.' : `You took ${withdrawn} things back.`}
          </Text>
        ) : null}
        <Text size="sm" tone="tertiary">
          Taking something back removes it from what their book draws on. Writing they’ve already
          done isn’t rewritten.
        </Text>
      </Stack>
    </Card>
  );
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'waiting for them to read it',
  accepted: 'they kept it',
  declined: 'they didn’t use this one',
  withdrawn: 'you took this back',
};

const PLACEHOLDER: Record<ContributionKind, string> = {
  memory: 'He rebuilt the porch that whole summer, alone, and never once said he was tired…',
  question: 'Ask him why he really left that job in 1998.',
  quote: '“You don’t get to be tired until it’s finished.”',
  correction: 'That was 1994, not 1995 — it was the year before the move.',
};
