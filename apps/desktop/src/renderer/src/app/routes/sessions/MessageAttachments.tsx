import { useEffect, useState } from 'react';
import type { AttachmentRef } from '@shared/schemas';
import { AttachmentThumb, Lightbox, type LightboxImage } from '../../../design-system/components';
import { useConversationStore } from '../../../stores/conversationStore';
import styles from './Sessions.module.css';

/**
 * A user message's image attachments (45 §3.3) — a thumbnail grid (each decrypted via `getAttachment`,
 * cached by the store) that opens a focus-trapped lightbox with prev/next + a "Save image" export. The
 * assistant's reply stays Markdown text; only user messages carry attachments.
 */
export function MessageAttachments({ attachments }: { attachments: AttachmentRef[] }): JSX.Element {
  const attachmentUrls = useConversationStore((s) => s.attachmentUrls);
  const loadAttachment = useConversationStore((s) => s.loadAttachment);
  const exportAttachment = useConversationStore((s) => s.exportAttachment);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    for (const ref of attachments) void loadAttachment(ref);
  }, [attachments, loadAttachment]);

  const label = (i: number): string =>
    attachments.length > 1 ? `Attached image ${i + 1} of ${attachments.length}` : 'Attached image';

  const images: LightboxImage[] = attachments.map((ref, i) => ({
    src: attachmentUrls[ref.id] ?? '',
    alt: label(i),
  }));

  return (
    <>
      <div className={styles.attachmentGrid}>
        {attachments.map((ref, i) => {
          const src = attachmentUrls[ref.id] ?? null;
          return (
            <AttachmentThumb
              key={ref.id}
              src={src}
              alt={label(i)}
              // Only a loaded image opens the lightbox; a missing one shows the calm placeholder.
              {...(src ? { onActivate: () => setLightboxIndex(i) } : {})}
            />
          );
        })}
      </div>
      {lightboxIndex !== null && images[lightboxIndex]?.src ? (
        <Lightbox
          images={images}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
          onSave={() => {
            const ref = attachments[lightboxIndex];
            if (ref) void exportAttachment(ref);
          }}
        />
      ) : null}
    </>
  );
}
