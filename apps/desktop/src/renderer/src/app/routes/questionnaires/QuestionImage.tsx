import { useEffect, useState } from 'react';
import type { Question } from '@shared/schemas';
import styles from './QuestionnaireForm.module.css';

type Media = NonNullable<Question['media']>;

/**
 * Displays an author-attached question image (08-questionnaires §4.2). The bytes are encrypted in the
 * vault, so the host supplies a `loadImage(imagePath)` that returns the decrypted base64 (in-app: the
 * `questionnaires:getImage` IPC; the relay page will pass its own client-side decrypt). Kept separate
 * from the answer controls so both the builder thumbnail and the answering form share one implementation.
 */
export function QuestionImage({
  media,
  loadImage,
}: {
  media: Media;
  loadImage: (imagePath: string) => Promise<string | null>;
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
