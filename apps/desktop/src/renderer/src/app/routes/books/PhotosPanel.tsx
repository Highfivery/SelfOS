import {
  Banner,
  Button,
  Card,
  Field,
  Heading,
  Inline,
  Stack,
  Text,
  TextInput,
} from '../../../design-system/components';
import { useStoryStore } from '../../../stores/storyStore';
import { downscaleImage } from '../sessions/downscaleImage';
import { ImageProgress } from './ImageProgress';
import styles from './Books.module.css';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Photos (§3.7, Phase H2). Upload personal photos (downscaled + EXIF-stripped in the renderer, spec 45);
 * each can be analyzed by Claude vision → a caption + 2–4 questions to answer, and every answer persists to
 * the interview corpus so the biographer can draw on it. A photo is NEVER an image-generation input — it's
 * only ever read by vision. Uploading needs no consent (it's the author's own photo); analyzing needs the
 * Claude key (the app already requires AI), so a failed analyze surfaces its reason calmly.
 */
export function PhotosPanel({ bookId }: { bookId: string }): JSX.Element {
  const navigate = useNavigate();
  const images = useStoryStore((s) => s.images);
  const imageUrls = useStoryStore((s) => s.imageUrls);
  const photoAnswers = useStoryStore((s) => s.photoAnswers);
  const loadImages = useStoryStore((s) => s.loadImages);
  const loadPhotoAnswers = useStoryStore((s) => s.loadPhotoAnswers);
  const getImageUrl = useStoryStore((s) => s.getImageUrl);
  const uploadPhoto = useStoryStore((s) => s.uploadPhoto);
  const analyzePhoto = useStoryStore((s) => s.analyzePhoto);
  const answerPhoto = useStoryStore((s) => s.answerPhoto);
  const deleteImage = useStoryStore((s) => s.deleteImage);

  const [busy, setBusy] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Per-photo vision questions (ephemeral) + a per-question draft answer, keyed by image id.
  const [questions, setQuestions] = useState<Record<string, string[]>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const photos = images.filter((i) => i.kind === 'uploaded');

  useEffect(() => {
    void loadImages(bookId);
    void loadPhotoAnswers(bookId);
  }, [bookId, loadImages, loadPhotoAnswers]);

  // Resolve a data URL for every uploaded photo not yet cached.
  useEffect(() => {
    for (const p of photos) {
      if (!imageUrls[p.id]) void getImageUrl(bookId, p.id);
    }
  }, [bookId, photos, imageUrls, getImageUrl]);

  const onPick = async (file: File): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const scaled = await downscaleImage(file);
      const entry = await uploadPhoto(bookId, scaled.mime, scaled.base64);
      if (entry) await getImageUrl(bookId, entry.id);
      else setError('That image couldn’t be added.');
    } catch {
      setError('Couldn’t read that image. Try a different photo.');
    }
    setBusy(false);
  };

  const analyze = async (imageId: string): Promise<void> => {
    setBusy(true);
    setAnalyzingId(imageId);
    setError(null);
    const res = await analyzePhoto(bookId, imageId);
    if (res.ok) setQuestions((q) => ({ ...q, [imageId]: res.analysis.questions }));
    else setError(res.message);
    setAnalyzingId(null);
    setBusy(false);
  };

  return (
    <Card>
      <Stack gap={2}>
        <Inline justify="space-between">
          <Heading level={2}>Photos</Heading>
          <Button variant="ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? 'Working…' : 'Add a photo'}
          </Button>
        </Inline>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className={styles.hiddenFile}
          aria-label="Add a photo"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onPick(file);
            e.target.value = ''; // allow re-selecting the same file
          }}
        />
        {error ? <Banner tone="danger">{error}</Banner> : null}
        {photos.length === 0 ? (
          <Text tone="secondary" size="sm">
            Add a photo and your biographer can ask about the memory behind it — the answers become
            part of your story. Photos are never used to generate art.
          </Text>
        ) : (
          <div className={styles.photoGrid}>
            {photos.map((p) => {
              const answered = photoAnswers.filter((a) => a.imageId === p.id);
              const asked = questions[p.id] ?? [];
              const url = imageUrls[p.id];
              return (
                <div key={p.id} className={styles.photoCard}>
                  {url ? (
                    <img
                      className={styles.photoCardImg}
                      src={url}
                      alt={p.caption ?? 'Uploaded photo'}
                    />
                  ) : (
                    <div className={styles.photoCardImgFallback} aria-hidden="true" />
                  )}
                  <div className={styles.photoCardBody}>
                    {p.caption ? (
                      <Text size="sm" weight={500}>
                        {p.caption}
                      </Text>
                    ) : (
                      <Text size="sm" tone="tertiary">
                        No caption yet
                      </Text>
                    )}
                    {answered.length > 0 ? (
                      <span className={styles.photoAnsweredChip}>
                        {answered.length} {answered.length === 1 ? 'memory' : 'memories'} captured
                      </span>
                    ) : null}
                    {answered.map((a, i) => (
                      <Text key={`ans-${i}`} tone="secondary" size="sm">
                        <strong>{a.question}</strong> {a.answer}
                      </Text>
                    ))}
                    {analyzingId === p.id ? (
                      <ImageProgress id={`photo:${bookId}:${p.id}`} kind="vision" />
                    ) : null}
                    {asked.map((q) => (
                      <Field key={q} label={q}>
                        {(fieldProps) => (
                          <Inline>
                            <TextInput
                              {...fieldProps}
                              value={drafts[`${p.id}:${q}`] ?? ''}
                              onChange={(e) =>
                                setDrafts((d) => ({ ...d, [`${p.id}:${q}`]: e.target.value }))
                              }
                              placeholder="Your answer…"
                            />
                            <Button
                              disabled={busy || !(drafts[`${p.id}:${q}`] ?? '').trim()}
                              onClick={async () => {
                                const answer = (drafts[`${p.id}:${q}`] ?? '').trim();
                                if (!answer) return;
                                await answerPhoto(bookId, p.id, q, answer);
                                setDrafts((d) => {
                                  const next = { ...d };
                                  delete next[`${p.id}:${q}`];
                                  return next;
                                });
                                setQuestions((qs) => ({
                                  ...qs,
                                  [p.id]: (qs[p.id] ?? []).filter((x) => x !== q),
                                }));
                              }}
                            >
                              Save answer
                            </Button>
                          </Inline>
                        )}
                      </Field>
                    ))}
                    <Inline gap={2} className={styles.photoCardActions}>
                      <Button variant="ghost" disabled={busy} onClick={() => analyze(p.id)}>
                        {p.caption ? 'Ask more' : 'Caption & ask about this'}
                      </Button>
                      {/* Seed the biographer memory chat (§14) from this photo — jump to the Interview tab. */}
                      <Button
                        variant="ghost"
                        onClick={() =>
                          navigate(
                            `/story/interview?seed=${encodeURIComponent(
                              p.caption ?? 'the story of this photo',
                            )}`,
                          )
                        }
                      >
                        Tell the story of this photo
                      </Button>
                      <button
                        type="button"
                        className={styles.sourcesToggle}
                        aria-label="Remove this photo"
                        onClick={() => void deleteImage(bookId, p.id)}
                      >
                        Remove
                      </button>
                    </Inline>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Stack>
    </Card>
  );
}
