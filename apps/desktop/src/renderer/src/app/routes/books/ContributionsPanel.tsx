import { useEffect, useMemo, useState } from 'react';
import { Button, Heading, Select, Text, TextInput } from '../../../design-system/components';
import { useContributionStore } from '../../../stores/contributionStore';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useSessionStore } from '../../../stores/sessionStore';
import styles from './Books.module.css';

/**
 * The author's half of household contributions (73 §3.1/§3.4) — who this book is open to, and what they
 * have offered.
 *
 * Two things are deliberately plain here. **Opening a book is per person**: there is no "open to everyone",
 * because nobody should learn a book exists unless the author told them (§8.2). And **accepting is not
 * publishing** — the accepted text becomes material the biographer may draw on, which is why the accept
 * control also asks whether to credit them by name.
 */
export function ContributionsPanel({ bookId }: { bookId: string }): JSX.Element {
  const invites = useContributionStore((s) => s.invites);
  const reviews = useContributionStore((s) => s.reviews);
  const busy = useContributionStore((s) => s.busy);
  const loadForBook = useContributionStore((s) => s.loadForBook);
  const invite = useContributionStore((s) => s.invite);
  const revoke = useContributionStore((s) => s.revoke);
  const decide = useContributionStore((s) => s.decide);
  const household = usePeopleStore((s) => s.people);
  const loadPeople = usePeopleStore((s) => s.load);
  const activePersonId = useSessionStore((s) => s.activePerson?.id);

  const [who, setWho] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    void loadForBook(bookId);
    void loadPeople();
  }, [bookId, loadForBook, loadPeople]);

  const open = useMemo(() => invites.filter((i) => !i.revokedAt), [invites]);
  // Only people who aren't already invited, and never yourself. The bridge refuses anyone unrelated, so a
  // stale list here can't widen anything — this is convenience, not the boundary.
  const candidates = useMemo(
    () =>
      household.filter((p) => p.id !== activePersonId && !open.some((i) => i.personId === p.id)),
    [household, activePersonId, open],
  );
  const nameOf = (id: string): string =>
    household.find((p) => p.id === id)?.displayName ?? 'Someone';

  const pending = reviews.filter((r) => r.status === 'pending');
  const settled = reviews.filter((r) => r.status !== 'pending');

  return (
    <div className={styles.peopleTab}>
      <div className={styles.shelfHead}>
        <div>
          <Heading level={2}>People who can add to this</Heading>
          <Text tone="secondary" size="sm">
            Invite someone who was there. They can offer a memory, a question or something you said
            — you decide what goes in, and they can take theirs back at any time.
          </Text>
        </div>
      </div>

      <div className={styles.contributeInvite}>
        <Select
          aria-label="Who to invite"
          value={who}
          onChange={(e) => setWho(e.target.value)}
          disabled={candidates.length === 0}
        >
          <option value="">
            {candidates.length === 0 ? 'Everyone is already invited' : 'Choose someone…'}
          </option>
          {candidates.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </Select>
        <TextInput
          aria-label="What to ask them about"
          placeholder="Anything you remember about the Denver years?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button
          variant="primary"
          disabled={!who || busy}
          onClick={() => {
            void invite(bookId, who, note).then(() => {
              setWho('');
              setNote('');
            });
          }}
        >
          Invite
        </Button>
      </div>

      {open.length === 0 ? (
        <Text tone="secondary" size="sm">
          This book isn’t open to anyone yet. Nobody can see that it exists.
        </Text>
      ) : (
        <div className={styles.peopleList}>
          {open.map((i) => {
            const theirs = reviews.filter((r) => r.contributorId === i.personId);
            return (
              <div key={i.personId} className={styles.peopleRow}>
                <span className={styles.peopleWho}>
                  <span className={styles.peopleName}>{nameOf(i.personId)}</span>
                  <span className={styles.peopleMeta}>
                    {theirs.length === 0
                      ? 'invited · nothing offered yet'
                      : theirs.length === 1
                        ? '1 offering'
                        : `${theirs.length} offerings`}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void revoke(bookId, i.personId)}
                >
                  Close it to them
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {pending.length > 0 ? (
        <div className={styles.contributeReview}>
          <Heading level={3}>Waiting for you</Heading>
          {pending.map((c) => (
            <div key={c.id} className={styles.needCard}>
              <span className={styles.needKind}>{KIND_LABEL[c.kind]}</span>
              <Text size="sm" className={styles.needTitle}>
                {c.contributorName}
              </Text>
              <Text size="sm">{c.text}</Text>
              <div className={styles.contributeActions}>
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => void decide(bookId, c.id, 'accepted', true)}
                >
                  Accept, credit {c.contributorName}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => void decide(bookId, c.id, 'accepted', false)}
                >
                  Accept without naming them
                </Button>
                <button
                  type="button"
                  className={styles.sourcesToggle}
                  disabled={busy}
                  aria-label={`Decline what ${c.contributorName} offered`}
                  onClick={() => void decide(bookId, c.id, 'declined')}
                >
                  Not this one
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {settled.length > 0 ? (
        <div className={styles.contributeReview}>
          <Heading level={3}>Already decided</Heading>
          {settled.map((c) => (
            <div key={c.id} className={styles.peopleRow}>
              <span className={styles.peopleWho}>
                <span className={styles.peopleName}>{c.text}</span>
                <span className={styles.peopleMeta}>
                  {c.contributorName} ·{' '}
                  {c.status === 'accepted'
                    ? c.attributed === false
                      ? 'accepted, not named'
                      : 'accepted'
                    : 'declined'}
                </span>
              </span>
              {c.status === 'accepted' ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void decide(bookId, c.id, 'declined')}
                >
                  Take it back out
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void decide(bookId, c.id, 'accepted', true)}
                >
                  Accept after all
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  memory: 'A memory',
  question: 'A question for you',
  correction: 'A correction',
  quote: 'Something you said',
};
