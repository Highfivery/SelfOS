import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import type { NoteForRecipient } from '@selfos/core/schemas';
import {
  Banner,
  Button,
  Card,
  Heading,
  Inline,
  Stack,
  Text,
} from '../../../design-system/components';
import styles from './NoteRead.module.css';

/**
 * Reading a note that was written for you (76 §3.6), and answering it.
 *
 * The Inbox NAVIGATES here rather than answering in place — the queue never acts on the person's behalf
 * (08 §35.1). This is the surface that owns the decision.
 *
 * **No sender, anywhere.** A note is unattributed on both surfaces; naming the author here would
 * contradict the email, which carries no signature. The screen names the thing, not who sent it.
 *
 * Answering writes the same record an emailed tap drains into (§3.5), so it makes no difference to the
 * author which surface was used — and tapping again simply replaces the answer, because a person may
 * change their mind about a question asked once.
 */
export function NoteRead(): JSX.Element {
  const { authorPersonId = '', noteId = '' } = useParams();
  const navigate = useNavigate();
  const [note, setNote] = useState<NoteForRecipient | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const found = (await window.selfos?.notesGetForMe({ authorPersonId, noteId })) ?? null;
        if (!cancelled) setNote(found);
      } catch {
        if (!cancelled) setNote(null);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authorPersonId, noteId]);

  const answer = async (label: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const updated = (await window.selfos?.notesAnswer({ authorPersonId, noteId, label })) ?? null;
      if (updated) setNote(updated);
      else setError('That answer could not be saved. Try again.');
    } catch {
      setError('That answer could not be saved. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const back = (
    <Button variant="secondary" onClick={() => navigate('/inbox')}>
      <ArrowLeft size={15} aria-hidden="true" /> Inbox
    </Button>
  );

  if (!loaded) return <div className={styles.page}>{back}</div>;

  if (!note) {
    return (
      <div className={styles.page}>
        <Inline gap={3} align="center" wrap>
          {back}
        </Inline>
        <Banner tone="info" role="none">
          That note isn’t here any more.
        </Banner>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <Inline gap={3} align="center" wrap>
        {back}
      </Inline>

      <Card>
        <Stack gap={4}>
          <Heading level={1}>{note.subject}</Heading>
          {note.body.split(/\n{2,}/).map((paragraph: string, i: number) => (
            // Paragraphs of one immutable body — index is a stable identity here.
            <Text key={i}>{paragraph.trim()}</Text>
          ))}

          {note.answers.length > 0 ? (
            <Stack gap={2}>
              <Text size="sm" tone="secondary">
                {note.answered ? 'You answered:' : 'What do you think?'}
              </Text>
              <Inline gap={2} wrap>
                {note.answers.map((a) => (
                  <Button
                    key={a.label}
                    variant={note.answered === a.label ? 'primary' : 'secondary'}
                    disabled={busy}
                    aria-pressed={note.answered === a.label}
                    onClick={() => void answer(a.label)}
                  >
                    {a.label}
                  </Button>
                ))}
              </Inline>
              {note.answered ? (
                <Text size="sm" tone="tertiary">
                  You can change your mind — tap another one.
                </Text>
              ) : null}
            </Stack>
          ) : null}

          {error ? (
            <Banner tone="danger" role="alert">
              {error}
            </Banner>
          ) : null}
        </Stack>
      </Card>
    </div>
  );
}
