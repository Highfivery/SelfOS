import { useEffect, useState } from 'react';
import { Heading, Text, TextInput } from '../../../design-system/components';
import { useStoryStore } from '../../../stores/storyStore';
import styles from './Books.module.css';

/**
 * People in your book (72 §3.9) — everyone the book names, how often, and what they're called in it.
 *
 * The count shown is **chapter** mentions, not corpus mentions. Since 72 §5.2 the corpus carries whole
 * session transcripts, so someone mentioned once in passing has corpus mentions while the book never names
 * them; "named in 8 chapters" is the thing a person can actually check.
 *
 * A different name substitutes everywhere the book is read, shared or exported — the draft keeps the real
 * one. That is the only control here. The four consent states this replaced were manual bookkeeping with no
 * enforcement: nothing was ever sent to anyone, nothing was blocked, and an author's private note about
 * whether they'd asked their mother is not something the app should be asking them to maintain in a form.
 */
export function PeopleTab({ bookId }: { bookId: string }): JSX.Element {
  const people = useStoryStore((s) => s.consent);
  const loadConsent = useStoryStore((s) => s.loadConsent);
  const setConsent = useStoryStore((s) => s.setConsent);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    void loadConsent(bookId);
  }, [bookId, loadConsent]);

  // Everyone the register knows, not only those already named in written prose. The Sharing tab warns
  // about anyone who'd appear under their real name, and filtering here would warn about someone this
  // screen doesn't list — a warning with nothing to act on.
  const named = people;

  return (
    <div className={styles.peopleTab}>
      <div className={styles.shelfHead}>
        <div>
          <Heading level={2}>People in your book</Heading>
          <Text tone="secondary" size="sm">
            Everyone this book names, and how often. Give anyone a different name and it replaces
            theirs everywhere the book is read, shared or exported — your draft keeps the real one.
          </Text>
        </div>
        {named.length > 0 ? (
          <Text tone="tertiary" size="sm">
            {named.length === 1 ? '1 person named' : `${named.length} people named`}
          </Text>
        ) : null}
      </div>

      {named.length === 0 ? (
        <Text tone="secondary" size="sm">
          Nobody is named in the book yet. People appear here as chapters are written.
        </Text>
      ) : (
        <div className={styles.peopleList}>
          <div className={styles.peopleHead} aria-hidden="true">
            <span>Person</span>
            <span>Appears in the book as</span>
          </div>
          {named.map((p) => {
            const draft = drafts[p.name] ?? p.pseudonym ?? '';
            return (
              <div key={p.name} className={styles.peopleRow}>
                <span className={styles.peopleWho}>
                  <span className={styles.peopleName}>{p.name}</span>
                  <span className={styles.peopleMeta}>
                    {p.relationship ? `${p.relationship} · ` : ''}
                    {p.chapterMentions === 0
                      ? 'not named in the book yet'
                      : p.chapterMentions === 1
                        ? 'named in 1 chapter'
                        : `named in ${p.chapterMentions} chapters`}
                  </span>
                </span>
                <TextInput
                  aria-label={`What ${p.name} is called in the book`}
                  placeholder="Their own name"
                  value={draft}
                  onChange={(e) => setDrafts((d) => ({ ...d, [p.name]: e.target.value }))}
                  onBlur={() => {
                    const next = draft.trim();
                    if (next === (p.pseudonym ?? '')) return;
                    // The consent value is passed through untouched: it is on its way out (§5.9) and this
                    // surface no longer asks for it, but a write must not silently reset what is stored.
                    void setConsent(bookId, p.name, p.consent, next);
                  }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
