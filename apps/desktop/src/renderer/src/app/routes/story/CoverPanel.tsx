import {
  AdminOnlyBadge,
  Banner,
  Button,
  Card,
  Heading,
  Inline,
  Stack,
  Text,
} from '../../../design-system/components';
import { useSetting } from '../../../settings/useSetting';
import { useImageConsent } from '../../../stores/imagePrefsStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useStoryStore } from '../../../stores/storyStore';
import { aiKeyResolved } from '../../aiAvailability';
import { ImageProgress } from './ImageProgress';
import styles from './Story.module.css';
import { useEffect, useState } from 'react';

/**
 * The book cover (§3.8, Phase H). Reuses the spec-13 distill→render image flow behind the ONE shared image
 * consent (`dreams.imageGenerationEnabled`) + the OpenAI key. A cover is symbolic — never a portrait of the
 * subject (the service enforces name-free/no-likeness). When AI images aren't set up, a calm setup note
 * appears instead of a button that could only fail — owner sees the Settings path, a member is pointed at
 * the owner (41 §3.3). An existing cover always stays viewable/removable even if AI is later turned off.
 */
export function CoverPanel({
  bookId,
  coverImageId,
}: {
  bookId: string;
  coverImageId?: string;
}): JSX.Element {
  const isAdmin = useSessionStore((s) => s.can('budgets.manage'));
  const canManageAi = useSessionStore((s) => s.can('settings.manage'));
  // Story image-generation consent is now per-person (image-settings amendment) — this author's own toggle.
  const consent = useImageConsent('story');
  const [aiEnabled] = useSetting('ai.enabled');
  const generateImage = useStoryStore((s) => s.generateImage);
  const getImageUrl = useStoryStore((s) => s.getImageUrl);
  const deleteImage = useStoryStore((s) => s.deleteImage);

  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    setError(null);
    setConfirmRemove(false);
    void (async () => {
      const has = await aiKeyResolved('openai');
      const url = coverImageId ? await getImageUrl(bookId, coverImageId) : null;
      setHasKey(Boolean(has));
      setCoverUrl(url);
      setLoading(false);
    })();
  }, [bookId, coverImageId, getImageUrl]);

  const ready = consent === true && aiEnabled !== false && hasKey;

  const create = async (): Promise<void> => {
    setBusy(true);
    setGenerating(true);
    setError(null);
    // No per-image style — every image uses the single global style (Settings → Images, §3.8).
    const res = await generateImage(bookId, { kind: 'cover' });
    if (res.ok) {
      const url = await getImageUrl(bookId, res.image.id);
      setCoverUrl(url);
      setCost(typeof res.costUsd === 'number' ? res.costUsd : null);
    } else {
      setError(res.message);
    }
    setGenerating(false);
    setBusy(false);
  };

  return (
    <Card>
      <Stack gap={2}>
        <Heading level={2}>Cover</Heading>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        {coverUrl ? (
          <img className={styles.coverImage} src={coverUrl} alt={`Cover for this book`} />
        ) : (
          <Text tone="secondary" size="sm">
            A symbolic cover for your story — evocative art, never a literal portrait.
          </Text>
        )}
        {generating ? (
          <ImageProgress id={`story:${bookId}:cover`} label="Creating your cover" />
        ) : null}
        {ready ? (
          <Stack gap={2}>
            <Inline>
              <Button disabled={busy} onClick={create}>
                {busy ? 'Creating…' : coverUrl ? 'Regenerate cover' : 'Create a cover'}
              </Button>
              {coverUrl && coverImageId ? (
                confirmRemove ? (
                  <Inline>
                    <Button
                      variant="danger"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        await deleteImage(bookId, coverImageId);
                        setCoverUrl(null);
                        setCost(null);
                        setConfirmRemove(false);
                        setBusy(false);
                      }}
                    >
                      Remove cover
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmRemove(false)}>
                      Keep
                    </Button>
                  </Inline>
                ) : (
                  <Button variant="ghost" onClick={() => setConfirmRemove(true)}>
                    Remove
                  </Button>
                )
              ) : null}
              {isAdmin && cost !== null ? (
                <Text tone="secondary" size="sm">
                  <AdminOnlyBadge /> ~${cost.toFixed(3)}
                </Text>
              ) : null}
            </Inline>
          </Stack>
        ) : loading ? null : (
          <Text tone="secondary" size="sm">
            {canManageAi
              ? 'Turn on AI image generation and add your OpenAI key in Settings → Images to create a cover.'
              : 'Ask the person who set up this household to turn on AI image generation.'}
          </Text>
        )}
      </Stack>
    </Card>
  );
}
