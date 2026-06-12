import { useEffect, useState } from 'react';
import { Cloud, ExternalLink, RefreshCw, Trash2 } from 'lucide-react';
import { Banner, Button, Field, Stack, Text, TextInput } from '../design-system/components';
import { useRelayStore } from '../stores/relayStore';
import styles from './RelaySettingsPanel.module.css';

/**
 * Admin-only relay setup (08-questionnaires §3.8). Paste a least-privilege Cloudflare token + account id;
 * the app provisions storage and deploys the zero-knowledge relay Worker to a free `*.workers.dev`
 * subdomain. Once connected, any household member can send/collect externally with zero setup — the
 * encrypted config lives in the vault. The token never leaves the host (it's not echoed back here).
 */
export function RelaySettingsPanel(): JSX.Element {
  const status = useRelayStore((s) => s.status);
  const loaded = useRelayStore((s) => s.loaded);
  const load = useRelayStore((s) => s.load);
  const connect = useRelayStore((s) => s.connect);
  const update = useRelayStore((s) => s.update);
  const teardown = useRelayStore((s) => s.teardown);

  const [token, setToken] = useState('');
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (status?.configured) {
    return (
      <Stack gap={3}>
        <Banner tone="info">
          Relay connected at <code className={styles.endpoint}>{status.endpointUrl}</code>
        </Banner>
        <Text size="sm" tone="secondary">
          External recipients answer through this household relay. It stores only encrypted data and
          can’t read questions or answers.
        </Text>
        {error ? <Banner tone="warning">{error}</Banner> : null}
        <div className={styles.actions}>
          {status.updateAvailable ? (
            <Button variant="primary" disabled={busy} onClick={() => void run(update)}>
              <RefreshCw size={15} aria-hidden="true" />
              Update relay
            </Button>
          ) : null}
          {confirmRemove ? (
            <>
              <Text size="sm">Remove the relay and delete it from Cloudflare?</Text>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() =>
                  void run(teardown).then(() => {
                    setConfirmRemove(false);
                  })
                }
              >
                <Trash2 size={15} aria-hidden="true" />
                Remove
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => setConfirmRemove(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="secondary" disabled={busy} onClick={() => setConfirmRemove(true)}>
              Remove relay
            </Button>
          )}
        </div>
      </Stack>
    );
  }

  return (
    <Stack gap={3}>
      <Text size="sm" tone="secondary">
        Connect your own Cloudflare account to let people without SelfOS answer questionnaires
        through a private, encrypted web link. Create an API token with Workers Scripts + Workers KV
        edit permissions, then paste it with your account ID.
      </Text>
      <Field label="Cloudflare account ID">
        {(props) => (
          <TextInput
            {...props}
            value={accountId}
            placeholder="e.g. 0a1b2c3d4e5f…"
            onChange={(e) => setAccountId(e.target.value)}
          />
        )}
      </Field>
      <Field label="Cloudflare API token">
        {(props) => (
          <TextInput
            {...props}
            type="password"
            value={token}
            placeholder="Paste your scoped token"
            onChange={(e) => setToken(e.target.value)}
          />
        )}
      </Field>
      {error ? <Banner tone="warning">{error}</Banner> : null}
      <div className={styles.actions}>
        <Button
          variant="primary"
          disabled={busy || token.trim() === '' || accountId.trim() === ''}
          onClick={() =>
            void run(() => connect({ apiToken: token.trim(), accountId: accountId.trim() })).then(
              () => {
                setToken('');
              },
            )
          }
        >
          <Cloud size={15} aria-hidden="true" />
          {busy ? 'Connecting…' : 'Connect & deploy'}
        </Button>
        <a
          className={styles.help}
          href="https://dash.cloudflare.com/profile/api-tokens"
          target="_blank"
          rel="noreferrer noopener"
        >
          Create a token <ExternalLink size={13} aria-hidden="true" />
        </a>
      </div>
    </Stack>
  );
}
