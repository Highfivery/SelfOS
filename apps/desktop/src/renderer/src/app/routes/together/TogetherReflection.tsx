import { useState } from 'react';
import { Check, Pencil, RotateCcw, Sparkles } from 'lucide-react';
import type { Agreement } from '@shared/schemas';
import { Banner, Button, Inline, Markdown, Text } from '../../../design-system/components';
import { useTogetherStore } from '../../../stores/togetherStore';
import styles from './Together.module.css';

/** One agreement row — inline edit of text/timeframe/status (§11 #2); marking done offers a gentle follow-up. */
function AgreementRow({
  agreement,
  sessionId,
  onFollowUp,
}: {
  agreement: Agreement;
  sessionId: string;
  onFollowUp: () => void;
}): JSX.Element {
  const save = useTogetherStore((s) => s.saveAgreement);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(agreement.text);
  const [timeframe, setTimeframe] = useState(agreement.timeframe ?? '');

  const commit = async (): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed) return;
    await save({
      sessionId,
      id: agreement.id,
      text: trimmed,
      ...(timeframe.trim() ? { timeframe: timeframe.trim() } : {}),
      status: agreement.status,
    });
    setEditing(false);
  };

  const setStatus = async (status: Agreement['status']): Promise<void> => {
    await save({
      sessionId,
      id: agreement.id,
      text: agreement.text,
      ...(agreement.timeframe ? { timeframe: agreement.timeframe } : {}),
      status,
    });
    if (status === 'done') onFollowUp();
  };

  return (
    <li className={styles.agreementRow} data-status={agreement.status}>
      {editing ? (
        <div className={styles.agreementEdit}>
          <input
            className={styles.agreementInput}
            aria-label="Agreement"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <input
            className={styles.agreementInput}
            aria-label="Timeframe (optional)"
            placeholder="e.g. weekdays"
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
          />
          <Inline gap={2} align="center">
            <Button onClick={() => void commit()}>Save</Button>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </Inline>
        </div>
      ) : (
        <>
          <div className={styles.agreementBody}>
            <Text className={agreement.status === 'done' ? styles.agreementDone : undefined}>
              {agreement.text}
            </Text>
            {agreement.timeframe ? (
              <Text size="xs" tone="secondary">
                {agreement.timeframe}
              </Text>
            ) : null}
          </div>
          <Inline gap={1} align="center">
            {agreement.status === 'standing' ? (
              <Button variant="secondary" onClick={() => void setStatus('done')}>
                <Check size={13} aria-hidden="true" /> Mark done
              </Button>
            ) : (
              <span className={styles.agreementDoneTag}>
                <Check size={12} aria-hidden="true" /> Done
              </span>
            )}
            <Button
              variant="secondary"
              onClick={() => setEditing(true)}
              aria-label="Edit agreement"
            >
              <Pencil size={13} aria-hidden="true" />
            </Button>
            <Button
              variant="secondary"
              onClick={() => void setStatus('retired')}
              aria-label="Retire agreement"
            >
              <RotateCcw size={13} aria-hidden="true" />
            </Button>
          </Inline>
        </>
      )}
    </li>
  );
}

/**
 * The wrap-up reflection + the pair agreements ledger (58 §3.8/§3.9). Shows a "Wrap up & reflect" CTA when
 * there's no report yet (or a "Refresh the reflection" when the session moved on), the shared report once it
 * exists, and the pair's living agreements — each inline-editable, with a gentle follow-up offered on "done".
 */
export function TogetherReflection({
  sessionId,
  memoryEnabled,
  aiReady,
}: {
  sessionId: string;
  memoryEnabled: boolean;
  aiReady: boolean;
}): JSX.Element | null {
  const view = useTogetherStore((s) => s.reportView);
  const wrappingUp = useTogetherStore((s) => s.wrappingUp);
  const wrapUp = useTogetherStore((s) => s.wrapUp);
  const saveAgreement = useTogetherStore((s) => s.saveAgreement);
  const [error, setError] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState(false);
  const [nextText, setNextText] = useState('');

  const { report, stale, agreements } = view;
  const activeAgreements = agreements.filter((a) => a.status !== 'retired');

  const runWrapUp = async (): Promise<void> => {
    setError(null);
    const result = await wrapUp(sessionId);
    if (!result.ok) setError(result.message);
  };

  // Nothing to show + can't produce anything (memory off / AI off) → hide (never a dead control).
  if (!report && activeAgreements.length === 0 && (!memoryEnabled || !aiReady)) return null;

  return (
    <section className={styles.reflection} aria-label="Reflection and agreements">
      <div className={styles.reflectionHead}>
        <Text weight={600}>Reflection</Text>
        {memoryEnabled && aiReady && (!report || stale) ? (
          <Button onClick={() => void runWrapUp()} disabled={wrappingUp}>
            <Sparkles size={14} aria-hidden="true" />
            {wrappingUp ? 'Reflecting…' : report ? 'Refresh the reflection' : 'Wrap up & reflect'}
          </Button>
        ) : null}
      </div>

      {!memoryEnabled ? (
        <Text size="sm" tone="secondary">
          Turn on session memory in Settings → Sessions to save a wrap-up.
        </Text>
      ) : !aiReady && !report ? (
        <Text size="sm" tone="secondary">
          Connect Claude in Settings → AI to wrap up your session.
        </Text>
      ) : null}

      {error ? <Banner tone="danger">{error}</Banner> : null}

      {report ? (
        <div className={styles.reportCard}>
          <Markdown>{report.summary}</Markdown>
          {report.workedThrough.length > 0 ? (
            <div className={styles.reportBlock}>
              <Text size="xs" tone="secondary" weight={600}>
                What you worked through
              </Text>
              <ul className={styles.reportList}>
                {report.workedThrough.map((w, i) => (
                  <li key={i}>
                    <Text size="sm">{w}</Text>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {report.themes.length > 0 ? (
            <Inline gap={1} align="center" wrap>
              {report.themes.map((t, i) => (
                <span key={i} className={styles.themeChip}>
                  {t}
                </span>
              ))}
            </Inline>
          ) : null}
          {stale ? (
            <Text size="xs" tone="secondary">
              You’ve talked more since this reflection — refresh it to catch up.
            </Text>
          ) : null}
        </div>
      ) : null}

      {activeAgreements.length > 0 ? (
        <div className={styles.ledger}>
          <Text size="xs" tone="secondary" weight={600}>
            Agreements you’ve made
          </Text>
          <ul className={styles.agreementList}>
            {activeAgreements.map((a) => (
              <AgreementRow
                key={a.id}
                agreement={a}
                sessionId={sessionId}
                onFollowUp={() => setFollowUp(true)}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {followUp ? (
        <div className={styles.followUp}>
          <Text size="sm">Nice — you followed through. Want to build on it?</Text>
          <input
            className={styles.agreementInput}
            aria-label="Next agreement"
            placeholder="A next step to build on it…"
            value={nextText}
            onChange={(e) => setNextText(e.target.value)}
          />
          <Inline gap={2} align="center">
            <Button
              disabled={nextText.trim().length === 0}
              onClick={() => {
                void saveAgreement({ sessionId, text: nextText.trim(), status: 'standing' });
                setNextText('');
                setFollowUp(false);
              }}
            >
              Add agreement
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setNextText('');
                setFollowUp(false);
              }}
            >
              Not now
            </Button>
          </Inline>
        </div>
      ) : null}
    </section>
  );
}
