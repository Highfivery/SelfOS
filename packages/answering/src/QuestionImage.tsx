import { useEffect, useState } from 'react';
import type { Question } from '@selfos/core/schemas';
import styles from './styles.module.css';

type Media = NonNullable<Question['media']>;

/** Decrypt an attached image to base64 for display; the host wires this to its image source. */
export type LoadImage = (imagePath: string) => Promise<string | null>;

/**
 * Displays an author-attached question image (08-questionnaires §4.2). The bytes are encrypted in the
 * vault, so the host supplies a `loadImage(imagePath)` that returns the decrypted base64 (in-app: the
 * `questionnaires:getImage` IPC; the relay page passes its own client-side decrypt over the fragment
 * key — §8.6). Kept separate from the answer controls so the builder thumbnail, the in-app answering
 * form, and the relay page all share one implementation.
 */
export function QuestionImage({
  media,
  loadImage,
}: {
  media: Media;
  loadImage: LoadImage;
}): JSX.Element | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void loadImage(media.imagePath).then((base64) => {
      if (live) setUrl(base64 ? `data:${media.mime};base64,${base64}` : null);
    });
    return () => {
      live = false;
    };
  }, [media.imagePath, media.mime, loadImage]);

  if (!url) return null;
  return <img src={url} alt={media.alt} className={styles.questionImage} />;
}
