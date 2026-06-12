# 13 — Dream images (AI image generation of a dream)

> **Status:** **Draft** · _last updated 2026-06-11_
>
> The deferred companion to [`12-dreams.md`](12-dreams.md): a dreamer can **visualize a dream** as a single
> AI-generated image. It introduces SelfOS's **second AI provider** (OpenAI, for image generation only — text
> stays Anthropic), a one-time **third-party consent**, **encrypted binary-blob** image storage in the vault,
> a **flat per-image cost** in the existing metering/budget layer, and a privacy-careful **prompt builder**
> that may make a figure resemble a real, People-graph-linked person by **appearance** but **never by name**.
> Images are **dreamer-only**: they never feed coaching context and are never part of per-dream sharing. This
> spec also includes a **prerequisite People-profile amendment** (new descriptive fields on `Person`,
> §4.6/§13.1) used as coaching context app-wide and as the depiction source for image prompts.

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
it, `12`), the dreamer can choose to **Visualize this dream**: SelfOS sends a privacy-careful description of
the dream's _narrative_ — plus, optionally, **generic physical-depiction notes** about any People-graph-linked
people who appeared in it — to **OpenAI's image API**, and stores the resulting single canonical image
**encrypted in the vault** under the dream. The image can be viewed, **regenerated** (replacing the prior
one, with a confirm), and **deleted**. Generation is gated three ways: a one-time **global consent** to send
dream content to OpenAI, an **OpenAI API key** present, and the **`dreams.generateImage`** capability.

This is the explicitly-deferred work parked in `12-dreams.md` §2/§11.2. It is a self-contained feature module
that adds a second provider behind a new **`ImageClient`** host interface (mirroring `ClaudeClient`), so the
seam is testable with an offline fake and the iOS host (`07`) gets it for free via `createCoreBridge`.

The spec opens with a **prerequisite People-profile amendment** (§4.6) — new descriptive `Person` fields the
user wants used as coaching context **app-wide** (not just for images). It ships as build slice 1 because it's
independently valuable and the image prompt's depiction notes (appearance + gender + ethnicity + approximate
age) read from a subset of those fields.

### 1.1 Relationship to other specs

- **`12-dreams.md`** owns the `Dream` schema, the dreamer-only privacy posture, the per-dream
  `SensitivityTier`, and the People-graph "people present" links. This spec **adds** an additive-optional
  `Dream.image` descriptor (§4.2) and a new `image.enc` blob under the dream folder. Synced into `12` via
  `sync-docs`, mirroring how `12` amended `08`'s `Insight`.
- **`06-ai-usage-and-budgets.md`** owns metering + budgets. This spec adds a `dream.image` usage type with a
  **flat** per-image cost path (`costOf` gains an image branch; the pricing table gains image-model entries).
- **`04-people-roles.md`** §4.1 (`Person`) is **amended** by §4.6/§13.1 — new descriptive fields, threaded
  through `buildContext`/`buildLinkedPeopleContext`, surfaced in the person editor.
- The text coach stays **Anthropic** end-to-end; OpenAI is used **only** for image pixels.

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
- A **privacy-careful prompt builder**: based on the dream **narrative**, **never** including real people's
  **names**; **may** append a People-graph-linked person's **appearance + gender + ethnicity + approximate
  age** (from the dreamer's own descriptions) as generic, name-free depiction notes; a chosen **style** +
  dreamlike, non-photorealistic framing.
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
- **Images feeding the coach** — images are dreamer-only and never enter `buildContext` (text Insights only)
  and are **not** part of per-dream sharing (`12` §3.4). Out of scope by design.
- **Multiple images per dream / galleries / variations** — v1 is one canonical image (regenerate replaces).
  A future enhancement could keep a history; not now (no scaffolding).
- **Exporting / sharing the generated image outside the dreamer** — open (§11); v1 is view-in-app only.
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
   Cancel. The renderer calls `dreams:generateImage`; main builds the prompt (§5.3/§8.2), checks budget,
   calls the `ImageClient`, encrypts the returned bytes to `image.enc`, stamps `Dream.image`, and records the
   `dream.image` usage event.
5. **Success** → the image renders in the panel with **Regenerate** + **Delete** actions and an "estimated
   cost" figure (admin-only `$`, `06`). A short caption notes it is an AI interpretation, dreamlike, not a
   literal record.

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

### 3.5 People-profile fields (the prerequisite, §4.6/§13.1)

In the tabbed **`PersonEditor`** (`04` §6.2), the new descriptive fields are surfaced in two groups:

- **About** (shareable) — gender, appearance, ethnicity, occupation, interests, location, goals, communication
  style, values, languages, important dates. These feed `buildContext` (own + related people) like
  `publicNotes`; the depiction subset (appearance + gender + ethnicity + approx age from `birthday`) also feeds
  image prompts.
- **Private** (own coaching context only) — health notes, faith. Never shared with other people's coach, never
  sent to OpenAI (§8.2).

These are independent of images (a dreamer with no images still benefits in chat); the image feature simply
**reads** the shareable depiction subset.

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
- Dimensions / aspect ratio are an **open question** (§11) — proposed default a square (e.g. 1024×1024).

### 4.5 Pricing (flat per-image)

`06`'s `UsageEvent` is token-based with a snapshotted `costUsd`. An image call has **no meaningful token
counts**, so it is represented as **`inputTokens=0, outputTokens=0, cacheWriteTokens=0, cacheReadTokens=0` + a
flat `costUsd`** (the per-image price for the chosen image model). This requires:

- The `06` **pricing table** gains image-model entries — a new `IMAGE_PRICING: Record<string, { perImageUsd:
number }>` (or an additive `perImageUsd?` on `ModelPricing`), seeded with the offered OpenAI models.
- **`costOf`** gains an **image-cost path**: for a `dream.image` event (zero tokens), cost = the flat
  `perImageUsd` for the model, not the token formula (which would yield $0). The exact price + the seeded model
  list are **open** (§11).

The `UsageEvent.model` records the OpenAI image model (provenance); `costUsd` is snapshotted at record time so
historical totals don't drift (the `06` rule).

### 4.6 People-profile amendment (amends `04` §4.1 `Person`)

Additive-optional fields on `PersonSchema` / `PersonInputSchema` (`@selfos/core/schemas`). **No `schemaVersion`
bump, no migration** (the `email`/`phone` precedent). **`birthday` already exists** (`04` §4.1) and is reused
for DOB/age — **not duplicated**. Proposed shapes (field-type calls noted in §11 where genuinely open):

```ts
// SHAREABLE descriptive fields — feed buildContext for the person AND for related people (like publicNotes).
// The depiction subset (appearanceDescription + gender + ethnicity + approx age from birthday) also feeds the
// image prompt (§8.2).
gender: z.string().optional(); // free text (inclusive; not an enum — see §11)
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

// PRIVATE fields — own coaching context only; never shared with others' coach, never sent to OpenAI (§8.2).
healthNotes: z.string().optional(); // free text (multiline)
faith: z.string().optional(); // free text
```

`buildContext` (`04` §3.4 / `packages/core/src/people/buildContext.ts`) and `buildLinkedPeopleContext`
(`12` §5.1) are extended to surface the **shareable** descriptive fields (own + related people), and the
**private** ones **only** in the person's own context block — the same shareable-vs-private split already
applied to `publicNotes`/`privateNotes`. The image-depiction subset = `appearanceDescription` + `gender` +
`ethnicity` + approximate age derived from `birthday`.

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

- **dreamImageService** (`@selfos/core/dreams`) — the orchestrator (the `dreamAnalysisService` pattern):
  - `generateDreamImage(deps)` — `checkBudget` (person + app, owner override) → build the prompt (§5.3) →
    `client.generate` → on `ok`: `encryptBytes` → write `image.enc` (validated bytes/mime, §4.4) → stamp
    `Dream.image` → `recordUsage('dream.image', flat cost)`; on `REFUSED`: **no metering**, return the calm
    reason; on `ERROR`: return the error (metering follows the §7 rule). Re-generate is the same call (it
    overwrites only on success).
  - `getDreamImage(personId, dreamId)` → decrypted bytes + mime, or null.
  - `deleteDreamImage(personId, dreamId)` → remove `image.enc` + clear `Dream.image`.
  - Reuses `encryptBytes`/`decryptBytes` + the `isDreamImagePath` guard (§4.3), `checkBudget`/`costOf`/
    `recordUsage` (`06`), and `getDream`/`saveDream` (`dreamService`).
- **buildDreamImagePrompt** (a pure, unit-tested helper in `@selfos/core/dreams`) — assembles the image prompt
  from the dream narrative + linked-people depiction notes + style + safety framing (§8.2). Pure and
  name-stripping is the security-critical unit (tested that **no real name** reaches the prompt and **no
  private field** does).
- **buildDepictionNote** (`@selfos/core/people`, a sibling of `buildLinkedPeopleContext`) — given a linked
  `personId`, returns a **name-free** depiction string from the shareable subset only (appearance + gender +
  ethnicity + approx age from `birthday`); never the person's name, notes, or private fields. Returns '' if
  there's nothing depictable. This is the single place the depiction subset is assembled, so the privacy
  boundary is one code path.
- **buildContext / buildLinkedPeopleContext** — extended for the §4.6 descriptive fields (shareable own +
  related; private own-only).
- **pricing / usageTypes** (`06`) — the `dream.image` usage type + the flat-image-cost path (§4.5).

### 5.3 Prompt construction (the privacy-critical core)

`buildDreamImagePrompt` produces a single string for `ImageClient.generate`:

1. **Base** — the dream `narrative`, condensed into a visual scene description. (v1: the narrative is used
   directly as the scene; an optional future enhancement could pre-summarize it via Claude, but v1 sends the
   narrative as the scene basis per the user's "send the narrative directly" decision.)
2. **Name stripping** — real people's **names** are **never** included. Where the dream's "people present" are
   People-graph-linked (`12` §3.1), each is rendered only as a generic figure with a name-free depiction note:
   `"a figure: <appearanceDescription>, <gender>, ~<approx age>, <ethnicity>"` (only the fields present;
   `buildDepictionNote`). A **free-name** dream person (text-only, no `personId`) contributes **nothing** to
   the prompt beyond what's already in the narrative — and free-name text is **not** treated as a depiction.
3. **Style** — the chosen style (per-image override or the Settings default) is applied.
4. **Safety framing** — a fixed **non-photorealistic / dreamlike** instruction (e.g. "dreamlike, painterly,
   surreal, not a photograph") so a figure resembling someone is clearly an artistic interpretation, never a
   realistic likeness; plus a within-policy framing (no instruction circumventing the provider's content
   policy, §8.4).

Never sent: any person's **name**, `privateNotes`, `healthNotes`, `faith`, non-depiction shareable fields
beyond the depiction subset, or any **reference image/photo**.

### 5.4 Desktop main (host) & iOS

- **main** wires `dreamImageService` to `nodeFileSystem` / `nodeSecretStore` / the OpenAI `ImageClient` impl
  and registers the IPC handlers (§6). `openai.apiKey` is read host-side via `host.secrets.get(OPENAI_API_KEY_ID)`
  (the `ANTHROPIC_API_KEY_ID = 'anthropic.apiKey'` precedent; a new `OPENAI_API_KEY_ID = 'openai.apiKey'`).
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
  — main builds the prompt, checks consent + key + budget + capability, calls the `ImageClient`, encrypts +
  stores, stamps `Dream.image`, records `dream.image` usage. (Bytes are fetched separately to keep this
  response small; or the response may carry base64 — an implementation choice, but the **bytes never carry the
  raw prompt** back.)
- `dreams:getImage({ dreamId })` → `{ mime: string; dataBase64: string } | null` — decrypted image bytes as
  base64 (the `08` §13.2 base64-over-IPC pattern), for the `<img>` data URL.
- `dreams:deleteImage({ dreamId })` → `void` — removes `image.enc` + clears `Dream.image`.
- The consent state, default style, and image model come from **vault settings** (read host-side like
  `dreams.memoryEnabled` / `ai.model`, `12` §6); the **OpenAI key** is read host-side from the `SecretStore`.

The bridge **re-enforces** all gates server-side (consent + key + `dreams.generateImage` + dreamer scope) — a
non-dreamer or a role without the capability cannot generate, read, or delete another person's dream image.

**Settings** (`03` registry; new declarations in the Dreams section, `12` §3/§6):

- `dreams.imageGenerationEnabled` (boolean, **default OFF**, the one-time global **consent**) — copy
  acknowledges that generating sends the dream's description to OpenAI (a third party). Generation requires
  this ON + the key present + the capability.
- `dreams.imageModel` (select, **admin-only** — `adminOnly` like the questionnaires relay model, marked
  "Admin only", §12) — the OpenAI image model. Default + options **open** (§11).
- `dreams.imageStyle` (select) — the default style (e.g. dreamlike / painterly / watercolor / realistic), with
  a per-image override on the panel (§3.2).
- An **OpenAI key control** (admin-only custom control, mirroring the `ai.apiKey` `ApiKeyControl` — write-only
  to the renderer; `secret:setOpenAiKey` / a `has` check, never a `get`).

### 6.1 OpenAI API boundary

- The key (`openai.apiKey`) is **device-local** in the `SecretStore`, never in the vault, never logged, never
  sent to the renderer (`00` §6.2 applied to the second provider).
- Main calls OpenAI's image API via the `ImageClient` impl. Failures (no key, auth, rate limit, network,
  timeout, content-policy refusal) map to the typed `DreamImageResult` reasons and surface as the §3.4 calm
  states. A content-policy **refusal** is `REFUSED` (uncharged → unmetered, §7); a transport **error** is
  `ERROR`.
- **Minimization:** only the privacy-careful prompt (§5.3) is sent — no names, no private fields, no photos.

## 7. States & edge cases

Per `00` §7, every surface handles loading / empty / error / offline:

- **Consent OFF / no key / AI off** — calm connect states (§3.4); no generation; the dream is unaffected.
- **Over budget** — `06` warn→block (owner override); an existing image stays viewable.
- **Capability absent** — the panel isn't shown; the bridge denies the channel.
- **Content-policy refusal (`REFUSED`)** — calm message; the call was **not charged**, so it is **not metered**
  (the service skips `recordUsage` on `REFUSED`). The dream + any prior image are untouched.
- **Transport error (`ERROR`)** — a clear retry. Metering: if the provider **did** bill for the call before the
  bytes failed (e.g. an oversized/invalid return after a successful generation, §4.4), it is metered as the
  `06` rule (a paid call is recorded even when post-processing fails — the `synthesizeAnalysis` "meter before
  parse" precedent); a pre-generation failure (no key, budget) is not.
- **Regenerate failure** — the existing image is preserved (no destructive overwrite before success, §3.3).
- **Oversized / wrong-MIME return** — rejected with a calm error, not stored (§4.4).
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

- **Real people's NAMES are never sent** to OpenAI. The prompt builder strips them; a figure is described
  generically ("a figure: …"), never tied to a name.
- **Appearance, gender, ethnicity, and approximate age MAY be sent** — but **only** the dreamer's **own
  descriptions** of a People-graph-linked person (the shareable depiction subset, §4.6), assembled by
  `buildDepictionNote`. This lets a figure resemble that person without naming them.
- **Private fields are never sent** to OpenAI: `privateNotes`, `healthNotes`, `faith`, and any non-depiction
  field. The depiction is **text-only** — **no reference image or photo** is ever sent.
- The depiction is the **shareable** subset, consistent with the `04` §3.4 shareable-vs-private boundary (the
  dreamer is describing their own view of someone, which is already the "may inform the AI" bucket). It is
  one-directional — the linked person learns nothing about the dream or the image.

### 8.3 Sensitive content

A dream's `SensitivityTier` (`12` §8.3) does **not block** image generation, but a non-standard tier shows a
clear **warning before sending** (content leaves the device to a third party, §3.2). Images are **dreamer-only**
regardless of tier — they never feed coaching context and are never part of per-dream sharing (`12` §3.4), so a
sensitive dream's image cannot leak into another person's context. (The §3.4 per-dream sharing exclusion for
sensitive tiers concerns the text Insight; images are excluded from sharing for **all** tiers.)

### 8.4 Provider content policy

All image generation runs **within OpenAI's usage policy**. Content-policy refusals (violent / sexual /
disallowed imagery) are handled **gracefully** (the §3.4 `REFUSED` state) and **never circumvented** — the
prompt builder adds no instruction designed to evade the policy. A refused generation costs nothing and is not
metered (§7).

### 8.5 Third-party data flow (consent honesty)

Generating an image sends the dream's description (and the name-free depiction notes) to **OpenAI**, a third
party distinct from Anthropic. The one-time global consent (§6) states this plainly and ships **OFF** by
default; the per-dream sensitive-tier warning (§3.2) restates it for the most sensitive content. No dream
content reaches OpenAI without the dreamer having turned consent on and explicitly tapping Generate.

### 8.6 Break-glass

Consistent with `04` §8 / `12` §8.4, the vault is not zero-knowledge from the device owner / super-admin (one
master key decrypts everything). The super-admin inspect mode can therefore reach a dream's image, as it can
the dream. No new exposure beyond the existing model; no image-access audit log in v1 (the `12` §8.4 posture).

## 9. Accessibility

Per `01` §9. The `DreamImagePanel` is keyboard-operable (Generate / Regenerate / Delete / style picker / the
sensitive-tier warning dialog are focusable, labelled, with visible focus); the generated `<img>` carries
meaningful **alt text** (e.g. "AI-generated dreamlike image of: <dream title or first line>" — never the raw
prompt, to avoid leaking depiction notes to assistive text that could be read aloud near others); the loading
state is a polite live region; the admin-only cost figure has a text equivalent (not color-only). The
sensitive-tier warning is a properly-labelled confirm. Responsive ~360px→desktop with the mobile-width (390px)
layout guard + a control-geometry guard on the panel's fixed controls (DoD §7). The new person-editor fields
follow `04`/`01` form a11y.

## 10. Testing strategy

- **Unit (core, node):**
  - **`buildDreamImagePrompt` (security-critical):** no real **name** ever appears in the prompt; a linked
    person contributes only the depiction subset; `privateNotes`/`healthNotes`/`faith` and non-depiction
    fields **never** appear; a free-name dream person adds nothing beyond the narrative; the style + dreamlike
    framing are present.
  - **`buildDepictionNote`:** assembles appearance + gender + ethnicity + approx-age (from `birthday`),
    name-free; returns '' when nothing is depictable.
  - **`dreamImageService`** with the **fake `ImageClient`:** generate → `encryptBytes` round-trips to
    `image.enc` + stamps `Dream.image`; `getDreamImage` decrypts; regenerate overwrites; delete removes + clears
    the descriptor; **`REFUSED` is not metered**; an `ERROR` after a billed call **is** metered (the §7 rule); a
    no-consent / no-key / over-budget call is refused with the right reason and **not** metered; the
    `isDreamImagePath` guard blocks an out-of-bounds path.
  - **pricing / metering:** `dream.image` `costOf` yields the **flat** per-image cost (not $0 from zero
    tokens); the `UsageEvent` snapshots it.
  - **`buildContext` / `buildLinkedPeopleContext`:** the new shareable descriptive fields feed own + related
    context; the private ones feed **only** the person's own block.
  - **schema:** `Dream.image` additive-optional (existing dreams parse); `Person` new fields additive (no
    migration).
- **Component (RTL):** `DreamImagePanel` in both placements — entry state, consent-off / no-key / AI-off / over
  budget / capability-absent calm states; the sensitive-tier warning gate; loading → success; the `REFUSED`
  state; Regenerate confirm + preserve-on-failure; Delete confirm; the style picker; the admin-only cost. The
  Settings consent toggle + admin-only key/model + style default persist. The person editor's new About/Private
  field groups.
- **E2E (Playwright):** with `SELFOS_FAKE_IMAGE` (+ `SELFOS_FAKE_CLAUDE`) — turn on consent → add a (fake) key
  → log a dream → **Visualize** → the image renders → an encrypted `image.enc` round-trips (decrypt the vault to
  assert ciphertext) → Regenerate replaces it → Delete clears it; a **sensitive-tier dream shows the warning
  first**; the `dream.image` usage shows in the dashboard; a `REFUSED` fake shows the calm state and records **no**
  usage; the capability-off role doesn't see the panel. No-overflow + control-geometry + mobile-width (390px)
  guards on every new surface. The `ImageClient` and `ClaudeClient` are **interfaces with fakes** (no real
  network).

## 11. Open questions

To resolve with the user before / during build (do **not** assume):

1. **Flat per-image price (USD)** — the exact `perImageUsd` for each offered image model (§4.5).
2. **Default OpenAI image model + the offered model options** — the Settings select's default and list (§6).
   Proposed default `gpt-image-1`; the exact list to confirm.
3. **Image dimensions / aspect ratio** — fixed square (proposed 1024×1024) vs. a size option; what sizes to
   offer (§4.4).
4. **Export / share outside the dreamer** — v1 is view-in-app only (images are dreamer-only, §8.3). Whether a
   later "save / export image" (to a file outside the vault) is wanted, and if so whether it carries the same
   privacy framing.
5. **New profile field types/enums (§4.6)** — proposed: free text for `gender`, `ethnicity`, `appearanceDescription`,
   `occupation`, `location`, `communicationStyle`, `goals`, `faith`, `healthNotes`; chip lists for `interests`,
   `values`, `languages`; `{label,date}` rows for `importantDates`. Confirm whether `gender` should be a small
   enum + free-text "other" (vs. fully free text), and whether any field warrants a constrained control.
6. **Approximate-age derivation** — derive an approximate age band (e.g. "~30s") from `birthday`, vs. an exact
   age, vs. an explicit "approximate age" depiction field. Proposed: a rounded band from `birthday` so the
   depiction stays generic (and no exact DOB is sent to OpenAI).
7. **(Non-blocking) Pre-summarize the narrative for the prompt** — v1 sends the narrative as the scene basis
   directly (§5.3). Whether a (metered) Claude pre-summarization to a tighter visual prompt is worth it later.

## 12. Resolved decisions

Confirmed with the user (2026-06-11) — encoded above, **not** to be re-opened:

1. **Provider** — **OpenAI** for images (text stays Anthropic); an **admin-only** image-model select setting
   (default a current OpenAI image model), mirroring the Claude model select.
2. **Second key** — `openai.apiKey` in the main/Keychain `SecretStore` alongside `anthropic.apiKey`; host-side
   only, never to the renderer.
3. **Seam** — a new **`ImageClient`** host interface (OpenAI impl + offline fake), mirroring `ClaudeClient`.
4. **Storage** — **one canonical image per dream**, **encrypted bytes** at
   `people/<id>/dreams/<id>/image.enc` via `encryptBytes`/`decryptBytes` + base64-over-IPC (`08` §13.2);
   regenerate **replaces** it (with a confirm); an additive-optional `Dream.image` descriptor (no migration);
   path access confined like `isMediaPath`.
5. **Consent** — a one-time **global opt-in** (default OFF) acknowledging that generating sends the dream
   description to OpenAI; generation needs consent ON + key + capability.
6. **Prompt** — based on the dream **narrative**; **never** real **names**; **may** include a linked person's
   **appearance + gender + ethnicity + approx age** (from `birthday`) as name-free depiction notes; **never**
   their notes or reference images; a chosen **style** + a non-photorealistic / dreamlike framing.
7. **Likeness** — appearance / gender / ethnicity / approx age **yes** (the dreamer's own descriptions); names
   **never**.
8. **Cost / budget** — a `dream.image` usage type with a **flat** per-image USD cost in the pricing table,
   recorded through `06`, charged to the **dreamer** (warn→block like chat); admin-only `$`.
   `UsageEvent` represents it as tokens=0 + a flat `costUsd`; `costOf` gains an image path.
9. **Capability** — a new **`dreams.generateImage`** (default ON for Member, like `dreams.own`), gated in the
   bridge.
10. **Sensitive tiers** — generation allowed for **any** tier, with a clear **warning before sending** on a
    non-standard tier; **graceful content-policy refusal** handling (calm message; uncharged refusal not metered).
11. **Style** — a **default image style** in Settings (dreamlike / painterly / watercolor / realistic …) with
    an optional **per-image override**.
12. **Placement** — a **"Visualize this dream"** action in **both** the dream detail/composer **and** the
    analysis card; image display + regenerate + delete; calm states for no-key / consent-off / over-budget /
    refusal / AI-off.
13. **Safety** — wellness/not-medical boundary kept; images **dreamer-only** — never feed coaching context
    (text only), **not** part of per-dream sharing; within OpenAI's usage policy (graceful refusal, never
    circumvented).
14. **People-profile amendment** — the §4.6 descriptive `Person` fields (shareable About + private
    health/faith) are used as coaching context **app-wide** (not just images), fed by `buildContext` with the
    shareable-vs-private split; `birthday` is **reused** for DOB/age (not duplicated); surfaced in the tabbed
    `PersonEditor`. It ships as build slice 1 (independently valuable).

## 13. Proposed build slices (after approval)

1. **People-profile amendment** (`04` §4.1) — the additive-optional descriptive fields on
   `Person`/`PersonInput` (no migration; `birthday` reused); `buildContext` + `buildLinkedPeopleContext`
   threading (shareable own + related; private own-only); the `PersonEditor` About + Private field groups; unit
   - RTL tests. Independently valuable; no images yet.
2. **Image core backend** — the `ImageClient` host interface (OpenAI impl + offline fake) + `OPENAI_API_KEY_ID`
   in the `SecretStore`; `buildDepictionNote` + `buildDreamImagePrompt` (name-exclusion + depiction +
   style + dreamlike framing); `dreamImageService` (generate → `encryptBytes` → store + stamp `Dream.image`;
   get; delete); the `dream.image` usage type + the flat-image-cost path in pricing; the `isDreamImagePath`
   guard; the `Dream.image` schema amendment. Core-only, unit-tested with the fake client.
3. **IPC seam + settings + capability** — `dreams:generateImage` / `:getImage` / `:deleteImage` through the
   typed seam (gated by `dreams.generateImage`, dreamer-scoped, key host-side); the `dreams.generateImage`
   capability (Member default); the Settings consent toggle, admin-only OpenAI key control + image-model
   select, and default-style picker; the host `image` part in `createCoreBridge`.
4. **Renderer + E2E** — the shared `DreamImagePanel` in both placements (entry / loading / success / refusal /
   calm states, the sensitive-tier warning, the style picker, Regenerate/Delete, admin-only cost); the
   `dreamStore`/`dreamAnalysisStore` image lifecycle; visual QA at desktop + 390px; the E2E (consent → generate
   → encrypted round-trip → regenerate → delete; sensitive-tier warning; refusal-not-metered; capability-off).

## 14. Changelog

- 2026-06-11 — created (**Draft**). The deferred AI dream-image-generation companion spec parked in
  [`12-dreams.md`](12-dreams.md) §2/§11.2. All product decisions pre-made by the user (§12): OpenAI provider +
  admin model select, a second `openai.apiKey` in the `SecretStore`, a new `ImageClient` host interface,
  encrypted-bytes storage at `people/<id>/dreams/<id>/image.enc` reusing the `08` §13.2 image precedent, a
  one-time global consent (default OFF), a privacy-careful prompt (narrative-based; names never; appearance /
  gender / ethnicity / approx-age allowed; no private fields; no reference photos), a `dream.image` flat-cost
  usage type, the `dreams.generateImage` capability, sensitive-tier warning + graceful content-policy refusal,
  a default + per-image style, dual placement, and images **dreamer-only** (never context, never shared). Also
  carries the prerequisite **People-profile amendment** to `04` §4.1 (§4.6/§13.1). Awaiting review/approval
  before any code; only genuine tuning (price, model list, image size, export, field-type confirmations,
  age-derivation) left in §11.
