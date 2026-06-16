/**
 * The Claude API host (00-architecture §6.2, 07-mobile-platform §5.1) — an injectable streaming client
 * so the proxy/chat logic is testable without the network and so each platform can supply its transport
 * (the Anthropic SDK in Electron's main process; a browser-mode SDK / native-HTTP plugin on iOS, §11 Q1).
 * The API key is passed per call and never reaches the renderer.
 */
export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeSendOptions {
  apiKey: string;
  model: string;
  system?: string;
  messages: ClaudeMessage[];
  maxTokens: number;
}

export interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

export interface ClaudeStreamOptions {
  apiKey: string;
  model: string;
  system: string;
  messages: ClaudeMessage[];
  maxTokens: number;
  // Adaptive extended thinking shares the `maxTokens` budget with the visible output. For a coaching chat
  // that's fine (long budget, reasoning helps). For a bounded structured-JSON call (questionnaire generation,
  // analysis) heavy thinking can consume the whole budget and TRUNCATE the JSON to empty — so those callers
  // pass `false` to disable thinking and keep the full budget for the output. Defaults to on (chat behavior).
  extendedThinking?: boolean;
}

export interface ClaudeStreamResult {
  text: string;
  usage: ClaudeUsage;
}

export interface ClaudeClient {
  send(options: ClaudeSendOptions): Promise<string>;
  /** Stream a reply, invoking `onDelta` per text chunk; resolves with the full text + token usage. */
  stream(
    options: ClaudeStreamOptions,
    onDelta: (text: string) => void,
  ): Promise<ClaudeStreamResult>;
}
