import type { JSX } from 'react';
import { Banner } from './Banner';
import { Button } from './Button';
import { Stack } from './Stack';
import { Text } from './Text';

/**
 * The shared "this turn is recoverable" affordance (66 §3.2).
 *
 * A chat turn whose transcript ends on an unanswered message is never a dead end — whether it just
 * failed (a live error), came back empty, or the session was simply reopened days later. Extracted from
 * Sessions because all four chat surfaces now need it and hand-rolled copies would drift.
 *
 * `error` distinguishes the two tones: a live failure reads as a warning with the real message; a
 * reopened, still-unanswered turn reads as a gentle informational nudge.
 */
export function RetryBanner({
  error,
  onRetry,
  busy = false,
  idleMessage = 'Your last message hasn’t been answered yet.',
  label = 'Try again',
}: {
  error?: string | null;
  onRetry: () => void;
  busy?: boolean;
  idleMessage?: string;
  label?: string;
}): JSX.Element {
  return (
    <Banner tone={error ? 'warning' : 'info'}>
      <Stack gap={2}>
        <Text>{error ?? idleMessage}</Text>
        <div>
          <Button variant="secondary" onClick={onRetry} disabled={busy}>
            {label}
          </Button>
        </div>
      </Stack>
    </Banner>
  );
}
