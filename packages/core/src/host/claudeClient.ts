/**
 * The Claude API host (00-architecture §6.2, 07-mobile-platform §5.1) — an injectable streaming client
 * so the proxy/chat logic is testable without the network and so each platform can supply its transport
 * (the Anthropic SDK in Electron's main process; a browser-mode SDK / native-HTTP plugin on iOS, §11 Q1).
 * The API key is passed per call and never reaches the renderer.
 */
/**
 * A Claude message content block (45-session-attachments §5.3). A message's `content` is either a plain
 * string (text-only, today's behaviour) or an array of blocks mixing text + base64 images for vision. All
 * shipped Claude 4.x models support vision; the block shapes mirror the Anthropic SDK's text/image params.
 */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

/** Flatten a message's content to its text (drops image blocks) — for the offline fakes + any text-only use. */
export function flattenContent(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('');
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

/**
 * Why a reply ended (66 §4). `max_tokens` means the model hit the ceiling mid-sentence — the reply is
 * TRUNCATED, not finished. Surfacing it is what makes a cut-off detectable at all: before this, a
 * truncated reply was persisted as if the model had chosen to stop, so nothing downstream could tell
 * the difference (the reported "the AI just stops" bug). Kept as a widened string, not a closed union,
 * so a new API stop reason can never crash a turn.
 */
export type ClaudeStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'stop_sequence'
  | 'tool_use'
  | (string & {});

export interface ClaudeStreamResult {
  text: string;
  usage: ClaudeUsage;
  /** Absent when the transport can't report one — treated as "finished" (never as truncated). */
  stopReason?: ClaudeStopReason;
}

export interface ClaudeClient {
  send(options: ClaudeSendOptions): Promise<string>;
  /** Stream a reply, invoking `onDelta` per text chunk; resolves with the full text + token usage. */
  stream(
    options: ClaudeStreamOptions,
    onDelta: (text: string) => void,
  ): Promise<ClaudeStreamResult>;
}
