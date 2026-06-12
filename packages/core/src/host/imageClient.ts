/**
 * The image-generation host (13-dream-images §5.1) — SelfOS's SECOND AI provider, behind an injectable
 * interface mirroring `ClaudeClient` so the dream-image logic is testable without the network and each
 * platform supplies its transport (the OpenAI image API in Electron's main process; a browser-mode call
 * or native plugin on iOS). The API key is passed per call and never reaches the renderer (00 §6.2).
 *
 * Text generation stays Anthropic; this provider renders pixels ONLY, from a Claude-distilled, name-free
 * prompt (§5.3). A content-policy decline maps to `REFUSED` (uncharged → unmetered, §7), distinct from a
 * transport `ERROR`, so the service never meters an uncharged refusal.
 */
export interface ImageGenerateOptions {
  apiKey: string;
  model: string;
  prompt: string;
  size?: string; // e.g. '1024x1024' (v1 is a fixed square, §4.4)
}

export interface ImageGenerateResult {
  bytes: Uint8Array; // the raw image
  mime: string; // e.g. 'image/png'
}

export type ImageGenerateOutcome =
  | { ok: true; image: ImageGenerateResult }
  | { ok: false; reason: 'REFUSED' | 'ERROR'; message: string }; // REFUSED = content-policy decline (uncharged)

export interface ImageClient {
  generate(options: ImageGenerateOptions): Promise<ImageGenerateOutcome>;
}
