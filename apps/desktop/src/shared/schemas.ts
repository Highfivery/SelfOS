// Re-export shim — the schemas now live in @selfos/core (07-mobile-platform §5.2). This keeps the
// renderer's `@shared/schemas` / `../shared/schemas` imports and the IPC `channels.ts` contract
// unchanged while the single source of truth moves to the platform-agnostic package.
export * from '@selfos/core/schemas';
