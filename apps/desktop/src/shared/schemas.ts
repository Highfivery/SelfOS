import { z } from 'zod';

/**
 * Zod schemas are the single source of truth for IPC payload shapes (00-architecture §6.1).
 * TS types are inferred from them. This module imports zod, so it must NOT be imported by the
 * sandboxed preload — the preload imports type-only from `./channels` instead.
 */

export const BootPhaseSchema = z.enum(['starting', 'onboarding', 'vault-error', 'ready']);
export type BootPhase = z.infer<typeof BootPhaseSchema>;

export const BootStateSchema = z.object({
  phase: BootPhaseSchema,
  vaultPath: z.string().nullable(),
  hasSettings: z.boolean(),
});
export type BootState = z.infer<typeof BootStateSchema>;

/** `.selfos/meta.json` — small app metadata stored inside the vault. */
export const VaultMetaSchema = z.object({
  schemaVersion: z.number().int().positive(),
  vaultId: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type VaultMeta = z.infer<typeof VaultMetaSchema>;

/** Device-local state (in userData, never synced) — which vault is active. */
export const DeviceStateSchema = z.object({
  schemaVersion: z.number().int().positive(),
  vaultPath: z.string().nullable(),
});
export type DeviceState = z.infer<typeof DeviceStateSchema>;
