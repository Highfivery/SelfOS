# 45 — Session image attachments (show the coach a screenshot)

> **Status:** **Draft** · _last updated 2026-06-25_
>
> Coaching sessions ([`05`](05-conversations.md)) are text-only, but real reflection often points at something
> visual — a screenshot of a tense text-message thread, a photo of a journal page, a meme a friend sent. This
> spec lets a person **attach images to a Session message** so the AI coach can **see** them (Claude vision),
> stored **encrypted in the vault** beside the conversation, with paste / drag-and-drop / file-picker input,
> client-side downscaling for cost, and a reusable encrypted-media core so Dreams/journal can adopt it later
> with no rework. Addresses **GitHub issue #63**.

Builds on [`00`](00-architecture.md) (vault, IPC, security, host-interface pattern, feature-module registry),
[`01`](01-design-system.md), [`05`](05-conversations.md) (the `Conversation`/`ChatMessage` model, the
streaming `ClaudeClient` host interface, key-in-main, `chatService.runChatTurn`, the `Composer`/`CrisisFooter`
surfaces), [`06`](06-ai-usage-and-budgets.md) (every AI call metered + budget-gated),
[`07`](07-mobile-platform.md) (the `FileSystem`/`SecretStore` host seam so the feature works on Electron + iOS),
[`08`](08-questionnaires.md) §13.2 (the existing encrypted-image precedent — `imageService` +
`encryptBytes`/`decryptBytes` + base64-over-IPC + `isMediaPath`), [`09`](09-session-analysis.md) +
[`40`](40-proactive-coaching.md) (session analysis stays text-only here), and [`13`](13-dream-images.md) (the
`ImageClient`/`saveImageFile` host-op precedents this mirrors, and a first adopter of the reusable media core).

---

## 1. Overview

**The problem.** A Session is a typed conversation. When a person wants to work through "look at how my mum
texted me this morning" the only options today are to retype it or describe it — losing the exact words, the
tone, the layout. Issue #63 asks for the obvious affordance: **attach an image to a message so the coach can
see it.** Screenshots of message threads are the headline case, so **paste-from-clipboard** is essential.

**The change.** A Session message may now carry up to ~5 **images** (PNG/JPEG/WebP/GIF). The composer accepts
them by **paste, drag-and-drop, or a file-picker**; each is **downscaled client-side** to ~1568px longest edge
(Claude's vision sweet spot, cost control), then sent to main, **validated** (mime + size), **encrypted** to a
per-conversation media folder, and **referenced** from the user's `ChatMessage`. On the turn the message is
sent — and on every later turn whose history still includes those images — main **re-reads the stored bytes,
re-encodes base64 host-side, and assembles Claude vision content blocks** (Claude is stateless, so attachments
must be re-supplied each turn). User attachments render as **thumbnails in the bubble** with a keyboard-
accessible **lightbox**; the assistant's reply stays Markdown text ([`34`](34-rich-text-rendering.md)).

**Reusable by design.** The storage/crypto/path-guard/IPC is built as a **generic encrypted-media core seam**
parameterized by a vault path — `@selfos/core/media` — so Dreams, journal, and future surfaces adopt it with no
rework. This spec **surfaces it only in Sessions** (no scaffolding for unbuilt callers, CLAUDE.md §12).

### 1.1 Relationship to other specs

- **[`05`](05-conversations.md)** owns the `Conversation`/`ChatMessage` schema, the transcript files, the
  `ClaudeClient` host interface, `chatService.runChatTurn`, `promptBuilder`, and the `Composer`/`CrisisFooter`.
  This spec **amends** `ChatMessage` with an additive `attachments?` field and **extends** `ClaudeMessage`
  - `chatStream` for vision.
- **[`06`](06-ai-usage-and-budgets.md)** owns metering + budgets. **No new usage type or schema change** —
  image input tokens fold into the existing `chat` event's `inputTokens` (§6.2), with a cost note.
- **[`08`](08-questionnaires.md)** §13.2 is the encrypted-image precedent (`encryptBytes`/`decryptBytes`,
  base64-over-IPC, `isMediaPath`, `MAX_IMAGE_BYTES`, `ALLOWED_IMAGE_MIME`); the reusable media core (§5.1)
  **generalizes** that pattern, and questionnaire/dream images can migrate onto it later (out of scope here).
- **[`09`](09-session-analysis.md)/[`40`](40-proactive-coaching.md)** own session analysis. Analysis stays
  **text-only** (the coach's reply already captured what it saw); attachments are **not** re-sent to the
  analyzer (§6.3, a locked decision).
- **[`13`](13-dream-images.md)** introduced the `ImageClient` and the `saveImageFile` host op; this spec reuses
  the `saveImageFile` op pattern for an optional later export (§11) and is the model for a Dreams adopter of
  the §5.1 media core.

## 2. Goals / Non-goals

**Goals**

- **Attach images to a Session message** so the coach sees them (Claude vision). PNG/JPEG/WebP/GIF — the
  `ALLOWED_IMAGE_MIME` set reused from [`08`](08-questionnaires.md) §13.2.
- **Three input methods** in the composer: **paste-from-clipboard** (essential for screenshots),
  **drag-and-drop**, and a **file-picker** (also the accessible alternative to paste/drag, §9).
- **Cost control**: **auto-downscale client-side to ~1568px longest edge** before encrypting/storing; cap
  **~5 images per message**. Images stay in full context to the coach for the **whole session** (simplest,
  best UX). Budget gating already applies ([`06`](06-ai-usage-and-budgets.md)).
- **Encrypted, per-conversation storage** at `people/<personId>/conversations/<conversationId>/attachments/
<uuid>.enc`, via a **reusable `@selfos/core/media`** helper (generic over a vault media dir) — so Dreams/
  journal adopt it later with no rework. Path access confined by an `isConversationAttachmentPath` guard;
  **mime + size validated in MAIN** (the renderer is not the trust boundary).
- **Vision on BOTH hosts** — `ClaudeMessage.content` accepts text + image blocks; the Electron
  `anthropicClient` and the iOS `browserClaudeClient` both map them. All Claude 4.x models support vision.
- **Re-supply each turn** — because Claude is stateless, main re-reads stored bytes + re-encodes base64 for
  every turn whose history includes an attachment; bytes never round-trip through the renderer for the model
  call.
- **Thumbnails in the bubble + a keyboard-accessible lightbox**; composer shows thumbnails-with-remove before
  send.
- **Delete-purges-attachments** — deleting a conversation purges its attachment files (the orphaned-media
  lesson, §7).

**Non-goals (deferred / out of scope)**

- **PDFs / text files / documents** — explicitly deferred. First cut is **images only**. (Claude can read PDFs
  via the documents API, but it's a different content block + larger payloads + its own UX; a later spec.)
- **Attachments on guided sessions / the dream-analysis chat** — those are also conversations, but this spec
  surfaces attachments **only in free + structured Sessions**; a later follow-up can extend them (§11).
- **Re-analysis of attachments in [`09`](09-session-analysis.md)/[`40`](40-proactive-coaching.md)** — analysis
  stays text-only (§6.3).
- **Exporting an attachment back out of the vault** — possible later via the `saveImageFile` op
  ([`13`](13-dream-images.md)), but not in v1 (§11).
- **Per-relationship / cross-person sharing of attachments** — an attachment is the author's own message
  content; it never enters anyone else's context (no `buildContext` path for binary, mirroring
  [`13`](13-dream-images.md) §8.3). Out of scope.
- **Image generation, editing, annotation, OCR** — out of scope (this is _show_ the coach an image, not make
  one). Generation is [`13`](13-dream-images.md).
- **Migrating questionnaire/dream images onto the new media core** — the core is built reusable, but migrating
  existing callers is a later refactor (no behaviour change shipped here).
- **The iOS photo/file picker UI** — the storage/IPC seam is host-agnostic and works on iOS, but the
  Capacitor photo/file-picker _UI_ is deferred; the seam is designed now (§5.4/§7).

## 3. UX & flows

The Sessions feature module ([`05`](05-conversations.md) §3) gains attachment affordances on the composer +
the message thread; the App Shell is untouched. Every surface is responsive ~360px→desktop (CLAUDE.md §12);
the not-medical line + always-present **`CrisisFooter`** ([`05`](05-conversations.md) §7) are unchanged.

### 3.1 Attaching (the composer)

The `Composer` ([`05`](05-conversations.md), `routes/sessions/Composer.tsx`) gains:

1. **A paste handler** — pasting one or more images from the clipboard (a screenshot copied with ⌘⇧4 → ⌃, or
   "Copy image") adds them as pending attachments. This is the headline path for message-thread screenshots.
2. **A drop zone** — dragging image files onto the composer (or the thread) adds them; a subtle
   "Drop images to attach" overlay appears on dragover.
3. **An "Attach image" button** (paperclip icon) opening a native **file-picker** (`<input type="file"
accept="image/png,image/jpeg,image/webp,image/gif" multiple>`).

Each added image is **downscaled client-side** (§5.5) then shown as a **pending thumbnail row** above the text
input, each thumbnail with a **remove (×)** control and the (downscaled) file size. A count chip shows
"N/5". The Send button enables when there's **text OR ≥1 attachment** (an image-only message is allowed — "what
do you make of this?" with a screenshot). **Enter sends / Shift+Enter newline** is unchanged.

### 3.2 Sending (happy path)

1. The person attaches ≤5 images and (optionally) types text, then **Send**.
2. The renderer, for each pending attachment, calls **`conversation:storeAttachment({ conversationId, base64,
mime })`** → main validates (mime + size, §4.4), encrypts to `attachments/<uuid>.enc`, returns an
   **`AttachmentRef`** (`{ id, mime, path, width, height, bytes }`). (The store-then-reference pattern, the
   [`08`](08-questionnaires.md) §13.2 precedent — attachments are stored before the message references them.)
3. The renderer calls **`chatStream({ conversationId, userText, attachments: AttachmentRef[] })`**.
4. Main appends the user `ChatMessage` with `content: userText` + `attachments`, **assembles Claude vision
   content blocks** for this turn (and re-reads bytes for any earlier attached message in history, §6.1),
   streams the reply, persists the transcript, meters the `chat` event (§6.2). The reply renders as Markdown.
5. The user's message renders in the thread as the text (if any) **plus a thumbnail grid** of its attachments.

### 3.3 Viewing (thumbnails + lightbox)

- A user message's attachments render as a **thumbnail grid** in the bubble (each an `<img>` from a decrypted
  base64 data URL, fetched via **`conversation:getAttachment`**; the [`08`](08-questionnaires.md) §13.2
  base64-over-IPC `QuestionImage` pattern). Thumbnails are lazy-loaded.
- Clicking/activating a thumbnail opens a **lightbox** — a focus-trapped overlay showing the full-size image
  (the stored, downscaled bytes), keyboard-dismissable (**Esc**), with prev/next when a message has several,
  and a visible close button. The assistant's text keeps the `@selfos/answering` `<Markdown>` renderer
  ([`34`](34-rich-text-rendering.md)) — attachments are user-only (the coach replies in text).

### 3.4 Removing a pending attachment / errors before send

- Removing a pending thumbnail before send drops it (it was never stored — store happens at Send, §3.2; or, if
  we store-on-add for instant thumbnails, removing deletes the just-stored file, the [`08`](08-questionnaires.md)
  §13.2 "remove only clears the draft / GC reaps orphans" lesson — resolved at build, §11).
- A rejected add (unsupported type, too large after downscale, >5 cap) shows a calm inline message ("That file
  isn't a supported image" / "Max 5 images per message"); the rest of the compose state is untouched.

### 3.5 Calm states (no dead controls)

- **AI off / no key / over budget** ([`05`](05-conversations.md)/[`06`](06-ai-usage-and-budgets.md)) — the
  existing connect/over-budget states already gate the composer; the attach controls are present but Send is
  gated exactly as today (an image-only message can't be sent when AI is unavailable). Attachments don't
  introduce a new spend gate — they ride the existing `chat` budget check.
- **A model without vision** — all shipped Claude 4.x models support vision, so this can't happen with the
  app's model options; defensively, if a configured model is non-vision, sending with attachments surfaces a
  calm "this model can't read images — switch model in Settings" rather than a provider error (§7).

## 4. Data model (vault files & schemas)

All persisted formats are **Zod-backed** (`z.infer` types), written through the vault + crypto service
([`00`](00-architecture.md) §4) — **no direct `fs`**. Types live in `@selfos/core` so the renderer + IPC
contract share one source.

### 4.1 Vault layout (additions)

```
vault/
  people/<personId>/
    conversations/
      <conversationId>.enc                     # Conversation (05 §4) — ChatMessage gains additive `attachments`
      <conversationId>/
        attachments/
          <uuid>.enc                           # NEW — one attached image, ENCRYPTED BYTES (encryptBytes envelope)
```

`attachments/<uuid>.enc` is an **encrypted-bytes** envelope (the [`08`](08-questionnaires.md) §13.2
`encryptBytes` envelope serialized as JSON, exactly like `questionnaires/media/<id>.enc`), **not** an
encrypted-JSON file. The per-conversation folder keys attachments to their conversation so a conversation
delete can purge them as a unit (§7).

> Note: [`05`](05-conversations.md) stores a conversation as a single `<conversationId>.enc` file (no folder
> today). This spec adds a **sibling folder** `<conversationId>/attachments/`; the conversation file is
> unchanged in shape (it gains only the additive `attachments` field on messages). Conversation **delete** is
> extended to remove both the `.enc` file and the sibling folder (§7).

### 4.2 `ChatMessage.attachments` (additive amendment to [`05`](05-conversations.md) §4)

```ts
// Added to ChatMessageSchema (packages/core/src/schemas.ts ~L477). Additive-optional — NO Conversation
// .schemaVersion bump, NO migration (the codebase's additive habit: Person.email / Conversation.guideId /
// Conversation.topicLifeAreas all added this way). Absent ⇒ a plain text message (today's behaviour).
export const AttachmentRefSchema = z.object({
  id: z.string().min(1), // the attachment uuid (also the basename of <uuid>.enc)
  kind: z.literal('image'), // forward-compat discriminant; only 'image' in v1 (PDFs/text are a non-goal)
  mime: z.string().min(1), // 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' (re-validated in main)
  path: z.string().min(1), // vault-relative path to <uuid>.enc — used only host-side to re-read bytes
  width: z.number().int().positive().optional(), // the stored (downscaled) pixel dimensions, for thumbnail layout
  height: z.number().int().positive().optional(),
  bytes: z.number().int().nonnegative().optional(), // stored byte length (display / sanity)
});
export type AttachmentRef = z.infer<typeof AttachmentRefSchema>;

// ChatMessageSchema gains:
//   attachments: z.array(AttachmentRefSchema).optional()
```

`content` stays a **plain string** (we do NOT migrate the stored message to content-blocks — keeping it
additive matches the codebase and avoids a transform). The vision content-block assembly for Claude is a
**runtime** mapping in `chatService`/the bridge (§6.1), not a stored shape.

### 4.3 Encrypted-bytes storage — the reusable media core (`@selfos/core/media`)

There is **no new crypto** and **no new envelope**. A generic helper module **`@selfos/core/media`**
generalizes the [`08`](08-questionnaires.md) §13.2 `imageService` so any feature can store encrypted media
under a vault path it owns:

```ts
// @selfos/core/media — generic encrypted-media storage, parameterized by a vault media DIRECTORY the
// caller owns. Re-exports the proven primitives so Sessions/Dreams/journal share ONE implementation.
export const ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const; // (08 §13.2)
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // ~5 MB (08 §13.2)
export function isAllowedImageMime(mime: string): boolean;

// Store bytes → <dir>/<uuid>.enc; returns the new path + id. (encryptBytes envelope as JSON, fs.writeAtomic.)
export async function storeMedia(
  fs: FileSystem,
  key: Uint8Array,
  dir: string,
  bytes: Uint8Array,
): Promise<{ id: string; path: string }>;

// Read+decrypt; null if `guard(path)` fails, absent, or unreadable. The CALLER supplies a path GUARD so a
// malicious renderer can never read an arbitrary vault file by path (the isMediaPath / isDreamImagePath rule).
export async function getMedia(
  fs: FileSystem,
  key: Uint8Array,
  path: string,
  guard: (p: string) => boolean,
): Promise<Uint8Array | null>;

export async function deleteMedia(
  fs: FileSystem,
  path: string,
  guard: (p: string) => boolean,
): Promise<void>;
```

Sessions supplies its own **path helpers + guard**:

```ts
// @selfos/core/conversations (sibling of paths in 05)
export function conversationAttachmentsDir(personId: string, conversationId: string): string {
  return `people/${personId}/conversations/${conversationId}/attachments`;
}
export function isConversationAttachmentPath(path: string): boolean {
  return (
    /^people\/[^/]+\/conversations\/[^/]+\/attachments\/[^/]+\.enc$/.test(path) &&
    !path.includes('..')
  );
}
```

The bridge addresses attachments by `(personId, conversationId)` and derives the dir/path itself; the guard is
defense in depth (the [`08`](08-questionnaires.md) §13.2 / [`13`](13-dream-images.md) §4.3 pattern).

### 4.4 Limits & validation

- **Accepted MIME** (validated in MAIN, never trusting the renderer): `image/png`, `image/jpeg`, `image/webp`,
  `image/gif` (`ALLOWED_IMAGE_MIME`). A non-image is rejected with a calm error and **not stored**.
- **Max stored bytes** ~5 MB per attachment (`MAX_IMAGE_BYTES`, reused). After client-side downscaling
  (§5.5) a normal screenshot is well under this; a still-oversized blob is rejected.
- **Per-message cap** ~**5** images (proposed; confirm §11). Enforced in the composer **and** re-checked when
  the message is assembled (the renderer is not the trust boundary).
- **Downscale target** ~**1568px** longest edge (proposed; confirm §11) — Claude's vision resolution sweet
  spot, which also caps per-image input tokens.

### 4.5 Ownership

All reads/writes go through the vault + crypto service (no direct `fs`). The API key stays in main
([`00`](00-architecture.md) §6.2). Attachment **bytes** cross IPC **only as base64**, and only renderer→main
on store and main→renderer on a thumbnail/lightbox read — **never** renderer→main→model (the model-bound bytes
are re-read host-side, §6.1).

## 5. Architecture & modules

### 5.1 Reusable encrypted-media core (`@selfos/core/media`)

The generic `storeMedia`/`getMedia`/`deleteMedia` + `ALLOWED_IMAGE_MIME`/`MAX_IMAGE_BYTES`/`isAllowedImageMime`
(§4.3) — the single, testable storage seam, parameterized by a vault dir + a caller-supplied path guard.
**Built reusable, surfaced only in Sessions** (no scaffolding for unbuilt callers, CLAUDE.md §12). A package
export `./media`.

### 5.2 Core (`@selfos/core/conversations`)

- **`conversationService`** ([`05`](05-conversations.md)) — gains:
  - `conversationAttachmentsDir` / `isConversationAttachmentPath` (§4.3).
  - `storeConversationAttachment(fs, key, personId, conversationId, bytes, mime)` → validate (mime/size) →
    `storeMedia` → return an `AttachmentRef` (id/path/mime, plus width/height/bytes passed by the caller).
  - `getConversationAttachment(fs, key, path)` → `getMedia(..., isConversationAttachmentPath)` → bytes or null.
  - **Delete is extended**: `deleteConversation` removes both `<conversationId>.enc` and the
    `<conversationId>/attachments` folder (`fs.remove` on the dir), so no orphaned media (§7).
- **`chatService.runChatTurn`** ([`05`](05-conversations.md), `chatService.ts`) — the message-mapping at
  ~L149 (`conversation.messages.map(m => ({ role, content: m.content }))`) is replaced by an **async
  attachment-aware mapper** that, for any message carrying `attachments`, **re-reads each `.enc` via
  `getConversationAttachment` and emits a `ClaudeMessage` whose `content` is a content-block array**
  (`[{type:'text', text}, ...{type:'image', source:{type:'base64', media_type, data}}]`); a message with no
  attachments stays a plain string (§6.1). The new user message's `attachments` are taken from the
  `chatStream` input. Everything downstream (stream, persist, meter) is unchanged — image input tokens fold
  into the `chat` event's `inputTokens` (§6.2). **No new usage type.**

### 5.3 Vision in the `ClaudeClient` host interface (BOTH hosts)

`ClaudeMessage.content` is widened from `string` to `string | ContentBlock[]`
(`packages/core/src/host/claudeClient.ts`):

```ts
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}
```

Both transports map it:

- **Electron `anthropicClient`** (`apps/desktop/src/main/claude/anthropicClient.ts`) — the two
  `messages.map((m) => ({ role, content: m.content }))` sites pass `content` through; the Anthropic SDK accepts
  the `string | ContentBlock[]` union directly (its `image` block shape is `{type:'image', source:{type:
'base64', media_type, data}}`). A small mapper normalizes our union → the SDK's content type.
- **iOS `browserClaudeClient`** (`apps/desktop/src/renderer/src/host/browserClaudeClient.ts`) — the same
  mapping for the browser-mode SDK. (The offline fake's `userText` join must tolerate non-string content —
  flatten blocks to their text parts, §10.)

All current Claude 4.x models support vision; the prompt-caching `cache_control` on the system prefix
([`05`](05-conversations.md)) is unaffected (it's on the system block, not the messages).

### 5.4 Desktop main (host) & iOS

- **main** registers the new IPC handlers (§6) and wires `conversationService` + the media core to
  `nodeFileSystem` + the existing `anthropicClient`. No new host op is required for v1 (an export uses the
  existing `saveImageFile`, [`13`](13-dream-images.md), only if §11 export ships).
- **iOS host** ([`07`](07-mobile-platform.md)) gets the storage + vision path for free via `createCoreBridge`
  (the media core + the widened `ClaudeMessage` are host-agnostic). The **photo/file-picker UI** is deferred
  (§2 non-goal); paste/drop also work in a WKWebView where the platform exposes them — the seam is designed
  now (§7).

### 5.5 Renderer

- **Client-side downscaling** — a pure-ish helper `downscaleImage(file | blob, maxEdge=1568)` that draws to an
  off-screen `<canvas>` and re-encodes (to PNG, or to the source mime where lossy is fine), returning
  `{ base64, mime, width, height, bytes }`. Runs **before** `storeAttachment` so the stored + transmitted
  bytes are already bounded (cost control). Animated GIFs are downscaled to a static first frame for the model
  (acceptable; noted §7).
- **`Composer`** (`routes/sessions/Composer.tsx`) — gains the paste handler, drop zone, file-picker button,
  the pending-thumbnail row (with remove + count chip), and passes `AttachmentRef[]` up through `onSend`.
- **Thread rendering** (`Sessions`/the message-bubble component) — a **thumbnail grid** for a user message's
  attachments + a **`Lightbox`** overlay (focus-trap, Esc, prev/next). Thumbnails/lightbox bytes come from
  `conversation:getAttachment` (base64 data URL). The assistant bubble is unchanged (Markdown).
- **`conversationStore`** ([`05`](05-conversations.md) §5) — `sendMessage` accepts attachments, calls
  `storeAttachment` per file then `chatStream`; an attachment-bytes cache keyed by path avoids re-fetching a
  thumbnail. Reset on `activePerson.id` change (the per-person isolation rule).
- Any new design-system primitive (`Lightbox`, an `AttachmentThumb`) → **`/gallery`** (DoD §12).

### 5.6 Feature-module registration

No new nav/route — this extends the existing Sessions module ([`05`](05-conversations.md)): the new IPC
handlers, the widened `chatStream` input, the `ChatMessage.attachments` schema amendment, and the renderer
surfaces. The shell is untouched. **No new capability** — attaching is part of `sessions.own` (you can attach
to your own session; the bridge re-enforces active-person scope, §6).

## 6. IPC / API contracts

Typed channels (`src/shared/channels.ts`, Zod-validated both sides, through the full seam:
`channels.ts` → `coreBridge.ts` → `ipc.ts` → preload → `conversationStore`), all gated by **`sessions.own`**
and **scoped to the active person in the bridge** (the trust boundary, not the UI). **Bytes never carry the
model prompt; the OpenAI/Anthropic key never crosses to the renderer.**

- **`conversation:storeAttachment({ conversationId, base64, mime, width?, height?, bytes? })`** →
  `AttachmentRef | { ok: false; reason: 'UNSUPPORTED' | 'TOO_LARGE' | 'NOT_FOUND'; message: string }`
  — main decodes base64, **re-validates mime + size** (§4.4), confirms the conversation belongs to the active
  person, `storeMedia` to the conversation's attachments dir, returns the `AttachmentRef`.
- **`conversation:getAttachment({ conversationId, path })`** →
  `{ mime: string; dataBase64: string } | null` — decrypted bytes as base64 for a thumbnail/lightbox; the
  bridge re-checks `isConversationAttachmentPath` **and** that the path is under the active person's named
  conversation (a recipient can't read another person's attachment by path).
- **`chatStream`** ([`05`](05-conversations.md)) — input **extended** with `attachments?: AttachmentRef[]`
  attached to the new user message: `chatStream({ conversationId, userText, attachments? })`. Response shape
  (`ChatTurnResult`) is unchanged.

The bridge **re-enforces** every gate server-side — a non-owner of the conversation cannot store, read, or
attach to it; an attachment ref pointing outside the active person's conversation is rejected. **Conversation
delete** (`conversation:delete`, [`05`](05-conversations.md)) is extended to purge the attachments folder (§7).

### 6.1 Vision content assembly (the stateless re-supply)

Claude is **stateless**: every turn re-sends the full message history. So on each turn, the attachment-aware
mapper (§5.2) walks `conversation.messages`; for any message with `attachments`, it **re-reads each stored
`.enc` (host-side, via `fs` + the master key), base64-encodes, and builds a content-block array**. This means:

- **Bytes never round-trip through the renderer for the model call** — the renderer sent base64 once at store
  time; thereafter main reads from the vault.
- **Image input tokens accrue every turn the attachment stays in history.** Because images stay in full
  context for the whole session (the locked UX decision), a session with attached screenshots costs more input
  tokens per subsequent turn. This is acceptable per the decision; the [`06`](06-ai-usage-and-budgets.md)
  budget gate already covers it. (A future "drop images after N turns" optimization is noted §11.)
- A stored attachment that is **missing/corrupt at re-read** is skipped (the message degrades to its text;
  never throws — §7), so the turn still completes.

### 6.2 Claude API & metering

- The text coach stays Anthropic; vision is the same models with image content blocks (§5.3).
- **Metering** ([`06`](06-ai-usage-and-budgets.md)) — **no schema change, no new usage type.** The provider
  reports image input tokens inside the response's `inputTokens`, which the existing `chat` `UsageEvent`
  already records (`chatService` ~L187). The cost note: an attached image meaningfully raises `inputTokens`
  for that turn and every later turn it's still in history; `costOf` is unchanged.
- **Failure handling** ([`05`](05-conversations.md)) — a vision-capable model that errors on an image surfaces
  the existing calm chat-error state; a non-vision configured model surfaces the §3.5 "switch model" hint.

### 6.3 Session analysis stays text-only (locked)

[`09`](09-session-analysis.md)/[`40`](40-proactive-coaching.md) analysis reads the **transcript text** only —
attachments are **not** re-sent to the analyzer. The coach's reply already captured what it saw (its written
response is the durable record), so re-sending images would add cost without new signal. The analyzer prompt
sees `content` strings; `AttachmentRef`s are ignored by it. (A locked decision, §11.)

## 7. States & edge cases

Per [`00`](00-architecture.md) §7 — every surface handles loading / empty / error / offline:

- **Huge image** — downscaled client-side first (§5.5); if still > `MAX_IMAGE_BYTES`, `storeAttachment` returns
  `TOO_LARGE` → a calm inline error; not stored.
- **Unsupported MIME** (e.g. a TIFF/HEIC/SVG, or a non-image dragged in) — rejected at add (renderer) **and**
  at `storeAttachment` (main, `UNSUPPORTED`) — the renderer is not the trust boundary.
- **Downscale failure** (canvas decode error, a corrupt/unsupported source) — the add is rejected with a calm
  "couldn't read that image"; the rest of compose state is untouched; nothing is stored.
- **Paste of non-image content** (text, a file path) — the paste handler ignores non-image clipboard items and
  lets the default text paste proceed (so pasting text into the box still works normally).
- **Animated GIF** — accepted (it's in `ALLOWED_IMAGE_MIME`); downscaled to a **static first frame** for the
  model (acceptable, noted). The stored bytes are the static frame.
- **>5 per message** — blocked at add with "Max 5 images per message"; re-checked on assembly.
- **Image-only message** (no text) — allowed; Send enables on ≥1 attachment.
- **Deleting a conversation purges its attachments** — `deleteConversation` removes the `<conversationId>.enc`
  file **and** the `<conversationId>/attachments` folder (the orphaned-media lesson, [`08`](08-questionnaires.md)
  §13.2 / [`13`](13-dream-images.md) §3.3). An E2E asserts the folder is gone.
- **Model without vision** — defensively surfaces the §3.5 "switch model" hint rather than a raw provider
  error; all shipped models are vision-capable so this is a guardrail, not a normal path.
- **Re-read of a missing/corrupt attachment** on a later turn — the mapper **skips** it (the message degrades
  to text), never throwing, so the turn completes (§6.1).
- **Sync conflict on an attachment file** — a binary `.enc` conflict copy is handled by the standard vault
  conflict detection ([`00`](00-architecture.md) §4.3); never auto-deleted; surfaced. The `AttachmentRef.path`
  still points at the canonical name; a conflict copy is an orphan the user resolves (the `getMedia` guard
  ignores unexpected names). The conversation transcript file conflicts like any other.
- **Corrupt / missing `attachments/<uuid>.enc`** — `getAttachment` returns null → the thumbnail shows a calm
  "image unavailable" placeholder; the message text + the rest of the conversation are unaffected.
- **Over budget / AI off** ([`06`](06-ai-usage-and-budgets.md)) — the existing chat gate applies; attachments
  don't bypass it.
- **Concurrent edits** to the same conversation across devices — the transcript is last-write-wins per
  [`05`](05-conversations.md); attachment files are immutable once stored (id is a uuid), so they don't
  conflict on content, only on the rare same-name race (handled above).
- **iOS / Capacitor** — storage + vision work via `createCoreBridge`; the **photo/file-picker UI** is a
  deferred seam (§2/§5.4) — paste/drop work where the WebView exposes them; the picker button is hidden or
  routed to the platform photo picker in a later iOS slice (§11).
- **Schema** — `ChatMessage.attachments` is additive-optional; existing transcripts parse unchanged (no
  migration).

## 8. Safety, privacy & honesty

This feature touches conversation, so the [`05`](05-conversations.md) §7 safety posture applies in full.

- **Not-medical boundary** — unchanged. SelfOS stays **wellness/self-help, not medical** (CLAUDE.md §1). An
  attached image doesn't change the coach's boundary; the not-medical line + **`CrisisFooter`** remain present
  on the Sessions surface throughout (no change).
- **Crisis routing** — unchanged. The coach's existing crisis detection + resources routing
  ([`05`](05-conversations.md) §7) operates on its reply as today. An image's content **may be distressing**
  (a screenshot of a hostile message, self-harm imagery) and the coach **can now see it** — its reply must
  stay within the same crisis-routing behaviour. No new crisis pathway is added; the existing footer/resources
  are always present, and a distressing image is one more input the coach responds to within those bounds.
- **Third-party words / consent** — a screenshot of a text-message thread contains **another person's words**.
  This is the **user's deliberate choice** to share their own message content with the coach, the same as
  quoting that person in text today. Attachments are stored under the **same encrypted boundary** as the rest
  of the vault (master-key AES-256-GCM, [`00`](00-architecture.md) §6) and sent only to **Anthropic** (the
  provider that already powers the coach) — **no new third party** (contrast [`13`](13-dream-images.md)'s
  OpenAI flow, which needed a fresh consent; this needs none beyond the existing AI consent). The data never
  enters anyone else's `buildContext` (no binary-sharing path, §2).
- **Owner access** — consistent with [`04`](04-people-roles.md) §8: the vault is not zero-knowledge from the
  device owner (one master key). The Owner can reach a conversation's attachments as they can its text. No new
  exposure beyond the existing model; no attachment-access audit log (the established posture).
- **Minimization** — only the (downscaled) image bytes are sent to Anthropic on the turns the attachment is in
  history; no filename, EXIF, or location metadata is sent (the canvas re-encode strips EXIF as a side effect —
  a privacy bonus worth asserting in a test, §10).

## 9. Accessibility

Per [`01`](01-design-system.md) §9:

- **Three input methods cover all users** — the **file-picker** is the keyboard- and screen-reader-accessible
  alternative to paste/drag (which are pointer/clipboard affordances); it's a labelled `<button>` opening a
  native file dialog. Paste and drop are enhancements, never the only path.
- **Pending thumbnails** are a labelled list; each remove control is a labelled `<button>` ("Remove
  attachment N") with visible focus; the count chip has a text equivalent ("3 of 5 images").
- **Thumbnails in a bubble** are focusable, labelled (alt text — see below), and activate the lightbox via
  Enter/Space.
- **Alt text** for a user attachment is **optional** (the person isn't authoring for an audience) — default
  alt is a generic, non-leaking label ("Attached image" / "Attached image N of M"), never derived from the
  image content or any inferred description (no content read aloud near others without intent).
- **Lightbox** — a focus-trapped `role="dialog"` overlay: focus moves in on open and returns to the trigger on
  close; **Esc** closes; prev/next are labelled buttons; the close button is reachable first. Respects
  reduced-motion (no zoom animation when reduced).
- **Live regions** — an add error / "image unavailable" placeholder is announced politely.
- Responsive ~360px→desktop with the mobile-width (390px) layout guard + a no-inner-scrollbar guard on the
  thumbnail grid (DoD §7); thumbnails reflow, the composer never horizontally scrolls.

## 10. Testing strategy

Vault + Claude are mocked as established (the offline fake `ClaudeClient`, `memFileSystem`); **decrypt the
vault to assert** ciphertext where relevant.

- **Unit (core, node):**
  - **media core (`@selfos/core/media`):** `storeMedia` round-trips bytes through `encryptBytes` to
    `<dir>/<uuid>.enc`; `getMedia` decrypts; `getMedia`/`deleteMedia` **refuse an out-of-guard path** (the
    guard blocks `..` / a non-attachment path); `getMedia` returns null for absent/corrupt; mime/size reject
    (`isAllowedImageMime`, `MAX_IMAGE_BYTES`).
  - **conversation attachments:** `storeConversationAttachment` validates mime + size and returns a correct
    `AttachmentRef`; `getConversationAttachment` round-trips; **`deleteConversation` purges the attachments
    folder** (assert the dir is gone).
  - **vision mapping (both clients):** the Electron `anthropicClient` **and** the iOS `browserClaudeClient` map
    a `ClaudeMessage` with `content: ContentBlock[]` to the SDK's image-block shape; the offline fake flattens
    blocks to text without throwing.
  - **`chatService` includes image blocks + meters:** a turn whose new message carries attachments produces a
    `ClaudeMessage` content-block array containing the re-read base64 (assert the fake client received an image
    block); a later turn **re-reads** the earlier message's attachment (stateless re-supply); the `chat`
    `UsageEvent` is recorded as today (no new type); a **missing attachment is skipped** (turn still completes).
  - **schema:** `ChatMessage.attachments` additive-optional (existing transcripts parse).
  - **EXIF stripped:** the downscale path produces bytes with no EXIF (a privacy assertion).
- **Component (RTL):** the `Composer` — **paste** an image (a fake `ClipboardEvent` with an image item) adds a
  pending thumbnail; **drop** an image file adds one; the **file-picker** adds one; **remove** drops a pending
  thumbnail; the **5-cap** + unsupported-type reject show calm errors; Send enables on text-or-attachment. The
  thread — a user message renders a thumbnail grid; activating a thumb opens the **lightbox** (focus trap, Esc
  closes, prev/next); a missing attachment shows the placeholder. Downscaling helper unit test (a large canvas
  → ≤1568 longest edge).
- **E2E (Playwright):** with the offline fake client — open a Session → **attach a fake screenshot** (drive the
  file-picker or a synthetic paste) → Send → **assert the on-disk `attachments/<uuid>.enc` is an encrypted
  envelope, not raw image bytes** (decrypt the vault) → the **thumbnail renders in the bubble** → open the
  lightbox (Esc closes) → **delete the conversation → the attachment file/folder is purged**. A no-overflow +
  mobile-width (390px) guard on the composer + thumbnail grid. The `ClaudeClient` is a fake (no real network).

## 11. Open questions

_Locked decisions (recorded, do not re-open):_ images-only (PDFs/text deferred); the reusable
`@selfos/core/media` core (surfaced only in Sessions now); auto-downscale ~1568px + cap ~5/message + images
stay in full context for the whole session; paste + drag-and-drop + file-picker; session analysis stays
text-only; deleting a conversation purges its attachments.

_Still needing the user's decision:_

- **Per-message and per-session caps + the downscale target** — proposed **5 images/message** and **~1568px**
  longest edge. Confirm these exact numbers (and whether there's any per-session total cap, given images stay
  in context every turn → recurring input-token cost). _Recommend: 5/message, 1568px, no separate session
  cap for v1._
- **Export an attachment back out of the vault** — should a stored attachment get a "Save image…" action (via
  the existing `saveImageFile` op, [`13`](13-dream-images.md))? _Recommend: later — not in v1; it's the
  user's own image either way._
- **Attachments on guided sessions + the dream-analysis chat** — both are conversations; should they also get
  attachments, or stay Sessions-only for now? _Recommend: a later follow-up once the Sessions surface is
  proven._
- **iOS / Capacitor file/photo picker** — the storage + vision seam is host-agnostic and works on iOS now;
  should the iOS **picker UI** ship in this spec or a later iOS slice? _Recommend: design the seam now (done),
  defer the iOS picker UI; paste/drop work where the WebView exposes them._
- **Store-on-add vs store-on-send** — should an attachment be encrypted to the vault the moment it's added
  (instant thumbnail, but a removed-before-send file must be GC'd, the [`08`](08-questionnaires.md) §13.2
  lesson) or only at Send (no orphans, but the pending thumbnail is an in-memory data URL)? _Recommend:
  store-on-send to avoid orphans; render pending thumbnails from the in-memory downscaled blob._

### 11.1 Concurrency / shared-surface coordination

A separate agent is concurrently building the **questionnaires** feature. This spec touches code the
questionnaire work also touches — sequence to avoid clobbering:

- **Append-only IPC seam files** (`apps/desktop/src/shared/channels.ts`, `coreBridge.ts`, `ipc.ts`,
  preload): both efforts append new channels here → expect trivial merge conflicts. Do this slice in a
  `git worktree` and re-apply only your own hunks (the established lesson); never whole-file-patch a shared
  seam file.
- **The reusable `@selfos/core/media` core** generalizes the questionnaire `imageService.ts`. Extract it as
  a thin helper that the **existing questionnaire image service keeps delegating to unchanged** (the prior
  `@selfos/core` extraction pattern — behaviour-preserving shim, the suite is the proof). If the
  questionnaire agent is mid-refactor on image handling, coordinate the extraction order with them first.
- Reuse — don't fork — the shared `ALLOWED_IMAGE_MIME` / `MAX_IMAGE_BYTES` constants so both surfaces stay
  on one source of truth.

## 12. Changelog

- 2026-06-25 — created (Draft). Addresses issue #63 (attach images to a Session so the coach can see them).
  Locked decisions recorded in §11: images-only first cut; reusable `@selfos/core/media` core surfaced only in
  Sessions; client-side downscale ~1568px + ~5/message cap, images in full context for the whole session;
  paste + drag-and-drop + file-picker; analysis stays text-only; conversation delete purges attachments.
  Grounded against `ChatMessageSchema`/`ConversationSchema` (schemas.ts ~L477), `chatService.ts` (~L149
  mapping), `ClaudeClient`/`ClaudeMessage` (host/claudeClient.ts), the `imageService`/`paths` precedent
  (08 §13.2), the dream `ImageClient`/`saveImageFile` precedents (13), and the `chatStream`/`storeImage`/
  `getImage` IPC contracts (channels.ts). Build-ready pending the §11 confirmations + approval.
