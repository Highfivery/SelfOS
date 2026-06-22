# 25 — Household AI credentials (owner shares one key, members inherit it)

> **Status:** Draft · _last updated 2026-06-21_
>
> SelfOS's Claude (and OpenAI dream-image) API keys are **device-local** secrets today, so a second
> household member who installs the app and points at the **same shared vault** has a synced
> `ai.enabled` but **no key** — every AI surface, and the AI-hard-gated onboarding, shows "AI hasn't
> been set up," locking the member out. This spec adds an **owner-shared key stored encrypted in the
> vault** (under the master key, exactly like the relay's Cloudflare token already is in
> `config/relay.enc`), so every member device inherits a working key automatically; a member may
> optionally override with their own device-local key. One Anthropic account pays for the whole
> household; spec 06's per-person budgets partition that shared spend.

Builds on [`00-architecture.md`](00-architecture.md) (the device-local-vs-synced storage split §4.1,
the Claude API boundary §6.2 — **both amended by this spec**), [`06-ai-usage-and-budgets.md`](06-ai-usage-and-budgets.md)
(per-person budgets are the partition of the shared spend), [`10-multi-device-vault.md`](10-multi-device-vault.md)
(the trusted-household model — every member device already holds the master key and full read of the
vault, which is precisely what makes a vault-stored key acceptable), and [`18-personal-onboarding.md`](18-personal-onboarding.md)
(the AI-hard-gated member onboarding this un-sticks). Inherits the vault/crypto/IPC boundary and the
"key never crosses to the renderer" rule from `00` — not restated here.

> **The decision being designed to (already made by the product owner, not re-opened):**
> **"Owner shares one key."** The owner's API key is stored **encrypted in the vault**, so every member
> device inherits it. A member may **optionally** override with their own device-local key. The same
> model applies to the OpenAI (dream-image) key. This is a **deliberate, documented relaxation** of the
> `00` §6.2 "key never enters the synced vault" rule, justified in §8.

---

## 1. Overview

Today AI readiness everywhere is computed as **`ai.enabled` (a vault setting, synced) && `hasKey` (a
device-local secret, not synced)**. The first half rides the shared vault to every device; the second
half does not. So the moment a household has **two** members on the **same** vault:

- The owner sets up AI (enables it + adds a key on their device). `ai.enabled` syncs.
- A member installs SelfOS, points at the shared vault, signs in — `ai.enabled === true` but their
  device's `secrets.json` has **no `anthropic.apiKey`**. `hasKey === false`.
- Every AI surface degrades to "AI hasn't been set up," and **onboarding (18) is AI-hard-gated**, so
  the member hits a full-screen dead-end they cannot clear. There is **no specced path** for a second
  member to get a working key.

This spec closes that gap with **one shared key, member-overridable**:

1. A new **vault-stored, master-key-encrypted** credentials file (`config/ai-credentials.enc`) holding
   the household's shared Claude key + shared OpenAI key. The cloud only ever sees ciphertext.
2. A host-side **resolution order** — a member's **device-local override** (if set) wins, else the
   **vault-shared** key — behind one helper (`resolveAiKey` / `resolveOpenAiKey`) that replaces the ~14
   scattered `host.secrets.get(ANTHROPIC_API_KEY_ID)` / `OPENAI_API_KEY_ID` call sites in `coreBridge`.
3. A renderer **readiness** call returning **booleans only** (`aiKeyStatus()`), so each AI surface
   computes `aiAvailable = ai.enabled && resolvedReady` without ever seeing a key value.
4. **Settings UI** that lets the owner _share_ their key and a member _use the household key_ or
   _override_ it.
5. A **consented, one-time migration** that promotes an existing owner's device key into the vault.
6. **One shared, role-aware "AI not set up" component** replacing the scattered, mostly role-blind
   messages — which also fixes the onboarding dead-end's _messaging_ (the deeper onboarding-offline
   work is spec 31).

The **resolved key value still never crosses IPC to the renderer** — the `00` §6.2 boundary is
preserved for the _value_; only its _storage location_ changes (and only for the explicitly-shared key).

## 2. Goals / Non-goals

**Goals**

- A second household member on the shared vault **inherits a working key with zero setup** and is never
  locked out of AI or onboarding.
- **One Anthropic account** funds the household; **per-person budgets (06)** throttle/partition the
  shared spend — there is no separate billing per member.
- A member can **opt out** of the shared key with their own **device-local override** (e.g. their own
  Anthropic account), and **clear** it to fall back to the shared key.
- The **shared key is encrypted at rest** under the master key like every other vault file — the cloud
  provider only ever holds ciphertext.
- The **resolved key value never reaches the renderer or any log** (the `00` §6.2 boundary, preserved).
- A **single resolution helper** replaces every scattered `secrets.get(...)` call site, so readiness is
  computed one way everywhere.
- A **role-aware** "AI not configured" surface: owner → "add/enable a key"; member → "AI is provided by
  your household / ask your owner / use your own key."
- **Existing single-device owners are unaffected** unless they opt into sharing; declining keeps their
  device key resolving first.

**Non-goals (deferred / owned elsewhere)**

- **General settings trust-boundary enforcement** (who may write which vault setting, enforced in the
  bridge) → **spec 30**. This spec enforces only the _owner-only write to the shared key_, coordinating
  with 22's broader model.
- **Onboarding offline form sections + deferred AI synthesis** (letting onboarding progress with no AI
  at all) → **spec 31**. Here we only fix the _readiness + messaging_ so a member with the inherited key
  is no longer falsely gated.
- **Device registry / per-device revocation / key rotation** (rotating the shared key, listing devices,
  revoking one device's access) → **spec 32**.
- **Multiple shared keys / per-feature keys / multiple providers beyond Anthropic + OpenAI.** One shared
  Claude key + one shared OpenAI key.
- **Real billing integration with Anthropic.** Budgets (06) remain an _estimate_; this spec doesn't add
  invoice reconciliation.
- **Encrypting the key with anything other than the master key.** Per-member envelope-encryption of the
  shared key (so a member can't read the raw key bytes) is out of scope — in the trusted-household model
  every member already holds the master key and full vault read (§8).

## 3. UX & flows

All AI Settings live in **Settings → AI** (Claude) and **Settings → Dreams** (OpenAI dream images),
the existing sections (`apps/desktop/src/renderer/src/settings/builtins.tsx`,
`aiControls.tsx`). The controls a person sees are **role-aware**.

### 3.1 Owner — first-time AI setup + "Share with the household"

The owner's AI section keeps the existing **enable toggle**, **model select**, and **write-only key
field** (`ApiKeyControl` / `SecretKeyControl` in `aiControls.tsx`). It gains:

- A **"Share this key with the household"** control (a `Switch` or a labelled action). When on, the
  owner's key is written into `config/ai-credentials.enc` (the shared key) so every member device
  inherits it. When off, the shared key is **cleared from the vault** and only the owner's device-local
  key resolves (back to single-device behavior).
- A short explainer: _"Members of your household will use this key. Your one Anthropic account pays for
  everyone; per-person budgets (Settings → Usage) control how much each person can spend."_

Writing/clearing the shared key is **owner-only**, enforced in the bridge (§6.2), not just hidden in the
UI.

### 3.2 Owner — first-run migration prompt (existing key → share it)

An owner who already had a device-local key **before** this feature shipped sees a **one-time,
consented** prompt (a Settings → AI `Banner` or a small card): _"Share your existing Claude key with
your household? Members on this vault will be able to use AI without entering a key of their own."_ —
with **Share** and **Not now** actions. **Share** copies the device key into the vault credentials
(§5.4); **Not now** dismisses it (recorded device-local so it doesn't nag) and the owner stays
single-device. The key is **never silently moved** into the synced file — this is the only path that
writes a secret into a cloud-synced location, and it requires an explicit tap (§8).

### 3.3 Member — "AI is provided by your household"

A non-owner with the household having a shared key sees, in Settings → AI:

- A read-only line: **"AI is provided by your household."** (No key field, no enable toggle — `ai.enabled`
  is a household setting the owner controls; whether a member may toggle it at all is **spec 30**.)
- An optional **"Use my own key instead"** control that reveals a device-local key field (writes the
  member's own `anthropic.apiKey` secret — their **override**, §4.3).
- When an override exists: a **"Clear override"** action that removes the device secret and falls back to
  the shared household key.

A member whose household has **no** shared key (owner hasn't shared) and who has **no** override sees the
role-aware "AI not set up — ask your household owner to set up AI, or use your own key" surface (§3.6).

### 3.4 Member — using their own key (override)

The override is a device-local secret identical to today's storage; it simply **takes precedence** over
the shared key in resolution (§4.3). A member on their own Anthropic account is billed there; the
household shared key (and the owner's budget) is untouched for that member's calls. (Budgets in 06 still
meter the member's spend against _their_ per-person budget regardless of which key paid — budgets are an
estimate of token spend, not a billing integration.)

### 3.5 Dream-image (OpenAI) key — same model

The Settings → Dreams section's `OpenAiKeyControl` mirrors §3.1–§3.4 for `openai.apiKey`: the owner can
**share** the OpenAI key into the vault credentials; a member inherits it or overrides it. Dream-image
generation (13) reads it via `resolveOpenAiKey` (§4.4).

### 3.6 The role-aware "AI not configured" surface (replaces scattered messages)

Today **11 renderer surfaces** compute their own "is AI ready?" and render their own, mostly role-blind,
"AI hasn't been set up" copy. This spec consolidates the _message_ into **one shared component**
(`AiNotConfigured` / `AiUnavailableNotice`) that is **role-aware**:

- **Owner:** "Add a Claude key in Settings → AI to enable coaching." (links to Settings → AI)
- **Member, household has no shared key:** "AI is provided by your household. Ask your household owner to
  set up AI, or add your own key in Settings → AI."
- **Member, shared key present but `ai.enabled` is off:** "Your household owner hasn't turned on AI yet."

Each AI surface (Sessions, Home, Onboarding, Dreams, Questionnaires) renders this one component in its
not-ready branch. This is also what un-sticks the **onboarding** dead-end's messaging — once a member
_inherits_ the shared key, `resolvedReady === true` and the gate clears; if there genuinely is no key
yet, they get the helpful member-facing message instead of a blind "set up AI" (the deeper
onboarding-can-proceed-offline work is **spec 31**).

### 3.7 Happy-path summary (the scenario this exists for)

1. Owner enables AI + adds a key on Device A; toggles **Share this key with the household** (§3.1).
   `config/ai-credentials.enc` is written (encrypted), syncs to the shared vault.
2. Member installs SelfOS on Device B, points at the same vault, joins (10), signs in.
3. On Device B, `aiKeyStatus()` → `{ hasSharedKey: true, hasDeviceOverride: false, resolvedReady: true,
source: 'shared' }`. Every AI surface shows `aiAvailable === true`. **Onboarding proceeds.**
4. A chat turn on Device B resolves the **shared** key host-side (`resolveAiKey`), calls Claude, and
   meters the spend against the **member's** per-person budget (06). The owner's one Anthropic account
   is billed.

## 4. Data model (vault files & schemas)

### 4.1 New vault file — `config/ai-credentials.enc`

A new vault file, **encrypted under the master key** (the standard `.enc` envelope, exactly like
`config/relay.enc` and all People data). The cloud only ever holds ciphertext. All reads/writes go
through the **`FileSystem` host + crypto** in `@selfos/core` (no direct `fs`; the renderer never reads
it).

```ts
// packages/core/src/schemas.ts (proposed)
export const AiCredentialsSchema = z.object({
  schemaVersion: z.number().int().positive(), // starts at 1
  /** Shared Claude/Anthropic API key for the household (plaintext inside the encrypted envelope). */
  anthropicApiKey: z.string().min(1).optional(),
  /** Shared OpenAI key for dream images (13). */
  openaiApiKey: z.string().min(1).optional(),
  /** Audit-friendly metadata (no secret material). */
  updatedAt: z.string().datetime().optional(),
  sharedByPersonId: z.string().optional(), // who shared it (the owner); informational
});
export type AiCredentials = z.infer<typeof AiCredentialsSchema>;
```

- Both key fields are **optional** so a household can share only Claude, only OpenAI, both, or neither
  (the file is created on first share; an absent file ⇒ no shared key).
- The plaintext key sits _inside_ the encrypted envelope — the same posture as `config/relay.enc`'s
  `cloudflare.apiToken` + `drainSecret` (the explicit precedent).
- **Path:** `config/ai-credentials.enc`. **Owned by** the new credentials service (§5.1); written **only**
  by the owner-gated bridge op (§6.2).

### 4.2 Schema versioning & migration

- `schemaVersion` starts at **1**. New file ⇒ no migration. Future shape changes follow the standard
  `00` §4.4 migration-registry pattern.
- There is **no migration of existing vaults' data** — the file simply doesn't exist until an owner
  shares a key (the §5.4 promotion creates it). Existing vaults are unaffected (they keep resolving the
  owner's device key, which still wins as the override).

### 4.3 Device-local secrets (unchanged storage, new role)

The existing device-local secrets are untouched in storage (`userData/secrets.json`, `safeStorage`):

- `anthropic.apiKey` (`ANTHROPIC_API_KEY_ID`) — on the **owner's** device, this is the key they may
  share; on a **member's** device, when present it is their **override**.
- `openai.apiKey` (`OPENAI_API_KEY_ID`) — same, for dream images.

Their **meaning** now depends on resolution order (§4.4), but the schema/storage is identical — so
single-device users keep working with no change.

### 4.4 Resolution order (the core rule)

Read **host-side** (in the bridge / core), **never** in the renderer:

```
resolveAiKey(host, fs):
  1. const override = await host.secrets.get(ANTHROPIC_API_KEY_ID)   // device-local
     if (override) return { key: override, source: 'device' }
  2. const shared = (await readAiCredentials(fs))?.anthropicApiKey    // vault, master-key-decrypted
     if (shared) return { key: shared, source: 'shared' }
  3. return { key: undefined, source: 'none' }
```

`resolveOpenAiKey(host, fs)` is identical for `OPENAI_API_KEY_ID` / `openaiApiKey`. **Device override
wins** so a member who chose their own key is never silently switched onto the household key, and a
single-device owner (no shared file) keeps resolving their device key exactly as today.

`readAiCredentials(fs)` decrypts `config/ai-credentials.enc` under the master key (via `vaultAndKey()`),
validates against `AiCredentialsSchema`, and returns `null` if the file is absent or empty.

## 5. Architecture & modules

### 5.1 Core service — `@selfos/core` `aiCredentialsService`

A new core service (host-agnostic, so the iOS host gets it via `createCoreBridge` for free — 07):

- `readAiCredentials(fs, key): Promise<AiCredentials | null>` — decrypt + validate `config/ai-credentials.enc`.
- `writeSharedKey(fs, key, { provider, value, sharedByPersonId }): Promise<void>` — set
  `anthropicApiKey` _or_ `openaiApiKey`, stamp `updatedAt`/`sharedByPersonId`, encrypt + atomic write.
- `clearSharedKey(fs, key, { provider }): Promise<void>` — drop one provider's key; delete the file when
  both are absent (so "stop sharing everything" leaves no orphan ciphertext).
- `resolveAiKey(host, fs)` / `resolveOpenAiKey(host, fs)` — the §4.4 resolution (override → shared →
  none). These are the **single** key source used everywhere downstream.

### 5.2 Bridge — `coreBridge.ts` call-site consolidation (the bulk of the work)

Replace every scattered `await host.secrets.get(ANTHROPIC_API_KEY_ID)` / `OPENAI_API_KEY_ID` with the
resolver. The grounded call sites (today's `coreBridge.ts`):

| Surface / op (line ≈)              | Today                                 | After                               |
| ---------------------------------- | ------------------------------------- | ----------------------------------- |
| `aiDeps` (chat/intake/etc. ~660)   | `secrets.get(ANTHROPIC_API_KEY_ID)`   | `resolveAiKey(host, ctx.fs)`        |
| chat stream readiness (~719)       | `ai.enabled && secrets.get(...)`      | `ai.enabled && resolveAiKey`        |
| `claudeTest` (~807)                | `secrets.get(ANTHROPIC_API_KEY_ID)`   | `resolveAiKey(host, fs)`            |
| questionnaire generate (~1196)     | `secrets.get(ANTHROPIC_API_KEY_ID)`   | `resolveAiKey`                      |
| questionnaire improve (~1245)      | `secrets.get(ANTHROPIC_API_KEY_ID)`   | `resolveAiKey`                      |
| dream analyze/synthesize (~2656)   | `secrets.get(ANTHROPIC_API_KEY_ID)`   | `resolveAiKey`                      |
| dream patterns (~2689)             | `secrets.get(ANTHROPIC_API_KEY_ID)`   | `resolveAiKey`                      |
| guided suggest / gapfinder (~2762) | `secrets.get(ANTHROPIC_API_KEY_ID)`   | `resolveAiKey`                      |
| dream images (~2858–2859)          | both `ANTHROPIC`+`OPENAI` secrets.get | `resolveAiKey` + `resolveOpenAiKey` |
| memory refresh (~2965)             | `secrets.get(ANTHROPIC_API_KEY_ID)`   | `resolveAiKey`                      |
| compat align/distill (~3023)       | `secrets.get(ANTHROPIC_API_KEY_ID)`   | `resolveAiKey`                      |

> Note: the exact line numbers/site list is a _snapshot_ to scope the work; the implementer must
> re-grep `ANTHROPIC_API_KEY_ID` / `OPENAI_API_KEY_ID` in `coreBridge.ts` at build time and replace
> **every** read with the resolver (the standing rule: no AI call site reads the raw secret directly).
> `secretSet` / `secretHas` / `secretClear` (the device-override Settings controls) keep using
> `host.secrets.*` directly — they manage the device override, not resolution.

The **resolved key value never leaves the bridge** — it flows into `host.claude.stream(...)` /
`host.image(...)` and into the `AiDeps.apiKey` field consumed by core services, none of which cross IPC.

### 5.3 Renderer readiness — `aiKeyStatus()` (booleans only)

Today **11 renderer surfaces** call `secretHas(ANTHROPIC_API_KEY_ID)` to compute readiness. Replace with
one new bridge call returning **only booleans + an enum** (never a key value):

```ts
// new IPC: ai:keyStatus  → AiKeyStatus
export const AiKeyStatusSchema = z.object({
  hasSharedKey: z.boolean(), // a vault-shared key exists for this provider
  hasDeviceOverride: z.boolean(), // this device has its own key secret
  resolvedReady: z.boolean(), // resolveAiKey would return a key
  source: z.enum(['device', 'shared', 'none']),
});
export type AiKeyStatus = z.infer<typeof AiKeyStatusSchema>;
```

`aiKeyStatus(provider?: 'anthropic' | 'openai')` is computed host-side from the resolver + the device
secret presence; it returns presence booleans only. Each surface computes
`aiAvailable = ai.enabled && status.resolvedReady`.

**The 11 surfaces to migrate** (from the grep):

- **Sessions** (`Sessions.tsx`)
- **Home** (`Home.tsx`)
- **Onboarding** (`Onboarding.tsx`, `IntakeFormPanel`)
- **Dreams** — `DreamAnalysisPane`, `DreamPatterns`, `DreamImagePanel` (the last uses the **OpenAI**
  status)
- **Questionnaires** — `QuestionnaireBuilder`, `SuggestedPanel`, `QuestionnaireResults`,
  `CompatibilitySendPanel`, `CompatibilityResults`

A small renderer hook (e.g. `useAiAvailability()`) wrapping `aiKeyStatus()` + the `ai.enabled` setting
keeps the computation in one place; the per-surface tests assert the not-ready branch renders the shared
`AiNotConfigured` component (§3.6).

### 5.4 The consented migration (owner's existing key → vault)

The owner's first-run promotion (§3.2):

1. The Settings → AI card shows the **Share / Not now** prompt **only** when: the active person is the
   owner, a device-local `anthropic.apiKey` exists, **no** shared key exists yet, and the prompt hasn't
   been dismissed.
2. **Share** → bridge op `ai:shareDeviceKey({ provider })` (owner-gated, §6.2) reads the device secret
   host-side and `writeSharedKey(...)` into the vault credentials. The device key is **kept** (it
   remains the owner's override and still resolves first — declining later un-shares via §3.1's toggle).
3. **Not now** → records a device-local dismissal flag (e.g. in `DeviceState`) so it doesn't re-prompt.

The migration **never silently writes** the key into the synced vault — it requires the explicit Share
tap (§8). Existing single-device users who never share are completely unaffected.

### 5.6 Auto-share by default (amendment 2026-06-22 — the recurring-trap fix)

The opt-in §5.4 promotion proved to be a **recurring trap**: an owner sets up AI, it works on their
machine, `ai.enabled` even syncs "on" — but the key is device-local and **unshared**, so every member is
silently locked out of onboarding ("Ask your household owner to enable AI") with no signal to the owner
that a separate Share tap is needed. Verified against a real two-machine setup: `ai.enabled: true` synced,
owner had `anthropic.apiKey` device-local, but `config/ai-credentials.enc` was **absent** (never shared).

Resolution (owner decision 2026-06-22): **sharing is the default, with an explicit opt-out.**

- **New vault setting `ai.shareCredentials`** (boolean, **default `true`**, **admin-only**, AI section,
  `visibleWhen` AI enabled). Copy: "Share AI with your household … Turn off to keep your key on this
  device only." It is in `ADMIN_ONLY_SETTING_KEYS` (30) so the bridge rejects a non-owner write.
- **Auto-share on save:** when an **owner** (`settings.manage`) saves a Claude/OpenAI key via `secretSet`
  and `ai.shareCredentials !== false`, the bridge **also** `writeSharedKey(...)` it into the vault. A
  **member's** own-key override is **device-local only** (the `settings.manage` guard skips non-owners).
- **Boot migration:** `householdStatus` runs an idempotent `ensureSharedAiCredentials` for the active
  owner (skips a provider already shared), so an **existing** setup that predates auto-sharing reaches
  members on the **next launch** — no tap required.
- **The opt-out is live:** toggling `ai.shareCredentials` **off** withdraws the shared key(s) from the
  vault (members fall back to their own); toggling **on** shares the owner's current device key(s).
- The manual **"Share with the household" / "Stop sharing"** buttons (§3.1/§5.4) are **removed** —
  auto-share + the toggle replace them; the owner key control now shows status only. The
  `ai:shareDeviceKey` / `ai:clearSharedKey` bridge ops remain (idempotent, still valid).

This supersedes §5.4's opt-in promotion as the default; §5.4's privacy framing still holds (the key is
encrypted under the master key, never plaintext on disk or over IPC; budgets cap per-person spend).

### 5.5 Modules touched (summary)

| Layer             | File                                                 | Change                                                                                        |
| ----------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Schemas (core)    | `packages/core/src/schemas.ts`                       | `AiCredentialsSchema`, `AiKeyStatusSchema`                                                    |
| Core service      | `packages/core/src/ai/aiCredentialsService.ts` (new) | read/write/clear shared key + `resolveAiKey` / `resolveOpenAiKey`                             |
| Shared contract   | `apps/desktop/src/shared/channels.ts`                | `ai:keyStatus`, `ai:shareDeviceKey`, `ai:setSharedKey`, `ai:clearSharedKey` + bridge methods  |
| Bridge (factory)  | `apps/desktop/src/shared/coreBridge.ts`              | replace all `secrets.get(KEY_ID)` with the resolver; new owner-gated share/clear ops          |
| Preload + mock    | preload bridge, `renderer/src/test-utils/bridge`     | expose + mock the new channels                                                                |
| Settings UI       | `settings/aiControls.tsx`, `settings/builtins.tsx`   | owner Share toggle + migration prompt; member "provided by household" + override/clear        |
| Renderer surfaces | the 11 files in §5.3                                 | swap `secretHas` → `aiKeyStatus()` via `useAiAvailability()`; render shared `AiNotConfigured` |
| Shared component  | `renderer/src/app/AiNotConfigured.tsx` (new)         | the one role-aware not-configured notice (§3.6)                                               |

## 6. IPC / API contracts

Renderer ↔ main only through the typed seam (`00` §6.1); inputs Zod-validated. **No channel ever returns
a key value.**

### 6.1 `ai:keyStatus` — new (renderer readiness)

- **Request:** `{ provider?: 'anthropic' | 'openai' }` (default `'anthropic'`).
- **Response:** `AiKeyStatus` (§5.3) — **booleans + `source` enum only**.
- **Behavior:** host-side, from `resolveAiKey`/`resolveOpenAiKey` + device-secret presence. Replaces the
  11 `secretHas(...)` readiness checks.

### 6.2 `ai:shareDeviceKey` / `ai:setSharedKey` / `ai:clearSharedKey` — new (owner-only)

- **Gating:** **owner-only**, enforced **in the bridge** (not just hidden in the UI). Proposed capability
  gate: a settings-admin capability (e.g. `settings.manage`) or an explicit owner check — **coordinate
  with spec 30**, which establishes the general settings-write trust boundary; this spec uses 30's gate
  for the shared key once 22 lands, and an owner check in the interim. A non-owner call is rejected
  (typed `AppError`), so a tampered renderer can't write the household key.
- **`ai:shareDeviceKey({ provider })`** — read the device secret host-side, `writeSharedKey` into the
  vault credentials (the §5.4 migration). Never accepts a key value over IPC (it reads the existing
  device secret), so no plaintext key crosses _in_.
- **`ai:setSharedKey({ provider, value })`** — set the shared key directly (used if the owner pastes a
  fresh key into the share field). The value crosses IPC renderer→main (it has to, to be stored), is
  written into the encrypted vault file, and is **never returned**, never logged.
- **`ai:clearSharedKey({ provider })`** — `clearSharedKey(...)`; deletes the file when both providers'
  keys are gone.

### 6.3 Reused channels (unchanged)

`secretSet` / `secretHas` / `secretClear` (device override management), `setting:get`/`set`
(`ai.enabled`, model), `claudeTest` (now resolves via §5.2). No change to their contracts.

### 6.4 Claude / OpenAI API

The resolved key flows into `host.claude.stream(...)` / `host.image(...)` **in main**, exactly as today
— streaming, model selection, token/error handling, and budget enforcement (06) are unchanged. The only
difference is _where the key came from_ (resolver vs a single `secrets.get`). **The key value never
reaches the renderer and is never logged** (`00` §6.2 / §8).

## 7. States & edge cases

- **Member, shared key present, no override (the headline case)** → `resolvedReady: true`, `source:
'shared'`. All AI surfaces work; onboarding proceeds. (The bug this spec fixes.)
- **Member, no shared key, no override** → `resolvedReady: false`, `source: 'none'`. Surfaces render the
  member-facing `AiNotConfigured` ("AI is provided by your household — ask your owner, or add your own
  key"). Onboarding's _messaging_ is helpful (the can-it-proceed-offline behavior is spec 31).
- **Member with an override + a shared key also present** → override **wins** (`source: 'device'`). The
  member's own account/key is used; clearing the override falls back to `'shared'`.
- **Owner, single device, never shares** → `source: 'device'`, identical to today. No `ai-credentials.enc`
  exists. **Unaffected.**
- **Owner shares, then un-shares (toggle off / clear)** → `clearSharedKey` removes the provider key (and
  the file if empty). Members lose `source: 'shared'`; those without an override drop to `'none'` and see
  the member message again. (No silent breakage — the owner chose to stop sharing.)
- **`config/ai-credentials.enc` corrupt / fails to decrypt or validate** → `readAiCredentials` returns
  `null` (typed error logged, **redacted**, never the bytes); resolution falls through to `none` (or the
  device override if present). Treated like any other corrupt vault file (`00` §7) — quarantine, surface
  a calm "couldn't read household AI key" notice, never crash. The vault file is not auto-deleted.
- **Sync conflict on `ai-credentials.enc`** (two owners/devices wrote it) → the standard `00` §4.3
  conflict detection applies; never auto-resolve. (In practice only the owner writes it; concurrent
  writes are rare. Device registry / rotation that would make this common is **spec 32**.)
- **Offline / vault folder unmounted** → if the vault is unreachable, `readAiCredentials` can't run; a
  device **override** still resolves (it's device-local), so a member with their own key keeps working
  offline-from-vault. A member relying on the shared key needs the vault readable (same as any vault
  read). No network is involved in resolution itself.
- **OpenAI vs Claude independence** → a household may share Claude but not OpenAI (or vice-versa). Each
  resolves independently; dream images (13) gate on `resolveOpenAiKey`, coaching on `resolveAiKey`.
- **`ai.enabled` is the household gate** → even with a resolved key, `aiAvailable` is `false` if the
  owner hasn't enabled AI. The member sees the "owner hasn't turned on AI yet" message (§3.6), not a
  key prompt.
- **Migration already done / prompt dismissed** → the share prompt (§3.2) shows once; a dismissal flag
  (device-local) and the presence of a shared key both suppress it.
- **A pasted shared key fails `claudeTest`** → the owner's existing "Test connection" path runs against
  the resolved key; a bad shared key surfaces the same calm test-failure as today, before members rely
  on it.

## 8. Safety

This is an infrastructure/credentials feature; it does **not** itself render wellbeing or conversation
content, so there is **no crisis-routing or not-medical surface here** — those remain owned by the
conversational specs (`05`, `09`, `18`) per [`CLAUDE.md`](../../CLAUDE.md) §1. It does, however, touch
the project's most sensitive non-content data (the API key), so the safety surface is **secret handling
and the documented relaxation of the vault-storage rule**.

### 8.1 The documented relaxation of `00` §6.2 (key never in the vault)

`00` §4.1 / §6.2 state the API key is device-local and **never enters the synced vault**. This spec
**deliberately relaxes that for the explicitly-shared key**, and the relaxation is acceptable because:

1. **The trusted-household model already shares everything that matters.** Per `10`, every member device
   that joins the vault **already holds the master key** and has **full read of all vault content** —
   People, Sessions, Dreams, the relay's Cloudflare token. A member who can already decrypt the entire
   vault gains nothing meaningful by also being able to decrypt the Claude key; the threat model is _the
   cloud provider and outside attackers_, not household members.
2. **The key is encrypted at rest like everything else.** `config/ai-credentials.enc` is sealed under the
   master key with the identical envelope used for all vault data — **the cloud only ever holds
   ciphertext**. Storing it in the vault does **not** expose it to the sync provider.
3. **There is an exact precedent already shipped.** The relay's **Cloudflare API token + drain secret**
   live in the vault at `config/relay.enc` (`00` §5.1, `RelayConfigSchema.cloudflare.apiToken`) under the
   same master-key encryption, host-side only. The AI key is the same class of secret stored the same
   way.
4. **Sharing is opt-in and consented.** The key is **never silently** written to the synced file — only
   the owner's explicit Share tap (§3.2/§3.1) creates it. Declining keeps the strict device-local
   posture.

**Required amendment:** `00-architecture.md` §4.1 (the device-local-vs-synced table / "the API key … is
not in the vault") and §6.2 (the Claude API boundary) must be **amended** to reflect: _the API key is
device-local by default; an owner may opt to share it into the vault encrypted under the master key, in
which case member devices inherit it; a device-local override always takes precedence._ This spec's
approval is the trigger for that amendment (tracked in §11).

### 8.2 Invariants that **do not** change

- **The resolved key value never crosses IPC to the renderer.** Every new channel returns booleans/enums
  only (`ai:keyStatus`) or `void` (the write ops); the key flows only main↔Claude/OpenAI. This is the
  `00` §6.2 boundary, fully preserved for the _value_.
- **The key is never logged** — not the shared key, not an override, not in errors, not in usage events
  (06 events carry token counts only). Logs redact secrets (`00` §8).
- **`ai:setSharedKey({ value })` is the only channel that carries a key value inbound**, and it travels
  renderer→main only to be sealed into the encrypted vault file (the owner is entering their own key).
  It is never echoed back.

### 8.3 Who pays — honesty

The shared key is **one Anthropic account**. Every household member's calls bill that account.
**Per-person budgets (06) are the partition/throttle**, not separate billing — a member's spend is
metered against their per-person budget and blocks at the limit (owner-overridable), but the dollars all
land on the owner's one bill. The Settings copy (§3.1) states this plainly so the owner isn't surprised.

## 9. Accessibility

Defers to [`01-design-system.md`](01-design-system.md). The new/changed surfaces meet those standards:

- The **Share toggle**, **override field**, and **Clear override** are real controls with clear
  accessible names, visible focus, ≥44px targets, and token-only styling.
- The **migration prompt** is a `Banner`/card with icon + text (never colour-alone), its actions
  keyboard-reachable; dismiss is a real button.
- The shared **`AiNotConfigured`** notice is semantic text with a link to Settings → AI; its message
  varies by role but is always a meaningful text equivalent (no icon-only state).
- Status changes (`source` flipping after share/override) update via the existing settings re-render;
  any live region used for "AI is now available" is polite, non-intrusive.
- Responsive ~360px→desktop; no horizontal overflow at 390px (DoD guard, §10).

## 10. Testing strategy

Vault is exercised against a temp dir / in-memory host (real crypto); the Claude/OpenAI client is the
injectable fake (`SELFOS_FAKE_CLAUDE` / `SELFOS_FAKE_IMAGE`). Per CLAUDE.md DoD, E2E covers **every** new
surface plus the responsive/geometry guards.

**Unit (Vitest, node — core + the bridge factory over the mock host):**

- **`resolveAiKey` order** — device override present → `source: 'device'`; no override + shared present →
  `source: 'shared'`; neither → `source: 'none'`. Same for `resolveOpenAiKey`.
- **`writeSharedKey` / `clearSharedKey` round-trip** — write Claude key → **decrypt the vault file** and
  assert `config/ai-credentials.enc` is an AES-GCM envelope (ciphertext, _not_ the raw key) whose
  decrypted `anthropicApiKey` matches; clearing both providers **deletes the file** (no orphan
  ciphertext).
- **Corrupt/absent file** → `readAiCredentials` returns `null`, never throws; resolution falls through.
- **Owner-only write gate** — a non-owner `ai:setSharedKey` / `ai:shareDeviceKey` / `ai:clearSharedKey`
  is **rejected** (the trust boundary is the bridge, not the UI).
- **`ai:keyStatus` returns booleans only** — assert the response shape carries **no** key value, for each
  of the four `source` cases.

**Component (Vitest + RTL, via the mock bridge):**

- **Owner AI section** — shows the Share toggle + (when a device key exists and nothing's shared) the
  migration prompt; toggling Share calls `ai:shareDeviceKey` / `ai:setSharedKey`.
- **Member AI section** — shows "AI is provided by your household," the "Use my own key" override field,
  and (with an override) "Clear override"; **no** owner-only Share control is present (with an
  `AdminOnlyBadge` posture where applicable).
- **`AiNotConfigured`** — renders the correct role-aware copy for owner / member-no-key /
  member-AI-off.
- **The 11 surfaces** — each renders the shared `AiNotConfigured` in its not-ready branch and treats
  `resolvedReady` from `aiKeyStatus()` (not a key value) as readiness; the Dream-image panel uses the
  **OpenAI** status.

**E2E (Playwright + Electron) — the headline guarantee:**

- **A member with no device key inherits the shared key** — set up vault A as owner: enable AI, add a
  key, **Share with household**. Decrypt the vault to assert `config/ai-credentials.enc` exists and holds
  the key (ciphertext on disk). Then **join as a member** on the same vault with **no device key** and
  assert: `aiKeyStatus()` → `resolvedReady: true, source: 'shared'`; the Sessions/Home AI surfaces are
  available; **onboarding proceeds** (no "AI not set up" dead-end); a chat turn succeeds against the fake
  client.
- **Member override wins** — the member adds their own key; assert `source: 'device'`; clear it → falls
  back to `source: 'shared'`.
- **Owner un-shares** — toggle Share off → member with no override drops to the member "ask your owner /
  use your own key" surface; the vault file no longer holds the key (decrypt to assert).
- **The key value never crosses IPC** — assert (in the E2E and a bridge unit test) that no IPC response
  observed by the renderer contains the raw key string (search the captured payloads / the mock bridge
  call log).
- **Guards** — no-horizontal-overflow at 390px on the AI + Dreams Settings sections and the
  `AiNotConfigured` surface; control-geometry guard on the Share toggle (must not shrink in a flex row).

**Mocking:** the mock bridge returns deterministic `AiKeyStatus`; bridge unit tests drive the real
factory over `memFileSystem` + a fake `SecretStore`, the way other `coreBridge` tests do; key values are
fixtures, never network.

## 11. Open questions

To resolve in the build session (none silently assumed):

- **Owner-write capability gate** — gate the shared-key write ops on `settings.manage`, an explicit
  owner-id check, or whatever **spec 30** lands as the settings-write trust boundary? (Recommendation:
  use 30's gate; an owner check in the interim.) **Coordinate with spec 30.**
- **Does sharing the OpenAI key live in Settings → Dreams or Settings → AI?** (Recommendation: Dreams,
  beside `OpenAiKeyControl`, since that's where OpenAI lives today.)
- **Should the owner be able to share a key they _haven't_ added device-locally** (paste a fresh key
  straight into the shared field via `ai:setSharedKey`), or only promote an existing device key
  (`ai:shareDeviceKey`)? (Recommendation: support both; the migration prompt is just the promote path.)
- **Does the member's "Use my own key" need any `ai.enabled` interaction**, or is `ai.enabled` strictly
  owner-controlled (i.e. a member with an override but the owner has AI off still can't use AI)?
  (Recommendation: `ai.enabled` is the household gate; an override doesn't bypass it — **but this overlaps
  spec 30's** "who may toggle `ai.enabled`" question.)
- **`AiCredentials.sharedByPersonId` / `updatedAt`** — keep this informational metadata, or omit to keep
  the file minimal? (Recommendation: keep; useful for a future device registry / audit in spec 32.)
- **Final copy** for the Share explainer, the member "provided by your household" line, and the three
  `AiNotConfigured` variants (settled in build + visual QA).

## 12. Changelog

- 2026-06-21 — **Built (slices 1–3 backend + UI; on `feat/household-ai-credentials`).** Core
  `aiCredentialsService` (`readAiCredentials`/`writeSharedKey`/`clearSharedKey`/`resolveAiKey`/
  `resolveOpenAiKey`/`aiKeyStatus`) + `AiCredentialsSchema`/`AiKeyStatusSchema`/`AiProviderSchema`; all the
  `secrets.get(KEY_ID)` AI call sites in `coreBridge` now resolve via the resolver (device override → shared
  → none); owner-gated `ai:setSharedKey`/`ai:shareDeviceKey`/`ai:clearSharedKey` + booleans-only
  `ai:keyStatus` through the full seam; all 11 renderer readiness surfaces migrated off `secretHas` to a
  shared `aiKeyResolved()`; role-aware `SharedKeyControl` (owner Share/Stop-sharing; member "provided by
  your household" + override). `00` §4.1/§6.2 amended. Tests: 8 core + 1 coreBridge
  (owner-shares→member-inherits→member-denied) + 2 RTL + a **Playwright E2E** (owner shares via the UI →
  decrypt `config/ai-credentials.enc` [ciphertext on disk] → clear the device key → a keyless device
  resolves `source:'shared'` + Sessions has no "Connect Claude"). Gate green: typecheck, lint, format,
  **449 core + 537 desktop** unit. **E2E + visual QA require a local display** (the project's standing
  constraint — Electron E2E can't run headless; the test is written to the proven relay-test pattern, to be
  run on the user's machine). **Deferred:** the consented migration _auto-prompt_ with a device-local
  dismissal flag (the Share affordance is built); `AiNotConfigured` copy-consolidation (readiness already
  consolidated via `aiKeyResolved`). NOTE: a later change (per the owner) made the whole **AI settings
  section owner-only**, so the member device-override UI is no longer surfaced — members rely solely on the
  inherited shared key (the override bridge path still resolves if a key were set).
- 2026-06-21 — created (Draft). Owner-shared, master-key-encrypted household AI credentials
  (`config/ai-credentials.enc`) so members on a shared vault inherit a working Claude/OpenAI key;
  device-local override wins; one resolver replaces ~14 scattered `secrets.get` call sites; a
  booleans-only `ai:keyStatus` replaces 11 renderer `secretHas` readiness checks; a consented one-time
  owner migration promotes an existing device key into the vault; one shared role-aware `AiNotConfigured`
  surface. Documents the deliberate relaxation of `00` §4.1/§6.2 (key may live in the vault, encrypted,
  when shared) and the precedent (`config/relay.enc`). Out of scope: settings-write trust boundary (22),
  onboarding-offline (23), device registry/rotation/revocation (24).

## 13. Build plan / slices

Small, methodical slices (CLAUDE.md §6). Each ships green-gated with tests + visual QA.

### Slice 1 — credentials core + resolver (backend, no UI)

- `AiCredentialsSchema` + `aiCredentialsService` (`readAiCredentials` / `writeSharedKey` /
  `clearSharedKey` / `resolveAiKey` / `resolveOpenAiKey`) in `@selfos/core`.
- **Replace every `secrets.get(ANTHROPIC_API_KEY_ID)` / `OPENAI_API_KEY_ID` in `coreBridge.ts` with the
  resolver** (the §5.2 table — re-grep at build time; no AI call site reads the raw secret).
- **Unit tests:** resolution order; write/clear round-trip with a **decrypt-the-vault** assertion
  (ciphertext on disk, key inside); clear-both deletes the file; corrupt file → `null`.
- No UI; behavior-preserving for single-device users (override resolves first, exactly as today).

### Slice 2 — readiness seam + the shared `AiNotConfigured` surface

- `AiKeyStatusSchema` + `ai:keyStatus` through the full typed seam (channels → coreBridge → ipc →
  preload → mock).
- The shared **`AiNotConfigured`** role-aware component + a `useAiAvailability()` hook.
- **Migrate the 11 surfaces** (§5.3) from `secretHas(...)` to `aiKeyStatus()` + the shared component.
- **RTL tests:** the three `AiNotConfigured` variants; each surface's not-ready branch.
- **E2E:** a member with no device key but a shared key present → every surface available + **onboarding
  proceeds** (decrypt the vault to confirm the shared key; assert `source: 'shared'`); the booleans-only
  invariant (no key in any observed payload). 390px overflow guards.

### Slice 3 — owner Share + member override Settings UI + consented migration

- Owner: **Share this key with the household** toggle + the **first-run migration prompt** (Share / Not
  now, dismissal flag); `ai:shareDeviceKey` / `ai:setSharedKey` / `ai:clearSharedKey` (owner-gated in the
  bridge). Same for the OpenAI key in Settings → Dreams.
- Member: **"AI is provided by your household"** + **"Use my own key instead"** override + **"Clear
  override."**
- **RTL tests:** owner-only controls absent for a member; toggling Share writes/clears the vault file;
  the migration prompt shows once; override/clear flip `source`.
- **E2E:** owner shares → member inherits → member overrides (`source: 'device'`) → clears (`'shared'`)
  → owner un-shares → member drops to the "ask your owner" surface (decrypt-the-vault assertions at each
  step); owner-only write enforced in the bridge (a member call is rejected). Geometry guard on the Share
  toggle.
- **Visual QA** at desktop + 390px: owner vs member AI sections read intentional and cohesive; the
  migration prompt is calm, not alarming.
- **Docs in lockstep:** amend `00` §4.1/§6.2 (shared-in-vault + device-override); cross-reference 06/10/18.
