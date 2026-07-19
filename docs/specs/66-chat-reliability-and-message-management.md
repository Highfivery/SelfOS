# 66 — Chat reliability & message management

> **Status:** **Approved** — _last updated 2026-07-19_
>
> Every AI chat surface in SelfOS gets the same reliability contract: a reply that hits the token
> ceiling is detected and silently continued rather than persisted half-finished; a failed turn never
> loses the user's message and is always recoverable; and any message can be rewound — retried from,
> or deleted from. It also fixes the Dreams double-analysis (the coach was licensed to write an
> analysis in chat prose that was never the structured artifact) and lets a dream analysis produce
> goals and questionnaires the way Sessions and Together already do.

Successor to [`37-ai-output-robustness`](37-ai-output-robustness.md), which established the honest
failure taxonomy (`TRUNCATED` / `MALFORMED` / `REFUSED`) for **bounded structured-JSON** calls. This
spec extends detection to **chat** — where truncation was undetectable, because `stop_reason` was
never surfaced. Amends [`05-conversations`](05-conversations.md) §4.1 (fail-safe turns) and
[`12-dreams`](12-dreams.md) §3.2/§15.4.

---

## 1. Overview

SelfOS has **five** renderer-facing streaming chat surfaces riding **four** IPC chunk channels:

| Surface                        | Service                           | Chunk channel    | Storage                                                  |
| ------------------------------ | --------------------------------- | ---------------- | -------------------------------------------------------- |
| Sessions (+ guided, challenge) | `conversations/chatService.ts`    | `chat:chunk`     | `Conversation`, one file rewritten per turn              |
| Together prep                  | `chatService.ts` (reused)         | `chat:chunk`     | `Conversation` carrying `togetherSessionId`              |
| Together couples               | `together/togetherChatService.ts` | `together:chunk` | `TogetherMessage`, append-only, **one file per message** |
| Dream analysis                 | `dreams/dreamAnalysisService.ts`  | `dreams:chunk`   | `Conversation` keyed by `dreamId`                        |
| Onboarding intake              | `intake/intakeService.ts`         | `intake:chunk`   | `IntakeSection.messages` in one `IntakeSession` doc      |

Sessions received a round of fail-safe hardening (05 §4.1). **The other four never did.** This spec
generalizes that hardening into a contract every surface holds, and adds message-level rewind.

## 2. Goals / Non-goals

**Goals**

- A truncated reply is **detected** and **silently auto-continued**, bounded and budget-checked.
- No chat surface can lose the user's message on a failed turn.
- Every chat surface has a reachable recovery path (retry), triggered by transcript state rather than
  transient error state.
- Any message can be **rewound**: "Retry from here" / "Delete from here".
- Dreams offers exactly **one** analyze affordance and never produces a duplicate analysis.
- A dream analysis creates goals (free — rides the existing synthesis call) and a questionnaire.

**Non-goals**

- **No branching / conversation trees.** Rewind is destructive and linear.
- **No per-message editing.** Edit-and-resend is deliberately out of scope for this pass.
- **No streaming-time truncation UI.** Auto-continue is invisible; there is no "continue" button.
- No change to the marker vocabulary (§3 of `58`), metering model (`06`), or budget model.

## 3. UX & flows

### 3.1 A cut-off reply (all surfaces)

The reply streams; if it stops at the token ceiling the app immediately continues it and the
remaining text keeps streaming into the same bubble. **The person sees one uninterrupted reply.**
There is no button, no banner, no visible seam. If the continuation cannot run (budget reached, cap
hit), the partial reply is kept as-is rather than discarded — a short reply beats a lost one.

### 3.2 A failed turn (all surfaces)

The user's message stays on screen **and on disk**. An honest error appears with a **Try again**
that regenerates the reply only — never re-sending or duplicating the message. Try again is offered
whenever the transcript ends on an unanswered user message, not only while a live error is set, so a
session reopened days later is never a dead end.

### 3.3 Rewind (all surfaces)

Hovering or keyboard-focusing any message reveals two actions:

- **Retry from here** — discards that message and everything after it, then regenerates.
- **Delete from here** — discards that message and everything after it. Confirmed before running.

Both are destructive and linear; there is no undo. On **Together**, the deleted messages leave a
quiet neutral "message removed" placeholder so the shared transcript does not silently change shape
for the other partner (§8.3).

### 3.4 Dream analysis

The coach explores the dream conversationally. When it has enough — feelings, images, waking-life
echoes — it **says so and invites the person to run the analysis**, explicitly leaving room for the
person to keep talking if they want to. It **never writes the analysis itself in chat.** The person
taps the single analyze affordance; the app writes the structured `DreamAnalysis`.

On completion the analysis card shows what was created alongside it: any **goals** added, and the
**questionnaire** that was created and sent, naming its recipient.

## 4. Data model

All schema additions are **additive-optional — no `schemaVersion` bump, no migration** (the repo's
standing precedent).

| Schema            | Field                             | Purpose                                                      |
| ----------------- | --------------------------------- | ------------------------------------------------------------ |
| `ChatMessage`     | `id?: string`                     | Stable id for rewind. Absent ⇒ legacy; falls back to index.  |
| `TogetherMessage` | `redactedAt?: string`             | Tombstone. Set ⇒ `content` cleared, placeholder rendered.    |
| `Conversation`    | `analysisReady?: boolean`         | Dreams: the readiness nudge, made durable across navigation. |
| `DreamAnalysis`   | `goals?: string[]`                | Goals the synthesis surfaced → `extractGoals`.               |
| `DreamAnalysis`   | `questionnaire?: DreamCheckInRef` | What was created + sent, for display + idempotency.          |

`ClaudeStreamResult` (`host/claudeClient.ts`, not persisted) gains `stopReason?: string`.

All reads/writes continue through the vault service; nothing touches `fs` directly.

## 5. Architecture & modules

### 5.1 `streamWithContinuation` — one helper, not five copies

New `packages/core/src/conversations/streamWithContinuation.ts`. Wraps `client.stream`:

- Streams normally, passing `onDelta` straight through so the renderer sees no seam.
- If `stopReason === 'max_tokens'`, is under `MAX_CONTINUATIONS` (**2** → at most 3 calls per turn),
  and `canContinue()` passes, it re-calls with the accumulated partial appended as an `assistant`
  message (assistant-prefill continuation) and concatenates the result.
- Invokes `onCall` per call so **every** call is metered as its own `UsageEvent`.

Two correctness rules this must hold:

1. **Meter every call**, before any parsing (the standing meter-first rule).
2. **Strip coach markers only after stitching.** A `[[SELFOS:…]]` marker can straddle a seam;
   concatenating first lets it reassemble. Per-segment stripping would corrupt it.

### 5.2 Token budgets

Adaptive thinking **shares** `maxTokens` with the visible reply
([[adaptive-thinking-shares-maxtokens]]). Two surfaces were left starved:

| Call                | Before | After |
| ------------------- | ------ | ----- |
| Dream analysis turn | 1024   | 4096  |
| Dream opener        | 512    | 1024  |
| Intake turn         | 1024   | 4096  |

Ceilings, not targets — you pay only for tokens generated.

### 5.3 Rewind primitive

`rewindConversation(fs, key, personId, conversationId, toMessageId)` truncates at the message and
saves. "Retry from here" composes it with the existing retry: rewind to just before the target, then
regenerate. One primitive serves both features and both `Conversation`-backed shapes (Sessions,
Dreams); intake gets the equivalent against `IntakeSection.messages`.

### 5.4 Renderer

`MessageRow` (`design-system/components/MessageTime.tsx`) gains an optional `actions` slot — that
alone gives Sessions, Dreams and Onboarding a consistent affordance. A shared `MessageActions`
component renders the two actions (hover **and** keyboard-focus reachable, destructive action
confirmed). Together renders its own header-bearing bubble, so `TogetherThread` places the same
component itself rather than via `MessageRow`.

## 6. IPC / API contracts

New channels, all gated and **active-person-scoped in the bridge** (the trust boundary), threaded
through the full typed seam (`channels.ts` → `coreBridge.ts` → `ipc.ts` → preload →
`test-utils/bridge`):

| Channel                | Purpose                                    | Gate                    |
| ---------------------- | ------------------------------------------ | ----------------------- |
| `dreams:retry`         | Regenerate an unanswered dream turn        | `dreams.own`            |
| `intake:retry`         | Regenerate an unanswered intake turn       | `intake.own`            |
| `conversations:rewind` | Truncate a session transcript at a message | `sessions.own`          |
| `dreams:rewind`        | Truncate a dream transcript                | `dreams.own`            |
| `intake:rewind`        | Truncate a section transcript              | `intake.own`            |
| `together:redact`      | Tombstone a message and everything after   | participant + live edge |

The Claude key stays host-side and never crosses IPC. Together's existing participant + live-edge
re-check applies to `together:redact` on every call.

## 7. States & edge cases

- **Truncated then budget-exhausted mid-continuation** — keep the partial, stop cleanly, no error.
- **Continuation cap reached** — keep what we have; never loop unbounded.
- **Empty reply** — unchanged: an honest `EMPTY` failure, never persisted (05 §4.1).
- **Failed turn** — the user's message is already persisted; the transcript ends on it and retry is
  offered.
- **Legacy messages with no `id`** — rewind falls back to positional index.
- **Rewind racing an in-flight turn** — disabled while a turn is streaming.
- **Together: redacting a private aside** — the tombstone stays scoped to whoever could already see
  the aside; it is never revealed to the other partner by its removal.
- **Together: redaction and derived signals** — a tombstone must not read as "their turn"; all four
  viewer signals derive from `projectMessages`, so handling it there keeps them consistent.
- **Dream re-synthesis** — already deletes the prior Insight; goal extraction must be idempotent so
  re-running neither duplicates nor orphans goals.
- **Dream questionnaire failure** — persists nothing (no orphan questionnaire or assignment).

## 8. Safety

- The not-medical boundary, crisis routing, and the crisis footer are **unchanged** on every surface.
- Auto-continue never alters content or register — it only lets a reply finish. `crisisFlag` and
  `distressSignal` remain never-coerced through the tolerant parse (37).
- **8.3 Together redaction is a tombstone, not an erasure.** In a couples context a transcript that
  silently rewrites itself is disorienting and corrosive to trust, so a removed message leaves a
  neutral placeholder for both partners. The content is gone; the fact that something was there is
  not hidden.
- **8.4 Dream-derived questionnaires are auto-sent, including from sensitive dreams.** This is a
  deliberate owner decision taken with the consequence stated explicitly: a questionnaire sent to the
  person a dream was about can disclose that they were dreamt about, and roughly what happened,
  without the dreamer reviewing what was asked. Recorded here so it is not later mistaken for a bug
  and silently "fixed". Precedent: the §24.5 "questionnaire tailoring uses ALL data" override.

## 9. Accessibility

- Message actions are reachable by keyboard, not hover-only, with visible focus.
- The destructive action is confirmed and announced; the confirm is focus-managed.
- The Together tombstone is real text, not a colour or icon alone.
- Auto-continue produces no focus change and no live-region churn — it is one continuous reply.

## 10. Testing strategy

- **Unit (Vitest)** — `streamWithContinuation`: stitching, the continuation cap, budget refusal
  mid-loop, per-call metering, and a marker straddling the seam. `rewindConversation`. The
  dream/intake persist-order fix. `extractGoals` idempotency on re-synthesis. The Together tombstone
  through `projectMessages` and all three derived signals.
- **Integration (coreBridge)** — decrypt the vault and assert what was actually written: a failed
  dream/intake turn leaves the user's message on disk; a rewind truncates correctly; a redacted
  Together message keeps its tombstone for **both** viewers; a dream synthesis writes the goals and
  the assignment, and a failed one leaves nothing behind.
- **E2E (Playwright)** — a new `SELFOS_FAKE_TRUNCATE` hook makes `fakeClaudeClient` return
  `stopReason: 'max_tokens'` once then complete on the continuation (mirroring `SELFOS_FAKE_CHAT_EMPTY`).
  Driven through the real UI: a truncated reply auto-completes seamlessly; retry works on dream and
  intake; rewind deletes and regenerates; the dream flow ends with exactly one analyze affordance and
  no duplicate analysis; a dream synthesis produces a visible goal and a sent questionnaire.
- **Live-model check** — the offline fake always returns clean output and therefore hides this exact
  class of bug. After Slice 1, verify a long dream-analysis reply against the real model.

## 11. Open questions

None — all resolved before implementation:

- Cut-off handling → **auto-continue silently** (bounded, budget-checked).
- Message management → **rewind to here**; no branching, no per-message edit.
- Together → **full parity**, with a "message removed" tombstone.
- Dream goals → **automatic** (matches session wrap-up).
- Dream questionnaires → **auto-created and auto-sent**, no sensitivity carve-out (§8.4).

## 12. Changelog

- 2026-07-19 — created and approved. Five slices: truncation + auto-continue; fail-safe parity;
  rewind; dream coherence; dream artifacts.
