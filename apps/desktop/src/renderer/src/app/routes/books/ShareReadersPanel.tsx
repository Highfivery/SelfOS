import {
  Banner,
  Button,
  Card,
  Heading,
  Inline,
  Select,
  Stack,
  Text,
} from '../../../design-system/components';
import { usePeopleStore } from '../../../stores/peopleStore';
import { useStoryStore } from '../../../stores/storyStore';
import styles from './Books.module.css';
import { useCallback, useEffect, useState } from 'react';
import type { StoryPublishDiff } from '@shared/schemas';
import { ExportDialog } from './ExportDialog';

/** A reader's read state (§13.6.8), joined author-side from their receipt. */
export function readerReadLabel(read?: { openedAt: string; upToDate: boolean }): string {
  if (!read) return 'Hasn’t opened it yet';
  if (read.upToDate) return 'Read the latest';
  return `Opened ${new Date(read.openedAt).toLocaleDateString()} · older version`;
}
/** The "Share & readers" panel (§3.5): publish (Reviewed chapters → the published head) + grant/revoke readers.
 *  Readers never see the working draft — only what's been marked "Looks good". */
export function ShareReadersPanel({
  bookId,
  publishedAt,
  authorPersonId,
}: {
  bookId: string;
  publishedAt?: string;
  authorPersonId: string;
}): JSX.Element {
  const publish = useStoryStore((s) => s.publish);
  const publishDiff = useStoryStore((s) => s.publishDiff);
  const unpublish = useStoryStore((s) => s.unpublish);
  const readers = useStoryStore((s) => s.readers);
  const loadReaders = useStoryStore((s) => s.loadReaders);
  const grantReader = useStoryStore((s) => s.grantReader);
  const revokeReader = useStoryStore((s) => s.revokeReader);
  const readerFeatured = useStoryStore((s) => s.readerFeatured);
  const consent = useStoryStore((s) => s.consent);
  const loadConsent = useStoryStore((s) => s.loadConsent);
  const people = usePeopleStore((s) => s.people);
  const loadPeople = usePeopleStore((s) => s.load);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState('');
  const [featured, setFeatured] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [diff, setDiff] = useState<StoryPublishDiff | null>(null);
  // A staged shrink awaiting confirmation: republishing would DROP chapters readers currently have (§18.2).
  const [shrinkConfirm, setShrinkConfirm] = useState(false);
  const [unpublishConfirm, setUnpublishConfirm] = useState(false);

  const refreshDiff = useCallback(async () => {
    setDiff(await publishDiff(bookId));
  }, [bookId, publishDiff]);

  useEffect(() => {
    void loadReaders(bookId);
    void loadPeople();
    void loadConsent(bookId);
    void refreshDiff();
  }, [bookId, loadReaders, loadPeople, loadConsent, refreshDiff]);

  const doPublish = async (): Promise<void> => {
    setBusy(true);
    setNotice(null);
    setShrinkConfirm(false);
    const res = await publish(bookId);
    setNotice(
      res.ok
        ? `Shared ${res.publishedChapters} chapter${res.publishedChapters === 1 ? '' : 's'} with your readers.`
        : res.message,
    );
    await refreshDiff();
    setBusy(false);
  };

  // Publish click: if a re-publish would remove chapters readers have, confirm first (no silent shrink, §18.2).
  const onPublishClick = async (): Promise<void> => {
    const current = diff ?? (await publishDiff(bookId));
    if (current.willShrink) {
      setDiff(current);
      setShrinkConfirm(true);
      return;
    }
    await doPublish();
  };

  // Who this book names, before you share it (72 §3.9). This used to be a warning about people not yet
  // "marked OK with it" — a state the app tracked and never acted on, which made sharing feel like it
  // needed permission it was never actually checking. Naming them plainly is the honest version: the
  // reader will see these people, and two of them under a different name.
  const named = consent.map((p) => p.name);
  const renamed = consent
    .filter((p) => p.pseudonym?.trim())
    .map((p) => `${p.name} → ${p.pseudonym}`);

  const readerIds = new Set(readers.map((r) => r.personId));
  const candidates = people.filter((p) => p.id !== authorPersonId && !readerIds.has(p.id));
  const candidateName = people.find((p) => p.id === candidate)?.displayName ?? '';

  return (
    <Card>
      <Stack gap={2}>
        <Heading level={2}>Share &amp; readers</Heading>
        <Text tone="secondary" size="sm">
          Readers see only the chapters you’ve marked “Looks good” — never your working draft.
          Sharing updates re-publishes those chapters.
        </Text>
        {notice ? <Banner tone="info">{notice}</Banner> : null}
        {named.length > 0 ? (
          <Banner tone="info">
            Your readers will see {named.length === 1 ? 'this person' : 'these people'}:{' '}
            {named.join(', ')}.
            {renamed.length > 0 ? ` Appearing under a different name: ${renamed.join(', ')}.` : ''}{' '}
            Change how someone appears under “People”.
          </Banner>
        ) : null}
        {/* Publish-diff preview (§18.2): what a re-publish would change for readers vs the current head. */}
        {publishedAt && diff && diff.everPublished && !diff.nothingToPublish ? (
          <Banner tone={diff.willShrink ? 'warning' : 'info'}>
            <Stack gap={1}>
              <Text size="sm">
                {diff.added.length + diff.updated.length + diff.removed.length === 0
                  ? 'Nothing has changed since you last shared.'
                  : 'Sharing updates would change your readers’ book:'}
              </Text>
              {diff.added.length > 0 ? (
                <Text size="sm" tone="secondary">
                  <strong>Add {diff.added.length}</strong>:{' '}
                  {diff.added.map((c) => c.title).join(', ')}
                </Text>
              ) : null}
              {diff.updated.length > 0 ? (
                <Text size="sm" tone="secondary">
                  <strong>Update {diff.updated.length}</strong>:{' '}
                  {diff.updated.map((c) => c.title).join(', ')}
                </Text>
              ) : null}
              {diff.removed.length > 0 ? (
                <Text size="sm" tone="secondary">
                  <strong>Remove {diff.removed.length}</strong> (readers lose these):{' '}
                  {diff.removed.map((c) => c.title).join(', ')}
                </Text>
              ) : null}
            </Stack>
          </Banner>
        ) : null}
        {shrinkConfirm ? (
          <Banner tone="warning">
            <Stack gap={1}>
              <Text size="sm">
                Sharing now removes{' '}
                {diff?.removed.length === 1 ? 'a chapter' : `${diff?.removed.length} chapters`} your
                readers currently have. This can’t be undone from their copy.
              </Text>
              <Inline>
                <Button variant="danger" disabled={busy} onClick={doPublish}>
                  {busy ? 'Sharing…' : 'Remove & share'}
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setShrinkConfirm(false)}>
                  Keep them
                </Button>
              </Inline>
            </Stack>
          </Banner>
        ) : null}
        {unpublishConfirm ? (
          <Banner tone="warning">
            <Stack gap={1}>
              <Text size="sm">
                Readers lose access immediately. Your draft and your reader list are untouched — you
                can share again anytime.
              </Text>
              <Inline>
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setNotice(null);
                    setUnpublishConfirm(false);
                    const res = await unpublish(bookId);
                    setNotice(
                      res.ok
                        ? 'Unshared — readers no longer have access.'
                        : (res.message ?? 'Couldn’t unshare.'),
                    );
                    await refreshDiff();
                    setBusy(false);
                  }}
                >
                  {busy ? 'Unsharing…' : 'Unshare now'}
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setUnpublishConfirm(false)}>
                  Cancel
                </Button>
              </Inline>
            </Stack>
          </Banner>
        ) : null}
        <Inline>
          <Button disabled={busy || shrinkConfirm} onClick={onPublishClick}>
            {busy ? 'Sharing…' : publishedAt ? 'Share updates' : 'Publish & choose readers'}
          </Button>
          {/* Export is always available (§13.6.1 — the draft head exports without publishing). */}
          <Button variant="ghost" onClick={() => setExportOpen(true)}>
            Export…
          </Button>
          {publishedAt ? (
            <Button variant="ghost" disabled={busy} onClick={() => setUnpublishConfirm(true)}>
              Unshare
            </Button>
          ) : null}
          {publishedAt ? (
            <Text tone="secondary" size="sm">
              Last shared {new Date(publishedAt).toLocaleDateString()}
            </Text>
          ) : null}
        </Inline>
        {exportOpen ? (
          <ExportDialog
            bookId={bookId}
            published={Boolean(publishedAt)}
            onClose={() => setExportOpen(false)}
          />
        ) : null}

        {readers.length > 0 ? (
          <Stack gap={1}>
            {readers.map((r) => (
              <div key={r.personId} className={styles.markRow}>
                <Text size="sm">
                  {r.displayName}
                  <Text as="span" tone="tertiary" size="sm">
                    {' · '}
                    {readerReadLabel(r.read)}
                  </Text>
                </Text>
                <button
                  type="button"
                  className={styles.sourcesToggle}
                  aria-label={`Remove ${r.displayName} as a reader`}
                  onClick={() => void revokeReader(bookId, r.personId)}
                >
                  Remove
                </button>
              </div>
            ))}
          </Stack>
        ) : null}

        {candidates.length > 0 ? (
          <Stack gap={1}>
            <Inline>
              <Select
                value={candidate}
                aria-label="Add a reader"
                onChange={async (e) => {
                  const id = e.target.value;
                  setCandidate(id);
                  setFeatured(id ? await readerFeatured(bookId, id) : false);
                }}
              >
                <option value="">Add a reader…</option>
                {candidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </Select>
              <Button
                variant="ghost"
                disabled={!candidate}
                onClick={async () => {
                  await grantReader(bookId, candidate);
                  setCandidate('');
                  setFeatured(false);
                }}
              >
                Add as reader
              </Button>
            </Inline>
            {featured && candidateName ? (
              <Text tone="secondary" size="sm">
                {candidateName} appears in this book — they’ll be able to read what you’ve written
                about them.
              </Text>
            ) : null}
          </Stack>
        ) : null}
      </Stack>
    </Card>
  );
}
