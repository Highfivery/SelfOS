import { useEffect, useState } from 'react';
import { Button, Heading, Text, TextInput, Textarea } from '../../../design-system/components';
import { ContributionsPanel } from './ContributionsPanel';
import { usePeopleStore } from '../../../stores/peopleStore';
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
 * one. The four consent states this replaced were manual bookkeeping with no enforcement: nothing was ever
 * sent to anyone, nothing was blocked, and an author's private note about whether they'd asked their mother
 * is not something the app should be asking them to maintain in a form.
 *
 * For a picture book (`castPolicy: 'childrenAsHeroes'`) each person also gets a **character sheet** (§4.8) —
 * how they look, so the hero has the same face on every page. That field is offered ONLY here, because it is
 * the only kind of book whose images may depict a real person (§8.5); on any other type a sheet would be
 * stored and never used, which is worse than not offering it.
 */
export function PeopleTab({
  bookId,
  castPolicy,
}: {
  bookId: string;
  castPolicy: 'realNames' | 'renamed' | 'childrenAsHeroes';
}): JSX.Element {
  const people = useStoryStore((s) => s.consent);
  const loadConsent = useStoryStore((s) => s.loadConsent);
  const setConsent = useStoryStore((s) => s.setConsent);
  const household = usePeopleStore((s) => s.people);
  const loadPeople = usePeopleStore((s) => s.load);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sheetDrafts, setSheetDrafts] = useState<Record<string, string>>({});
  const [editingSheet, setEditingSheet] = useState<string | null>(null);

  const sheets = castPolicy === 'childrenAsHeroes';

  useEffect(() => {
    void loadConsent(bookId);
  }, [bookId, loadConsent]);
  // Only a book that can actually use a sheet needs the household profiles (for the suggestion below).
  useEffect(() => {
    if (sheets) void loadPeople();
  }, [sheets, loadPeople]);

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
            const open = editingSheet === p.name;
            // Suggested from the profile the author already filled in — but never sent on its own. The
            // author has to read it and press save, because saving is what lets it reach an image
            // provider (§8.5).
            const suggestion = p.personId
              ? (household.find((h) => h.id === p.personId)?.appearanceDescription ?? '')
              : '';
            const sheetDraft = sheetDrafts[p.name] ?? p.sheet ?? '';
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
                  {sheets ? (
                    <span className={styles.peopleSheet}>
                      {open ? (
                        <>
                          <Textarea
                            aria-label={`How ${p.name} looks`}
                            rows={3}
                            placeholder="Six years old, dark curls, red wellies, always carrying a toy fox…"
                            value={sheetDraft}
                            onChange={(e) =>
                              setSheetDrafts((d) => ({ ...d, [p.name]: e.target.value }))
                            }
                          />
                          <Text size="sm" tone="secondary">
                            This description is sent to the image service so {p.name} is drawn the
                            same way on every page. It is the only thing here that leaves SelfOS.
                          </Text>
                          <span className={styles.peopleSheetActions}>
                            <Button
                              size="sm"
                              onClick={() => {
                                void setConsent(bookId, p.name, { sheet: sheetDraft.trim() });
                                setEditingSheet(null);
                              }}
                            >
                              Save description
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setSheetDrafts((d) => ({ ...d, [p.name]: p.sheet ?? '' }));
                                setEditingSheet(null);
                              }}
                            >
                              Cancel
                            </Button>
                            {suggestion && sheetDraft.trim() !== suggestion ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  setSheetDrafts((d) => ({ ...d, [p.name]: suggestion }))
                                }
                              >
                                Use their profile description
                              </Button>
                            ) : null}
                          </span>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setSheetDrafts((d) => ({
                              ...d,
                              [p.name]: p.sheet ?? d[p.name] ?? suggestion,
                            }));
                            setEditingSheet(p.name);
                          }}
                        >
                          {p.sheet ? 'Edit how they look' : 'Describe how they look'}
                        </Button>
                      )}
                    </span>
                  ) : null}
                </span>
                <TextInput
                  aria-label={`What ${p.name} is called in the book`}
                  placeholder="Their own name"
                  value={draft}
                  onChange={(e) => setDrafts((d) => ({ ...d, [p.name]: e.target.value }))}
                  onBlur={() => {
                    const next = draft.trim();
                    if (next === (p.pseudonym ?? '')) return;
                    void setConsent(bookId, p.name, { pseudonym: next });
                  }}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* The other half of "who is in this book": the people allowed to ADD to it (73 §3.1). It sits here
          because both are about the same question — who else is involved — and the author shouldn't have to
          learn a second place for it. */}
      <ContributionsPanel bookId={bookId} />
    </div>
  );
}
