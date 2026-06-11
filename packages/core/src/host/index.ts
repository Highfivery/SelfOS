// @selfos/core/host — platform host interfaces injected into the business logic (07-mobile-platform §5.1).
export * from './fileSystem';
export * from './secretStore';
export * from './claudeClient';
// An in-memory `FileSystem` for tests + the web preview (07-mobile-platform §10, iii-b2).
export * from './memFileSystem';
