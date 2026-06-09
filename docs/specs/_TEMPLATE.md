# NN — <Feature set name>

> **Status:** Draft · Review · **Approved** (pick one) — _last updated YYYY-MM-DD_
>
> One-paragraph summary: what this feature set is and why it exists. Keep it to 2–4 sentences.

Copy this file to `docs/specs/NN-name.md` (next free number, kebab-case name) and fill **every**
section. If a section truly doesn't apply, keep the heading and write _"N/A — \<reason\>"_. Reference
shared architecture (`00-architecture.md`) and design tokens (`01-design-system.md`) rather than
restating them (DRY).

---

## 1. Overview

What problem does this solve for the user? Where does it sit in SelfOS? Link related specs.

## 2. Goals / Non-goals

- **Goals** — bullet the outcomes this delivers.
- **Non-goals** — bullet what is explicitly out of scope (and, where useful, why / when it might come
  later).

## 3. UX & flows

The user-facing experience. Enumerate each flow step-by-step. Cover entry points, navigation, and
the **happy path**. Include wireframe notes or references where helpful. (For non-UI/foundational
specs: describe the developer-facing API/usage instead, and say so.)

## 4. Data model (vault files & schemas)

- **Files:** which Markdown/JSON files this owns, their **paths within the vault**, and formats
  (Markdown body + YAML frontmatter? JSON shape?).
- **Schemas:** the **Zod** schemas (source of truth) and the inferred TS types. Include
  `schemaVersion` and the migration approach for any persisted format.
- **Ownership:** confirm all reads/writes go through the vault service (no direct `fs`).

## 5. Architecture & modules

How this is built. If it's a feature, describe the **feature module** and exactly what it registers
(nav entry, routes, settings, schemas, IPC handlers). Identify new/changed components, stores
(Zustand), and main-process services. Note anything that must be shared (extract to `packages/*`).

## 6. IPC / API contracts

- **IPC channels:** name, direction, request/response shapes (Zod), error cases. Renderer ↔ main
  only through the typed IPC layer.
- **Claude API:** if used — prompt/response shape, streaming, model, token/limit handling, failure
  and retry behavior. The key stays in main; the renderer never sees it.

## 7. States & edge cases

Exhaustively: loading, empty, error, partial, offline (no Claude API), large data, concurrent edits,
**sync conflicts**, corrupt/missing files, migration from an old schema. For each: the intended
behavior.

## 8. Safety (required if this touches wellbeing or conversation)

The not-medical boundary as surfaced here; crisis/self-harm detection and routing to professional
resources; handling of sensitive content. Omit only for purely technical features (state why).

## 9. Accessibility

Keyboard interaction, focus management, semantic roles/labels, contrast, motion/reduced-motion,
screen-reader behavior. Tie to the design-system standards.

## 10. Testing strategy

What proves this works: unit (Vitest), component (Vitest + RTL), and E2E (Playwright) — list the key
cases, including the edge cases from §7. How the vault and Claude API are mocked.

## 11. Open questions

Bullet every unresolved decision needing the user's input. **Never** silently assume an answer — list
it here instead. Resolve and remove as decisions are made.

## 12. Changelog

- YYYY-MM-DD — created.
