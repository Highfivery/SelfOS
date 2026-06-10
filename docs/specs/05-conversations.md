# 05 — AI conversations

> **Status:** Approved · _last updated 2026-06-09_
>
> The first conversational surface: a **streaming Claude chat** scoped to the **active person**. The
> system prompt is assembled from the coach **persona**, the **wellness/not-medical/crisis safety**
> boundary, and the person's consented **context** (`buildContext`). Transcripts are stored
> **encrypted** in the vault. This is where SelfOS finally _talks_.

Builds on [`00-architecture.md`](00-architecture.md), [`01-design-system.md`](01-design-system.md),
[`03-settings.md`](03-settings.md) (the AI settings — enable + model + key),
[`04-people-roles.md`](04-people-roles.md) (active person, `buildContext`, encryption), and
[`06-ai-usage-and-budgets.md`](06-ai-usage-and-budgets.md) (built **first**: the chat emits a usage
event per turn, enables prompt caching on the system prefix, enforces budgets, and shows cost live).

---

## 1. Overview

When a subject is the active person and AI is enabled, they can hold a **conversation** with their
coach. Each message goes to the Claude API through the **main-process proxy** (the key never leaves
main); responses **stream** back token-by-token. The model is grounded by a **system prompt** built
from a fixed coach persona, the non-negotiable safety boundary, and `buildContext(activePerson)` — so
the coach knows who it's supporting and the context they've consented to share. Every conversation is
saved as an **encrypted transcript** in the active person's vault folder.

## 2. Goals / Non-goals

**Goals**

- A **chat surface** scoped to the active person: a conversation list + a streaming message thread.
- **Streaming** responses over IPC; the API key stays in main (00-architecture §6.2).
- A **system prompt** = coach persona + safety boundary + `buildContext` (consented context).
- **Encrypted per-person transcripts** in the vault (conversations are the most sensitive data).
- The **wellness/not-medical** boundary and **crisis routing** as hard, always-present behavior.
- Gating: requires `ai.enabled` + a stored key + the active person having `sessions.own`.

**Non-goals (deferred)**

- Relationship "about us" chats (per-relationship tailored sessions) — a later slice.
- Cross-conversation long-term memory / summarization beyond the model's context window.
- Voice / audio (architecture must not preclude it).
- Tool use / retrieval / attachments inside the chat.

## 3. UX & flows

### 3.1 The chat surface (`/chat`)

- **Conversation list** (left): the active person's conversations, newest first, + "New
  conversation". Each has a title (auto from the first message, editable) and timestamp.
- **Thread** (right): messages (user right-aligned, coach left-aligned), a composer at the bottom
  (multiline, Enter to send / Shift+Enter newline), and a streaming indicator while the coach replies.
- **Always-visible footer**: the not-medical disclaimer + a quiet "Get help now" affordance that
  opens crisis resources (§7). Never dismissable.

### 3.2 Not configured

- If AI is off / no key: the chat shows a calm empty state pointing to **Settings → AI** (enable +
  add key), not an error.
- If the active person lacks `sessions.own` (e.g. a Guest): the chat surface is not available to them.

### 3.3 Sending a message

User types → message appended locally → `claude:streamStart` over IPC → main assembles the system
prompt, calls the streaming proxy, forwards `chunk` events → renderer appends tokens live → on
`done`, the full turn is persisted to the encrypted transcript. Errors (no key, auth, network, rate
limit) surface inline with the same typed envelope as the connection test (03/05).

## 4. Data model

### 4.1 Conversation (encrypted, per person)

```ts
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  ts: string; // ISO
}
interface Conversation {
  id: string;
  schemaVersion: number;
  personId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}
```

Stored encrypted at `people/<person-id>/conversations/<conversation-id>.enc` via the People-1 crypto
service (AES-256-GCM, master key). Zod-validated on read; `schemaVersion` + migrations.

## 5. Architecture & modules

### 5.1 Main process

- **claudeService (extended)** — add a **streaming** `send` that yields text deltas, backed by the
  SDK's `messages.stream()` (`.finalMessage()` for the full turn) with **adaptive thinking**
  (`thinking: {type: "adaptive"}`) for deeper reflection; only the visible **text** is streamed to the
  renderer (thinking blocks are not displayed). The injectable `ClaudeClient` keeps the offline fake
  (for tests/E2E) so streaming is deterministic without network.
- **conversationService** — CRUD over encrypted transcripts (list/get/save/delete) per person.
- **promptBuilder** — assembles the system prompt: `PERSONA` + `SAFETY` (constants) + `buildContext`.
- **chat IPC** — `claude:streamStart({ conversationId, userText })` opens a stream; main emits
  `claude:streamChunk` (delta) and `claude:streamDone` / `claude:streamError` events to the sender;
  persists the turn on done. `conversations:list/get/save/delete`.

### 5.2 Renderer

- **conversationStore** (Zustand) — the active person's conversations + the open thread + streaming
  buffer; subscribes to the stream events.
- **Chat screen** — list + thread + composer, built on the design system; nav entry gated by
  `sessions.own` + `ai.enabled`. The crisis footer is part of the chat layout.

## 6. IPC / API contracts

- `conversations:list` / `:get(id)` / `:save(conversation)` / `:delete(id)` (scoped to active person).
- `claude:streamStart({ conversationId, userText })` → begins streaming; the key + context never cross
  to the renderer. Events to the sender: `claude:streamChunk`, `claude:streamDone`,
  `claude:streamError` (typed envelope reused from 05/03).
- The renderer never sees the API key, the assembled system prompt, or other people's private data.

## 7. Safety (hard requirements)

- **Not medical.** Every conversation carries the persistent disclaimer; the persona never claims to
  diagnose, treat, or replace professional care.
- **Crisis routing.** The `SAFETY` system-prompt block instructs the model to respond with warmth and
  to **route self-harm / crisis situations to professional resources** (emergency services, crisis
  lines) rather than handling them alone. The UI's always-visible **"Get help now"** opens a curated
  resources panel. (Open question §11.2: keyword-triggered interstitial in addition.)
- **Consent & privacy.** The system prompt includes only the active person's own data + others'
  **shareable** context (`buildContext` already excludes others' private notes). Transcripts are
  encrypted at rest. Nothing is sent to Anthropic except the consented conversation.

## 8. Accessibility

Per [`01-design-system.md`](01-design-system.md) §9: the composer, message list, and conversation
switcher are keyboard-operable and screen-reader friendly; streaming updates use a polite live region;
the crisis affordance is reachable and clearly labeled.

## 9. Testing strategy

- **Unit (node):** promptBuilder (persona + safety + context present; others' private data absent),
  conversationService (encrypted round-trip, list/delete), the streaming proxy with the **fake client**
  (chunks assembled; error envelopes).
- **Component (RTL):** the chat thread renders streamed tokens; composer send; not-configured empty
  state; the crisis footer is always present.
- **E2E (Playwright):** with `SELFOS_FAKE_CLAUDE`, send a message → streamed reply appears → transcript
  persists across reopen; the not-medical disclaimer + "Get help now" are always visible; the
  no-overflow + control-geometry guards apply to the chat screen.

## 10. Proposed build slices (after approval)

1. **Streaming proxy + transcripts** — extend claudeService for streaming, conversationService,
   promptBuilder, chat IPC. Unit-tested with the fake client. Minimal/no UI.
2. **Chat UI** — conversation list + thread + composer + streaming + the crisis footer; nav gating.
3. **Polish** — titles/rename, delete, empty/error states, accessibility live-region pass.

## 11. Resolved decisions

Confirmed with the user (2026-06-09):

1. **Conversations** — multiple named conversations per person, with a list (title from the first
   message, editable; deletable).
2. **Crisis handling** — the `SAFETY` system-prompt block routes crisis/self-harm to professional
   resources, plus a persistent, non-dismissable **"Get help now"** affordance always on screen. No
   keyword interstitial in v1 (avoids false positives; revisit later).
3. **Transcripts** — **encrypted** at rest (AES-256-GCM, master key), like the rest of People data.
4. **Model / thinking** — default to the `ai.model` setting (`claude-sonnet-4-6`) with **adaptive
   thinking** (`thinking: {type: "adaptive"}`) for deeper reflection; only visible text is streamed.
5. **Persona** — a fixed v1 coach voice: **warm, reflective, non-clinical, curious, non-judgmental**;
   asks open questions, validates, never diagnoses or prescribes. Lives as a `PERSONA` constant in the
   prompt builder; making it user-configurable is a future setting.

## 12. Changelog

- 2026-06-09 — created (draft).
- 2026-06-09 — resolved open questions (multiple named conversations, model-instruction + always-on
  crisis resources, encrypted transcripts, adaptive thinking, fixed warm non-clinical persona); set
  §5.1 to adaptive thinking; marked Approved.
