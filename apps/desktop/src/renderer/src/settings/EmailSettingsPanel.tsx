import { useEffect, useState } from 'react';
import type { EmailPrefs, EmailStatus, EmailVerifyResult } from '@selfos/core/schemas';
import { RESEND_API_KEY_ID } from '@shared/channels';
import {
  AdminOnlyBadge,
  Banner,
  Button,
  Field,
  Inline,
  Stack,
  Switch,
  Text,
  TextInput,
} from '../design-system/components';
import { useSessionStore } from '../stores/sessionStore';
import { SecretKeyControl } from './aiControls';

/**
 * Settings → Email (67 §3.1) — the connect + configure surface. Household connection (admin-only, an
 * `AdminOnlyBadge`) sets the Resend key + sending domain / from-address; per-person preferences (every
 * member) set the SEPARATE opt-in engagement address + per-family opt-in + a master pause. Until Resend is
 * connected, the per-person toggles show "Connect Resend to turn this on" (never a dead toggle). The Resend
 * key never crosses to the renderer — the panel reads only the booleans-only `EmailStatus`.
 *
 * Phase 0 exposes the `welcome` family toggle only (the one built family — §12: no scaffolding for unbuilt
 * families); later phases surface each family's toggle + the digest day/time + the intimacy opt-in as they land.
 */
export function EmailSettingsPanel(): JSX.Element {
  const canManage = useSessionStore((state) => state.can('settings.manage'));
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [prefs, setPrefs] = useState<EmailPrefs | null>(null);

  const refresh = async (): Promise<void> => {
    setStatus((await window.selfos?.emailStatus()) ?? null);
    setPrefs((await window.selfos?.emailGetPrefs()) ?? null);
  };
  useEffect(() => {
    void refresh();
  }, []);

  const connected = status?.resolvedReady === true;

  return (
    <Stack gap={4}>
      {canManage ? <ConnectSection status={status} onChanged={() => void refresh()} /> : null}
      <PrefsSection connected={connected} prefs={prefs} onSaved={(next) => setPrefs(next)} />
    </Stack>
  );
}

/** Household connection — admin-only (67 §3.1): the Resend key + sending domain / from-address + Test. */
function ConnectSection({
  status,
  onChanged,
}: {
  status: EmailStatus | null;
  onChanged: () => void;
}): JSX.Element {
  const [fromAddress, setFromAddress] = useState('');
  const [fromName, setFromName] = useState('');
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [verify, setVerify] = useState<EmailVerifyResult | null>(null);

  useEffect(() => {
    setFromAddress(status?.fromAddress ?? '');
    setFromName(status?.fromName ?? '');
    setDomain(status?.sendingDomain ?? '');
  }, [status?.fromAddress, status?.fromName, status?.sendingDomain]);

  const saveConfig = async (): Promise<void> => {
    setBusy(true);
    try {
      await window.selfos?.emailSetConfig({
        fromAddress: fromAddress.trim(),
        fromName: fromName.trim(),
        sendingDomain: domain.trim(),
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const test = async (): Promise<void> => {
    setBusy(true);
    setVerify(null);
    try {
      setVerify((await window.selfos?.emailVerify()) ?? null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap={3}>
      <Inline gap={2} align="center">
        <Text weight={600}>Connect Resend</Text>
        <AdminOnlyBadge />
      </Inline>
      <Text size="sm" tone="secondary">
        SelfOS sends email through your household’s own Resend account. Add your Resend API key
        (create one at resend.com), then set the verified sending domain and the address emails come
        from.
      </Text>

      <SecretKeyControl
        secretId={RESEND_API_KEY_ID}
        label="Resend API key"
        configuredHint="A Resend key is configured on this device — encrypted and stored only here."
        emptyHint="No Resend key on this device yet. Create one at resend.com, then paste it here."
        placeholder="re_…"
        onChanged={onChanged}
      />

      <Field label="Sending domain">
        {(f) => (
          <TextInput
            {...f}
            value={domain}
            placeholder="yourfamily.example"
            onChange={(event) => setDomain(event.target.value)}
          />
        )}
      </Field>
      <Field label="From address">
        {(f) => (
          <TextInput
            {...f}
            value={fromAddress}
            placeholder="hello@yourfamily.example"
            onChange={(event) => setFromAddress(event.target.value)}
          />
        )}
      </Field>
      <Field label="From name">
        {(f) => (
          <TextInput
            {...f}
            value={fromName}
            placeholder="SelfOS"
            onChange={(event) => setFromName(event.target.value)}
          />
        )}
      </Field>

      <Inline gap={2}>
        <Button variant="primary" onClick={() => void saveConfig()} disabled={busy}>
          Save sending details
        </Button>
        <Button variant="secondary" onClick={() => void test()} disabled={busy} aria-busy={busy}>
          {busy ? 'Testing…' : 'Test connection'}
        </Button>
      </Inline>

      {verify?.ok ? (
        verify.domains.some((d) => d.verified) ? (
          <Text size="sm" tone="accent">
            Connected —{' '}
            {verify.domains
              .filter((d) => d.verified)
              .map((d) => d.name)
              .join(', ')}{' '}
            verified.
          </Text>
        ) : (
          <Banner tone="warning">
            Connected, but no domain is verified yet. Add the DNS records in Resend, then re-check.
          </Banner>
        )
      ) : null}
      {verify && !verify.ok ? (
        <Text size="sm" tone="secondary">
          Couldn’t verify the key ({verify.reason.toLowerCase()}). {verify.message ?? ''}
        </Text>
      ) : null}
    </Stack>
  );
}

/** Per-person preferences (67 §3.1) — every member sets their own engagement address + opt-ins. */
function PrefsSection({
  connected,
  prefs,
  onSaved,
}: {
  connected: boolean;
  prefs: EmailPrefs | null;
  onSaved: (next: EmailPrefs) => void;
}): JSX.Element {
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setAddress(prefs?.address ?? '');
  }, [prefs?.address]);

  const welcomeOn = prefs?.families?.welcome ?? true;
  const paused = prefs?.paused ?? false;

  const patch = async (
    input: Parameters<NonNullable<typeof window.selfos>['emailSetPrefs']>[0],
  ): Promise<void> => {
    setBusy(true);
    try {
      const next = await window.selfos?.emailSetPrefs(input);
      if (next) {
        onSaved(next);
        setSaved(true);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap={3}>
      <Text weight={600}>Your email preferences</Text>

      <Field
        label="Email me at"
        help="A separate address just for SelfOS engagement email — distinct from any address others use to send you a questionnaire. Leave it blank to receive no engagement email."
      >
        {(f) => (
          <Inline gap={2} align="end">
            <TextInput
              {...f}
              value={address}
              placeholder="you@inbox.example"
              onChange={(event) => {
                setAddress(event.target.value);
                setSaved(false);
              }}
            />
            <Button
              variant="secondary"
              onClick={() => void patch({ address: address.trim() })}
              disabled={busy}
            >
              Save
            </Button>
          </Inline>
        )}
      </Field>
      {saved ? (
        <Text size="sm" tone="accent">
          Saved.
        </Text>
      ) : null}

      {!connected ? <Banner tone="info">Connect Resend (above) to turn on email.</Banner> : null}

      <ToggleRow
        label="Welcome & getting-started email"
        help="A one-time orientation email when you first set up SelfOS."
        checked={welcomeOn}
        disabled={busy || !connected}
        onChange={(checked) => void patch({ families: { welcome: checked } })}
      />
      <ToggleRow
        label="Pause all email"
        help="Stop every SelfOS email until you turn this back off."
        checked={paused}
        disabled={busy}
        onChange={(checked) => void patch({ paused: checked })}
      />
    </Stack>
  );
}

/** A label + help on the left, a `Switch` on the right (the settings-toggle row shape). */
function ToggleRow({
  label,
  help,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  help: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <Inline gap={3} align="center" justify="space-between">
      <Stack gap={1}>
        <Text>{label}</Text>
        <Text size="sm" tone="secondary">
          {help}
        </Text>
      </Stack>
      <Switch
        checked={checked}
        disabled={disabled ?? false}
        aria-label={label}
        onChange={onChange}
      />
    </Inline>
  );
}
