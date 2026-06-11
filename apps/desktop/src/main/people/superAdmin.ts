/**
 * The concealed super-admin's in-memory "inspect everything" state for the current session
 * (04-people-roles §8). Main is the source of truth so that capability gating in the shared bridge
 * factory honors super-admin mode — the renderer flag alone is not trusted. Cleared on lock, never
 * persisted. The Electron host exposes this as `BridgeHost.isSuperAdminActive`/`setSuperAdminActive`.
 *
 * The vault-backed passphrase (storing/verifying `config/superadmin.enc` + the one-time device-local →
 * vault migration, 10-multi-device-vault §6.4) lives in the shared `createCoreBridge` factory over
 * `@selfos/core/people`, so it runs on iOS too.
 */
let inspectModeActive = false;

export function setSuperAdminActive(active: boolean): void {
  inspectModeActive = active;
}

export function isSuperAdminActive(): boolean {
  return inspectModeActive;
}
