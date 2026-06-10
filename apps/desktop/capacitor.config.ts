import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor config for the iOS shell (07-mobile-platform §5.4). The same React UI runs in a WKWebView;
 * `webDir` is the standalone web build produced by `vite.web.config.ts` (`pnpm build:web`). Bundle id +
 * min-iOS were resolved with the user (§11.7): `com.highfivery.selfos`, iOS 18.
 */
const config: CapacitorConfig = {
  appId: 'com.highfivery.selfos',
  appName: 'SelfOS',
  webDir: 'dist-web',
};

export default config;
