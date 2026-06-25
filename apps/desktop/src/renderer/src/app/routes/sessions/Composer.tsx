import { useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { Paperclip, SendHorizontal, X } from 'lucide-react';
import { ALLOWED_IMAGE_MIME, isAllowedImageMime } from '@selfos/core/media';
import { AttachmentThumb, Button } from '../../../design-system/components';
import {
  downscaleImage,
  MAX_ATTACHMENTS_PER_MESSAGE,
  type PendingAttachment,
} from './downscaleImage';
import styles from './Sessions.module.css';

/**
 * The message composer (05 §3). Enter sends; Shift+Enter inserts a newline. When `allowAttachments` is set
 * (Sessions only, 45 §3.1) it also accepts images by paste, drag-and-drop, or a file-picker — each downscaled
 * client-side and held as an in-memory pending thumbnail until Send (store-on-send, §11).
 */
export function Composer({
  disabled,
  onSend,
  placeholder = 'Write a message…',
  autoFocus = true,
  initialText = '',
  allowAttachments = false,
}: {
  disabled: boolean;
  /** Send the message. May return `false` (or a promise of it) to signal the send failed, so the composer
   *  keeps the pending attachments for a retry; anything else clears them. */
  onSend: (
    text: string,
    attachments: PendingAttachment[],
  ) => void | boolean | Promise<void | boolean>;
  placeholder?: string;
  autoFocus?: boolean;
  /** Seed text to prefill (e.g. a synthesis observation handed off from Home, 40 §3.3). The user edits/sends.
   *  Read ONCE at mount (the launcher remounts on navigation, so a fresh seed always seeds a fresh composer). */
  initialText?: string;
  /** Enable image attachments (45) — opt-in so the shared Composer stays text-only on dream/intake surfaces. */
  allowAttachments?: boolean;
}): JSX.Element {
  const [text, setText] = useState(initialText);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [addError, setAddError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSend = !disabled && (text.trim().length > 0 || pending.length > 0);

  const submit = async (): Promise<void> => {
    if (!canSend) return;
    const result = await onSend(text.trim(), pending);
    if (result === false) return; // send failed — keep the text + pending attachments to retry
    setText('');
    setPending([]);
    setAddError(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  const addFiles = async (files: File[]): Promise<void> => {
    if (!allowAttachments || files.length === 0) return;
    const images = files.filter((f) => isAllowedImageMime(f.type));
    if (images.length < files.length) {
      setAddError('That file isn’t a supported image.');
    }
    let next = pending;
    for (const file of images) {
      if (next.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
        setAddError(`Max ${MAX_ATTACHMENTS_PER_MESSAGE} images per message.`);
        break;
      }
      try {
        const attachment = await downscaleImage(file);
        next = [...next, attachment];
        setPending(next);
      } catch {
        setAddError('Couldn’t read that image.');
      }
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    if (!allowAttachments) return;
    const files = [...event.clipboardData.items]
      .filter((item) => item.kind === 'file' && isAllowedImageMime(item.type))
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null);
    // Only intercept when an image was pasted — otherwise let the default text paste proceed.
    if (files.length > 0) {
      event.preventDefault();
      void addFiles(files);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    if (!allowAttachments) return;
    event.preventDefault();
    setDragOver(false);
    void addFiles([...event.dataTransfer.files]);
  };

  const removePending = (id: string): void => {
    setPending((list) => list.filter((a) => a.id !== id));
    setAddError(null);
  };

  return (
    <div
      className={`${styles.composerWrap}${dragOver ? ` ${styles.dragOver}` : ''}`}
      {...(allowAttachments
        ? {
            onDragOver: (event: DragEvent<HTMLDivElement>) => {
              event.preventDefault();
              setDragOver(true);
            },
            onDragLeave: () => setDragOver(false),
            onDrop,
          }
        : {})}
    >
      {allowAttachments && pending.length > 0 ? (
        <ul className={styles.pendingRow} aria-label="Attachments">
          {pending.map((attachment, i) => (
            <li key={attachment.id} className={styles.pendingItem}>
              <AttachmentThumb src={attachment.previewUrl} alt={`Attached image ${i + 1}`} />
              <button
                type="button"
                className={styles.removeAttach}
                onClick={() => removePending(attachment.id)}
                aria-label={`Remove attachment ${i + 1}`}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </li>
          ))}
          <li
            className={styles.countChip}
            aria-label={`${pending.length} of ${MAX_ATTACHMENTS_PER_MESSAGE} images`}
          >
            {pending.length}/{MAX_ATTACHMENTS_PER_MESSAGE}
          </li>
        </ul>
      ) : null}

      {addError ? (
        <p className={styles.attachError} role="status">
          {addError}
        </p>
      ) : null}

      {allowAttachments && dragOver ? (
        <div className={styles.dropHint} aria-hidden="true">
          Drop images to attach
        </div>
      ) : null}

      <div className={styles.composer}>
        {allowAttachments ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_IMAGE_MIME.join(',')}
              multiple
              className={styles.fileInput}
              onChange={(event) => {
                void addFiles([...(event.target.files ?? [])]);
                event.target.value = ''; // allow re-selecting the same file
              }}
            />
            <Button
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || pending.length >= MAX_ATTACHMENTS_PER_MESSAGE}
              aria-label="Attach image"
            >
              <Paperclip size={16} aria-hidden="true" />
            </Button>
          </>
        ) : null}
        <textarea
          className={styles.textarea}
          aria-label="Message"
          placeholder={placeholder}
          value={text}
          rows={2}
          autoFocus={autoFocus}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          {...(allowAttachments ? { onPaste } : {})}
        />
        <Button variant="primary" onClick={() => void submit()} disabled={!canSend}>
          <SendHorizontal size={16} aria-hidden="true" />
          Send
        </Button>
      </div>
    </div>
  );
}
