import { useEffect, useState } from 'react';
import type {
  EmailPrefs,
  EmailResponse,
  EmailStatus,
  EmailVerifyResult,
  OwnerEmailActivityEntry,
} from '@selfos/core/schemas';
import { RESEND_API_KEY_ID } from '@shared/channels';
import {
  AdminOnlyBadge,
  Banner,
  Button,
  Field,
  Inline,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from '../design-system/components';
import { useSessionStore } from '../stores/sessionStore';
import { SecretKeyControl } from './aiControls';

const DAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/**
 * Settings → Email (67 §3.1) — the connect + configure surface. Household connection (admin-only, an
 * `AdminOnlyBadge`) sets the Resend key + sending domain / from-address; per-person preferences (every
 * member) set the SEPARATE opt-in engagement address + per-family opt-in + a master pause. Until Resend is
 * connected, the per-person toggles show "Connect Resend to turn this on" (never a dead toggle). The Resend
 * key never crosses to the renderer — the panel reads only the booleans-only `EmailStatus`.
 *
 * Surfaces every built family's toggle (welcome / transactional / digest / re-engagement / AI suggestions +
 * the gated intimacy opt-in), the digest day/time, the drained-response history, and the Phase-5 response-loop
 * surfaces (mutual green light + intimacy-inventory offer). Each self-hides until it has something to show.
 */
export function EmailSettingsPanel(): JSX.Element {
  const canManage = useSessionStore((state) => state.can('settings.manage'));
  const canViewActivity = useSessionStore((state) => state.can('people.manage'));
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
      <PrefsSection
        connected={connected}
        prefs={prefs}
        intimacyEligible={status?.intimacyEligible ?? false}
        onSaved={(next) => setPrefs(next)}
        onRefreshStatus={() => void refresh()}
      />
      <GreenLightsSection />
      <IntimacyOffersSection />
      <ResponsesSection />
      {canViewActivity ? <EmailActivityView /> : null}
    </Stack>
  );
}

/**
 * The owner Email-activity view (67 §3.7 / Phase 6) — an admin-only subsection showing EVERY member's sent
 * email (full visibility, the Owner full-access model), filterable by member + family, with delivery-health
 * counts and a CSV export. Never member-facing; the read is `people.manage`-gated in the bridge.
 */
function EmailActivityView(): JSX.Element {
  const [rows, setRows] = useState<OwnerEmailActivityEntry[]>([]);
  const [member, setMember] = useState('all');
  const [family, setFamily] = useState('all');

  useEffect(() => {
    void (async () => setRows((await window.selfos?.emailAllActivity()) ?? []))();
  }, []);

  const members = Array.from(new Set(rows.map((r) => r.personName))).sort();
  const families = Array.from(new Set(rows.map((r) => r.family))).sort();
  const filtered = rows.filter(
    (r) =>
      (member === 'all' || r.personName === member) && (family === 'all' || r.family === family),
  );
  const bounced = rows.filter((r) => r.status === 'bounced').length;
  const complained = rows.filter((r) => r.status === 'complained').length;
  const when = (iso?: string): string => (iso ? new Date(iso).toLocaleString() : '—');

  const exportCsv = (): void => {
    const esc = (v: string): string => `"${v.replace(/"/g, '""')}"`;
    const header = [
      'Member',
      'Family',
      'Subject',
      'To',
      'Status',
      'Sent',
      'Delivered',
      'Opened',
      'Clicked',
    ];
    const lines = filtered.map((r) =>
      [
        r.personName,
        r.family,
        r.subject,
        r.toAddress,
        r.status,
        when(r.sentAt),
        when(r.deliveredAt),
        when(r.openedAt),
        when(r.clickedAt),
      ]
        .map((v) => esc(String(v)))
        .join(','),
    );
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'selfos-email-activity.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Stack gap={3}>
      <Inline gap={2} align="center">
        <Text weight={600}>Email activity</Text>
        <AdminOnlyBadge />
      </Inline>
      <Text size="sm" tone="secondary">
        Every email SelfOS has sent for your household — delivery, opens, and clicks.
      </Text>
      {rows.length === 0 ? (
        <Text size="sm" tone="secondary">
          No email has been sent yet.
        </Text>
      ) : (
        <>
          <Inline gap={3} align="end">
            <Field label="Member">
              {(f) => (
                <Select {...f} value={member} onChange={(e) => setMember(e.target.value)}>
                  <option value="all">All members</option>
                  {members.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Family">
              {(f) => (
                <Select {...f} value={family} onChange={(e) => setFamily(e.target.value)}>
                  <option value="all">All families</option>
                  {families.map((fam) => (
                    <option key={fam} value={fam}>
                      {fam}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button variant="secondary" onClick={exportCsv}>
              Export CSV
            </Button>
          </Inline>
          {bounced + complained > 0 ? (
            <Text size="sm" tone="secondary">
              Delivery health: {bounced} bounced · {complained} complaint
              {complained === 1 ? '' : 's'}.
            </Text>
          ) : null}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '14px' }}>
              <thead>
                <tr>
                  {['Member', 'Family', 'Subject', 'To', 'Status', 'Sent'].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: 'left',
                        padding: '6px 10px',
                        borderBottom: '1px solid var(--color-border)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td style={cellStyle}>{r.personName}</td>
                    <td style={cellStyle}>{FAMILY_LABEL[r.family] ?? r.family}</td>
                    <td style={cellStyle}>{r.subject}</td>
                    <td style={cellStyle}>{r.toAddress}</td>
                    <td style={cellStyle}>{r.status}</td>
                    <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>{when(r.sentAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Stack>
  );
}

const cellStyle = {
  padding: '6px 10px',
  borderBottom: '1px solid var(--color-border-subtle)',
  verticalAlign: 'top',
} as const;

/**
 * "You're both up for this" (67 §3.6) — a couple suggestion both partners tapped "I'm game" on (via email).
 * Own-scoped, self-hides when there are none.
 */
function GreenLightsSection(): JSX.Element | null {
  const [greens, setGreens] = useState<
    { partnerId: string; partnerName: string; label: string; sharedSuggestionKey: string }[]
  >([]);
  useEffect(() => {
    void (async () => setGreens((await window.selfos?.emailMutualGreenLights()) ?? []))();
  }, []);
  if (greens.length === 0) return null;
  return (
    <Stack gap={2}>
      <Text weight={600}>You’re both up for this</Text>
      {greens.map((g) => (
        <Text key={g.sharedSuggestionKey} size="sm">
          You and <strong>{g.partnerName}</strong> both said yes to a suggestion SelfOS emailed you.
        </Text>
      ))}
    </Stack>
  );
}

/**
 * Intimacy-inventory-update offers (67 §3.6) — when you tapped "I'm game" on an intimacy email, an in-app
 * offer to mark that in your inventory. NEVER silent: it's applied only on your explicit tap here.
 */
function IntimacyOffersSection(): JSX.Element | null {
  const [offers, setOffers] = useState<{ actKey: string; actLabel: string }[]>([]);
  const load = async (): Promise<void> => {
    setOffers((await window.selfos?.emailIntimacyOffers()) ?? []);
  };
  useEffect(() => {
    void load();
  }, []);
  if (offers.length === 0) return null;
  const apply = async (actKey: string): Promise<void> => {
    await window.selfos?.emailApplyIntimacyOffer({ actKey });
    await load();
  };
  return (
    <Stack gap={2}>
      <Text weight={600}>Update your intimacy inventory?</Text>
      <Text size="sm" tone="secondary">
        You said you’re into these in a recent email. Add them to your inventory? (Nothing changes
        unless you tap.)
      </Text>
      {offers.map((o) => (
        <Inline key={o.actKey} gap={2} align="center">
          <Text size="sm">{o.actLabel}</Text>
          <Button variant="secondary" onClick={() => void apply(o.actKey)}>
            Add it
          </Button>
        </Inline>
      ))}
    </Stack>
  );
}

/** Family label for the response history (matches the family toggles above). */
const FAMILY_LABEL: Record<string, string> = {
  welcome: 'Welcome',
  'questionnaire-delivery': 'Questionnaire',
  transactional: 'Transactional',
  digest: 'Digest',
  're-engagement': 'Re-engagement',
  'ai-suggestion': 'Suggestion',
  'ai-suggestion-intimacy': 'Intimacy',
  milestone: 'Milestone',
};

/**
 * Your email responses (67 §3.6 / Phase 4) — the own-only, editable history of what you tapped in an email
 * (drained back from the relay). Self-hides when there are none.
 */
function ResponsesSection(): JSX.Element | null {
  const [responses, setResponses] = useState<EmailResponse[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const load = async (): Promise<void> => {
    setResponses((await window.selfos?.emailResponses()) ?? []);
  };
  useEffect(() => {
    void load();
  }, []);

  if (responses.length === 0) return null;

  const save = async (id: string): Promise<void> => {
    await window.selfos?.emailEditResponse({ id, answer: draft.trim() });
    setEditing(null);
    await load();
  };

  return (
    <Stack gap={2}>
      <Text weight={600}>Your email responses</Text>
      <Text size="sm" tone="secondary">
        What you’ve tapped in a SelfOS email. Only you can see these.
      </Text>
      {responses.map((r) => (
        <div key={r.id}>
          {editing === r.id ? (
            <Inline gap={2} align="end">
              <TextInput
                aria-label="Edit response"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <Button
                variant="secondary"
                aria-label="Save response"
                onClick={() => void save(r.id)}
              >
                Save
              </Button>
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </Inline>
          ) : (
            <Inline gap={2} align="center">
              <Text size="sm">
                <strong>{FAMILY_LABEL[r.family] ?? r.family}</strong> — {r.answer}
                {r.edited ? ' (edited)' : ''}
              </Text>
              <Button
                variant="secondary"
                onClick={() => {
                  setEditing(r.id);
                  setDraft(r.answer);
                }}
              >
                Edit
              </Button>
            </Inline>
          )}
        </div>
      ))}
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
  intimacyEligible,
  onSaved,
  onRefreshStatus,
}: {
  connected: boolean;
  prefs: EmailPrefs | null;
  intimacyEligible: boolean;
  onSaved: (next: EmailPrefs) => void;
  onRefreshStatus: () => void;
}): JSX.Element {
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setAddress(prefs?.address ?? '');
  }, [prefs?.address]);

  const welcomeOn = prefs?.families?.welcome ?? true;
  const transactionalOn = prefs?.families?.transactional ?? true;
  const digestOn = prefs?.families?.digest ?? true;
  const reengagementOn = prefs?.families?.['re-engagement'] ?? true;
  const digestDay = prefs?.digestDay ?? 0;
  const digestTime = prefs?.digestTime ?? 'evening';
  const suggestionsOn = prefs?.families?.['ai-suggestion'] ?? true;
  const intimacyOn = prefs?.families?.['ai-suggestion-intimacy'] ?? false;
  const intimacyEmailOptIn = prefs?.intimacyEmailOptIn ?? false;
  const milestoneOn = prefs?.families?.milestone ?? true;
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
        label="Transactional alerts"
        help="A heads-up when something happens for you — a response arrives, a partner invites you, someone shares their story."
        checked={transactionalOn}
        disabled={busy || !connected}
        onChange={(checked) => void patch({ families: { transactional: checked } })}
      />
      <ToggleRow
        label="Weekly digest"
        help="A gentle weekly look-back: your reflection of the week, momentum, and what’s been happening."
        checked={digestOn}
        disabled={busy || !connected}
        onChange={(checked) => void patch({ families: { digest: checked } })}
      />
      {digestOn ? (
        <Inline gap={3} align="end">
          <Field label="Digest day">
            {(f) => (
              <Select
                {...f}
                value={String(digestDay)}
                disabled={busy || !connected}
                onChange={(event) => void patch({ digestDay: Number(event.target.value) })}
              >
                {DAY_LABELS.map((label, index) => (
                  <option key={label} value={String(index)}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Time of day">
            {(f) => (
              <Select
                {...f}
                value={digestTime}
                disabled={busy || !connected}
                onChange={(event) =>
                  void patch({
                    digestTime: event.target.value as 'morning' | 'afternoon' | 'evening',
                  })
                }
              >
                <option value="morning">Morning</option>
                <option value="afternoon">Afternoon</option>
                <option value="evening">Evening</option>
              </Select>
            )}
          </Field>
        </Inline>
      ) : null}
      <ToggleRow
        label="Re-engagement nudges"
        help="If you’ve been away a while with something waiting, one gentle nudge to come back."
        checked={reengagementOn}
        disabled={busy || !connected}
        onChange={(checked) => void patch({ families: { 're-engagement': checked } })}
      />
      <ToggleRow
        label="AI coach suggestions"
        help="Once or twice a week, a warm, personal suggestion from your coach — a reflection to sit with, something to try, or a quick check-in you can answer right from the email."
        checked={suggestionsOn}
        disabled={busy || !connected}
        onChange={(checked) => void patch({ families: { 'ai-suggestion': checked } })}
      />
      {intimacyEligible ? (
        <ToggleRow
          label="Intimacy suggestions by email"
          help="Explicit, act-specific suggestions built only from what you and a partner have BOTH said you’re into. Wanting explicit content in the app is separate from wanting it in your inbox — this is off unless you turn it on, and needs both partners’ 18+ and shared-inventory consent."
          checked={intimacyOn && intimacyEmailOptIn}
          disabled={busy || !connected}
          onChange={(checked) =>
            void patch({
              families: { 'ai-suggestion-intimacy': checked },
              intimacyEmailOptIn: checked,
            })
          }
        />
      ) : (
        <Stack gap={1}>
          <Text weight={600}>Intimacy suggestions by email</Text>
          <Text size="sm" tone="secondary">
            Explicit, act-specific suggestions built only from what you and a partner have BOTH said
            you’re into. To turn these on, confirm you’re 18+ (a one-time, app-wide
            acknowledgement).
          </Text>
          <Inline gap={2}>
            <Button
              variant="secondary"
              disabled={busy || !connected}
              onClick={async () => {
                setBusy(true);
                try {
                  await window.selfos?.emailAcknowledgeAdult();
                  onRefreshStatus();
                  await patch({
                    families: { 'ai-suggestion-intimacy': true },
                    intimacyEmailOptIn: true,
                  });
                } finally {
                  setBusy(false);
                }
              }}
            >
              I’m 18+ — turn these on
            </Button>
          </Inline>
        </Stack>
      )}
      <ToggleRow
        label="Milestones & celebrations"
        help="A short well-done when you reach a goal, cross a streak, or your Story book is ready to read."
        checked={milestoneOn}
        disabled={busy || !connected}
        onChange={(checked) => void patch({ families: { milestone: checked } })}
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
