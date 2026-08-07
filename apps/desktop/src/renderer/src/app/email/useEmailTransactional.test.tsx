import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import type { EmailStatus } from '@selfos/core/schemas';
import { DEFAULT_ROLES } from '@shared/capabilities';
import { useEmailTransactional } from './useEmailTransactional';
import { useSessionStore } from '../../stores/sessionStore';
import { useNotificationStore } from '../../stores/notificationStore';
import type { NotificationCandidate } from '../notifications/notificationKinds';
import { clearMockBridge, installMockBridge } from '../../test-utils/bridge';

const person = {
  id: 'p1',
  schemaVersion: 1 as const,
  displayName: 'Ben',
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
};

const READY: EmailStatus = {
  configured: true,
  domainVerified: true,
  hasSharedKey: false,
  hasDeviceOverride: true,
  resolvedReady: true,
  source: 'device',
};

const PREFS = {
  schemaVersion: 1 as const,
  address: 'me@inbox.example',
  families: {},
  richness: 'brief' as const,
  intimacyEmailOptIn: false,
  paused: false,
  digestDay: 0,
  digestTime: 'evening' as const,
  unsubscribeToken: 't',
};

function Harness(): null {
  useEmailTransactional();
  return null;
}

function signIn(): void {
  useSessionStore.setState({
    activePerson: person,
    access: {
      roles: DEFAULT_ROLES,
      accounts: [{ personId: person.id, roleId: 'member', hasPin: false }],
    },
  });
}

afterEach(() => {
  clearMockBridge();
  useSessionStore.setState({ activePerson: null, access: null });
  useNotificationStore.getState().reset();
});

const emailable: NotificationCandidate = {
  kind: 'responses-arrived',
  coalesceKey: 'responses-arrived:q1',
  signature: '1',
  title: 'Alex answered “Q1”',
  body: '1 response is ready.',
};
const housekeeping: NotificationCandidate = {
  kind: 'sync-conflict',
  coalesceKey: 'sync-conflict',
  signature: '1',
  title: 'Sync conflicts found',
};

describe('useEmailTransactional (67 §3.2 / Phase 2)', () => {
  it('emails each emailable candidate (not housekeeping kinds) once, keyed by coalesceKey#signature', async () => {
    const send = vi.fn(() => Promise.resolve({ ok: true as const, entryId: 'e1' }));
    installMockBridge({
      emailStatus: () => Promise.resolve(READY),
      emailGetPrefs: () => Promise.resolve(PREFS),
      emailSendTransactional: send,
    });
    signIn();
    useNotificationStore.setState({ candidates: [emailable, housekeeping] });
    render(<Harness />);

    // Exactly ONE call, and it's the emailable candidate — so the sync-conflict candidate never emailed.
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'responses-arrived', sourceKey: 'responses-arrived:q1#1' }),
    );

    // A recompute with the SAME candidate doesn't re-fire (de-dup on sourceKey).
    useNotificationStore.setState({ candidates: [{ ...emailable }] });
    await new Promise((r) => setTimeout(r, 20));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does nothing when email is not ready', async () => {
    const send = vi.fn(() => Promise.resolve({ ok: true as const, entryId: 'e1' }));
    installMockBridge({
      emailStatus: () => Promise.resolve({ ...READY, resolvedReady: false }),
      emailSendTransactional: send,
    });
    signIn();
    useNotificationStore.setState({ candidates: [emailable] });
    render(<Harness />);
    await new Promise((r) => setTimeout(r, 20));
    expect(send).not.toHaveBeenCalled();
  });

  it('does nothing when the person lacks email.own', async () => {
    const send = vi.fn(() => Promise.resolve({ ok: true as const, entryId: 'e1' }));
    installMockBridge({
      emailStatus: () => Promise.resolve(READY),
      emailGetPrefs: () => Promise.resolve(PREFS),
      emailSendTransactional: send,
    });
    // No sign-in → no active person / capability.
    useNotificationStore.setState({ candidates: [emailable] });
    render(<Harness />);
    await new Promise((r) => setTimeout(r, 20));
    expect(send).not.toHaveBeenCalled();
  });

  it('clamps an over-long title/body to the bridge caps (a questionnaire title has no length cap)', async () => {
    const send = vi.fn(() => Promise.resolve({ ok: true as const, entryId: 'e1' }));
    installMockBridge({
      emailStatus: () => Promise.resolve(READY),
      emailGetPrefs: () => Promise.resolve(PREFS),
      emailSendTransactional: send,
    });
    signIn();
    useNotificationStore.setState({
      candidates: [{ ...emailable, title: 'x'.repeat(300), body: 'y'.repeat(600) }],
    });
    render(<Harness />);
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const calls = send.mock.calls as unknown as Array<[{ title: string; body?: string }]>;
    expect(calls[0]?.[0]?.title.length).toBe(200);
    expect(calls[0]?.[0]?.body?.length).toBe(400);
  });

  it('does not send once the active person changes before the send resolves (structural guard)', async () => {
    let release: (v: EmailStatus) => void = () => {};
    const statusGate = new Promise<EmailStatus>((r) => {
      release = r;
    });
    const send = vi.fn(() => Promise.resolve({ ok: true as const, entryId: 'e1' }));
    installMockBridge({
      emailStatus: () => statusGate,
      emailGetPrefs: () => Promise.resolve(PREFS),
      emailSendTransactional: send,
    });
    signIn();
    useNotificationStore.setState({ candidates: [emailable] });
    render(<Harness />);
    // Sign out (person switch) BEFORE emailStatus resolves; then let it resolve.
    useSessionStore.setState({ activePerson: null, access: null });
    release(READY);
    await new Promise((r) => setTimeout(r, 20));
    expect(send).not.toHaveBeenCalled();
  });
});
