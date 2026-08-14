import {
  Button,
  Card,
  Field,
  Heading,
  Inline,
  Stack,
  Switch,
  Text,
  Textarea,
} from '../../../design-system/components';
import { useStoryStore } from '../../../stores/storyStore';
import styles from './Story.module.css';
import { missingMatter } from '@selfos/core/story-matter';
import { useEffect, useMemo, useState } from 'react';
import type { BookMatter } from '@shared/schemas';

/** The front/back matter editor (§3.6/§16.3) — dedication, epigraph, acknowledgments, about-the-author and
 *  a colophon. The colophon is ADDED to SelfOS's own closing boundary line, never a replacement (§8.2). */
export function MatterEditor({
  bookId,
  matter,
}: {
  bookId: string;
  matter?: BookMatter;
}): JSX.Element {
  const update = useStoryStore((s) => s.update);
  const castRegister = useStoryStore((s) => s.castRegister);
  const loadCastRegister = useStoryStore((s) => s.loadCastRegister);
  const [dedication, setDedication] = useState(matter?.dedication ?? '');
  const [epigraph, setEpigraph] = useState(matter?.epigraph ?? '');
  const [acknowledgments, setAcknowledgments] = useState(matter?.acknowledgments ?? '');
  const [aboutAuthor, setAboutAuthor] = useState(matter?.aboutAuthor ?? '');
  const [colophon, setColophon] = useState(matter?.colophon ?? '');
  const [castPublished, setCastPublished] = useState(matter?.castPublished ?? false);
  useEffect(() => {
    void loadCastRegister(bookId);
  }, [bookId, loadCastRegister]);
  // `missingMatter` trims, so pass the raw values — one computation, not one per render branch.
  const missing = useMemo(
    () => missingMatter({ dedication, epigraph, acknowledgments, aboutAuthor }),
    [dedication, epigraph, acknowledgments, aboutAuthor],
  );
  const [saved, setSaved] = useState(false);
  const touch = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setSaved(false);
  };
  return (
    <Card>
      <Stack gap={2}>
        <Heading level={2}>Dedication &amp; acknowledgments</Heading>
        <Text tone="secondary" size="sm">
          Your own words for the opening and closing pages — added to what readers see. Optional.
        </Text>
        <Field label="Dedication">
          {(p) => (
            <Textarea
              {...p}
              value={dedication}
              rows={2}
              placeholder="For…"
              onChange={(e) => touch(setDedication)(e.target.value)}
            />
          )}
        </Field>
        <Field label="Epigraph">
          {(p) => (
            <Textarea
              {...p}
              value={epigraph}
              rows={2}
              placeholder="A line or quote to open with…"
              onChange={(e) => touch(setEpigraph)(e.target.value)}
            />
          )}
        </Field>
        <Field label="Acknowledgments">
          {(p) => (
            <Textarea
              {...p}
              value={acknowledgments}
              rows={3}
              placeholder="With thanks to…"
              onChange={(e) => touch(setAcknowledgments)(e.target.value)}
            />
          )}
        </Field>
        <Text tone="tertiary" size="sm">
          Anyone you’ve shared the book with sees these when you publish again.
        </Text>
        <Field label="About the author">
          {(p) => (
            <Textarea
              {...p}
              value={aboutAuthor}
              rows={3}
              placeholder="A few lines about you, for the back of the book…"
              onChange={(e) => touch(setAboutAuthor)(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Colophon"
          help="A closing line — how the book was made, or a last word. SelfOS always adds its own note that this book is reflection, not assessment."
        >
          {(p) => (
            <Textarea
              {...p}
              value={colophon}
              rows={2}
              placeholder="Set in Lora. Written over the winter of…"
              onChange={(e) => touch(setColophon)(e.target.value)}
            />
          )}
        </Field>
        {/* Dramatis personae (§17.2) — an opt-in cast list, built from your people. Off by default; the register
            is only ever used behind the scenes for consistency unless you publish it here. */}
        <div className={styles.castEditor}>
          <Inline justify="space-between" align="center">
            <Text size="sm">Publish a cast list (“The people in this book”)</Text>
            <Switch
              checked={castPublished}
              onChange={(v) => {
                setCastPublished(v);
                setSaved(false);
              }}
              aria-label="Publish a cast list"
            />
          </Inline>
          <Text tone="tertiary" size="sm">
            {castRegister.length > 0
              ? `Built from your people — ${castRegister.length} so far. It appears in the front of the book only when this is on.`
              : 'Once your book knows a few recurring people, they’ll appear here. It’s published only when this is on.'}
          </Text>
          {castPublished && castRegister.length > 0 ? (
            <ul className={styles.castPreview}>
              {castRegister.slice(0, 8).map((m) => (
                <li key={m.name}>
                  <strong>{m.name}</strong>
                  {m.relationship ? ` — ${m.relationship}` : ''}
                </li>
              ))}
              {castRegister.length > 8 ? <li>…and {castRegister.length - 8} more</li> : null}
            </ul>
          ) : null}
        </div>
        {/* A light nudge, never a gate (§16.3) — a book with nothing out front is still a book. */}
        {missing.length > 0 ? (
          <Text tone="tertiary" size="sm">
            Your book doesn’t have{' '}
            {new Intl.ListFormat(undefined, { style: 'long', type: 'conjunction' }).format(missing)}{' '}
            yet — all optional.
          </Text>
        ) : null}
        <Inline>
          <Button
            aria-label="Save front and back matter"
            onClick={async () => {
              await update(bookId, {
                matter: {
                  ...(dedication.trim() ? { dedication: dedication.trim() } : {}),
                  ...(epigraph.trim() ? { epigraph: epigraph.trim() } : {}),
                  ...(acknowledgments.trim() ? { acknowledgments: acknowledgments.trim() } : {}),
                  ...(aboutAuthor.trim() ? { aboutAuthor: aboutAuthor.trim() } : {}),
                  ...(colophon.trim() ? { colophon: colophon.trim() } : {}),
                  ...(castPublished ? { castPublished: true } : {}),
                },
              });
              setSaved(true);
            }}
          >
            Save
          </Button>
          {saved ? (
            <Text tone="secondary" size="sm">
              Saved.
            </Text>
          ) : null}
        </Inline>
      </Stack>
    </Card>
  );
}
