/// <reference types="vite/client" />
import type { SelfosBridge } from '@shared/channels';

declare global {
  interface Window {
    selfos?: SelfosBridge;
  }

  /** App version, injected at build time via `define` (see buildInfo.ts / 19-distribution §3.3). */
  const __APP_VERSION__: string;
  /** Short git SHA of the build (`'dev'` when built outside git). */
  const __BUILD_SHA__: string;
  /** Build date `YYYY-MM-DD`. */
  const __BUILD_DATE__: string;
}
