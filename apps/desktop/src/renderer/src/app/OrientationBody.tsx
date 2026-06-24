import { Stack, Text } from '../design-system/components';

/**
 * The shared "what is SelfOS / how this works" prose (41 §3.5) — a brief, warm orientation: a wellness
 * companion that learns about you, stores everything as files you own, and is explicitly NOT medical care
 * (CLAUDE.md §1). Rendered both as a dismissible first-run Home card and from the account-menu "About
 * SelfOS" panel. It never implies anyone else can read your content.
 */
export function OrientationBody(): JSX.Element {
  return (
    <Stack gap={2}>
      <Text tone="secondary">
        SelfOS is a calm companion for reflection. As you have sessions, log dreams, and answer
        questionnaires, it gently learns what matters to you and brings that context to future
        conversations — so it feels like talking to someone who remembers.
      </Text>
      <Text tone="secondary">
        Everything you write stays as plain files you own, on your device. Nothing is shared with
        anyone else unless you choose to share it.
      </Text>
      <Text tone="secondary">
        SelfOS is a wellness and self-help tool — <strong>not medical care</strong>, not a diagnosis
        or treatment, and not a substitute for a professional. If you’re in distress, reach out to a
        crisis line or someone you trust.
      </Text>
    </Stack>
  );
}
