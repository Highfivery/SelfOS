import {
  Banner,
  Button,
  Card,
  Heading,
  Inline,
  SegmentedControl,
  Stack,
  Text,
} from '../../../design-system/components';
import { useStoryStore } from '../../../stores/storyStore';
import styles from './Story.module.css';
import { useEffect, useState } from 'react';

/**
 * The export dialog (§13.6.1) — a centered `role="dialog"` (the app's hand-rolled pattern): pick a format
 * (Markdown / PDF) and which head (the live Draft, or the Published version once shared), then export OUTSIDE
 * the encrypted vault. A never-published book can still export its draft.
 */
export function ExportDialog({
  bookId,
  published,
  onClose,
}: {
  bookId: string;
  published: boolean;
  onClose: () => void;
}): JSX.Element {
  const exportMarkdown = useStoryStore((s) => s.exportMarkdown);
  const exportPdf = useStoryStore((s) => s.exportPdf);
  const exportEpub = useStoryStore((s) => s.exportEpub);
  const exportDocx = useStoryStore((s) => s.exportDocx);
  const [format, setFormat] = useState<'markdown' | 'pdf' | 'epub' | 'docx'>('markdown');
  const [head, setHead] = useState<'draft' | 'published'>(published ? 'published' : 'draft');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const doExport = async (): Promise<void> => {
    setBusy(true);
    setResult(null);
    const path =
      format === 'markdown'
        ? await exportMarkdown(bookId, head)
        : format === 'epub'
          ? await exportEpub(bookId, head)
          : format === 'docx'
            ? await exportDocx(bookId, head)
            : await exportPdf(bookId, head);
    setBusy(false);
    if (path) setResult(`Saved to ${path} — this file leaves your encrypted vault.`);
    else setResult('Nothing to export yet, or the save was cancelled.');
  };

  return (
    <div
      className={styles.exportOverlay}
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <Card
        className={styles.exportCard}
        role="dialog"
        aria-modal="true"
        aria-label="Export your story"
        onClick={(e) => e.stopPropagation()}
      >
        <Stack gap={4}>
          <Heading level={3}>Export your story</Heading>
          <Stack gap={1}>
            <Text size="sm" weight={600}>
              Format
            </Text>
            <SegmentedControl
              value={format}
              onChange={setFormat}
              aria-label="Export format"
              options={[
                { value: 'markdown', label: 'Markdown' },
                { value: 'epub', label: 'EPUB' },
                { value: 'docx', label: 'Word' },
                { value: 'pdf', label: 'PDF' },
              ]}
            />
          </Stack>
          <Stack gap={1}>
            <Text size="sm" weight={600}>
              Which version
            </Text>
            <SegmentedControl
              value={head}
              onChange={setHead}
              aria-label="Which version to export"
              options={[
                { value: 'draft', label: 'Working draft' },
                { value: 'published', label: 'Published' },
              ]}
            />
            <Text size="sm" tone="secondary">
              {head === 'draft'
                ? 'Every chapter you’ve written so far — no need to share first.'
                : published
                  ? 'Exactly what your readers see — the chapters you’ve marked “Looks good”.'
                  : 'You haven’t shared this book yet, so there’s no published version to export.'}
            </Text>
          </Stack>
          {result ? <Banner tone="info">{result}</Banner> : null}
          <Inline gap={2} align="center">
            <Button
              variant="primary"
              disabled={busy || (head === 'published' && !published)}
              aria-busy={busy}
              autoFocus
              onClick={() => void doExport()}
            >
              {busy ? 'Exporting…' : 'Export'}
            </Button>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Close
            </Button>
          </Inline>
        </Stack>
      </Card>
    </div>
  );
}
