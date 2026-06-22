import { useEffect, useState } from 'react';
import { Banner, Button, Inline, Stack, Text, TextInput } from '../design-system/components';
import { ANTHROPIC_API_KEY_ID, OPENAI_API_KEY_ID, type ClaudeTestResult } from '@shared/channels';
import type { AiKeyStatus, AiProvider } from '@selfos/core/schemas';
import { useSessionStore } from '../stores/sessionStore';

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
  onChanged,
}: {
  secretId: string;
  label: string;
  configuredHint: string;
  emptyHint: string;
  placeholder: string;
  onChanged?: () => void;
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
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const clear = async (): Promise<void> => {
    setBusy(true);
    try {
      await window.selfos?.secretClear({ id: secretId });
      await refresh();
      onChanged?.();
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

/**
 * The household AI key control (25-household-ai-credentials §3). Role-aware: the Owner enters a key + may
 * **share it with the household** (stored encrypted in the vault, §4.1); a Member sees "AI is provided by
 * your household" and may **override** with their own device-local key. No key value ever crosses to the
 * renderer — only the booleans-only `aiKeyStatus`.
 */
function SharedKeyControl({
  provider,
  label,
  configuredHint,
  emptyHint,
  placeholder,
}: {
  provider: AiProvider;
  label: string;
  configuredHint: string;
  emptyHint: string;
  placeholder: string;
}): JSX.Element {
  const canManage = useSessionStore((state) => state.can('settings.manage'));
  const secretId = provider === 'anthropic' ? ANTHROPIC_API_KEY_ID : OPENAI_API_KEY_ID;
  const [status, setStatus] = useState<AiKeyStatus | null>(null);
  const [showOverride, setShowOverride] = useState(false);

  const refresh = async (): Promise<void> => {
    setStatus((await window.selfos?.aiKeyStatus({ provider })) ?? null);
  };
  useEffect(() => {
    void refresh();
  }, []);

  const keyField = (
    <SecretKeyControl
      secretId={secretId}
      label={label}
      configuredHint={configuredHint}
      emptyHint={emptyHint}
      placeholder={placeholder}
      onChanged={() => void refresh()}
    />
  );

  // --- Owner: enter a key; it's shared with the household automatically (toggle: "Share AI with your
  // household"). The manual share/unshare buttons are gone — auto-share + that opt-out replace them. ---
  if (canManage) {
    return (
      <Stack gap={3}>
        {keyField}
        {status?.hasSharedKey ? (
          <Text size="sm" tone="accent">
            Shared with your household — every member device uses this key.
          </Text>
        ) : (
          <Text size="sm" tone="secondary">
            Keys you add here are shared with your household automatically so members can use AI
            without a key of their own. Manage this with “Share AI with your household” below.
          </Text>
        )}
      </Stack>
    );
  }

  // --- Member: inherit the household key, or override with their own ---
  return (
    <Stack gap={2}>
      {status?.hasSharedKey ? (
        <Banner tone="info">AI is provided by your household.</Banner>
      ) : (
        <Text size="sm" tone="secondary">
          Ask your household owner to set up AI, or add your own key below.
        </Text>
      )}
      {status?.hasDeviceOverride || showOverride || !status?.hasSharedKey ? (
        <Stack gap={2}>
          {status?.hasSharedKey ? (
            <Text size="sm" tone="secondary">
              Using your own key instead of the household key.
            </Text>
          ) : null}
          {keyField}
        </Stack>
      ) : (
        <Inline gap={2}>
          <Button variant="ghost" onClick={() => setShowOverride(true)}>
            Use my own key instead
          </Button>
        </Inline>
      )}
    </Stack>
  );
}

/** Set / replace / clear the Claude API key, with household sharing (Owner) / inheritance (Member). */
export function ApiKeyControl(): JSX.Element {
  return (
    <SharedKeyControl
      provider="anthropic"
      label="Claude API key"
      configuredHint="A key is configured on this device — encrypted and stored only here."
      emptyHint="No key on this device yet. Create one at console.anthropic.com, then paste it here."
      placeholder="sk-ant-…"
    />
  );
}

/** Set / replace / clear the OpenAI API key (dream images, 13-dream-images §6), with household sharing. */
export function OpenAiKeyControl(): JSX.Element {
  return (
    <SharedKeyControl
      provider="openai"
      label="OpenAI API key"
      configuredHint="A key is configured on this device — encrypted and stored only here."
      emptyHint="No key on this device yet. Create one at platform.openai.com, then paste it here."
      placeholder="sk-…"
    />
  );
}

/** Shared "Test connection" control — runs `test()` and shows Connected / a calm error message. */
function ConnectionTest({
  test,
}: {
  test: () => Promise<ClaudeTestResult | undefined>;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ClaudeTestResult | null>(null);

  const run = async (): Promise<void> => {
    setBusy(true);
    setResult(null);
    try {
      const outcome = await test();
      if (outcome) setResult(outcome);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap={2}>
      <Inline gap={3}>
        <Button variant="secondary" onClick={() => void run()} disabled={busy} aria-busy={busy}>
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

/** Send a tiny request to verify the Claude key + selected model work. */
export function TestConnectionControl(): JSX.Element {
  return <ConnectionTest test={() => window.selfos!.claudeTest()} />;
}

/** Verify the OpenAI (dream-image) key with a non-generative probe (33-multi-device-housekeeping §5.B). */
export function OpenAiTestConnectionControl(): JSX.Element {
  return <ConnectionTest test={() => window.selfos!.openaiTest()} />;
}
