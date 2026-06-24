# 41 — Discoverability, empty states & first-run polish

> **Status:** Draft · _last updated 2026-06-23_
>
> SelfOS is cohesive and capable, but it **under-discovers its own power**: new and non-technical users land
> without a clear "what next", empty states dead-end instead of nudging, advanced affordances (the
> questionnaire gap-finder, depth invitations) are easy to miss, AI-unavailable messages point everyone at
> Settings even though most users never touch an API key, and some settings silently differ in scope
> (device-local vs synced) with no signal. This spec is a focused **UX polish pass** to make the app
> self-explaining, welcoming, and easy to follow — sleek and modern, never cluttered. It is renderer-heavy
> with little or no new backend.

Part of a five-spec group: [`37`](37-ai-robustness.md) (AI robustness), [`38`](38-questionnaire-lifecycle.md)
(questionnaire lifecycle), [`39`](39-living-memory.md) (living memory), [`40`](40-proactive-coaching.md)
(proactive coaching), and **41** (this). Consumes and refines existing surfaces — it adds no new feature
domain. References, doesn't restate: the shell/titlebar ([`02 §3`/`§13`](02-app-shell.md)), the schema-driven
settings ([`03`](03-settings.md)), the Home dashboard ([`17`](17-home-dashboard.md)), the design system +
tokens ([`01`](01-design-system.md)), household AI credentials ([`25`](25-household-ai-credentials.md)), the
AI-required policy ([`31`](31-ai-required.md)), the onboarding gate ([`18 §3.1`](18-personal-onboarding.md)),
questionnaires ([`08`](08-questionnaires.md)), memory ([`20`](20-memory-dashboard.md)), dreams
([`12`](12-dreams.md)/[`13`](13-dream-images.md)), progressive profile / depth invitations
([`29`](29-progressive-profile.md)), and capabilities/roles ([`04`](04-people-roles.md)).

---

## 1. Overview

The problem is **discoverability and orientation**, not capability. A real walk of the app surfaces five
recurring gaps:

1. **Empty states dead-end.** The Inbox "all caught up" card explains where questionnaires arrive but gives no
   path to _create_ one. Memory's empty state says "nothing here yet" but doesn't make clear that insights
   appear after sessions/dreams/questionnaires are analyzed. A dream with no image can read as "broken" rather
   than "no image yet." A minimal user on Home (one session, nothing else) sees a single narrow card and little
   "what next" guidance.
2. **Advanced features hide.** The questionnaire **gap-finder** (Home `SuggestionsCard` + the builder's
   Suggested panel) and **depth invitations** (`29`, Home `DepthInvitationCard`) are genuinely useful but easy
   to miss; nothing gently points to them on first encounter.
3. **AI-unavailable messaging is wrong for members.** Every "Turn on AI in Settings" / "connect Claude" calm
   state (e.g. `SuggestedSessions`, `SuggestionsCard`, Memory refresh, `DreamImagePanel`) tells **everyone** to
   go to Settings. But the household **owner** sets up the Claude key once and shares it household-wide
   ([`25`](25-household-ai-credentials.md), auto-share is the default), so a **member** can't and shouldn't
   touch a key — they should be told to **ask the household owner**.
4. **Settings scope is invisible.** Each setting is device-local **or** vault-synced (the `scope` field already
   exists, [`03 §4.1`](03-settings.md)). A user syncing two devices may expect Appearance to sync (it's
   device-local) or expect a vault setting to be private to one device. There is no signal which is which.
5. **No lightweight orientation.** The vault-setup welcome ([`02 §3.2`](02-app-shell.md)) is one line and the
   onboarding gate ([`18 §3.1`](18-personal-onboarding.md)) is a focused intake; between them there is no brief,
   warm "what is SelfOS, and how does it work?" that frames it as a wellness companion that learns about you
   (and is **not medical**) without re-adding a wall of forms.

This spec makes the app **self-explaining**: every primary surface's empty state nudges the obvious next
action; advanced affordances become discoverable without a heavy tour; AI-unavailable copy is **role-aware**; a
quiet **device-vs-synced** signal sits on each setting; and a brief, dismissible orientation greets first-time
users. All of it must obey the SelfOS UI/UX bar (CLAUDE.md §12): fully responsive ~360px→desktop, no horizontal
scrollbars, admin-only markers where relevant, designed as part of the whole (sleek, intentional, never
bolted-on), accessible throughout, and **never** implying an owner/admin can see a user's data.

## 2. Goals / Non-goals

**Goals**

- **Actionable empty states.** Every primary surface's empty state nudges the obvious next action (Inbox →
  "create a questionnaire" when the person can; Memory → "insights appear after a few sessions are analyzed";
  Dreams-no-image → a clear, calm "no image yet" hint; Home-minimal → gentle discovery prompts), coherent and
  on-brand.
- **Feature discovery without clutter.** Make the gap-finder, depth invitations, and similar advanced
  affordances discoverable via empty-state copy and a **subtle, dismissible, one-time hint** — never a heavy
  multi-step tour.
- **Role-aware AI-unavailable messaging.** One consistent, role-aware treatment across **every** AI surface:
  the **owner** sees a setup path (link to Settings → AI); a **member** sees "ask the household owner to set up
  AI." No API-key wizard is built (explicit user decision, §11).
- **Settings scope clarity.** A quiet "Device only" vs "Synced across devices" signal per setting, driven by
  the existing `scope` field, so users aren't surprised.
- **A brief first-run orientation.** A short, warm "what is SelfOS" card/panel (wellness companion that learns
  about you — **not medical**), dismissible, coordinated with the existing vault-setup welcome and onboarding
  gate so nothing is asked twice.
- **Responsive + accessible + on-brand.** Reuse existing primitives; reflow to ~360px; verify the titlebar
  control cluster fits at 360px; no horizontal scrollbars; a11y per `01 §9`.

**Non-goals**

- **No guided AI-key setup wizard** (explicit user decision, §11). The owner sets the key once and shares it;
  members never see a key prompt.
- **No heavy product tour / coach marks overlay.** Discovery is empty-state copy + at most a subtle one-time
  tip; a multi-step spotlight tour is out of scope (and would fight the calm aesthetic).
- **No new feature domain or new analytics.** This polishes existing surfaces; it produces no new vault content
  and adds no metrics.
- **No re-architecture of the shell, settings, or onboarding.** This rides the existing registry/stores/IPC.
- **No nav redesign.** At most, tooltip/label affordances for clarity (§11 decides whether even those ship);
  the icon-rail/drawer structure of `02 §3.4` is unchanged.
- **No telemetry to choose which features to surface.** Discovery decisions are static/heuristic, not data-driven
  (no analytics backend — `00-architecture.md`).

## 3. UX & flows

> Which of the following ship in v1, and the exact discovery mechanism / copy / signal styling, are **open**
> (§11). This section describes the intended experiences so the open questions are concrete.

### 3.1 Actionable empty states (every primary surface)

Each primary surface's empty state becomes a **calm, single-next-action nudge** instead of a dead-end. The
pattern is consistent: an icon, a one-line plain explanation of _when content appears here_, and (where the
person has the capability) **one** primary action. Per-surface:

- **Inbox** (`routes/inbox/Inbox.tsx`) — keeps "Nothing to answer right now…" and, **when the active person can
  create questionnaires** (`questionnaires.create`), adds a single action: **"Create a questionnaire →"** to
  `/questionnaires`. A person without `questionnaires.create` sees the explanation only (no dead button).
- **Memory** (`routes/memory/Memory.tsx`) — the empty card already explains insights appear from
  sessions/dreams/questionnaires; tighten the copy so the **when** is unmistakable ("Insights appear here after
  your sessions, dreams, and questionnaires are analyzed — start a session to begin"), and offer a single
  **"Start a session →"** action (`sessions.own`-gated). Never implies anyone else can read these insights.
- **Dreams — no image** (`routes/dreams/DreamImagePanel.tsx`) — when a dream has no image and image generation
  is available to the person, the panel's entry state already invites "Visualize this dream"; ensure the
  **absence of an image never reads as an error** — a calm "No image yet" affordance, visually distinct from
  the refusal/error states (§7). (When the person lacks `dreams.generateImage`, the panel stays hidden, as
  today.)
- **Home — minimal** (`routes/home/GettingStarted.tsx`) — the getting-started card already shows 2–3 primary
  actions for a brand-new person. Extend it to nudge **discovery** a touch harder for a near-empty person (e.g.
  one session, nothing else): a short "Here's what you can explore" line pointing at the under-discovered
  affordances (a guided session, logging a dream, sending a questionnaire if they can), **without** turning into
  a wall of buttons. The card still self-replaces with real cards as data appears (`17 §3.2`).
- **Other surfaces with empty states** (Dreams journal, Sessions launcher, People, Questionnaires list) — audit
  each for the same "explain + one next action" shape; fix any dead-ends found, keeping each calm and capability-
  gated. (The exact set that ships in v1 is §11.)

### 3.2 Feature discovery (no clutter)

Two mechanisms, both subtle:

1. **Better empty-state copy** (§3.1) is the primary discovery vehicle — it names the advanced affordance at the
   moment a person is most receptive (the empty surface that the affordance fills).
2. **A subtle, one-time, dismissible tip** on a small number of high-value, easy-to-miss affordances — e.g. the
   gap-finder ("Let the coach suggest a questionnaire worth sending") and depth invitations ("SelfOS can invite
   you to go deeper over time"). A tip is a quiet inline hint (not a modal, not an overlay), shown **once**,
   dismissible, and **never re-shown** after dismissal or after the person has used the affordance. Whether tips
   ship, and which affordances get one, is §11.

Dismissal/seen state is **device-local + per-person** (so a tip doesn't sync across devices or nag after a
person switch), persisted via the existing device-state mechanism that notifications already use (`35`
precedent). No new vault content.

### 3.3 Role-aware AI-unavailable messaging

A single, consistent, role-aware treatment replaces today's "Turn on AI in Settings" everywhere AI is
unavailable (no resolved key / AI off / offline) — `SuggestedSessions`, `SuggestionsCard`, Memory refresh, the
questionnaire AI panels, `DreamImagePanel`, the onboarding interviewer's calm states, and any other AI surface:

- **Owner** (`isOwner()` / `settings.manage`) — sees a setup path: a short line + a link to **Settings → AI**
  (e.g. "AI isn't set up yet. Set up Claude in Settings → AI."). This is the only setup affordance; there is no
  separate key wizard.
- **Member** (no `settings.manage`) — sees an **ask-the-owner** line (e.g. "AI isn't set up yet — ask the
  person who set up this household to turn it on." — final copy §11). **No** Settings link, **no** key prompt.
  Wording never implies the member can or should obtain a key.
- **Offline** (key present but no connectivity) — a distinct, calm "You appear to be offline — SelfOS needs a
  connection for this." for **both** roles (no setup implication, per the AI-required policy `31`). Owner copy
  may still link Settings; member copy does not.

To keep this DRY and consistent, the role-aware copy is centralized in **one small helper/component** (a single
source of truth) that every AI surface uses, rather than each surface hand-rolling its own string. It reads
availability from the existing `aiAvailability` module (resolved readiness) and the role from `sessionStore`
(`isOwner()` / `can('settings.manage')`).

### 3.4 Settings scope clarity (device vs synced)

Every setting in the Settings screen carries a quiet signal of its `scope` so users aren't surprised that
Appearance is per-device while AI/feature settings sync. Driven entirely by the existing
`SettingDefinition.scope` (`'vault' | 'device'`, default `'vault'` = synced — [`03 §4.1`](03-settings.md)):

- A small, non-loud indicator per setting (or per section group): **"Synced across devices"** for `scope:'vault'`
  and **"This device only"** for `scope:'device'`. Whether it's a badge, a tooltip on an info glyph, or a
  section-level grouping/caption is **open** (§11). It must read as a calm hint, not visual noise.
- It is **purely informational** — it changes no behavior. It must not be confused with the existing
  **"Admin only"** marker (CLAUDE.md §12); both can appear on the same setting (e.g. an admin-only vault setting
  is "Admin only" + "Synced across devices"), so the two markers must be visually distinguishable and not collide
  on one line at any width.
- Secrets (`type:'secret'`, device scope) read as "This device only," consistent with the rest. This is honest
  and useful: a member's own-device key override is device-local.

### 3.5 First-run welcome / orientation

A brief, warm "what is SelfOS" orientation — a **wellness companion that learns about you, with everything
stored as files you own, and it is not medical** — shown once to a first-time user, dismissible, and coordinated
with the two existing first-run touch-points so nothing is asked or stated twice:

- **Vault-setup welcome** (`02 §3.2`) — already a single line; this orientation either replaces/expands that
  one screen or sits just after it.
- **Onboarding gate** (`18 §3.1`) — a Member is taken over by onboarding on first login; the orientation must
  not duplicate the onboarding intro and must not block or precede the gate inappropriately.

**Where** the orientation lives (a step in vault setup, a dismissible Home card for the first session, or a
small "About SelfOS / How this works" panel reachable from the account menu) and **whether it's dismissible /
re-openable** are **open** (§11). Whatever the placement: it is brief (a few sentences + the not-medical line),
calm, on-brand, never a wall of forms, and never implies an owner/admin can read a person's content.

### 3.6 Nav clarity & 360px geometry (optional / verification)

- **Optional** nav affordances: tooltips on the collapsed icon rail already exist (`title`/`aria-label`,
  `02 §3.4`); a small enhancement would be tooltips/labels for first-time clarity even when expanded, or
  showing labels for the first few runs. Whether to add anything here is **open** (§11) — the default is to do
  nothing beyond what exists if the audit shows the icons read clearly.
- **Verification (required):** confirm the titlebar control cluster (notification bell + usage ring +
  appearance + account, per `02 §13.3` + `35`) fits at **360px** with **no horizontal overflow** and the
  documented collapse order (sync chip + brand wordmark collapse first). This is a documented concern in
  `02 §13.5`; this spec re-asserts it as a guard given the bell was added after that amendment (memory:
  notification-system phone-width fix). If it overflows at 360px, fix the collapse, not by wrapping (CLAUDE.md
  §12).

## 4. Data model (vault files & schemas)

**No new vault files and no schema changes.** This spec is read/compose + small device-local UI state:

- **Tip/orientation seen-and-dismissed state** — **device-local + per-person**, stored as small
  signatures/flags via the existing device-state channel pattern (the same mechanism notifications use for
  read/dismissed state, `35`; e.g. a `discoveryDismissals` blob keyed by the active person in the bridge — the
  trust boundary). **Not** synced, **not** in the vault. The exact key shape is an implementation detail; if a
  new device-state field is added it is additive-optional (no migration), per the established precedent
  (`DeviceStateSchema` additive fields).
- **Settings `scope`** — already declared on every `SettingDefinition` ([`03 §4.1`](03-settings.md)); the
  device-vs-synced signal is **derived** from it. No change to settings persistence.
- **No Markdown/JSON content** is produced by this feature.

All reads/writes that touch device state go through the existing device-state IPC (no direct `fs`).

## 5. Architecture & modules

Renderer-heavy; reuses the existing design system, stores, and IPC.

- **Empty-state copy/actions** — edits to the existing route components (`Inbox`, `Memory`, `DreamImagePanel`,
  `GettingStarted`, and any others §11 selects). Capability gating uses the existing `sessionStore.can(...)`.
  No new components beyond small presentational helpers if shared.
- **Role-aware AI-unavailable** — **one shared helper/component** (e.g. `AiUnavailableNotice` or a
  `useAiUnavailableMessage()` hook) in `renderer/src/app/` next to `aiAvailability.ts`, the single source of
  truth for the owner/member/offline copy. Every AI surface imports it instead of hand-rolling a string. Reads
  `aiKeyResolved()` + `ai.enabled` + `sessionStore.isOwner()`/`can('settings.manage')`. If it renders, it's a
  small presentational component (Text + optional link); it carries no new IPC.
- **Settings scope signal** — extend the settings UI generator (`SettingField` / `SettingsScreen`,
  [`03 §5.3`](03-settings.md)) to render the scope indicator from `definition.scope`. The shape (badge/tooltip/
  caption) is §11. If a new design-system primitive is needed (e.g. a quiet "ScopeBadge"), it goes to
  `/gallery` (DoD §12); the preference is to reuse existing primitives or extend `AdminOnlyBadge`'s pattern so
  the two markers are visually consistent yet distinct.
- **One-time tips** — a small reusable inline "tip" presentational component (calm, dismissible, `aria`-correct)
  if §11 approves tips; backed by the device-local per-person dismissal state. Added to `/gallery` if it's a new
  primitive.
- **First-run orientation** — a small component placed per the §11 decision (a vault-setup step, a Home card,
  or an account-menu panel). Reuses `Card`/`Stack`/`Text`/`Heading` and the not-medical line component already
  used on wellbeing surfaces.
- **Shared extraction** — none expected to leave `apps/desktop`; the AI-unavailable copy is renderer-only. If
  the relay/iOS web hosts need the same role-aware copy later, the helper can move to a shared package, but
  that's out of scope here.

No new nav entries or routes. No main-process services beyond reusing the device-state read/write.

## 6. IPC / API contracts

- **No new IPC channels expected.** This composes existing channels: device-state read/write (for tip/orientation
  dismissal, the `35` pattern), `settings:getAll` (already returns scope-resolved values; the scope itself comes
  from the registered definitions in the renderer, not over IPC), `aiKeyStatus` (resolved readiness, via
  `aiAvailability`), and the existing capability/session selectors.
- **No Claude API usage** is added by this spec. It only changes how _unavailability_ is communicated; the
  actual AI calls live in the surfaces this spec touches (sessions, memory, dreams, questionnaires) and are
  unchanged. The key stays in main; the renderer never sees it (`25`).
- If §11 chooses a device-state field for dismissals that warrants a dedicated typed channel rather than riding
  the notifications/device-state blob, it is added through the full typed seam (channels → coreBridge → ipc →
  preload → test mock), gated to the active person in the bridge (the trust boundary). Default: reuse the
  existing device-state mechanism, no new channel.

## 7. States & edge cases

- **Loading** — empty-state nudges render only after the relevant store reports `loaded` (the existing
  `loaded` flags on Inbox/Memory/etc.), so a nudge never flashes before data arrives, and an empty grid never
  flickers (the `ready`-gate precedent, `17 §13`).
- **Empty** — the core of this spec: each empty surface explains _when_ content appears and offers one
  capability-gated next action. No dead buttons for people who lack the capability.
- **Error vs empty (dreams)** — a dream with **no image** must be visually distinct from an image **error/
  refusal** (`DreamImagePanel` already has REFUSED/ERROR/BUDGET states); "no image yet" is calm/neutral, the
  error states are clearly distinguishable. Never render a broken-image affordance for the absence case.
- **AI unavailable** — owner vs member vs offline copy (§3.3), driven by resolved readiness + role. If role
  resolution is momentarily unknown (e.g. mid person-switch), default to the **safer member** copy (no
  Settings link, no key implication) until role resolves.
- **Partial** — a near-empty (not brand-new) person sees real cards plus the gentle discovery nudge (§3.1
  Home), not the full getting-started card; the two states transition cleanly as data appears.
- **Offline (no Claude)** — calm offline copy (§3.3); deterministic surfaces (Inbox, settings, the scope
  signal, the orientation) all still render. No surface that can't function offline pretends it can (`31`).
- **Large data** — N/A for new content (this adds none); the empty-state changes only affect the empty branch.
- **Concurrent edits / sync conflicts** — N/A for new persisted content (the only persistence is device-local
  dismissal state, which doesn't sync, so it can't conflict). Settings sync conflicts are handled by `03 §7`
  unchanged; the scope signal is derived and stateless.
- **Corrupt/missing dismissal state** — a missing/invalid dismissal blob is treated as "nothing dismissed"
  (tips/orientation may show again), failing **open to showing** the (harmless) hint rather than crashing; it
  never blocks a surface.
- **Migration** — none (no schema change). Any new device-state field is additive-optional.
- **Repeat visitors** — a dismissed tip/orientation never re-shows (per-person, per-device); using the
  affordance also suppresses its tip.
- **Capability change** — if a person gains/loses `questionnaires.create`/`sessions.own`/etc., the empty-state
  action appears/disappears live (it reads the reactive `can(...)` selector), like every gated control.
- **360px** — the titlebar cluster and every touched surface fit with no horizontal overflow (§3.6 verification;
  CLAUDE.md §7/§12).

## 8. Safety

This touches wellbeing surfaces (Home, Memory, Dreams) and the first-run orientation, so the SelfOS safety
boundary applies:

- **Not-medical line.** The first-run orientation explicitly states SelfOS is a **wellness/self-help** tool,
  **not medical**, not a diagnosis or treatment, and not a substitute for professional care (CLAUDE.md §1). The
  not-medical line stays present on the wellbeing surfaces it already appears on (`17 §7`, `05 §7`); this spec
  does not remove it anywhere.
- **Crisis routing.** This spec adds no conversational surface and changes no crisis logic; the always-present
  `CrisisFooter` on wellbeing surfaces is untouched. Empty-state and orientation copy is calm and supportive and
  never minimizes distress.
- **Never imply surveillance.** No copy — in any empty state, tip, orientation, or AI-unavailable message — may
  state or imply that a household owner/admin can see a person's answers, insights, dreams, or sessions (durable
  rule, CLAUDE.md §1). The member-facing AI-unavailable copy says "ask the owner to **set up AI**," never
  anything about the owner accessing the member's content. Memory's empty/orientation copy frames insights as
  **the person's own** view.
- **Sensitive content.** Dreams/Memory may hold sensitive material; the empty-state and scope-signal changes
  never surface any content (they operate on the empty/structural branches and on setting metadata), so no new
  exposure path is created.

## 9. Accessibility

Per [`01 §9`](01-design-system.md):

- Every empty-state action is a **real, keyboard-operable** button/link with a clear accessible name and visible
  focus; icons in actions are `aria-hidden` with text labels.
- The role-aware AI-unavailable notice uses appropriate semantics (a `role="status"` for a calm informational
  line where it announces a state change; a real link for the owner's Settings path) and never relies on color
  alone to distinguish owner/member/offline.
- The settings **scope signal** must convey meaning in **text**, not color/icon alone (a tooltip must be
  keyboard-reachable and screen-reader-exposed; a badge carries text). It must be distinguishable from the
  "Admin only" marker by screen readers (distinct accessible names), and the two must not visually collide or
  cause overflow at any width.
- One-time **tips** are dismissible by keyboard, have an accessible dismiss control, and don't trap focus (they
  are inline hints, not modals).
- The **first-run orientation** has a logical heading, is dismissible by keyboard/Esc where it's an overlayable
  card, and moves focus sensibly (does not steal focus disruptively).
- **Reduced motion** respected for any tip/orientation entrance.
- Responsive ~360px→desktop; no horizontal scrollbars anywhere; tap targets ≥44px at mobile width.

## 10. Testing strategy

Vault + Claude mocked as established; `pnpm typecheck` after writing tests (memory:
`vitest-does-not-typecheck`). Drive complete flows through the rendered UI, not bridge calls (CLAUDE.md §7).

- **Component (Vitest + RTL):**
  - Inbox empty state shows "Create a questionnaire" for a person **with** `questionnaires.create` and **omits**
    it (no dead button) for one without.
  - Memory empty state shows the "insights appear after analysis" copy + the `sessions.own`-gated action.
  - `DreamImagePanel` renders the **no-image** entry state distinctly from REFUSED/ERROR (assert different copy/
    affordances).
  - Home `GettingStarted` shows the discovery nudge for a near-empty person and the actions are capability-gated.
  - **Role-aware AI-unavailable** helper: owner → Settings-link copy; member → ask-the-owner copy (no link, no
    key wording); offline → offline copy for both. A snapshot/assertion that **no AI surface** shows the
    owner-only setup link to a member (drive each surface with AI unavailable in both roles).
  - Settings scope signal: a `scope:'device'` setting shows "This device only"; a `scope:'vault'` setting shows
    "Synced across devices"; an admin-only vault setting shows **both** markers without overlap; the scope text
    is screen-reader-exposed.
  - One-time tip (if shipped): shows once, hides after dismiss, doesn't re-show on remount; dismissal is
    per-person (a different active person sees it un-dismissed).
  - First-run orientation: shows for a first-time user, dismissible, doesn't re-show after dismissal.
- **E2E (Playwright):**
  - A new member with `questionnaires.create` lands → Inbox empty → clicks "Create a questionnaire" → reaches
    the builder.
  - A **member** with AI unavailable sees the ask-the-owner copy on a real AI surface (e.g. the Sessions
    launcher) and **no** Settings link; the **owner** sees the Settings link → reaches Settings → AI (the
    common real "not-set-up" state, per the §7 DoD "test the prerequisite-absent path").
  - Settings screen shows the device-vs-synced signal on at least one device-scoped and one vault-scoped
    setting.
  - First-run orientation appears, is dismissed, and does not reappear on relaunch.
  - **360px guards:** the titlebar control cluster (incl. the notification bell) has no horizontal overflow at
    360px (assert no element with `overflow-x:auto|scroll` has `scrollWidth > clientWidth`); every touched
    surface (Inbox/Memory/Dreams/Home/Settings) renders to the bottom with no inner scrollbar at 360px.
  - Visual-QA every touched surface at desktop + 360px (light + dark): empty states, the AI-unavailable notice
    in both roles, the scope signal beside the admin marker, the orientation — alignment, spacing, nothing
    clipped, intentional and cohesive (DoD §7).

## 11. Open questions

Genuinely-open product/UX decisions — **do not assume**:

1. **Which empty states / nudges ship in v1?** Inbox + Memory + Dreams-no-image + Home-minimal are the proposed
   core (§3.1). Should the audit also cover Dreams journal, Sessions launcher, People, and Questionnaires list
   in v1, or are those a follow-up?
2. **Discovery mechanism.** Empty-state copy is in regardless. Do we also ship **one-time dismissible tips**
   (§3.2)? If yes, on which affordances (gap-finder, depth invitations, others?), and is the tip a quiet inline
   hint only (preferred — no overlay)?
3. **Role-aware AI-unavailable copy.** Confirm the exact member wording — proposed: "AI isn't set up yet — ask
   the person who set up this household to turn it on." Does it ever name the owner, or stay generic
   ("the household owner")? Confirm the owner and offline copy too. (The mechanism — role-aware, owner-only
   setup path, no key wizard — is decided.)
4. **Settings device-vs-synced signal styling.** A small **badge** per setting, a **tooltip** on an info glyph,
   or a **section-level grouping/caption**? It must read as a calm hint and not collide with the "Admin only"
   marker (§3.4).
5. **First-run orientation — placement & re-openability.** Where does it live: a step in vault setup, a
   dismissible Home card for the first session, or an "About SelfOS / How this works" panel from the account
   menu? Is it dismissible-only, or also re-openable later (e.g. from the account menu / About)?
6. **Nav tooltips/labels.** Add anything beyond the existing collapsed-rail tooltips (e.g. expanded-state
   tooltips, or labels for the first few runs), or leave nav as-is if the icon audit shows it reads clearly
   (§3.6)? Default: leave as-is unless the audit finds a problem.
7. **Tip/orientation dismissal granularity.** Per-person + per-device is proposed (§3.2/§4). Confirm that's
   right (vs household-wide, which would let one person's dismissal hide a tip from everyone — not preferred).

## 12. Changelog

- 2026-06-23 — created (Draft). Part of the five-spec group (37–41); spec 41 = discoverability, empty states,
  role-aware AI-unavailable messaging, settings device-vs-synced signal, and a brief first-run orientation.
  Grounded in the live Home/Inbox/Memory/Dreams/Settings/AppShell surfaces and specs 02/03/17/18/25/29/31/35.
  Decided up front (per the user): **no guided AI-key setup wizard** — the owner sets the key once and shares it
  (`25`), so members see "ask the owner," not a key prompt. Open product/UX decisions captured in §11.

## 13. Suggested slicing

Renderer-heavy; ship in small, independently-valuable slices, each through the full DoD (typecheck/lint/format,
unit + RTL, E2E for touched surfaces incl. 360px guards, visual QA, code-review, docs in lockstep):

1. **Slice 1 — Role-aware AI-unavailable messaging (the highest-value fix).** One shared helper/component
   (single source of truth) + swap every AI surface onto it (owner → Settings link, member → ask-the-owner,
   offline → offline copy). RTL for all three roles across the surfaces + an E2E proving a member never sees the
   owner-only setup link (prerequisite-absent path). Pure copy/role logic; no new persistence.
2. **Slice 2 — Actionable empty states.** Inbox → create-a-questionnaire, Memory → "insights appear after
   analysis" + start-a-session, Dreams no-image-vs-error distinction, Home near-empty discovery nudge. Each
   capability-gated; RTL + E2E + visual QA.
3. **Slice 3 — Settings device-vs-synced signal.** Extend the settings UI generator to render the scope
   indicator from `definition.scope` (styling per §11), distinct from the Admin-only marker; `/gallery` if a new
   primitive; RTL (both scopes + the both-markers case) + E2E + a11y.
4. **Slice 4 — First-run orientation** (placement per §11) + **optional one-time tips** for the gap-finder /
   depth invitations (if §11 approves). Device-local per-person dismissal (the `35` pattern); shows-once /
   never-re-shows tests; E2E (appears → dismiss → relaunch → gone).
5. **Slice 5 — 360px geometry verification & nav clarity (optional).** Re-assert the titlebar cluster (incl.
   the bell) fits at 360px with a guard; add nav tooltip/label affordances only if §6/the audit warrants
   (default: none beyond existing).
