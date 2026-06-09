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
