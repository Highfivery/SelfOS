import { useEffect, useState } from 'react';
import type { AttachmentRef } from '@shared/schemas';
import { AttachmentThumb, Lightbox, type LightboxImage } from '../../../design-system/components';
import styles from './Together.module.css';

/**
 * A Together message's image attachments (58 §6.1). Each is decrypted via `together:getAttachment` — which is
 * message-gated in the bridge, so an aside's image is refused for the partner (returns null → a placeholder).
 * Reuses the design-system AttachmentThumb + Lightbox; the Together seam is distinct from the 45 solo one.
 */
export function TogetherAttachments({
  sessionId,
  attachments,
}: {
  sessionId: string;
  attachments: AttachmentRef[];
}): JSX.Element {
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  const [lightbox, setLightbox] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      for (const ref of attachments) {
        const got = await window.selfos?.togetherGetAttachment({ sessionId, path: ref.path });
        if (!alive) return;
        setUrls((prev) => ({
          ...prev,
          [ref.id]: got ? `data:${got.mime};base64,${got.dataBase64}` : null,
        }));
      }
    })();
    return () => {
      alive = false;
    };
  }, [sessionId, attachments]);

  const images: LightboxImage[] = attachments.map((ref, i) => ({
    src: urls[ref.id] ?? '',
    alt: `Shared image ${i + 1}`,
  }));

  return (
    <>
      <div className={styles.attachmentGrid}>
        {attachments.map((ref, i) => (
          <AttachmentThumb
            key={ref.id}
            src={urls[ref.id] ?? null}
            alt={`Shared image ${i + 1}`}
            {...(urls[ref.id] ? { onActivate: () => setLightbox(i) } : {})}
          />
        ))}
      </div>
      {lightbox !== null ? (
        <Lightbox
          images={images}
          index={lightbox}
          onClose={() => setLightbox(null)}
          onIndexChange={setLightbox}
        />
      ) : null}
    </>
  );
}
