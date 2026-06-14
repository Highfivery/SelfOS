# 13 — Dream images (AI image generation of a dream)

> **Status:** **Built** (all 5 slices shipped to `main`) · **Approved** (2026-06 style amendment, §15) · _last updated 2026-06-14_
>
> **2026-06 amendment (§15, package F of the app refresh):** a richer **default image style** picker (more
> presets) plus a **free-text style description** so the dreamer can refine the look in their own words — both in
> Settings → Dreams (defaults) and optionally per image. Read §15 with §5.3/§6.
>
> The deferred companion to [`12-dreams.md`](12-dreams.md): a dreamer can **visualize a dream** as a single
> AI-generated image. It introduces SelfOS's **second AI provider** (OpenAI, for image generation only — text
> stays Anthropic), a one-time **third-party consent**, **encrypted binary-blob** image storage in the vault,
> a **flat per-image cost** in the existing metering/budget layer, and a privacy-careful, **Claude-distilled
> prompt** that may make a figure resemble a real, People-graph-linked person by **appearance** but **never by
> name**. An image **never feeds the AI coaching context**, but it is **dreamer-controlled** — the dreamer may
> deliberately **export** it to a file or **share** it per-dream with a related person. This spec also includes
> a **prerequisite People-profile amendment** (new descriptive fields on `Person`, §4.6/§13.1) used as coaching
> context app-wide and as the depiction source for image prompts.

Builds on [`00-architecture.md`](00-architecture.md) (vault, IPC, security, feature-module registry, the
host-interface pattern), [`01-design-system.md`](01-design-system.md),
[`03-settings.md`](03-settings.md) (the settings registry: model select, consent toggle, style picker),
[`04-people-roles.md`](04-people-roles.md) (`Person`, capabilities, encryption, `buildContext`,
shareable-vs-private), [`05-conversations.md`](05-conversations.md) (the `ClaudeClient` host-interface
precedent + key-in-main), [`06-ai-usage-and-budgets.md`](06-ai-usage-and-budgets.md) (every AI call metered
and budget-gated), [`07-mobile-platform.md`](07-mobile-platform.md) (the `SecretStore`/host-interface seam, so
the feature works on Electron + iOS), [`08-questionnaires.md`](08-questionnaires.md) §13.2 (the existing
encrypted-image precedent — `imageService` + `encryptBytes`/`decryptBytes` + base64-over-IPC + `isMediaPath`),
and [`12-dreams.md`](12-dreams.md) (the dream the image visualizes; the dreamer-only privacy posture).

---

## 1. Overview

A dream is intensely visual, and seeing it can deepen reflection. After capturing a dream (and/or analyzing
it, `12`), the dreamer can choose to **Visualize this dream**: SelfOS runs a small **Claude pass** that distills
the dream's _narrative_ — plus, optionally, **generic, name-free physical-depiction notes** about any
People-graph-linked people who appeared in it — into a tight visual prompt, sends **that** to **OpenAI's image
API**, and stores the resulting single canonical image **encrypted in the vault** under the dream. The image
can be viewed, **regenerated** (replacing the prior one, with a confirm), **deleted**, **exported** to a file,
and **shared** per-dream with a related person. Generation is gated three ways: a one-time **global consent** to
send dream content to OpenAI, an **OpenAI API key** present, and the **`dreams.generateImage`** capability.

This is the explicitly-deferred work parked in `12-dreams.md` §2/§11.2. It is a self-contained feature module
that adds a second provider behind a new **`ImageClient`** host interface (mirroring `ClaudeClient`), so the
seam is testable with an offline fake and the iOS host (`07`) gets it for free via `createCoreBridge`.

The spec opens with a **prerequisite People-profile amendment** (§4.6) — new descriptive `Person` fields the
user wants used as coaching context **app-wide** (not just for images). It ships as build slice 1 because it's
independently valuable and the image prompt's depiction notes (appearance + gender + ethnicity + exact age)
read from a subset of those fields.

### 1.1 Relationship to other specs

- **`12-dreams.md`** owns the `Dream` schema, the dreamer privacy posture, the per-dream `SensitivityTier`, the
  People-graph "people present" links, and the per-dream **fact**-sharing model (§13.5) this mirrors for
  image-sharing. This spec **adds** an additive-optional `Dream.image` descriptor (§4.2, incl. `shareableWith`)
  and a new `image.enc` blob under the dream folder. Synced into `12` via `sync-docs`, mirroring how `12`
  amended `08`'s `Insight`.
- **`06-ai-usage-and-budgets.md`** owns metering + budgets. This spec adds a **flat** `dream.image` usage type
  (`costOf` gains an image branch; the pricing table gains image-model entries) **plus** a token-based
  `dream.imagePrompt` type for the Claude distillation pass (§4.5).
- **`04-people-roles.md`** §4.1 (`Person`) is **amended** by §4.6/§13.1 — new descriptive fields, threaded
  through `buildContext`/`buildLinkedPeopleContext`, surfaced in the person editor.
- The text coach stays **Anthropic** end-to-end, and Anthropic (Claude) also **distills** the image prompt;
  **OpenAI** is used **only** to render image pixels from that distilled, name-free prompt.

## 2. Goals / Non-goals

**Goals**

- **Visualize a dream** as one AI-generated image, reachable from **both** the dream detail/composer and the
  analysis card (`12` §3.2/§3.3).
- A **second provider** (OpenAI image generation) behind a new **`ImageClient`** host interface (an OpenAI
  impl plus an offline fake), with the key in the **main/Keychain `SecretStore`** as `openai.apiKey` — never
  reaching the renderer (the `anthropic.apiKey` precedent, `00` §6.2 / `05`).
- **Encrypted binary-blob storage**: one canonical image per dream at
  `people/<person-id>/dreams/<dream-id>/image.enc` via the existing `encryptBytes`/`decryptBytes` + the
  base64-over-IPC pattern from `08` §13.2; regeneration **replaces** it (with a confirm); path access
  confined like `isMediaPath`.
- A **one-time global consent** (default OFF) acknowledging that generating sends the dream's description to a
  third party (OpenAI).
- A **privacy-careful, Claude-distilled prompt**: a small Claude pass condenses the dream **narrative** (+
  name-free depiction notes + style + framing) into a tight visual prompt, **never echoing real people's
  names**; it **may** use a People-graph-linked person's **appearance + gender + ethnicity + exact age**
  (from the dreamer's own descriptions, name-free) so a figure resembles them; a chosen **style** + dreamlike,
  non-photorealistic framing. Metered as a `dream.imagePrompt` Claude call (§4.5).
- **Export & per-dream sharing**: the dreamer can **export** a generated image to a file and **share** it
  per-dream with a related household person (gated by `dreams.shareContext`, excluded for sensitive tiers),
  viewed in a "Shared with you" surface (§3.6).
- **Metering + budget**: a `dream.image` usage type with a **flat** per-image USD cost, recorded through `06`,
  charged to the **dreamer**, with the chat warn→block budget behaviour; admin-only `$` display.
- A new **`dreams.generateImage`** capability (default ON for Member, like `dreams.own`), gated in the bridge.
- **Image generation allowed for any `SensitivityTier`**, with a clear **warning before sending** when the
  dream is a non-standard tier (content leaves the device); **graceful handling of OpenAI content-policy
  refusals** (calm message; an uncharged refusal is not metered).
- A **default image style** in Settings (e.g. dreamlike / painterly / watercolor / realistic) with an
  optional **per-image override**.
- The **People-profile amendment** (§4.6): new descriptive `Person` fields used as coaching context app-wide
  and as the image-depiction source, with the **shareable-vs-private** split intact.

**Non-goals (deferred / owned elsewhere)**

- **Sending reference images / photos** of a real person to the provider — never (no likeness via photo; the
  depiction is text-only fields). Out of scope permanently.
- **Real-person likeness via NAME** — never sent. (Appearance/gender/ethnicity/approx-age **are** sent, per
  the user's explicit reconciliation, §8.2.)
- **Images feeding the coach** — an image never enters `buildContext` (text Insights only — an image can't be
  a text fact). It can be exported or per-dream **shared** (§3.6) by the dreamer's explicit action, but it is
  never part of the AI's written context. Out of scope by design.
- **Multiple images per dream / galleries / variations** — v1 is one canonical image (regenerate replaces).
  A future enhancement could keep a history; not now (no scaffolding).
- **Multiple image sizes / aspect ratios** — v1 is a fixed 1024×1024 square (§4.4). Portrait/landscape later.
- **Image-to-image, inpainting, editing tools** — out of scope.
- **A second provider for anything other than images** — the text coach remains Anthropic.
- **Voice / animation** — out of scope.

## 3. UX & flows

The Dreams feature module (`12` §3) gains the image surfaces; the App Shell is untouched. Every surface is
responsive (~360px→desktop) per CLAUDE.md §12, and the not-medical line + crisis footer already present on
dream surfaces (`12` §8.2) remain.

### 3.1 Placement (two entry points)

A **"Visualize this dream"** action appears in **both** places, gated identically (consent + key + capability,
§3.4):

1. **Dream detail / composer** (`12` §3) — on a saved dream, below the narrative/quick fields. Lets a dreamer
   visualize a captured dream without analyzing it.
2. **Analysis card** (`12` §3.2/§3.3) — on the synthesized analysis (the `DreamSynthesisCard`), so the
   visualization sits beside the written reflection.

Both render the same **`DreamImagePanel`** component (one source of truth) bound to the dream id; whichever
surface generated the image, the other shows it (the image lives on the dream, not the surface).

### 3.2 Generate (happy path)

1. The dreamer taps **Visualize this dream**.
2. If the dream's `sensitivity` is non-standard (`12` §8.3), a **one-step warning** appears first: "This is a
   sensitive dream. Generating an image sends its description to OpenAI (a third party). Continue?" — Continue
   / Cancel. (Standard-tier dreams skip this; the global consent, §3.4, already covers third-party sending.)
3. Optionally the dreamer picks a **style** for this image (defaulting to the Settings default, §6) — a small
   style picker on the panel.
4. **Generate** → a **loading state** (the image takes seconds): a calm placeholder with progress copy and a
   Cancel. The renderer calls `dreams:generateImage`; main **distills the prompt via a Claude pass**
   (§5.3/§8.2, recorded as `dream.imagePrompt`), checks budget, calls the `ImageClient`, encrypts the returned
   bytes to `image.enc`, stamps `Dream.image`, and records the flat `dream.image` usage event.
5. **Success** → the image renders in the panel with **Regenerate**, **Delete**, **Save image…** (export, §3.5),
   and **Share** (per-dream, §3.6) actions and an "estimated cost" figure (admin-only `$`, `06`). A short caption
   notes it is an AI interpretation, dreamlike, not a literal record.

### 3.3 Regenerate & delete

- **Regenerate** — a confirm ("This replaces the current image. Continue?") then the §3.2 flow; on success the
  new bytes overwrite `image.enc` and `Dream.image` is re-stamped (`generatedAt`/`style`/`mime`). A failed
  regenerate **keeps the existing image** (no destructive write before the new bytes arrive).
- **Delete** — a confirm, then `image.enc` is removed and `Dream.image` is cleared; the panel returns to the
  "Visualize this dream" entry state.
- Deleting the **dream** already purges its whole folder (`12` §3.6 `purgeDream` / `dreamService.deleteDream`
  removes the dream dir), so `image.enc` is purged with it — no orphan.

### 3.4 Calm states (no dead controls)

The panel resolves to exactly one state, mirroring the AI-off / over-budget / refusal patterns already in
`05`/`12`:

- **Consent OFF** — a calm "Turn on dream-image generation in Settings" note (with what it means: sends the
  dream's description to OpenAI), not a dead Generate button. Links to **Settings → Dreams**.
- **No OpenAI key** — "Add your OpenAI key in Settings to visualize dreams," pointing to **Settings → Dreams**
  (admin-only key control, §6).
- **AI disabled globally** (`ai.enabled` off, `05`) — the same calm connect state; no Generate.
- **Over budget** — the `06` warn→block UX (owner override); the existing image (if any) stays viewable.
- **Capability absent** (`dreams.generateImage` off for this role) — the panel is **not shown** at all (the
  bridge re-enforces; the UI gate is convenience, not the trust boundary, §6).
- **Content-policy refusal** — a calm "OpenAI declined to generate this image (its content policy). Your dream
  is saved; you can edit the description and try again." — no metering of an uncharged refusal (§7).
- **Loading / error / offline** — a spinner+Cancel; a clear retry on network failure; the dream is never lost.

### 3.5 Export (save to a file)

- A **Save image…** action on a generated image decrypts the bytes and writes them to a file the dreamer
  chooses **outside the vault** (Electron: a native save dialog in main; iOS/web: a download/share-sheet). A
  short note reminds the dreamer that the exported file leaves the encrypted vault and is no longer protected by
  it. No third party is involved (the bytes are already on the device); export is **dreamer-only** and needs no
  extra capability beyond `dreams.generateImage` (it's their own image).

### 3.6 Per-dream image sharing (default off)

- A **Share** action lets the dreamer share a dream's image with a **related household person** — mirroring the
  §13.5 per-dream **fact** sharing: pick a related person; the image becomes visible to **that** person.
  Gated by **`dreams.shareContext`** and **excluded for sensitive-tier dreams** (`12` §8.3), so intimate
  content can't be shared. Sharing is a deliberate, reversible per-person act (an "Unshare" returns it to
  dreamer-only). The image still **never** enters anyone's AI coaching context (text Insights only, §8.3).
- The share targets are persisted on the descriptor (`Dream.image.shareableWith: string[]`, §4.2); the
  recipient sees shared images in a lightweight **"Shared with you"** surface in Dreams (placement confirmed in
  the sharing slice, §11.4). The bridge re-enforces the relationship + capability + sensitivity at **read**
  time, so removing a relationship drops the share (the §13.5 read-time re-gate).

### 3.7 People-profile fields (the prerequisite, §4.6/§13.1)

In the tabbed **`PersonEditor`** (`04` §6.2), the descriptive fields (gender, appearance, ethnicity,
occupation, interests, location, goals, communication style, values, languages, important dates, **health
notes, faith**) are each **individually lockable** and default to **shared**
([`15-shareability.md`](15-shareability.md) §4.1) — health/faith are no longer always-private. They feed
`buildContext` (own always; related people only when not locked); the depiction subset (appearance + gender +
ethnicity + exact age from `birthday`) feeds image prompts only for the fields not locked (§8.2).

These are independent of images (a dreamer with no images still benefits in chat); the image feature simply
**reads** the shared depiction subset.

## 4. Data model

All persisted formats are **Zod-backed** (`z.infer` types), versioned, and written through the vault + crypto
service (`00` §4, `04` §5) — **no direct `fs`**. Types live in `@selfos/core` so the renderer and IPC contract
share one source.

### 4.1 Vault layout (additions)

```
vault/
  people/<person-id>/
    dreams/<dream-id>/
      dream.enc          # Dream (12 §4.2) — gains an additive-optional `image` descriptor (§4.2 below)
      analysis.enc       # DreamAnalysis (12 §4.3) — unchanged
      conversation.enc   # guided-analysis transcript (12 §4.1) — unchanged
      image.enc          # NEW — the canonical generated image, ENCRYPTED BYTES (encryptBytes envelope)
```

`image.enc` is an **encrypted-bytes** envelope (the `08` §13.2 `encryptBytes` envelope serialized as JSON,
exactly like `questionnaires/media/<id>.enc`), **not** an encrypted-JSON file. There is one image per dream;
regeneration overwrites it. It lives **inside the dream folder**, so `dreamService.deleteDream` (which removes
the dir, `12` §4.1) purges it automatically.

### 4.2 `Dream.image` (additive-optional amendment to `12` §4.2)

```ts
// Added to DreamSchema (12-dreams §4.2) — additive-optional, NO migration, Dream.schemaVersion stays 1
// (the Person.email / Insight.dreamId precedent).
const DreamImageDescriptorSchema = z.object({
  style: z.string().min(1), // the style used (e.g. 'dreamlike'); free string so styles can grow
  mime: z.string().min(1), // e.g. 'image/png' — builds the display data URL (08 §13.2 `mime` precedent)
  generatedAt: z.string(),
  model: z.string().min(1), // the OpenAI image model used (provenance; cost is snapshotted in the UsageEvent)
  // Per-dream sharing (§3.6): the related-person ids this image is shared with (the §13.5 InsightFact
  // .shareableWith model). Absent/[] = dreamer-only. The relationship + sensitivity are re-gated at read.
  shareableWith: z.array(z.string()).optional(),
});
// Dream gains:  image?: z.infer<typeof DreamImageDescriptorSchema>
```

The descriptor is metadata only; the bytes live in `image.enc`. Absent `image` = the dream has no generated
image (the §3.4 entry state). Existing dream files parse unchanged (no `schemaVersion` bump, no migration).

### 4.3 Encrypted-bytes storage (reuse `08` §13.2)

There is **no new crypto** and **no new envelope**. The feature reuses:

- **`encryptBytes(bytes, key)` / `decryptBytes(envelope, key)`** (`@selfos/core/crypto`) — the byte-level
  AES-256-GCM primitives `08` §13.2 added (and that the string `encrypt`/`decrypt` already wrap, so the
  on-disk envelope is byte-identical and existing vaults stay readable).
- The **store/read/delete** shape of `imageService` (`08` §13.2 `storeQuestionnaireImage` / `getQuestionnaireImage`
  / `deleteQuestionnaireImage`): write the JSON-serialized envelope via `fs.writeAtomic`; read → parse →
  `isEncryptedEnvelope` guard → `decryptBytes`; delete via `fs.remove`.
- A **path guard** in the spirit of `isMediaPath` (`08` §13.2): an `isDreamImagePath(path)` helper confines any
  caller-supplied path to a dream's `image.enc` (`people/<id>/dreams/<id>/image.enc`, ends `.enc`, no `..`), so
  a malicious renderer can't read/delete an arbitrary vault file by path. In practice the bridge addresses the
  image by `(personId, dreamId)` and derives the path itself — the guard is defense in depth.

### 4.4 Image limits

Mirroring `08` §13.2's bounds (the relay/ZK constraints don't apply here, but bounding blob size keeps vault
sync sane):

- **Accepted MIME** from the provider: `image/png` (and `image/webp`/`image/jpeg` if the model returns them).
- **Max stored bytes** ~5 MB (`MAX_IMAGE_BYTES`, reused). A larger return is rejected with a calm error and not
  stored or metered as a success (the call still spent, so it is metered — see §7 on the refusal-vs-error
  distinction).
- **Dimensions** are fixed at **1024×1024 (square)** in v1 (§12.5); multiple sizes are deferred (§2 non-goals).

### 4.5 Metering (a flat image charge + a token-based distillation charge)

Each generation records **two** `06` usage events, both charged to the dreamer:

1. **`dream.imagePrompt`** (token-based) — the Claude pass that distills the narrative into the visual prompt
   (§5.3). Costed by the normal token formula (`costOf` on the active Claude model), like `dream.analyze`.
2. **`dream.image`** (flat) — the OpenAI generation. `06`'s `UsageEvent` is token-based with a snapshotted
   `costUsd`; an image call has **no meaningful token counts**, so it is represented as
   **`inputTokens=0, outputTokens=0, cacheWriteTokens=0, cacheReadTokens=0` + a flat `costUsd`** (the per-image
   price for the chosen image model). This requires:
   - The `06` **pricing table** gains image-model entries — a new `IMAGE_PRICING: Record<string, { perImageUsd:
number }>` (or an additive `perImageUsd?` on `ModelPricing`), seeded with the offered OpenAI models at the
     **high-quality 1024² estimate (~$0.17)** (exact values confirmed at build, §11.2).
   - **`costOf`** gains an **image-cost path**: for a `dream.image` event (zero tokens), cost = the flat
     `perImageUsd` for the model, not the token formula (which would yield $0).

Both events' `model` + `costUsd` are snapshotted at record time so historical totals don't drift (the `06`
rule). The budget gate is checked once before generation; a `REFUSED` (uncharged) generation meters neither
event for the OpenAI call (the distillation, if it ran and was billed, is metered — §7).

### 4.6 People-profile amendment (amends `04` §4.1 `Person`)

Additive-optional fields on `PersonSchema` / `PersonInputSchema` (`@selfos/core/schemas`). **No `schemaVersion`
bump, no migration** (the `email`/`phone` precedent). **`birthday` already exists** (`04` §4.1) and is reused
for DOB/age — **not duplicated**. Proposed shapes (field-type calls noted in §11 where genuinely open):

```ts
// Descriptive fields — each individually lockable via privateFields, defaulting to SHARED (15-shareability
// §4.1); healthNotes/faith are no longer always-private. The depiction subset (appearanceDescription +
// gender + ethnicity + exact age from birthday) feeds the image prompt only when not locked (§8.2).
gender: z.string().optional(); // small enum (female/male/non-binary/prefer-not-to-say) + free-text "other" (§11.3)
appearanceDescription: z.string().optional(); // free text — hair, build, distinctive features, etc.
ethnicity: z.string().optional(); // free text (self-described; not an enum — see §11)
occupation: z.string().optional(); // free text
interests: z.array(z.string()).optional(); // chip list
location: z.string().optional(); // free text
goals: z.string().optional(); // free text (multiline)
communicationStyle: z.string().optional(); // free text
values: z.array(z.string()).optional(); // chip list
languages: z.array(z.string()).optional(); // chip list
importantDates: z.array(z.object({ label: z.string().min(1), date: z.string().min(1) })).optional();
healthNotes: z.string().optional(); // free text (multiline) — defaults shared, lockable (15 §4.1)
faith: z.string().optional(); // free text — defaults shared, lockable (15 §4.1)
```

`buildContext` (`04` §3.4 / `packages/core/src/people/buildContext.ts`) and `buildLinkedPeopleContext`
(`12` §5.1) surface each descriptive field in a related person's context **only when not locked**
(`isPersonFieldShared`), and always in the person's own context block — the unified per-field model
([`15-shareability.md`](15-shareability.md) §4.1). The image-depiction subset = `appearanceDescription` +
`gender` + `ethnicity` + the **exact age** computed from `birthday` (§12.8), each gated the same way.

### 4.7 Ownership

All reads/writes go through the vault + crypto service (no direct `fs`). The OpenAI key lives **only** in the
main/Keychain `SecretStore` (`openai.apiKey`); it never crosses IPC to the renderer (the `anthropic.apiKey`
rule, `00` §6.2). Image bytes cross IPC only as **base64** (the `08` §13.2 pattern).

## 5. Architecture & modules

### 5.1 The `ImageClient` host interface (new)

A new host interface in `@selfos/core/host`, mirroring `ClaudeClient` (`05` / `packages/core/src/host/claudeClient.ts`):

```ts
export interface ImageGenerateOptions {
  apiKey: string;
  model: string;
  prompt: string;
  size?: string; // e.g. '1024x1024' (open question, §11)
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
```

- **OpenAI impl** (host-side): calls the OpenAI image API with the key, returns bytes + mime. A
  content-policy decline maps to `{ ok: false, reason: 'REFUSED' }` (distinguished from a network/`ERROR` so
  the service can avoid metering an uncharged refusal, §7). Lives in the main host (and the iOS/web host as a
  browser-mode call or a fake), parallel to `anthropicClient` / `browserClaudeClient`.
- **Offline fake**: returns a small deterministic PNG (a 1×1 or tiny solid image) so tests/E2E never hit the
  network — selected by env (`SELFOS_FAKE_IMAGE`), the `SELFOS_FAKE_CLAUDE` precedent.

The interface is the testable seam for **this** feature (not scaffolding — it ships with the OpenAI impl + the
fake + a consumer). `createCoreBridge` (`07` §5.3) gains an `image: ImageClient` host part, so the iOS host
gets image generation by supplying its own impl.

### 5.2 Core (`@selfos/core`)

- **dreamImageService** (`@selfos/core/dreams`) — the orchestrator (the `dreamAnalysisService` pattern); it
  takes **both** a `ClaudeClient` (for distillation) and an `ImageClient` (for pixels):
  - `generateDreamImage(deps)` — `checkBudget` (person + app, owner override) → **distill the prompt** via the
    `ClaudeClient` (§5.3), recording `dream.imagePrompt` → `imageClient.generate(distilledPrompt)` → on `ok`:
    validate bytes/mime (§4.4) → `encryptBytes` → write `image.enc` → stamp `Dream.image` →
    `recordUsage('dream.image', flat cost)`; on `REFUSED`: **no `dream.image` metering**, return the calm reason
    (a billed distillation is still metered); on `ERROR`: return the error (metering per §7). Re-generate is the
    same call (it overwrites only on success).
  - `getDreamImage(personId, dreamId)` → decrypted bytes + mime, or null.
  - `deleteDreamImage(personId, dreamId)` → remove `image.enc` + clear `Dream.image`.
  - `setDreamImageShare(dreamerId, dreamId, targetPersonId, shared)` → toggle a related person in
    `Dream.image.shareableWith` (§3.6); **refuses** a sensitive-tier dream + a non-related/unknown target (the
    `12` §13.5 `setDreamFactShare` precedent). `getSharedDreamImage(viewerId, dreamerId, dreamId)` →
    re-validates the relationship + capability + sensitivity at read, returns the image or denies.
  - Reuses `encryptBytes`/`decryptBytes` + the `isDreamImagePath` guard (§4.3), `checkBudget`/`costOf`/
    `recordUsage` (`06`), and `getDream`/`saveDream` (`dreamService`).
- **buildImagePromptInput** (a pure, unit-tested helper in `@selfos/core/dreams`) — assembles the **distillation
  input** (the dream narrative + linked-people name-free depiction notes + style + the safety instruction)
  handed to the Claude distillation. Pure and name-free: the security-critical unit (tested that **no real
  name** and **no private field** is ever placed into the distillation input).
- **buildDepictionNote** (`@selfos/core/people`, a sibling of `buildLinkedPeopleContext`) — given a linked
  `personId`, returns a **name-free** depiction string from the shareable subset only (appearance + gender +
  ethnicity + exact age from `birthday`); never the person's name, notes, or private fields. Returns '' if
  there's nothing depictable. This is the single place the depiction subset is assembled, so the privacy
  boundary is one code path.
- **buildContext / buildLinkedPeopleContext** — extended for the §4.6 descriptive fields (shareable own +
  related; private own-only).
- **pricing / usageTypes** (`06`) — the `dream.image` (flat) + `dream.imagePrompt` (token) usage types + the
  flat-image-cost path (§4.5).

### 5.3 Prompt construction — the Claude distillation (the privacy-critical core)

Generation is a **two-call** flow: a Claude distillation produces the visual prompt, then OpenAI renders it.

1. **Assemble the distillation input** (`buildImagePromptInput`, pure) — the dream `narrative`, plus, for each
   People-graph-linked "person present" (`12` §3.1), a **name-free** depiction note from `buildDepictionNote`
   (`"a figure: <appearanceDescription>, <gender>, age <exact age>, <ethnicity>"`, only the fields present); a
   **free-name** dream person (no `personId`) contributes **nothing** beyond the narrative and is **not** a
   depiction. The chosen **style** (per-image override or Settings default) and a fixed
   **non-photorealistic/dreamlike, within-policy** instruction are included.
2. **Distill via Claude** — a small `ClaudeClient` call turns that input into a single, tight **visual prompt**.
   Its system instruction requires the output to **never include any person's name** and to describe figures
   only by the provided depiction notes — defense in depth on top of step 1 (which already passes **no names**
   in). The narrative may contain names (the dreamer's own words); the distillation is responsible for not
   echoing them. Metered as `dream.imagePrompt` (§4.5).
3. **Render** — the distilled prompt is sent to `ImageClient.generate` (the OpenAI call, `dream.image`).

Never sent to **OpenAI**: any person's **name**, `privateNotes`, `healthNotes`, `faith`, non-depiction
shareable fields, or any **reference image/photo**. The only inputs to the OpenAI call are the Claude-distilled,
name-free prompt + the style/size. (The narrative + depiction notes are seen by **Claude** during distillation
— the same model that already powers the coach — but the names within the narrative are stripped before the
prompt reaches OpenAI.)

### 5.4 Desktop main (host) & iOS

- **main** wires `dreamImageService` to `nodeFileSystem` / `nodeSecretStore` / the OpenAI `ImageClient` impl
  **and the existing `anthropicClient`** (`ClaudeClient`) for the distillation pass, and registers the IPC
  handlers (§6). `openai.apiKey` is read host-side via `host.secrets.get(OPENAI_API_KEY_ID)` (the
  `ANTHROPIC_API_KEY_ID = 'anthropic.apiKey'` precedent; a new `OPENAI_API_KEY_ID = 'openai.apiKey'`); the
  Anthropic key is read host-side as today. The **export** save-dialog is a main-side platform op (§6).
- **iOS host** (`07`) supplies its own `ImageClient` (browser-mode or a native call) + the Keychain
  `openai.apiKey`; the feature works via `createCoreBridge` with no shell changes.

### 5.5 Renderer

- **Stores (Zustand):** extend `dreamStore` / `dreamAnalysisStore` (`12` §5.3) with the image lifecycle
  (load/generate/regenerate/delete + the resolved §3.4 state), resetting on `activePerson.id` change (the
  per-person isolation rule).
- **Components:** **`DreamImagePanel`** (the shared panel rendered in both placements, §3.1) — the entry
  action, the style picker, the sensitive-tier warning, the loading/success/refusal/calm states, and the
  image with Regenerate/Delete + the admin-only cost. Reuses the design-system primitives; no new design-system
  primitive is required (the image is an `<img>` from a decrypted data URL, the `08` `QuestionImage` pattern).
- **Settings:** the Dreams settings section (`12`) gains the consent toggle, the admin-only OpenAI key control
  - image-model select, and the default-style picker (§6).

### 5.6 Feature-module registration

No new nav/route — this extends the existing Dreams module (`12` §5.4): the `dreams.generateImage` capability,
the new IPC handlers, the new Settings declarations, the `image` host part, and the `Dream.image` schema
amendment. The shell is untouched.

## 6. IPC / API contracts & settings

Typed channels (`src/shared/channels.ts`, Zod-validated both sides; **the OpenAI key never crosses to the
renderer**), all gated by **`dreams.generateImage`** and scoped to the active dreamer in the bridge (the trust
boundary, not the UI):

- `dreams:generateImage({ dreamId, style? })` → `DreamImageResult`
  (`{ ok: true; mime: string } | { ok: false; reason: 'NO_KEY' | 'NO_CONSENT' | 'BUDGET' | 'REFUSED' | 'ERROR'; message: string }`)
  — main checks consent + key + budget + capability, **distills the prompt via Claude** (records
  `dream.imagePrompt`), calls the `ImageClient`, encrypts + stores, stamps `Dream.image`, records the flat
  `dream.image` usage. (Bytes are fetched separately to keep this response small; the **bytes never carry the
  prompt** back.)
- `dreams:getImage({ dreamId })` → `{ mime: string; dataBase64: string } | null` — decrypted image bytes as
  base64 (the `08` §13.2 base64-over-IPC pattern), for the `<img>` data URL.
- `dreams:deleteImage({ dreamId })` → `void` — removes `image.enc` + clears `Dream.image`.
- `dreams:exportImage({ dreamId })` (gated `dreams.generateImage`, dreamer-scoped) → writes the decrypted bytes
  to a dreamer-chosen file **outside the vault** via a main-side save dialog (Electron) / download (iOS/web);
  returns the chosen path or null if cancelled (§3.5).
- `dreams:imageShareTargets({ dreamId })` → the dreamer's related people + each one's current share state (for
  the §3.6 picker), gated `dreams.own`.
- `dreams:setImageShare({ dreamId, targetPersonId, shared })` → toggles `Dream.image.shareableWith`, gated by
  the privileged **`dreams.shareContext`**; refuses a sensitive-tier dream + a non-related/unknown target (§3.6).
- `dreams:getSharedImage({ dreamerId, dreamId })` → a **recipient** reads an image shared **with them**; the
  bridge re-validates the relationship + `Dream.image.shareableWith` + sensitivity at read time, else denies
  (the "Shared with you" surface, §3.6).
- The consent state, default style, and image model come from **vault settings** (read host-side like
  `dreams.memoryEnabled` / `ai.model`, `12` §6); the **OpenAI key** is read host-side from the `SecretStore`.

The bridge **re-enforces** all gates server-side (consent + key + `dreams.generateImage`/`dreams.shareContext`

- dreamer/recipient scope) — a non-dreamer or a role without the capability cannot generate, read, export,
  share, or delete another person's dream image, and a recipient can read a shared image **only** while the share
- relationship hold.

**Settings** (`03` registry; new declarations in the Dreams section, `12` §3/§6):

- `dreams.imageGenerationEnabled` (boolean, **default OFF**, the one-time global **consent**) — copy
  acknowledges that generating sends the dream's description to OpenAI (a third party). Generation requires
  this ON + the key present + the capability.
- `dreams.imageModel` (select, **admin-only** — `adminOnly` like the questionnaires relay model, marked
  "Admin only", §12) — the OpenAI image model; options **`gpt-image-2` (default) + `gpt-image-1`** (exact ids
  confirmed at build, §11.1).
- `dreams.imageStyle` (grouped select) — the default style, chosen from the ~20 family-grouped
  `IMAGE_STYLE_PRESETS` (Painted / Drawn / Stylized / Photographic-ish), with a per-image override on the
  panel (§3.2). A **free string** so the set can grow without migration (§15.1).
- `dreams.imageStyleNotes` (textarea, max 300, default empty) — **Settings-only** free-text style direction
  that augments the preset on every image; threaded host-side into `buildImagePromptInput` (§15.2).
- An **OpenAI key control** (admin-only custom control, mirroring the `ai.apiKey` `ApiKeyControl` — write-only
  to the renderer; `secret:setOpenAiKey` / a `has` check, never a `get`).

### 6.1 OpenAI API boundary

- The key (`openai.apiKey`) is **device-local** in the `SecretStore`, never in the vault, never logged, never
  sent to the renderer (`00` §6.2 applied to the second provider).
- Main calls OpenAI's image API via the `ImageClient` impl. Failures (no key, auth, rate limit, network,
  timeout, content-policy refusal) map to the typed `DreamImageResult` reasons and surface as the §3.4 calm
  states. A content-policy **refusal** is `REFUSED` (uncharged → unmetered, §7); a transport **error** is
  `ERROR`.
- **Minimization:** only the **Claude-distilled, name-free prompt** (§5.3) reaches OpenAI — no names, no
  private fields, no photos. (The narrative is seen only by Claude during distillation — the coach model — and
  its names are stripped before the prompt reaches OpenAI.)

## 7. States & edge cases

Per `00` §7, every surface handles loading / empty / error / offline:

- **Consent OFF / no key / AI off** — calm connect states (§3.4); no generation; the dream is unaffected.
- **Over budget** — `06` warn→block (owner override); an existing image stays viewable.
- **Capability absent** — the panel isn't shown; the bridge denies the channel.
- **Distillation fails** — if the Claude distillation pass errors (no Anthropic key, network, budget), no OpenAI
  call is made; a calm error. A billed distillation that then fails is metered per the `06` rule; a
  pre-distillation gate failure is not.
- **Content-policy refusal (`REFUSED`)** — calm message; the OpenAI call was **not charged**, so **no
  `dream.image`** is metered (a distillation that already ran + billed is still metered). The dream + any prior
  image are untouched.
- **Transport error (`ERROR`)** — a clear retry. Metering: if the provider **did** bill for the call before the
  bytes failed (e.g. an oversized/invalid return after a successful generation, §4.4), it is metered as the
  `06` rule (a paid call is recorded even when post-processing fails — the `synthesizeAnalysis` "meter before
  parse" precedent); a pre-generation failure (no key, budget) is not.
- **Regenerate failure** — the existing image is preserved (no destructive overwrite before success, §3.3).
- **Oversized / wrong-MIME return** — rejected with a calm error, not stored (§4.4).
- **Export cancelled** — the save dialog is dismissed → no-op, no error (§3.5).
- **Shared-image read after un-share / removed relationship** — `getSharedImage` re-gates at read, so the
  recipient's view denies/empties the moment the share or relationship is gone (§3.6) — no stale access.
- **Share a sensitive-tier dream's image** — refused (the §3.6 exclusion), with a calm explanation.
- **Concurrent edits / sync conflict** on `image.enc` or `dream.enc` — vault conflict detection (`00`); never
  auto-deleted; surfaced. (A binary `image.enc` conflict copy is a provider conflict file, handled like any
  other, `00` §4.3.)
- **Corrupt / missing `image.enc`** — `getDreamImage` returns null (the §3.4 entry state); the dream + analysis
  are unaffected; the dreamer can regenerate.
- **Large blob** — bounded at ~5 MB (§4.4); base64 over IPC is a one-shot fetch, not streamed (images are
  small enough).
- **Dream deleted** — the folder purge removes `image.enc` (§3.3); no orphan.
- **Sensitive-tier dream** — generation is allowed but shows the §3.2 warning first.
- **Schema** — `Dream.image` is additive-optional (no migration); existing dreams parse unchanged.

## 8. Safety, privacy & honesty

### 8.1 Wellness boundary

SelfOS remains **wellness/self-help, not medical** (CLAUDE.md §1, `12` §8.1). An AI image is a creative,
dreamlike interpretation — not a record, diagnosis, or interpretation of "what the dream means." The
not-medical line + crisis footer already present on dream surfaces (`12` §8.2) remain on the image surfaces.
The dreamlike, non-photorealistic framing (§5.3) keeps the image clearly artistic.

### 8.2 The name-exclusion / appearance-allowed reconciliation (explicit)

This is the user's deliberate reconciliation of two requirements — "base the image on the dream and make a
figure resemble the dreamer's real people" vs. "never generate a real person's likeness by name":

- **Real people's NAMES are never sent to OpenAI.** The dream narrative + name-free depiction notes are seen
  only by **Claude** during distillation (the coach model, which already has this context); the **distilled
  prompt that reaches OpenAI is stripped of names** (§5.3) and describes any figure generically ("a figure: …").
- **Appearance, gender, ethnicity, and exact age MAY be used** — but **only** the dreamer's **own
  descriptions** of a People-graph-linked person, and **only for each field the dreamer has NOT locked**
  (`isPersonFieldShared`, [`15-shareability.md`](15-shareability.md) §4.1; a locked appearance/gender/
  ethnicity/birthday is withheld), assembled by `buildDepictionNote`. This lets a figure resemble that person
  without naming them.
- **Locked + non-depiction fields are never sent** to either provider: any field the dreamer has locked, plus
  all non-depiction fields (`notes`, `healthNotes` and `faith` when locked, etc.). The depiction is
  **text-only** — **no reference image or photo** is ever sent.
- The depiction is the per-field **shared** subset (15-shareability §4.1) — the dreamer is describing their
  own view of someone, which is the "may inform the AI" data. It is one-directional — the linked person learns
  nothing about the dream from the prompt.

### 8.3 Image visibility (dreamer-controlled), sharing & sensitive content

- An image **never feeds the AI coaching context** — it can't be a text Insight, so it never enters
  `buildContext` for anyone (the `12` §8.4 "approved text Insight" path is text-only).
- An image is **dreamer-controlled**: by default it is the dreamer's alone. It leaves their own view **only** by
  their explicit action — an **export** to a file (§3.5) or a **per-dream share** with a chosen related person
  (§3.6). Both are deliberate, and the share is reversible (un-share / removing the relationship re-gates at
  read, §3.6).
- A dream's `SensitivityTier` (`12` §8.3) does **not block** generation, but a non-standard tier shows a clear
  **warning before sending** (content leaves the device to a third party, §3.2). A **sensitive-tier dream's
  image cannot be shared** (the §3.6 exclusion, mirroring the `12` §3.4 fact-sharing exclusion), so intimate
  content can't reach another person's view; export (a local file, the dreamer's own copy) is still allowed.

### 8.4 Provider content policy

All image generation runs **within OpenAI's usage policy**. Content-policy refusals (violent / sexual /
disallowed imagery) are handled **gracefully** (the §3.4 `REFUSED` state) and **never circumvented** — the
prompt builder adds no instruction designed to evade the policy. A refused generation costs nothing and is not
metered (§7).

### 8.5 Third-party data flow (consent honesty)

Generating an image sends a **Claude-distilled, name-free prompt** to **OpenAI**, a third party distinct from
Anthropic (the dream narrative + depiction notes are processed by Claude during distillation — the same
provider that already powers the coach). The one-time global consent (§6) states the OpenAI flow plainly and
ships **OFF** by default; the per-dream sensitive-tier warning (§3.2) restates it for the most sensitive
content. No dream content reaches OpenAI without the dreamer having turned consent on and explicitly tapping
Generate. **Export** (§3.5) writes a local file the dreamer chooses — no third party — but the exported bytes
leave the encrypted vault, which the export note makes plain.

### 8.6 Break-glass

Consistent with `04` §8 / `12` §8.4, the vault is not zero-knowledge from the device owner / super-admin (one
master key decrypts everything). The super-admin inspect mode can therefore reach a dream's image, as it can
the dream. No new exposure beyond the existing model; no image-access audit log in v1 (the `12` §8.4 posture).

## 9. Accessibility

Per `01` §9. The `DreamImagePanel` is keyboard-operable (Generate / Regenerate / Delete / Save image… / Share /
style picker / the sensitive-tier warning dialog are focusable, labelled, with visible focus); the generated
`<img>` carries
meaningful **alt text** (e.g. "AI-generated dreamlike image of: <dream title or first line>" — never the raw
prompt, to avoid leaking depiction notes to assistive text that could be read aloud near others); the loading
state is a polite live region; the admin-only cost figure has a text equivalent (not color-only). The
sensitive-tier warning is a properly-labelled confirm. Responsive ~360px→desktop with the mobile-width (390px)
layout guard + a control-geometry guard on the panel's fixed controls (DoD §7). The new person-editor fields
follow `04`/`01` form a11y.

## 10. Testing strategy

- **Unit (core, node):**
  - **`buildImagePromptInput` (security-critical):** no real **name** ever appears in the distillation input; a
    linked person contributes only the depiction subset; `privateNotes`/`healthNotes`/`faith` and non-depiction
    fields **never** appear; a free-name dream person adds nothing beyond the narrative; the style + dreamlike
    framing are present.
  - **`buildDepictionNote`:** assembles appearance + gender + ethnicity + exact age (from `birthday`),
    name-free; returns '' when nothing is depictable.
  - **`dreamImageService`** with the **fake `ImageClient` + fake `ClaudeClient`:** distill → generate →
    `encryptBytes` round-trips to `image.enc` + stamps `Dream.image`; **both** `dream.imagePrompt` (token) and
    `dream.image` (flat) usage events are recorded; the **distilled prompt sent to the `ImageClient` carries no
    name** (assert against a narrative containing a name); `getDreamImage` decrypts; regenerate overwrites;
    delete removes + clears the descriptor; **`REFUSED` records no `dream.image`** (a billed distillation still
    meters); an `ERROR` after a billed call **is** metered (the §7 rule); a no-consent / no-key / over-budget
    call is refused with the right reason; the `isDreamImagePath` guard blocks an out-of-bounds path.
  - **sharing:** `setDreamImageShare` refuses a sensitive-tier dream + a non-related/unknown target;
    `getSharedDreamImage` returns the image to a current share target and **denies after un-share / removed
    relationship** (read-time re-gate).
  - **pricing / metering:** `dream.image` `costOf` yields the **flat** per-image cost (not $0 from zero
    tokens); the `UsageEvent` snapshots it; `dream.imagePrompt` costs by the token formula.
  - **`buildContext` / `buildLinkedPeopleContext`:** the new shareable descriptive fields feed own + related
    context; the private ones feed **only** the person's own block.
  - **schema:** `Dream.image` (incl. `shareableWith`) additive-optional (existing dreams parse); `Person` new
    fields additive (no migration).
- **Component (RTL):** `DreamImagePanel` in both placements — entry state, consent-off / no-key / AI-off / over
  budget / capability-absent calm states; the sensitive-tier warning gate; loading → success; the `REFUSED`
  state; Regenerate confirm + preserve-on-failure; Delete confirm; the style picker; the admin-only cost; the
  **Save image…** + **Share** controls (and Share absent on a sensitive tier / without `dreams.shareContext`).
  The Settings consent toggle + admin-only key/model + style default persist. The person editor's new
  About/Private field groups (incl. the `gender` enum + "other").
- **E2E (Playwright):** with `SELFOS_FAKE_IMAGE` (+ `SELFOS_FAKE_CLAUDE`) — turn on consent → add a (fake) key
  → log a dream → **Visualize** → the image renders → an encrypted `image.enc` round-trips (decrypt the vault to
  assert ciphertext) → Regenerate replaces it → **Export** writes a file → **Share** with a related person →
  that person reads it in "Shared with you" → un-share denies → Delete clears it; a **sensitive-tier dream shows
  the warning first** and **can't be shared**; the `dream.image` + `dream.imagePrompt` usage show in the
  dashboard; a `REFUSED` fake shows the calm state and records **no** `dream.image` usage; the capability-off
  role doesn't see the panel. No-overflow + control-geometry + mobile-width (390px) guards on every new surface.
  The `ImageClient` and `ClaudeClient` are **interfaces with fakes** (no real
  network).

## 11. Open questions

All product decisions are resolved (§12). Only these **build-time confirmations** remain — small, non-blocking:

1. **Exact OpenAI model IDs** — ✅ **Confirmed with the user (2026-06-12, slice 2):** ship **`gpt-image-2`
   (default) + `gpt-image-1`** (both in `IMAGE_PRICING` + the slice-3 admin select). If `gpt-image-2` turns
   out not to be available on the user's account at on-device test, it's a one-line config swap to default to
   `gpt-image-1`.
2. **Per-image price values** — ✅ **Confirmed (2026-06-12, slice 2):** seeded at **~$0.17** flat for both
   models (the high-quality 1024² estimate; cost is always an estimate, `06`). Tweakable in one place
   (`IMAGE_PRICING`).
3. **`gender` enum options** — ✅ **Resolved (2026-06-12, slice 1):** the preset list is **Female / Male /
   Non-binary / Prefer not to say**, plus a free-text **"Other…"** that reveals a describe field. Built in the
   `PersonEditor` About tab.
4. **The "Shared with you" surface** — ✅ **Resolved (2026-06-12, slice 5):** a lightweight **"Shared with
   you"** section at the **top of the Dreams journal**, appearing only when something is shared with the
   viewer (the recipient's `SharedDreamImages` gallery).

## 12. Resolved decisions

Confirmed with the user (2026-06-11) — encoded above, **not** to be re-opened:

1. **Provider & models** — **OpenAI** for images (text stays Anthropic); an **admin-only** image-model select
   offering **`gpt-image-2` (default) + `gpt-image-1`** (exact ids confirmed at build, §11.1), mirroring the
   Claude model select.
2. **Second key** — `openai.apiKey` in the main/Keychain `SecretStore` alongside `anthropic.apiKey`; host-side
   only, never to the renderer.
3. **Seam** — a new **`ImageClient`** host interface (OpenAI impl + offline fake), mirroring `ClaudeClient`.
4. **Storage** — **one canonical image per dream**, **encrypted bytes** at
   `people/<id>/dreams/<id>/image.enc` via `encryptBytes`/`decryptBytes` + base64-over-IPC (`08` §13.2);
   regenerate **replaces** it (with a confirm); an additive-optional `Dream.image` descriptor (no migration);
   path access confined like `isMediaPath`.
5. **Size & quality** — **1024×1024 square**, **high quality** by default (the flat cost seeds at the
   high-quality estimate, ~$0.17/image, §4.5). One fixed size in v1.
6. **Consent** — a one-time **global opt-in** (default OFF) acknowledging that generating sends the dream
   description to OpenAI; generation needs consent ON + key + capability.
7. **Prompt — Claude-distilled** — a small **Claude pass first distills** the dream narrative (+ the name-free
   depiction notes + style + a non-photorealistic/dreamlike, within-policy framing) into a tight visual prompt
   that is then sent to OpenAI. The distillation is instructed to **never echo a person's name** (defense in
   depth: names are also not passed in as depiction input). Metered as a token-based `dream.imagePrompt` Claude
   call (in addition to the flat `dream.image` charge, §4.5). This resolves the earlier "send directly" choice
   in favour of a safer, tighter prompt.
8. **Likeness** — a linked person's **appearance + gender + ethnicity + exact age** (computed from `birthday`)
   **may** inform the figure (the dreamer's own descriptions); **names never**; never their notes/private fields;
   never a reference image/photo.
9. **Cost / budget** — a flat-cost **`dream.image`** usage type (tokens=0 + a flat `costUsd`; `costOf` gains an
   image path) **plus** the token-based **`dream.imagePrompt`** distillation charge — both recorded through `06`,
   charged to the **dreamer** (warn→block like chat); admin-only `$`.
10. **Capability** — a new **`dreams.generateImage`** (default ON for Member, like `dreams.own`), gated in the
    bridge.
11. **Sensitive tiers** — generation allowed for **any** tier, with a clear **warning before sending** on a
    non-standard tier; **graceful content-policy refusal** handling (calm message; uncharged refusal not metered).
12. **Style** — a **default image style** in Settings (dreamlike / painterly / watercolor / realistic …) with
    an optional **per-image override**.
13. **Placement** — a **"Visualize this dream"** action in **both** the dream detail/composer **and** the
    analysis card; image display + regenerate + delete; calm states for no-key / consent-off / over-budget /
    refusal / AI-off.
14. **Export & per-dream sharing** — a generated image can be **exported to a file** (a "Save image…" action;
    the bytes leave the encrypted vault by the dreamer's choice) **and shared per-dream** with a related
    household person (mirroring the §13.5 fact-sharing target model: gated by **`dreams.shareContext`**,
    **excluded for sensitive tiers**); the recipient views it in a **"Shared with you"** surface (§3.6).
15. **Safety** — wellness/not-medical boundary kept; images **never feed coaching context** (text Insights
    only — an image can't be a text fact). They are **dreamer-controlled**: only the dreamer's explicit export
    or per-dream share lets an image leave their own view; within OpenAI's usage policy (graceful refusal,
    never circumvented).
16. **People-profile amendment** — the §4.6 descriptive `Person` fields (shareable About + private
    health/faith) are used as coaching context **app-wide** (not just images), fed by `buildContext` with the
    shareable-vs-private split; `birthday` is **reused** for DOB/age (not duplicated); surfaced in the tabbed
    `PersonEditor`. It ships as build slice 1 (independently valuable). `gender` is a small enum + free-text
    "other" (§11.3); the other field types per §4.6.

## 13. Proposed build slices (after approval)

1. **People-profile amendment** (`04` §4.1) — ✅ **Built 2026-06-12** (branch `feat/dream-images-slice-1`).
   The additive-optional descriptive fields on `Person`/`PersonInput` (no migration; `birthday` reused);
   `buildContext` + `buildLinkedPeopleContext` threading via `shareableProfileLines`/`privateProfileLines`
   (shareable own + related; private own-only); the `PersonEditor` Profile-tab birthday input + the **About**
   tab (shared + private field groups; `gender` preset enum + free-text "Other"; `ChipEditor` for
   interests/values/languages; an important-dates row editor); unit + RTL + E2E tests. Independently valuable;
   no images yet.
2. **Image core backend** — ✅ **Built 2026-06-12** (branch `feat/dream-images-slice-2`). The `ImageClient`
   host interface (`@selfos/core/host`) + the main-side OpenAI impl + offline fake (`SELFOS_FAKE_IMAGE`,
   `=refuse` mode) + `OPENAI_API_KEY_ID = 'openai.apiKey'`; `buildDepictionNote` + `ageFromBirthday`
   (`@selfos/core/people`, name-free) + the pure `buildImagePromptInput` + the **Claude distillation** pass;
   `dreamImageService` (`generateDreamImage` distill → render → `encryptBytes` → store + stamp `Dream.image`;
   `getDreamImage`; `deleteDreamImage`; `isDreamImagePath`); the flat `dream.image` + token `dream.imagePrompt`
   usage types + the `IMAGE_PRICING` flat-image path in `costOf` (`gpt-image-2`/`gpt-image-1` @ ~$0.17); the
   `Dream.image` additive-optional schema. Core-only, unit-tested with fake `ImageClient` + `ClaudeClient` (no
   network). Security units: no name / no private field reaches the distillation input; OpenAI only ever sees
   the Claude-distilled prompt. Code-reviewer **ship**. **Models confirmed (§11.1):** `gpt-image-2` default +
   `gpt-image-1`. **Price confirmed (§11.2):** ~$0.17 flat. No IPC/renderer yet (slice 3).
3. **IPC seam + settings + capability** — ✅ **Built 2026-06-12** (branch `feat/dream-images-slice-3`).
   `dreams:generateImage` / `:getImage` / `:deleteImage` through the full typed seam (channels → coreBridge →
   ipc → preload → bridge mock), gated by the new **`dreams.generateImage`** capability (Member default ON,
   Owner auto-grants), dreamer-scoped, both API keys read host-side and **never** crossing IPC; the slim
   `DreamImageResult` keeps usage events host-side. Settings (Dreams section): `dreams.imageGenerationEnabled`
   (consent, default OFF), `dreams.imageModel` (admin-only `gpt-image-2`/`gpt-image-1`), `dreams.imageStyle`
   (default-style select), and an admin-only **`OpenAiKeyControl`** (a shared `SecretKeyControl` refactor of
   `ApiKeyControl`; write-only). The `image` host part added to `BridgeHost` — Electron `defaultImageClient`,
   web preview `webFakeImageClient`, iOS `browserImageClient` (browser-mode OpenAI, the `browserClaudeClient`
   mirror). Code-reviewer **ship**. Renderer panel + generate E2E is slice 4.
4. **Renderer + E2E (generate)** — ✅ **Built 2026-06-12** (branch `feat/dream-images-slice-4`). The shared
   **`DreamImagePanel`** rendered in BOTH the dream detail/composer (`DreamComposer`, on a saved dream) and the
   analysis card (`DreamAnalysisPane`, beside the synthesis card), bound to the dream id — self-contained local
   state + a `reqId` request-guard so a stale fetch after a switch is dropped (no store change needed:
   per-person isolation holds because the panel remounts per dream and `dreamStore.reset()` fires on a person
   switch). States: capability-absent → hidden; calm consent-off / AI-off / no-key (gated on the async key
   check resolving, so the happy path doesn't flash) → Settings link; entry (style picker + "Visualize this
   dream"); the sensitive-tier warning-before-send; loading; success (image + Regenerate + "Delete image" +
   **admin-only cost**, double-gated — the bridge omits `costUsd` for non-admins AND the panel requires
   `budgets.manage`); REFUSED/BUDGET/ERROR calm messages. Code-reviewer **fix-first**. 8 RTL + an E2E
   (sensitive warning → generate → assert `image.enc` is an AES-GCM envelope on disk → regenerate → delete) +
   visual QA at desktop + 390px.
5. **Export + per-dream sharing** — ✅ **Built 2026-06-12** (branch `feat/dream-images-slice-5`). The
   `dreams:exportImage` save flow (a main-side `saveImageFile` host op — a native save dialog writing the
   **decrypted** bytes OUTSIDE the vault; a Blob download on web/iOS); the `:setImageShare` (gated
   `dreams.shareContext`, sensitive-excluded, dreamer-scoped) / `:getSharedImage` / `:listSharedImages` seam
   over `Dream.image.shareableWith` — with the **read-time re-gate** (`getSharedDreamImage`/`listImagesSharedWith`
   re-validate relationship + `shareableWith` + standard-tier at read, so un-share / removed-relationship /
   sensitive denies, no stale access); the panel's **Save image…** (+ "leaves the encrypted vault" note) +
   **Share** controls (a per-related-person Switch list); the recipient's **"Shared with you"** gallery at the
   top of the Dreams journal (§11.4); the `Dreams.tsx` per-person selection reset. Code-reviewer **ship**
   (privacy re-gate verified airtight on every path). 12 RTL + 4 core + the bridge round-trip + an E2E (export
   writes a real decrypted file; share → recipient sees it in "Shared with you"); visual QA desktop + 390px.
   **Spec 13 is now FULLY BUILT.**

## 14. Changelog

- 2026-06-14 — **§15 amendment APPROVED + BUILT (package F).** Status → Approved (§15.6). Expanded
  `dreams.imageStyle` to **~20 family-grouped presets** (Painted / Drawn / Stylized / Photographic-ish)
  sharing **one `IMAGE_STYLE_PRESETS` constant** (new `app/routes/dreams/imageStyles.ts`) used by the
  Settings select **and** the `DreamImagePanel` picker — both render native `<optgroup>`s and a fallback
  option for a legacy/unknown stored value (§15.4); the schema field stays a **free string** (the four
  original values retained, so pre-expansion dreams still resolve). Added **Settings-only**
  `dreams.imageStyleNotes` (textarea, max 300) threaded through `buildImagePromptInput`'s new optional
  `styleNotes` param (appends `Additional style direction: …` after the style line, before the framing;
  blank ⇒ omitted) and read host-side in `coreBridge.dreamGenerateImage`; the `dreams:generateImage` IPC is
  **unchanged** (no per-image notes). Softened the baseline `DREAMLIKE_FRAMING` + `DISTILLATION_INSTRUCTION`
  to **"evocative, non-photorealistic"** so it blends with a non-dreamlike preset while keeping the §8.2
  never-a-photoreal-likeness guarantee. Added a reusable **`textarea`** settings control type + a grouped
  **`select`** variant to the registry. No schema/IPC/metering change. Synced §6 + `03` §4.1. Gate green:
  typecheck, lint, format, **340 core + 417 desktop + 8 relay** unit (+ prompt include/omit/framing + a
  distillation-capture assertion + textarea/grouped-select/legacy-fallback RTL + panel preset RTL), **59
  E2E** (settings reveal sets an expanded preset + notes → persists to `settings.json`; visualize stamps
  the chosen preset on `Dream.image.style`; 390px guard). Visual QA at desktop + 390px (grouped select,
  full-width notes textarea, panel picker — no overflow, no console errors). Code-reviewer **ship** (the
  Settings legacy-fallback nit applied so it matches the panel's §15.4 handling). On `feat/dream-image-style`.
- 2026-06-12 — **2026-06 style amendment added (§15, package F of the app refresh; Review).** Expands the
  `dreams.imageStyle` presets and adds a **free-text style description** (`dreams.imageStyleNotes`) so the
  dreamer can refine the look in their own words; threads it through `buildImagePromptInput` while keeping the
  baseline non-photorealistic safety framing (§8.2). Adds a reusable `textarea` settings control type. Decisions
  in memory `app-refresh-plan-2026-06`. Renderer + one core prompt-builder param + settings.
- 2026-06-11 — created (**Draft**). The deferred AI dream-image-generation companion spec parked in
  [`12-dreams.md`](12-dreams.md) §2/§11.2. All product decisions pre-made by the user (§12): OpenAI provider +
  admin model select, a second `openai.apiKey` in the `SecretStore`, a new `ImageClient` host interface,
  encrypted-bytes storage at `people/<id>/dreams/<id>/image.enc` reusing the `08` §13.2 image precedent, a
  one-time global consent (default OFF), a privacy-careful prompt (narrative-based; names never; appearance /
  gender / ethnicity / approx-age allowed; no private fields; no reference photos), a `dream.image` flat-cost
  usage type, the `dreams.generateImage` capability, sensitive-tier warning + graceful content-policy refusal,
  a default + per-image style, dual placement, and images **dreamer-only** (never context, never shared). Also
  carries the prerequisite **People-profile amendment** to `04` §4.1 (§4.6/§13.1).
- 2026-06-11 — **§11 open questions resolved** with the user (now §12). Models: **`gpt-image-2` (default) +
  `gpt-image-1`**, admin-selectable. Size/quality: **1024² high** (~$0.17 flat estimate). `gender`: a **small
  enum + free-text "other"**. Age in depiction: **exact age** from `birthday`. **Prompt is now Claude-distilled**
  (a `dream.imagePrompt` token pass strips names + tightens the prompt before OpenAI — replacing "send the
  narrative directly"). Images are now **exportable to a file** and **per-dream shareable** with a related person
  (gated `dreams.shareContext`, sensitive-excluded, viewed in a "Shared with you" surface) — so the earlier
  "dreamer-only, never shared" stance is updated: an image still **never feeds AI context**, but the dreamer may
  deliberately export or share it. Spec body (§2/§3.5–3.6/§4.2/§4.5/§5.2–5.3/§6/§7/§8.2–8.3/§10/§13) updated in
  lockstep; build slices now 1–5 (slice 5 = export + sharing). Only small build-time confirmations remain (§11).
  Ready for the user's final approval before slice 1.
- 2026-06-12 — **Approved.** The user reviewed the resolved spec and approved it for build. Cleared for
  **slice 1 — the People-profile amendment** (`04` §4.1: the additive descriptive fields + `buildContext`
  threading + the `PersonEditor` groups), then slices 2–5. Only the §11 build-time confirmations remain.
- 2026-06-12 — **Slice 1 built** (People-profile amendment; `04` §4.1/§13.1). Additive-optional descriptive
  fields on `PersonSchema`/`PersonInputSchema` (gender, appearanceDescription, ethnicity, occupation,
  interests, location, goals, communicationStyle, values, languages, importantDates [shareable]; healthNotes,
  faith [private]) — **no `schemaVersion` bump, no migration** (the email/phone precedent); `birthday`
  **reused**. Threaded through `upsertPerson` and surfaced in `buildContext`/`buildLinkedPeopleContext` via two
  new pure helpers `shareableProfileLines`/`privateProfileLines`: the shareable set feeds the person's own AND
  related/linked people's context (the `publicNotes` bucket), the private set feeds **only** the person's own
  block (the `privateNotes` boundary). `PersonEditor` gained a Profile-tab **birthday** input (previously
  unreachable in the UI — the depiction's age source) and a new **About** tab with a shared group (gender =
  the §11.3 preset enum + free-text "Other…"; `ChipEditor` for interests/values/languages; a label+date
  important-dates row editor) and a Private group (health/faith, clearly marked "never shared, never sent to
  an image provider"). §11.3 (gender options) resolved with the user. Tests: +4 core (buildContext
  shareable/private split, linked-people private exclusion, peopleService round-trip + clean-absence), +2 RTL
  (About fields save; gender-Other reveal), +1 E2E (encrypted About round-trip) + the 390px sweep walks the
  About tab. Gate green: typecheck (node + web/DOM-lib), lint, format, **248 core + 326 desktop** unit, E2E.
  Visual QA at desktop + 390px. **NEXT: slice 2 — the image core backend** (`ImageClient` host interface +
  OpenAI impl + fake; `buildDepictionNote`/`buildImagePromptInput`; `dreamImageService`; the `dream.image` /
  `dream.imagePrompt` usage types).
- 2026-06-12 — **Slice 2 built** (image core backend; §13.1 slice 2). The `ImageClient` host interface
  (`@selfos/core/host`, the `ClaudeClient` mirror — a `REFUSED` vs `ERROR` outcome) + the main-side OpenAI impl
  - offline fake (`apps/desktop/src/main/image/openaiImageClient.ts`, gated by `SELFOS_FAKE_IMAGE`, `=refuse`
    mode for the refusal E2E) + `OPENAI_API_KEY_ID = 'openai.apiKey'`. `buildDepictionNote` + `ageFromBirthday`
    (`@selfos/core/people`) — the single, **name-free + private-free** depiction source (appearance + gender +
    exact age from `birthday` + ethnicity; never name/notes/private). The pure `buildImagePromptInput` assembles
    the name-free distillation input. `dreamImageService.generateDreamImage` (consent + both keys + budget gates
    → Claude distillation [`dream.imagePrompt`] → OpenAI render → validate bytes/mime → `encryptBytes` →
    `image.enc` → stamp `Dream.image` → flat `dream.image`), `getDreamImage`, `deleteDreamImage`,
    `isDreamImagePath`. `IMAGE_PRICING` + the `costOf` flat-image path (`gpt-image-2`/`gpt-image-1` @ ~$0.17);
    `dream.image`/`dream.imagePrompt` usage labels; the additive-optional `Dream.image` descriptor +
    `DreamImageGenerateResult` view type. **§11.1/§11.2 confirmed with the user.** Code-reviewer **ship**
    (privacy boundary structurally airtight — OpenAI only ever sees the Claude-distilled prompt; metering
    correct on the refused/billed/pre-gen split; regenerate non-destructive; path-guard confines I/O). Core-only
    (no IPC/renderer — slice 3). Gate green: typecheck (node + web/DOM-lib), lint, format, **266 core + 328
    desktop + 8 relay** unit. **NEXT: slice 3 — IPC seam + settings + the `dreams.generateImage` capability.**
- 2026-06-12 — **Slice 3 built** (IPC seam + settings + capability; §13.1 slice 3 / §6). The
  `dreams:generateImage`/`:getImage`/`:deleteImage` channels through the full typed seam (`channels.ts` +
  `DreamImageResult` → `coreBridge.ts` [the trust boundary] → `ipc.ts` thin delegates + `image:
defaultImageClient()` host wiring → `preload` → `test-utils/bridge` mock), all gated by a NEW
  **`dreams.generateImage`** capability (Member default ON, not EXPLICIT_GRANT_ONLY so Owner auto-grants),
  dreamer-scoped, with **both API keys read host-side** (`ANTHROPIC_API_KEY_ID` + `OPENAI_API_KEY_ID`) and
  **never** crossing IPC. `dreamGenerateImage` reads consent/model/style from vault settings and maps the rich
  `DreamImageGenerateResult` → the slim `DreamImageResult` (usage stays host-side); `dreamGetImage` returns
  base64. Settings (Dreams section): `dreams.imageGenerationEnabled` (consent, default OFF),
  `dreams.imageModel` (admin-only `gpt-image-2`/`gpt-image-1` select), `dreams.imageStyle` (default-style
  select), and an admin-only `OpenAiKeyControl` (`aiControls.tsx` refactored to a shared write-only
  `SecretKeyControl`); model/style/key `visibleWhen` consent on. The `image` host part added to `BridgeHost` —
  Electron `defaultImageClient`, web preview `webFakeImageClient`, iOS `browserImageClient` (browser-mode
  OpenAI, the `browserClaudeClient` mirror, so iOS gets it via `createCoreBridge`). Code-reviewer **ship**
  (trust boundary airtight — keys never returned, all 3 ops re-enforce the capability + scope; settings
  defaults match; `browserImageClient` faithful; `SecretKeyControl` preserves `ApiKeyControl` behavior). Gate
  green: typecheck (node + web/DOM-lib), lint, format, **266 core + 331 desktop + 8 relay** unit (+2 bridge:
  consent/key/capability-gated generate→read→delete round-trip + Guest denial; +1 RTL `OpenAiKeyControl`), **3
  E2E** (+1 dream-image settings reveal + admin-only marker; the section-overflow + responsive sweeps now
  cover the new settings). Visual QA at desktop + 390px. **NEXT: slice 4 — the `DreamImagePanel` renderer
  (both placements) + the generate E2E + visual QA.**
- 2026-06-12 — **Slice 4 built** (the `DreamImagePanel` renderer + generate E2E; §13.1 slice 4 / §3). The
  shared **`DreamImagePanel`** rendered in BOTH the dream detail/composer (`DreamComposer`, on a saved dream)
  and the analysis card (`DreamAnalysisPane`, beside the synthesis card), bound to the dream id —
  **self-contained local state + a `reqId` request-guard** (no store change: per-person isolation holds
  because the panel remounts per dream and `dreamStore.reset()` fires on a person switch). States:
  capability-absent → **hidden**; calm consent-off / AI-off / no-key (the no-key state gated on the async key
  check resolving, so the happy path doesn't flash) → Settings link; entry (style picker + "Visualize this
  dream"); the **sensitive-tier warning-before-send**; loading; success (the `<img>` from a base64 data URL +
  Regenerate + "Delete image" + **admin-only cost**, double-gated — the bridge omits `costUsd` for non-admins
  AND the panel requires `budgets.manage`); REFUSED/BUDGET/ERROR calm messages. A small admin-gated `costUsd`
  was added to `DreamImageResult` (the bridge includes it only for `budgets.manage`, = flat image + distillation
  cost). Code-reviewer **fix-first** (the one should-fix applied: the no-key calm state flashed before the async
  `secretHas` resolved on the happy path → now gated on `!loading`; per-dream/person isolation, the
  double-gated cost, the capability boundary, the sensitive-tier warning, and a11y all verified clean). Gate
  green: typecheck (node + web/DOM-lib), lint, format, **266 core + 339 desktop + 8 relay** unit (+8 RTL:
  every calm state, generate+cost, sensitive warning, existing-image+delete, refusal), **+1 E2E** (sensitive
  warning → generate → **assert `image.enc` is an AES-GCM envelope on disk, not the raw PNG** → regenerate →
  delete; `SELFOS_FAKE_IMAGE` added to `e2eEnv`). Visual QA at desktop + 390px (the panel sits below the dream
  fields / beside the analysis card; square image, clean actions, no overflow). Built in the
  **`feat/dream-images-slice-4`** worktree off `main`. **Lesson: a panel whose readiness depends on an ASYNC
  check (`secretHas`) must gate that calm state on the load completing (`!loading && !hasKey`), or the common
  happy path flashes the wrong "add a key" state for a frame before the check returns.** **NEXT: slice 5 —
  export (`dreams:exportImage` save dialog) + per-dream image sharing (`Dream.image.shareableWith` +
  `dreams:imageShareTargets`/`:setImageShare`/`:getSharedImage`) + the "Shared with you" recipient surface
  (ASK placement). This is the LAST slice of spec 13.**
- 2026-06-12 — **Slice 5 built — spec 13 is now FULLY BUILT** (export + per-dream image sharing; §13.1 slice 5
  / §3.5/§3.6). **§11.4 confirmed with the user:** the recipient's "Shared with you" lives as a section at the
  **top of the Dreams journal** (self-hides when empty). **Export:** `dreams:exportImage` decrypts the bytes
  and a new **`saveImageFile` platform host op** writes them OUTSIDE the vault (Electron save dialog +
  `writeFile`, with a `SELFOS_FAKE_SAVE_DIR` E2E hook; a Blob download on web/iOS); gated `dreams.generateImage`,
  dreamer-scoped; the panel's "Save image…" shows a "leaves the encrypted vault" note. **Sharing:** core
  `setDreamImageShare` (toggle `Dream.image.shareableWith`; refuses sensitive + non-related, the
  `setDreamFactShare` mirror), `getSharedDreamImage` + `listImagesSharedWith` with the **read-time re-gate** —
  both re-validate relationship + `shareableWith` + standard-tier at read, so **un-share / removed-relationship
  / sensitive denies with no stale access** (no `shareableWith` cleanup needed; `listRelatedPeople` is the
  symmetric gate). Seam: `dreams:setImageShare` (gated **`dreams.shareContext`**, dreamer-scoped — a recipient
  can't re-share another's image) / `:getSharedImage` / `:listSharedImages` (viewer-scoped — the share is the
  grant). Renderer: the panel's **Share** controls (a per-related-person Switch list; shown only standard-tier +
  `dreams.shareContext` + has relations; a "kept out of shared context" note otherwise) + the recipient's
  **`SharedDreamImages`** gallery; `Dreams.tsx` now **resets its selection on `activePersonId` change** (a
  pre-existing per-person leak the 390px QA surfaced — a switch left another person's dream selected, hiding
  the mobile list incl. "Shared with you"). Code-reviewer **ship** (the read-time re-gate verified airtight on
  every path; export writes a decrypted file only by the dreamer's gated action; sharing scoped to
  `dreams.shareContext` + the active person). Gate green: typecheck (node + web/DOM-lib), lint, format, **269
  core + 344 desktop + 8 relay** unit (+3 core sharing [share→read→un-share-denies, relationship-removal
  denies, sensitive+non-related refused], +1 bridge export→share→recipient round-trip, +4 RTL [panel
  export/share/sensitive-note + `SharedDreamImages` shows/self-hides]), **+1 E2E** (export writes a real PNG
  outside the vault + share → switch to the partner → the image appears in their "Shared with you"). Visual QA
  at desktop + 390px (the Share controls + the "Shared with you" gallery read clean; the per-person reset fixed
  the mobile recipient view). Built in the **`feat/dream-images-slice-5`** worktree off `main`. **Lesson: a
  per-person read-time re-gate (relationship + share + sensitivity re-checked on every read) means a share
  auto-revokes when ANY of those changes — no separate revocation/cleanup of `shareableWith` is needed, and a
  removed relationship drops the share for free.** **Spec 13 (AI dream images) is COMPLETE — all 5 slices on
  `main`. The only Dreams work left is the user's real on-device/OpenAI verification.**

---

## 15. 2026-06 amendment — richer image style + free-text style description

Layers on the built feature (§1–§14 remain accurate). Covers app-refresh item **12**: a more comprehensive
style picker and a free-text description so the dreamer can refine the look. Renderer + settings + one core
prompt-builder parameter; no schema change (`Dream.image.style` is already a free string, §4.2), no new IPC, no
provider/metering change.

### 15.1 Expanded style presets

Today `dreams.imageStyle` offers four presets (`dreamlike` · `painterly` · `watercolor` · `realistic`). Expand to
a broader, curated set so the dreamer can pick a look that fits, e.g.:

> dreamlike (surreal) · painterly (oil) · watercolor · gouache · ink & line art · charcoal sketch · pastel ·
> storybook illustration · impressionist · art nouveau · ukiyo-e · cinematic · concept art · comic / graphic
> novel · ethereal / luminous · gothic / dark · vaporwave / neon · minimalist · collage · abstract

The presets are **grouped by family** in the picker (e.g. _Painted_ · _Drawn_ · _Stylized_ ·
_Photographic-ish_) so a longer list stays scannable; the exact final set is tunable at build (these are
representative). Each preset is a short label that becomes a style phrase in the prompt. The schema field stays a
**free string** (`Dream.image.style`), so the set can grow without migration; the settings select and the
per-image picker share **one constant** (`IMAGE_STYLE_PRESETS`, family-grouped) so Settings and the panel never
drift.

**Safety reconciliation (§8.2).** A baseline **"stylized / evocative, non-photorealistic"** framing remains in
the prompt **regardless of preset** — the §8.2 reason (a figure may _resemble_ a real person from name-free
depiction notes, so the image must never read as a photoreal likeness). So `realistic`/`cinematic` mean
_painterly-realistic / filmic_, never photographic of a real person. The fixed `DREAMLIKE_FRAMING` becomes a
slightly softer **"evocative, non-photorealistic"** baseline that blends with (rather than contradicts) a
non-dreamlike preset, but the non-photorealism guarantee is non-negotiable.

### 15.2 Free-text style description

Add a new vault setting **`dreams.imageStyleNotes`** (free text, default empty, `visibleWhen` image-gen consent
ON, like the other image settings) — the dreamer describes the look in their own words, e.g. _"muted earth
tones, soft focus, golden-hour light, faint film grain."_ It **augments** the chosen preset (doesn't replace
it).

**Plumbing.** `buildImagePromptInput` (pure, §5.3) gains an optional `styleNotes?: string`. When present, after
the `Visual style: <preset>.` line it appends `Additional style direction: <styleNotes>.`, then the baseline
non-photorealistic safety framing (which still wins). The Claude distillation incorporates the direction into the
single visual prompt; the name-free / no-private-fields guarantees (§5.3/§8) are unchanged — style notes are
visual direction only and are passed through the same distillation. `dreamGenerateImage` reads
`dreams.imageStyleNotes` from vault settings alongside the existing style/model/consent reads (host-side).

**A reusable `textarea` settings control.** The settings registry (`03`) currently has a single-line `text`
control; this adds a **`textarea`** control type (multiline, reusing the design-system `Textarea`) — generally
useful, not dream-specific. `dreams.imageStyleNotes` uses it.

### 15.3 Per-image override (panel)

The `DreamImagePanel` (§3.2/§5.5) per-image **style picker** uses the expanded, grouped `IMAGE_STYLE_PRESETS`
(same constant as Settings). **Style notes are Settings-only** (resolved) — they apply to all dream images and
are not editable per image; the existing `dreams:generateImage({ dreamId, style? })` IPC is **unchanged** (no
`styleNotes?` param). So a single image can still switch _preset_ on the panel; the free-text direction is a
single default you set once in Settings.

### 15.4 Edge cases, a11y & testing

- **Empty style notes** — absent/blank ⇒ prompt is exactly as today (preset + framing only); never injects an
  empty "Additional style direction:" line.
- **Long / odd notes** — bounded to a reasonable max length (e.g. 300 chars) at the input + schema; the
  distillation naturally compresses; no policy bypass (the safety framing + distillation still apply).
- **Preset removed later** — a `Dream.image.style` holding a now-unlisted preset still renders (free string); the
  picker shows it as a custom/legacy value or falls back to the default label.
- **A11y** — the new textarea uses the design-system `Textarea` (labelled, keyboard-friendly); the expanded
  select stays a native `Select`; responsive ~360px→desktop. `/gallery` updated if the `textarea` control type
  surfaces a new pattern (DoD).
- **Tests** — unit: `buildImagePromptInput` includes the `Additional style direction:` line when notes are
  present and omits it when blank, and always includes the non-photorealistic framing. RTL: the Settings style
  select shows the expanded presets + the notes textarea persists; the panel picker uses the shared constant.
  E2E (fake image client): generate with a custom style + notes → assert the distillation input carried both
  (via the fake client capture), the on-disk `Dream.image.style` is stamped, no policy/framing regression; 390px
  guard on the Settings + panel surfaces.

### 15.5 Resolved decisions (2026-06-12)

- **Expanded preset list, grouped by family** (e.g. Painted / Drawn / Stylized / Photographic-ish), ~20 curated,
  final set tunable at build, sharing one `IMAGE_STYLE_PRESETS` constant (Settings select + panel picker).
- **Free-text `dreams.imageStyleNotes`** added (**Settings-only**, augments the preset), threaded via a new
  `buildImagePromptInput` `styleNotes` param.
- **Baseline non-photorealistic safety framing kept** for all presets (§8.2 preserved).
- **New reusable `textarea` settings control type** added to the registry.

### 15.6 Open questions (amendment)

_All resolved (2026-06-12) — see §15.5. **Approved 2026-06-14** (package F of the app refresh); built on
`feat/dream-image-style`._
