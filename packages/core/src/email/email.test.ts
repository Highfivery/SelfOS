import { describe, expect, it, vi } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import type { EmailClient } from '../host';
import { buildQuestionnaireDeliveryEmail, buildWelcomeEmail } from './emailComposer';
import {
  emailStatusOf,
  readEmailConfig,
  resolveResendKey,
  updateEmailConfig,
  writeSharedResendKey,
} from './emailConfig';
import { effectiveFamilyEnabled, ensureEmailPrefs, setEmailPrefs } from './emailPrefs';
import { listEmailActivity, sendFamilyEmail, sendQuestionnaireDeliveryEmail } from './emailSend';
import { RESEND_API_KEY_ID } from '../schemas';

const key = generateMasterKey();
const now = new Date('2026-08-07T12:00:00.000Z');

/** A minimal in-memory SecretStore for the device-override tests. */
function memSecrets(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get: (id: string) => Promise.resolve(store.get(id) ?? null),
    set: (id: string, value: string) => {
      store.set(id, value);
      return Promise.resolve();
    },
    has: (id: string) => Promise.resolve(store.has(id)),
    clear: (id: string) => {
      store.delete(id);
      return Promise.resolve();
    },
  };
}

function fakeEmail(over: Partial<EmailClient> = {}): EmailClient {
  return {
    send: vi.fn(() => Promise.resolve({ ok: true as const, id: 'resend-1' })),
    cancel: vi.fn(() => Promise.resolve()),
    status: vi.fn(() => Promise.resolve([])),
    verify: vi.fn(() => Promise.resolve({ ok: true as const, domains: [] })),
    ...over,
  };
}

describe('resolveResendKey + emailStatusOf (67 §4.1)', () => {
  it('device override wins, else shared, else none; status carries no key value', async () => {
    const fs = memFileSystem();
    // none
    expect((await resolveResendKey(memSecrets(), fs, key)).source).toBe('none');
    // shared
    await writeSharedResendKey(fs, key, 're-shared', now);
    expect(await resolveResendKey(memSecrets(), fs, key)).toEqual({
      key: 're-shared',
      source: 'shared',
    });
    // device override wins
    const resolved = await resolveResendKey(
      memSecrets({ [RESEND_API_KEY_ID]: 're-device' }),
      fs,
      key,
    );
    expect(resolved).toEqual({ key: 're-device', source: 'device' });

    // A key alone isn't "ready" — a from-address is required too (else a send would fail NOT_CONFIGURED).
    const keyOnly = await emailStatusOf(memSecrets({ [RESEND_API_KEY_ID]: 're-device' }), fs, key);
    expect(keyOnly).toMatchObject({
      hasDeviceOverride: true,
      resolvedReady: false,
      source: 'device',
    });
    await updateEmailConfig(fs, key, { fromAddress: 'hi@fam.example' }, now);
    const status = await emailStatusOf(memSecrets({ [RESEND_API_KEY_ID]: 're-device' }), fs, key);
    expect(status).toMatchObject({
      hasSharedKey: true,
      hasDeviceOverride: true,
      resolvedReady: true,
      source: 'device',
    });
    expect(JSON.stringify(status)).not.toContain('re-device'); // never a key value
  });

  it('a corrupt config reads as null (fail-closed) and status is none', async () => {
    const fs = memFileSystem();
    await fs.writeAtomic('config/email.enc', new TextEncoder().encode('not-json'));
    expect(await readEmailConfig(fs, key)).toBeNull();
    expect((await emailStatusOf(memSecrets(), fs, key)).resolvedReady).toBe(false);
  });

  it('updateEmailConfig round-trips the from-address + domain', async () => {
    const fs = memFileSystem();
    await updateEmailConfig(fs, key, { fromAddress: 'hi@fam.example', fromName: 'SelfOS' }, now);
    const config = await readEmailConfig(fs, key);
    expect(config?.fromAddress).toBe('hi@fam.example');
  });
});

describe('emailPrefs (67 §4.2)', () => {
  it('mints an unsubscribe token once, defaults intimacy off + everything else on', async () => {
    const fs = memFileSystem();
    const p1 = await ensureEmailPrefs(fs, key, 'me', now);
    const p2 = await ensureEmailPrefs(fs, key, 'me', new Date());
    expect(p2.unsubscribeToken).toBe(p1.unsubscribeToken); // minted once
    expect(effectiveFamilyEnabled(p1, 'welcome')).toBe(true);
    expect(effectiveFamilyEnabled(p1, 'ai-suggestion-intimacy')).toBe(false);
  });

  it('coerces the intimacy opt-in OFF when ineligible; clears a blank address (fail-closed)', async () => {
    const fs = memFileSystem();
    const ineligible = await setEmailPrefs(
      fs,
      key,
      'me',
      { intimacyEmailOptIn: true, address: 'x@y.z' },
      false,
      now,
    );
    expect(ineligible.intimacyEmailOptIn).toBe(false);
    const cleared = await setEmailPrefs(fs, key, 'me', { address: '  ' }, true, now);
    expect(cleared.address).toBeUndefined();
    const eligible = await setEmailPrefs(fs, key, 'me', { intimacyEmailOptIn: true }, true, now);
    expect(eligible.intimacyEmailOptIn).toBe(true);
  });
});

describe('buildWelcomeEmail (67 §3.2 / Phase 0)', () => {
  it('renders HTML + plaintext with the name, the not-medical line, and no inline SVG', () => {
    const email = buildWelcomeEmail({ recipientName: 'Ada' });
    expect(email.subject).toContain('Ada');
    expect(email.html).toContain('Welcome, Ada');
    expect(email.html).toContain('wellness support, not medical care');
    expect(email.html).not.toContain('<svg');
    expect(email.text).toContain('Welcome, Ada');
  });

  it('escapes an HTML-bearing name', () => {
    const email = buildWelcomeEmail({ recipientName: '<b>x</b>' });
    expect(email.html).not.toContain('<b>x</b>');
    expect(email.html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});

describe('sendFamilyEmail — the gated orchestrator (67 §5.2/§7/§8)', () => {
  async function ready(fs = memFileSystem()) {
    await updateEmailConfig(fs, key, { fromAddress: 'hi@fam.example', fromName: 'SelfOS' }, now);
    await setEmailPrefs(fs, key, 'me', { address: 'me@inbox.example' }, false, now);
    return fs;
  }
  const base = (fs: ReturnType<typeof memFileSystem>, over = {}) => ({
    fs,
    key,
    email: fakeEmail(),
    resendKey: 're-key' as string | undefined,
    personId: 'me',
    family: 'welcome' as const,
    composed: buildWelcomeEmail({ recipientName: 'Me' }),
    crisisSuppressed: false,
    now,
    ...over,
  });

  it('sends when configured + opted in, and logs an EmailActivityEntry', async () => {
    const fs = await ready();
    const res = await sendFamilyEmail(base(fs));
    expect(res.ok).toBe(true);
    const log = await listEmailActivity(fs, key, 'me');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      family: 'welcome',
      status: 'sent',
      toAddress: 'me@inbox.example',
      resendMessageId: 'resend-1',
    });
  });

  it('gates: crisis → CRISIS (no send/log); no key → NOT_CONFIGURED; no address → NO_ADDRESS; off → FAMILY_OFF; paused → PAUSED', async () => {
    const fs = await ready();
    const email = fakeEmail();
    expect(await sendFamilyEmail(base(fs, { email, crisisSuppressed: true }))).toEqual({
      ok: false,
      reason: 'CRISIS',
    });
    expect(
      ((await sendFamilyEmail(base(fs, { email, resendKey: undefined }))) as { reason: string })
        .reason,
    ).toBe('NOT_CONFIGURED');
    // No address (fresh person)
    expect(
      ((await sendFamilyEmail(base(fs, { email, personId: 'nobody' }))) as { reason: string })
        .reason,
    ).toBe('NO_ADDRESS');
    // Family off
    await setEmailPrefs(fs, key, 'me', { families: { welcome: false } }, false, now);
    expect(((await sendFamilyEmail(base(fs, { email }))) as { reason: string }).reason).toBe(
      'FAMILY_OFF',
    );
    await setEmailPrefs(fs, key, 'me', { families: { welcome: true }, paused: true }, false, now);
    expect(((await sendFamilyEmail(base(fs, { email }))) as { reason: string }).reason).toBe(
      'PAUSED',
    );
    // Never sent while gated.
    expect(email.send).not.toHaveBeenCalled();
    expect(await listEmailActivity(fs, key, 'me')).toHaveLength(0);
  });

  it('a Resend failure is logged as failed and returns SEND_ERROR', async () => {
    const fs = await ready();
    const email = fakeEmail({
      send: vi.fn(() =>
        Promise.resolve({
          ok: false as const,
          reason: 'API_ERROR' as const,
          message: 'domain unverified',
        }),
      ),
    });
    const res = await sendFamilyEmail(base(fs, { email }));
    expect(res).toEqual({ ok: false, reason: 'SEND_ERROR', message: 'domain unverified' });
    expect((await listEmailActivity(fs, key, 'me'))[0]?.status).toBe('failed');
  });
});

describe('buildQuestionnaireDeliveryEmail (67 §3.2 / Phase 1 / family A)', () => {
  it('renders the CTA link, the message body (html + text), and escapes the note; no inline SVG', () => {
    const email = buildQuestionnaireDeliveryEmail({
      subject: 'Ben would like your input',
      message: 'Hi <there>!\n\nOpen the secure link: https://relay.example/q/abc\n\nPIN: 123456',
      link: 'https://relay.example/q/abc#k=xyz',
    });
    expect(email.subject).toBe('Ben would like your input');
    // The CTA button points at the link; the message body renders as escaped paragraphs.
    expect(email.html).toContain('href="https://relay.example/q/abc#k=xyz"');
    expect(email.html).toContain('Open your questionnaire');
    expect(email.html).toContain('Hi &lt;there&gt;!');
    expect(email.html).toContain('wellness support, not medical care');
    expect(email.html).not.toContain('<svg');
    // Plaintext is the message verbatim (link + PIN preserved for non-HTML clients).
    expect(email.text).toContain('https://relay.example/q/abc');
    expect(email.text).toContain('PIN: 123456');
  });
});

describe('sendQuestionnaireDeliveryEmail — family A (67 §3.2/§7)', () => {
  const composed = buildQuestionnaireDeliveryEmail({
    subject: 'A questionnaire for you',
    message: 'Open the secure link: https://relay.example/q/abc',
    link: 'https://relay.example/q/abc',
  });
  const deliveryBase = (fs: ReturnType<typeof memFileSystem>, over = {}) => ({
    fs,
    key,
    email: fakeEmail(),
    resendKey: 're-key' as string | undefined,
    senderPersonId: 'sender',
    toAddress: 'alex@example.com',
    composed,
    now,
    ...over,
  });

  it('sends to the RECIPIENT contact address and logs under the SENDER (no engagement prefs needed)', async () => {
    const fs = memFileSystem();
    // Only the household config is set — the recipient has NO EmailPrefs (they may not be a SelfOS person).
    await updateEmailConfig(fs, key, { fromAddress: 'hi@fam.example', fromName: 'SelfOS' }, now);
    const email = fakeEmail();
    const res = await sendQuestionnaireDeliveryEmail(deliveryBase(fs, { email }));
    expect(res.ok).toBe(true);
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'alex@example.com', from: 'SelfOS <hi@fam.example>' }),
    );
    // Logged under the sender, with the recipient's address + family questionnaire-delivery.
    const log = await listEmailActivity(fs, key, 'sender');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      family: 'questionnaire-delivery',
      status: 'sent',
      toAddress: 'alex@example.com',
      personId: 'sender',
    });
    // Nothing was logged under the recipient's address as a person id.
    expect(await listEmailActivity(fs, key, 'alex@example.com')).toHaveLength(0);
  });

  it('NOT_CONFIGURED when there is no key or no from-line; NO_ADDRESS on a blank recipient (no send/log)', async () => {
    const fs = memFileSystem();
    const email = fakeEmail();
    // No config at all → NOT_CONFIGURED.
    expect(
      ((await sendQuestionnaireDeliveryEmail(deliveryBase(fs, { email }))) as { reason: string })
        .reason,
    ).toBe('NOT_CONFIGURED');
    // Key present but no from-address → still NOT_CONFIGURED.
    expect(
      (
        (await sendQuestionnaireDeliveryEmail(
          deliveryBase(fs, { email, resendKey: undefined }),
        )) as { reason: string }
      ).reason,
    ).toBe('NOT_CONFIGURED');
    // Configured, but a blank recipient → NO_ADDRESS.
    await updateEmailConfig(fs, key, { fromAddress: 'hi@fam.example' }, now);
    expect(
      (
        (await sendQuestionnaireDeliveryEmail(deliveryBase(fs, { email, toAddress: '   ' }))) as {
          reason: string;
        }
      ).reason,
    ).toBe('NO_ADDRESS');
    expect(email.send).not.toHaveBeenCalled();
    expect(await listEmailActivity(fs, key, 'sender')).toHaveLength(0);
  });

  it('a Resend failure is logged as failed and returns SEND_ERROR', async () => {
    const fs = memFileSystem();
    await updateEmailConfig(fs, key, { fromAddress: 'hi@fam.example' }, now);
    const email = fakeEmail({
      send: vi.fn(() =>
        Promise.resolve({ ok: false as const, reason: 'API_ERROR' as const, message: 'bounced' }),
      ),
    });
    const res = await sendQuestionnaireDeliveryEmail(deliveryBase(fs, { email }));
    expect(res).toEqual({ ok: false, reason: 'SEND_ERROR', message: 'bounced' });
    expect((await listEmailActivity(fs, key, 'sender'))[0]?.status).toBe('failed');
  });
});
