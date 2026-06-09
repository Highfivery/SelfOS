/// <reference types="vite/client" />
import type { SelfosBridge } from '@shared/channels';

declare global {
  interface Window {
    selfos?: SelfosBridge;
  }
}
