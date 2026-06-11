# 01 — Design system

> **Status:** Approved · _last updated 2026-06-09_
>
> The calm-and-warm visual foundation for SelfOS: design tokens (color, type, space, radius,
> elevation, motion), light/dark theming, the accessibility bar, and the primitive component
> inventory every feature builds from. The aesthetic is **low-stimulation, warm, and reassuring** —
> appropriate for a wellness app — and **fully token-driven** so themes, accent, density, and text
> size are swappable and user-configurable.

Foundational spec — adapts the template: §3 is developer-facing usage, §6 is N/A (renderer-only), and
§9 (accessibility) is the canonical source other specs reference.

---

## 1. Overview

A small, consistent set of **design tokens** (CSS custom properties) is the single source of truth
for every visual value. Components never hard-code colors, spacing, or fonts — they consume semantic
tokens, so re-theming (light/dark, accent, density, larger text, higher contrast) is a token change,
not a component change. This is what makes the look both **calm by default** and **configurable**.

Confirmed direction: warm-paper light theme, warm-charcoal dark theme, **dusty-blue accent**,
**Mulish** for the interface and **Lora** for long-form reading.

## 2. Goals / Non-goals

**Goals**

- A 3-tier token system (primitive → semantic → component) driving all visuals.
- Light + dark themes via `data-theme`, defaulting to the OS preference; instant switching.
- A reusable, accessible **primitive component** library.
- Built-in **configurability**: theme, accent (future), density, text-size scale, reduced-motion,
  high-contrast — all wired to user settings.
- A documented **accessibility** bar (the canonical reference for the whole app).

**Non-goals**

- No heavy UI framework (MUI/Chakra). We build lightweight primitives on tokens + CSS Modules.
- No per-feature bespoke styling outside the token system.
- RTL/i18n layout is designed-for but not implemented in v1 (tokens are direction-agnostic).

## 3. Usage (developer-facing)

- Components import tokens via CSS custom properties in their `*.module.css`
  (e.g. `color: var(--color-text-primary); padding: var(--space-4);`). **Never** raw hex or px for
  themed values.
- Typography and layout are expressed through primitives (`Text`, `Heading`, `Stack`, `Inline`) and
  tokens, not ad-hoc styles.
- The design system lives at `apps/desktop/src/renderer/design-system/` and is a candidate to extract
  to `packages/@selfos/design-system` once a second consumer appears.

## 4. Design-related settings (link to the settings system)

These are **user settings** persisted via [`03-settings.md`](03-settings.md) and applied by the theme
layer; the design system only defines the tokens they switch between:

| Setting       | Values                          | Effect                                    |
| ------------- | ------------------------------- | ----------------------------------------- |
| Appearance    | System · Light · Dark           | Sets `data-theme` (System follows the OS) |
| Accent        | Dusty blue (default) · …        | Swaps the accent token ramp               |
| Density       | Comfortable (default) · Compact | Scales the spacing/control-size tokens    |
| Text size     | 0.9× – 1.3× (default 1×)        | Scales the root type scale                |
| Reduce motion | Off (follows OS) · On           | Disables non-essential animation          |
| High contrast | Off · On                        | Swaps to a higher-contrast token set      |

## 5. Architecture & modules

### 5.1 Token tiers

1. **Primitive tokens** — raw scales (the full color ramps, the type scale, the space scale). Not
   used directly by components.
2. **Semantic tokens** — role-based aliases components actually use: `--color-bg`, `--color-surface`,
   `--color-text-primary`, `--color-accent`, `--color-border`, `--color-danger`, etc. These are
   re-pointed per theme.
3. **Component tokens** — optional, for a component with internal variants
   (e.g. `--button-primary-bg`), defined in terms of semantic tokens.

### 5.2 Theming mechanics

- Tokens are declared on `:root` (primitives + light semantics) and overridden under
  `[data-theme='dark']`. `[data-theme='system']` resolves to light/dark from `prefers-color-scheme`.
- A `themeStore` (Zustand) + a tiny script set `data-theme` on `<html>` **before paint** (no flash).
- Density / text-size apply via root-level modifier attributes or a CSS var multiplier
  (`--space-scale`, `--type-scale`). High contrast swaps a semantic-token override block.

### 5.3 Color tokens

Warm neutrals + a **dusty-blue** accent. Interactive accent solids use a deeper stop so text meets
contrast (see §9). All values are tuned; exact ramp stops may be fine-tuned during build.

**Neutrals**

| Semantic role            | Light     | Dark      |
| ------------------------ | --------- | --------- |
| `--color-bg`             | `#F6F1EA` | `#1C1A17` |
| `--color-surface`        | `#FFFFFF` | `#26231F` |
| `--color-surface-alt`    | `#FBF7F1` | `#2F2B26` |
| `--color-border`         | `#E7DFD3` | `#38332C` |
| `--color-border-strong`  | `#D7CDBC` | `#4A4339` |
| `--color-text-primary`   | `#2E2A25` | `#ECE5DB` |
| `--color-text-secondary` | `#6E665C` | `#A79E92` |
| `--color-text-tertiary`  | `#948B7E` | `#7C7468` |

**Dusty-blue accent ramp** (primitive `--blue-50…900`), with semantic mappings:

| Token                       | Light value          | Dark value           |
| --------------------------- | -------------------- | -------------------- |
| `--color-accent`            | `#6E8FA6` (blue-500) | `#94B2C6` (blue-300) |
| `--color-accent-solid`      | `#4F7388` (blue-600) | `#94B2C6`            |
| `--color-accent-solid-text` | `#FFFFFF`            | `#1C1A17`            |
| `--color-accent-text`       | `#3E5F73` (blue-700) | `#AFC7D6`            |
| `--color-accent-subtle-bg`  | `#ECF1F5` (blue-50)  | `#2A3742`            |
| `--color-focus-ring`        | `#6E8FA6` @ 45%      | `#94B2C6` @ 50%      |

**Feedback** (muted to fit the calm palette): `--color-success` `#5E8C6A`/`#8FB89A`, `--color-warning`
`#C28A3E`/`#E0B36B`, `--color-danger` `#C25B4E`/`#E08C7F`, `--color-info` = accent. Each has a
`-subtle-bg` and `-text` variant meeting contrast.

**Chart series** — a 4-color series palette (`--color-chart-1…4`), themed light/dark, drawn from the
accent + feedback hues so multi-series charts (`LineChart`) stay cohesive with the calm palette.

### 5.4 Typography

- **Mulish** — UI & body (weights 400/500/600). **Lora** — long-form reading (journal entries,
  reflections; 400 + italic). **Mono** — system mono stack for code/values. Fonts are **bundled
  locally** (self-hosted woff2 via the build, e.g. `@fontsource`) — no CDN, works offline, private.
- Type scale (rem, root 16px; scaled by `--type-scale`):

| Token         | Size / line-height | Use                          |
| ------------- | ------------------ | ---------------------------- |
| `--text-xs`   | 12 / 1.5           | meta, captions               |
| `--text-sm`   | 13 / 1.5           | secondary UI text            |
| `--text-base` | 15 / 1.6           | body / UI default            |
| `--text-md`   | 17 / 1.5           | emphasized body, card titles |
| `--text-lg`   | 20 / 1.4           | section headings             |
| `--text-xl`   | 24 / 1.3           | page titles                  |
| `--text-2xl`  | 30 / 1.25          | hero / welcome               |
| `--text-read` | 17 / 1.7 (Lora)    | long-form reading            |

### 5.5 Spacing, radius, elevation, motion

- **Space** (4px base): `--space-1`=4 … `2`=8, `3`=12, `4`=16, `5`=20, `6`=24, `8`=32, `10`=40,
  `12`=48, `16`=64. Density `Compact` multiplies by ~0.85.
- **Radius**: `--radius-sm` 6, `--radius-md` 8, `--radius-lg` 12, `--radius-xl` 16, `--radius-pill` 999. Cards use `lg`.
- **Elevation**: deliberately flat/calm. Prefer borders + `--color-surface-alt`. Two soft shadow
  tokens only: `--shadow-sm` (popovers), `--shadow-md` (modals). No glows/gradients.
- **Motion**: durations `--motion-fast` 120ms, `--motion-base` 200ms, `--motion-slow` 320ms; easing
  `--ease-standard` `cubic-bezier(0.2,0,0,1)`. **All motion is gated by `prefers-reduced-motion` and
  the Reduce-motion setting.**
- **Breakpoints** (`--bp-sm` 480, `--bp-md` 768, `--bp-lg` 1024, `--bp-xl` 1280): the canonical
  responsive stops, declared in `tokens.css`. SelfOS is **one responsive codebase** (mobile-first,
  ~360px→desktop — a standing requirement, like accessibility). The sidebar becomes an off-canvas
  drawer below `--bp-md`; two-pane screens (Sessions, People) collapse to a master–detail. Because
  CSS custom properties can't be used inside `@media`, use these exact pixel values as literals in
  media queries (and read the tokens from JS when needed). Tap targets are ≥44px on touch widths.

### 5.6 Primitive components (inventory)

Built on tokens + CSS Modules, each accessible by default. APIs are specced per-component when built;
this is the v1 inventory:

- **Layout:** `Stack`, `Inline`, `Box`, `Divider`, `Spacer`.
- **Typography:** `Heading`, `Text`, `Prose` (Lora long-form).
- **Forms:** `Button` (primary/secondary/ghost/danger), `IconButton`, `TextInput`, `Textarea`,
  `Select`, `Checkbox`, `Radio`, `Switch`, `Slider`, `Field` (label/help/error wrapper).
- **Surfaces:** `Card`, `Panel`, `Modal`/`Dialog`, `Popover`, `Tooltip`, `Toast`.
- **Navigation:** `Tabs`, `Menu`, `SidebarItem`, `Breadcrumb`.
- **Feedback / status:** `Badge`, `AdminOnlyBadge` (the "Admin only" lock pill — marks any
  control/section only admins can see; CLAUDE.md §12), `Avatar`, `Spinner`, `Skeleton`, `EmptyState`,
  `Banner`.
- **Data viz:** `LineChart` — a minimal multi-series line chart (token-driven `--color-chart-*`,
  theme-aware, `role="img"` + a labelled `<title>` + a legend); powers questionnaire trends and any small
  time-series.
- **Icons:** **`lucide-react`** — a single outline icon set (calm, consistent, tree-shakeable).

## 6. IPC / API contracts

N/A — the design system is renderer-only. The values it switches between are driven by user settings
(§4), which travel via the settings system's IPC (see [`03-settings.md`](03-settings.md)).

## 7. States & edge cases

- **OS theme change** while `Appearance = System` → live update, no flash.
- **Font not yet loaded** → fall back to the system humanist stack; swap in Mulish/Lora when ready
  (`font-display: swap`); no layout shift beyond glyph metrics.
- **Reduced motion** (OS or setting) → animations become instant/opacity-only.
- **High contrast on** → semantic tokens swap to a higher-contrast set; never rely on color alone.
- **Large text (1.3×)** → layouts reflow without clipping; nothing pinned to fixed px heights.
- **Long/loc strings & RTL** → components don't assume text length; spacing is logical-property based
  so RTL can be enabled later.

## 8. Safety

N/A directly, but the calm, low-stimulation aesthetic (muted palette, restrained motion, generous
whitespace) is a deliberate wellbeing choice and should be preserved as features are added.

## 9. Accessibility (canonical reference)

The bar for the entire app:

- **Contrast** — WCAG **AA**: ≥ 4.5:1 for body text, ≥ 3:1 for large/bold text and UI/affordance
  boundaries. Accent solids use the deeper stop to satisfy this (§5.3).
- **Focus** — a visible `--color-focus-ring` on every interactive element via `:focus-visible`; never
  remove focus styles.
- **Keyboard** — everything operable without a mouse; logical tab order; Esc closes overlays; focus
  trapping in modals; focus restoration on close.
- **Semantics** — semantic HTML and ARIA roles/labels; icon-only controls have `aria-label`.
- **Motion** — honor `prefers-reduced-motion` and the setting.
- **Color independence** — never use color as the only signal (pair with icon/text).
- **Targets** — interactive hit areas ≥ 24×24px (≥ 44px for primary touch-like actions).

## 10. Testing strategy

- **Component tests (Vitest + RTL):** each primitive renders, is keyboard-operable, and exposes
  correct roles/labels; variants and disabled/error states behave.
- **Token tests:** a snapshot/assertion that required semantic tokens exist for both themes (catches
  a token missing in dark mode).
- **Contrast checks:** an automated check of key text/background and accent-solid pairs against AA.
- **A11y smoke:** `axe` assertions on representative compositions.
- **Visual review:** a Storybook-style gallery route (dev-only) to eyeball primitives in both themes;
  Playwright can screenshot it for regression later.

## 11. Resolved decisions

Confirmed with the user (2026-06-09):

1. **Icon set** — `lucide-react`.
2. **Dev gallery** — yes; build a dev-only in-app design-system gallery route showing every primitive
   in both themes (aids review and supports visual-regression tests).
3. **Density default** — Comfortable.
4. **Accent ramp** — dusty-blue stops as specified in §5.3; fine-tune exact values during build for AA
   - feel (a build detail, not a blocker).

_No open questions remain. New questions that arise during implementation are appended here._

## 12. Changelog

- 2026-06-09 — created (draft). Direction confirmed: warm neutrals, dusty-blue accent, Mulish + Lora.
- 2026-06-09 — resolved open questions (lucide-react icons, build the dev gallery, Comfortable density
  default) after review; marked Approved.
