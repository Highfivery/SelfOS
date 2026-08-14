import { Banner, Button, Heading, Inline, Stack, Text } from '../../../design-system/components';
import { useStoryStore } from '../../../stores/storyStore';
import { useState } from 'react';
import type { StoryBookBundle } from '@shared/schemas';

export function NeedsOutline({
  bundle,
  error,
  aiUnavailable = false,
  onGenerate,
}: {
  bundle: StoryBookBundle;
  error: string | null;
  /** AI unavailable → drafting can only fail; disable the CTA (the notice above explains how to enable). */
  aiUnavailable?: boolean;
  onGenerate: () => void | Promise<void>;
}): JSX.Element {
  const remove = useStoryStore((s) => s.remove);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <Stack gap={4}>
      <Heading level={1}>{bundle.manifest.title}</Heading>
      <Text tone="secondary">
        Your outline hasn’t been drafted yet. When you’re ready, your biographer will read
        everything it knows and propose the shape of your book.
      </Text>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Inline justify="space-between">
        <Button
          variant="primary"
          disabled={busy || aiUnavailable}
          onClick={async () => {
            setBusy(true);
            await onGenerate();
            setBusy(false);
          }}
        >
          {error ? 'Try again' : 'Draft the outline'}
        </Button>
        {confirmDelete ? (
          <Inline>
            <Button variant="danger" onClick={() => void remove(bundle.manifest.id)}>
              Delete
            </Button>
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
          </Inline>
        ) : (
          <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
            Delete book
          </Button>
        )}
      </Inline>
    </Stack>
  );
}
