import { useEffect, useState } from 'react';
import { Button, Inline, Stack, Text, TextInput } from '../design-system/components';
import { ANTHROPIC_API_KEY_ID, type ClaudeTestResult } from '@shared/channels';

/** Set / replace / clear the encrypted Claude API key. The key value never leaves the main process. */
export function ApiKeyControl(): JSX.Element {
  const [configured, setConfigured] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async (): Promise<void> => {
    const has = await window.selfos?.secretHas({ id: ANTHROPIC_API_KEY_ID });
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
      await window.selfos?.secretSet({ id: ANTHROPIC_API_KEY_ID, value: trimmed });
      setValue('');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const clear = async (): Promise<void> => {
    setBusy(true);
    try {
      await window.selfos?.secretClear({ id: ANTHROPIC_API_KEY_ID });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap={2}>
      <Text size="sm" tone="secondary">
        {configured
          ? 'A key is configured — encrypted and stored only on this device.'
          : 'No key yet. Create one at console.anthropic.com, then paste it here.'}
      </Text>
      <TextInput
        type="password"
        placeholder={configured ? 'Enter a new key to replace it' : 'sk-ant-…'}
        value={value}
        aria-label="Claude API key"
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
