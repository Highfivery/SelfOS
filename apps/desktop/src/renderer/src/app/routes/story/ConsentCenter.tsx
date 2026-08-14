import { Card, Heading, Select, Stack, Text, TextInput } from '../../../design-system/components';
import { useStoryStore } from '../../../stores/storyStore';
import styles from './Story.module.css';
import { useEffect, useState } from 'react';
import type { ConsentState } from '@shared/schemas';

export const CONSENT_OPTIONS: { value: ConsentState; label: string }[] = [
  { value: 'unknown', label: 'Not asked' },
  { value: 'requested', label: 'Asked them' },
  { value: 'granted', label: 'They’re OK with it' },
  { value: 'declined', label: 'They said no' },
];
/** The people-in-your-book consent center (§17.5) — every real person the book names, with a consent state you
 *  track by hand and an optional pseudonym used in the read + exported book (the draft keeps their real name). */
export function ConsentCenter({ bookId }: { bookId: string }): JSX.Element | null {
  const consent = useStoryStore((s) => s.consent);
  const loadConsent = useStoryStore((s) => s.loadConsent);
  const setConsent = useStoryStore((s) => s.setConsent);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  useEffect(() => {
    void loadConsent(bookId);
  }, [bookId, loadConsent]);
  if (consent.length === 0) return null;
  return (
    <Card>
      <Stack gap={2}>
        <Heading level={2}>People in your book</Heading>
        <Text tone="secondary" size="sm">
          Real people your book names. Track whether they’re OK with appearing, and give anyone a
          pseudonym — it replaces their name everywhere the book is read or exported, while your
          draft keeps the real name. SelfOS never contacts anyone; this is yours to manage.
        </Text>
        {consent.map((p) => (
          <div key={p.name} className={styles.consentRow}>
            <Text size="sm" className={styles.consentName}>
              <strong>{p.name}</strong>
              {p.relationship ? (
                <Text tone="tertiary" size="sm">
                  {p.relationship}
                </Text>
              ) : null}
            </Text>
            <Select
              aria-label={`Consent for ${p.name}`}
              value={p.consent}
              onChange={(e) =>
                void setConsent(bookId, p.name, e.target.value as ConsentState, p.pseudonym)
              }
            >
              {CONSENT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <TextInput
              aria-label={`Pseudonym for ${p.name}`}
              placeholder="Pseudonym (optional)"
              value={drafts[p.name] ?? p.pseudonym ?? ''}
              onChange={(e) => setDrafts((d) => ({ ...d, [p.name]: e.target.value }))}
              onBlur={(e) => {
                if ((e.target.value.trim() || '') !== (p.pseudonym ?? ''))
                  void setConsent(bookId, p.name, p.consent, e.target.value);
              }}
            />
          </div>
        ))}
      </Stack>
    </Card>
  );
}
