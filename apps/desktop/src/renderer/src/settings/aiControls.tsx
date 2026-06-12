import { useEffect, useState } from 'react';
import { Button, Inline, Stack, Text, TextInput } from '../design-system/components';
import { ANTHROPIC_API_KEY_ID, OPENAI_API_KEY_ID, type ClaudeTestResult } from '@shared/channels';

/**
 * Set / replace / clear an encrypted device-local API key (the value never leaves the main process —
 * write-only to the renderer: `secretSet`/`secretHas`/`secretClear`, never a `get`). Parametrized by the
 * secret id + copy so both the Claude and OpenAI key controls share one implementation.
 */
function SecretKeyControl({
  secretId,
  label,
  configuredHint,
  emptyHint,
  placeholder,
}: {
  secretId: string;
  label: string;
  configuredHint: string;
  emptyHint: string;
  placeholder: string;
}): JSX.Element {
  const [configured, setConfigured] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async (): Promise<void> => {
    const has = await window.selfos?.secretHas({ id: secretId });
    setConfigured(Boolean(has));
  };

  useEffect(() => {
    void refresh();
  }, []);

  const save = async (): Promise<void> => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await window.selfos?.secretSet({ id: secretId, value: trimmed });
      setValue('');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const clear = async (): Promise<void> => {
    setBusy(true);
    try {
      await window.selfos?.secretClear({ id: secretId });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap={2}>
      <Text size="sm" tone="secondary">
        {configured ? configuredHint : emptyHint}
      </Text>
      <TextInput
        type="password"
        placeholder={configured ? 'Enter a new key to replace it' : placeholder}
        value={value}
        aria-label={label}
        onChange={(event) => setValue(event.target.value)}
      />
      <Inline gap={2}>
        <Button variant="primary" onClick={() => void save()} disabled={busy || !value.trim()}>
          Save key
        </Button>
        {configured ? (
          <Button variant="secondary" onClick={() => void clear()} disabled={busy}>
            Clear
          </Button>
        ) : null}
      </Inline>
    </Stack>
  );
}

/** Set / replace / clear the encrypted Claude API key. */
export function ApiKeyControl(): JSX.Element {
  return (
    <SecretKeyControl
      secretId={ANTHROPIC_API_KEY_ID}
      label="Claude API key"
      configuredHint="A key is configured — encrypted and stored only on this device."
      emptyHint="No key yet. Create one at console.anthropic.com, then paste it here."
      placeholder="sk-ant-…"
    />
  );
}

/** Set / replace / clear the encrypted OpenAI API key (dream images, 13-dream-images §6). */
export function OpenAiKeyControl(): JSX.Element {
  return (
    <SecretKeyControl
      secretId={OPENAI_API_KEY_ID}
      label="OpenAI API key"
      configuredHint="A key is configured — encrypted and stored only on this device."
      emptyHint="No key yet. Create one at platform.openai.com, then paste it here."
      placeholder="sk-…"
    />
  );
}

/** Send a tiny request to verify the key + selected model work. */
export function TestConnectionControl(): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ClaudeTestResult | null>(null);

  const test = async (): Promise<void> => {
    setBusy(true);
    setResult(null);
    try {
      const outcome = await window.selfos?.claudeTest();
      if (outcome) setResult(outcome);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap={2}>
      <Inline gap={3}>
        <Button variant="secondary" onClick={() => void test()} disabled={busy}>
          {busy ? 'Testing…' : 'Test connection'}
        </Button>
        {result?.ok ? (
          <Text size="sm" tone="accent">
            Connected
          </Text>
        ) : null}
      </Inline>
      {result && !result.ok ? (
        <Text size="sm" tone="secondary">
          {result.message}
        </Text>
      ) : null}
    </Stack>
  );
}
