import { useEffect, useState } from 'react';
import type { VaultSyncReadiness } from '@shared/channels';
import { useSessionStore } from '../stores/sessionStore';
import { Splash } from './boot/Splash';
import { Setup } from './boot/Setup';
import { SyncWarning } from './boot/SyncWarning';
import { UnlockScreen } from './boot/UnlockScreen';
import { LockScreen } from './LockScreen';
import { Shell } from './Shell';

/**
 * Sits between boot-ready and the app and routes three ways on two signals (10-multi-device-vault
 * §3.1): the key-free `vaultInitialized` (a vault property) and `hasMasterKey` (this device).
 *
 * | vaultInitialized | hasMasterKey | route                                            |
 * | ---------------- | ------------ | ------------------------------------------------ |
 * | false            | false        | Setup  — fresh vault; the ONLY path that mints an owner |
 * | true             | false        | Unlock — initialized vault, this device hasn't joined  |
 * | true             | true         | Shell / picker — this device holds the key; resume     |
 * | false            | true         | Unlock — desync (key but no recovery.enc); fails safely|
 *
 * With the key present we further split on `hasOwner` and the active person: an initialized vault with
 * no owner is an interrupted first-run that Setup finishes (without re-keying — §6.3); and a key-holding
 * device with no active person (e.g. a freshly-joined second device) shows the person picker first.
 */
export function HouseholdGate(): JSX.Element {
  const loaded = useSessionStore((s) => s.loaded);
  const status = useSessionStore((s) => s.status);
  const load = useSessionStore((s) => s.load);
  // Sync-safety (33 §5.D): before offering first-run Setup, check the chosen folder isn't still
  // downloading from iCloud (a not-yet-synced `recovery.enc` would look like a fresh vault).
  const [readiness, setReadiness] = useState<VaultSyncReadiness | 'checking' | null>(null);
  const [setUpAnyway, setSetUpAnyway] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  // Run the readiness check only when we're about to offer fresh-vault Setup.
  const wouldSetup =
    loaded && Boolean(status) && !status?.hasMasterKey && !status?.vaultInitialized;
  useEffect(() => {
    if (!wouldSetup || setUpAnyway) {
      setReadiness(null);
      return;
    }
    setReadiness('checking');
    void window.selfos?.vaultSyncReadiness().then((r) => setReadiness(r ?? { ready: true }));
  }, [wouldSetup, setUpAnyway]);

  if (!loaded || !status) return <Splash />;

  if (!status.hasMasterKey) {
    // Initialized vault, this device hasn't joined → Unlock.
    if (status.vaultInitialized) return <UnlockScreen />;
    // Fresh-vault Setup — but warn first if the folder is still syncing from iCloud (33 §5.D).
    if (!setUpAnyway) {
      if (readiness === null || readiness === 'checking') return <Splash />;
      if (!readiness.ready) {
        return (
          <SyncWarning
            onCheckAgain={() => {
              void load();
              setReadiness('checking');
              void window.selfos
                ?.vaultSyncReadiness()
                .then((r) => setReadiness(r ?? { ready: true }));
            }}
            onSetUpAnyway={() => setSetUpAnyway(true)}
          />
        );
      }
    }
    return <Setup />;
  }
  // Key present but no recovery.enc → desync; recover by unlocking.
  if (!status.vaultInitialized) return <UnlockScreen />;
  // Key + recovery.enc but no owner → interrupted setup; finish it (Setup won't re-key, §6.3).
  if (!status.hasOwner) return <Setup />;
  // A member redeemed an invite but hasn't set their PIN yet (e.g. a crash mid-join) → resume that
  // step rather than dropping into an open picker with a PIN-less account (§5.4).
  if (status.pendingJoinPersonId) return <UnlockScreen resumeJoin />;
  // Fully set up: pick who's here if nobody is active on this device yet.
  return status.activePersonId ? <Shell /> : <LockScreen />;
}
