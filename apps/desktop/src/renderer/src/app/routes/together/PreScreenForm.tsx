import { useState } from 'react';
import type { TogetherPreScreenItem, TogetherPreScreenResult } from '@shared/schemas';
import { Banner, Button, Heading, Stack, Text } from '../../../design-system/components';
import { useTogetherStore } from '../../../stores/togetherStore';
import { PRESCREEN_INTRO_LINE } from './roomRules';
import styles from './Together.module.css';

/**
 * The private pre-screen (58 §8.2): a short, gentle, AI-free check before a person's first session. No wrong
 * answers; raw answers are never persisted (only the outcome). A flag shows a calm private hold + resources —
 * the partner never sees the screen exists. `onCleared` fires when a clear result unlocks Together.
 */
export function PreScreenForm({ onCleared }: { onCleared?: () => void }): JSX.Element {
  const prescreen = useTogetherStore((s) => s.prescreen);
  const submit = useTogetherStore((s) => s.submitPrescreen);
  const items: TogetherPreScreenItem[] = prescreen?.items ?? [];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TogetherPreScreenResult | null>(null);

  const complete = items.every((item) => typeof answers[item.id] === 'string');

  const onSubmit = async (): Promise<void> => {
    setBusy(true);
    try {
      const outcome = await submit(answers);
      setResult(outcome);
      if (!outcome.flagged) onCleared?.();
    } finally {
      setBusy(false);
    }
  };

  // A flagged (held) outcome — a calm, private state with individual support (+ crisis resources when the
  // fear item triggered). Mechanical, non-judgmental; the partner never sees any of this (§8.2).
  if (result?.flagged) {
    return (
      <section className={styles.prescreen} aria-label="A gentle check-in">
        <Stack gap={3}>
          <Heading level={2}>Let’s take this gently</Heading>
          <Text tone="secondary">
            Thanks for being honest. From your answers, it might help to start with your own coach
            first — one-on-one — before working through things together. Together will be here when
            you’re ready; you can take this check again any time.
          </Text>
          {result.showCrisis ? (
            <Banner tone="warning">
              If you ever feel unsafe or afraid, you deserve support right now. In the US &amp;
              Canada, call or text <strong>988</strong>. In the UK &amp; ROI, call{' '}
              <strong>116&nbsp;123</strong> (Samaritans). If you’re in immediate danger, call your
              local emergency number.
            </Banner>
          ) : null}
          <Text size="sm" tone="secondary">
            SelfOS is wellness support, not medical care.
          </Text>
        </Stack>
      </section>
    );
  }

  return (
    <section className={styles.prescreen} aria-label="A private check-in">
      <Stack gap={3}>
        <Stack gap={1}>
          <Heading level={2}>A private check-in, just for you</Heading>
          <Text tone="secondary">{PRESCREEN_INTRO_LINE} There are no wrong answers.</Text>
        </Stack>
        {items.map((item) => (
          <fieldset key={item.id} className={styles.prescreenItem}>
            <legend className={styles.prescreenPrompt}>{item.prompt}</legend>
            <div className={styles.prescreenChoices} role="radiogroup" aria-label={item.prompt}>
              {item.choices.map((choice) => {
                const id = `${item.id}-${choice.value}`;
                return (
                  <label key={choice.value} htmlFor={id} className={styles.prescreenChoice}>
                    <input
                      id={id}
                      type="radio"
                      name={item.id}
                      value={choice.value}
                      checked={answers[item.id] === choice.value}
                      onChange={() => setAnswers((prev) => ({ ...prev, [item.id]: choice.value }))}
                    />
                    <span>{choice.label}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
        <Button onClick={() => void onSubmit()} disabled={!complete || busy} aria-busy={busy}>
          {busy ? 'Saving…' : 'Continue'}
        </Button>
        <Text size="xs" tone="secondary">
          Your answers aren’t saved — only whether you’re ready to begin.
        </Text>
      </Stack>
    </section>
  );
}
