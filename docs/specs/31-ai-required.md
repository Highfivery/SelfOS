# 31 — AI is a hard requirement (online required)

> **Status:** Approved (policy) · _last updated 2026-06-21_ · on `feat/household-ai-credentials`
>
> **Product decision (2026-06-21, the owner, explicit):** _"AI is required by the app and requires online,
> period."_ SelfOS is an **AI** therapist + life coach; its value **is** the AI. We do **not** build an
> offline mode, a degraded "works without AI" experience, or a path that lets a person complete core flows
> with no Claude key. When AI is unavailable (no key, AI disabled, or no internet) the app **explains and
> prompts setup/connectivity** — it does not fake a working experience.

This spec **supersedes and cancels** the previous draft of #27 ("onboarding offline resilience — let the forms
work without AI"). That direction is **rejected**: it tried to make onboarding progress without AI, which
contradicts the AI-required policy. The existing AI-required gating ([`18`](18-personal-onboarding.md) §3.1 hard
gate; the not-configured prompts across surfaces) is **correct and stays** — it is **not** to be relaxed.

Reinforced by [`25-household-ai-credentials`](25-household-ai-credentials.md) (a member on a shared vault
**inherits** the household key → AI is available household-wide, the normal case) and
[`00-architecture.md`](00-architecture.md) (§7, **amended** below).

---

## 1. What "AI required, online required" means

1. **AI is a prerequisite, not an add-on.** Coaching sessions, dreams analysis, questionnaires generation/
   analysis, the personal-onboarding portrait, and memory all require a resolved key + connectivity. There is
   **no** offline or no-key substitute for these.
2. **No degraded/offline mode is built.** We do not invest in letting flows "work without AI." When AI is
   unavailable, surfaces show a **clear, role-aware setup/connectivity prompt** (the `25` model: owner → "add/
   enable a key"; member → "AI is provided by your household — ask your owner, or use your own key"; offline →
   "you appear to be offline — AI needs a connection").
3. **Onboarding stays hard-gated on the AI portrait** ([`18`](18-personal-onboarding.md) §3.1). A Member is not
   "released early" on forms-only; the portrait (which needs AI) remains the completion bar. With `25` the
   member inherits the household key, so in a correctly-set-up household this **just works**.
4. **The Owner is never locked out of setup.** "AI required" does **not** mean "block the whole app until AI
   works" — that would be a chicken-and-egg trap (the owner needs the app to add the key). The Owner is exempt
   from the onboarding gate ([`18`](18-personal-onboarding.md), 2026-06-14 decision) and reaches Settings → AI
   to set up + share the key. Members are gated (they should onboard), and their not-configured state tells
   them exactly what to do.

## 2. Goals / Non-goals

**Goals**

- Codify the AI-required + online-required policy so future work does not re-introduce offline/degraded paths.
- Ensure every "AI not available" surface is an **honest setup/connectivity prompt**, never a silent or faked
  experience (the `25` role-aware messaging already does this for readiness).
- Reconcile the one stale doc line that promised graceful offline degradation (`00` §7).

**Non-goals**

- **Offline functionality of AI features.** Explicitly out — rejected by the policy.
- **Forms-without-AI onboarding / early gate release.** Cancelled (the superseded draft).
- **Robust offline _detection_ UX** (a precise "you're offline" banner with reconnect handling) — a _possible_
  future enhancement (§4), not required here; the existing not-configured/error states already degrade safely
  to a calm message.
- **Blocking the whole app behind an AI check.** The owner must reach setup; per-surface prompts are the model,
  not an app-wide wall.

## 3. Changes

### 3.1 Functionality — already aligned (no behavior change required)

The app already enforces AI-required and prompts setup rather than faking a degraded experience:

- **Onboarding** ([`18`](18-personal-onboarding.md)): the hard member gate holds until the portrait (AI) is
  generated; the not-`aiAvailable` state shows a role-aware "connect AI / ask your owner" prompt — **kept**.
- **Sessions / Dreams / Questionnaires / Home**: each AI surface gates on `aiAvailable` and shows a
  setup/connect prompt when not ready — **kept** (and consolidated onto the `25` `aiKeyResolved` readiness).
- **`25`** ensures members **inherit** the household key, so the no-AI state is the genuine
  not-set-up/offline case, not a routine member experience.

So **no code change is required** to satisfy the policy beyond what `25` already shipped. This spec's
deliverable is primarily the **policy of record** + the doc reconciliation (§3.2), so the codebase is not later
"fixed" back toward an offline mode.

### 3.2 Docs reconciliation (the concrete edits)

- **`00-architecture.md` §7** — the line _"Offline / no Claude key → AI features degrade gracefully and
  explain; non-AI features keep working fully"_ is **amended** to: AI features are **required**; with no key /
  AI disabled / offline they show a **clear setup/connectivity prompt** (no degraded substitute). Pure-local,
  non-AI utilities (e.g. reading already-saved journal/dream entries, appearance settings) remain usable, but
  the product's **core value requires AI + connectivity** and we ship no offline AI experience.
- **`18-personal-onboarding.md` §3.1 / §7** — confirmed unchanged by this spec (the AI-required framing stands;
  the superseded #27 would have weakened it — it does not).
- **`CLAUDE.md`** — a Changelog entry records the durable policy (done with this spec).

## 4. Possible future enhancement (not in scope)

A dedicated **offline-detection** affordance: when `navigator.onLine` is false (or a Claude call fails with a
network error), surface a distinct "You appear to be offline — AI needs a connection" banner separate from the
"no key configured" prompt, so the user can tell a connectivity problem from a setup problem. This is additive
UX over the AI-required policy; it changes no gating. Spec it separately if desired.

## 5. Safety

No change to the safety model. Crisis routing, the not-medical boundary, and the restricted-content rules
([`18`](18-personal-onboarding.md), `05`, `09`) are untouched. Making AI a hard requirement does not change what
the AI is allowed to do or how crisis situations are routed.

## 6. Testing

No new functional surface, so no new E2E. The policy is enforced by the existing AI-required tests (onboarding's
AI gate; each surface's not-ready branch) which already assert the setup-prompt behavior. The only deliverable
is documentation; the doc-drift backstop (`sync-docs`) covers it.

## 7. Changelog

- 2026-06-21 — **Repurposed + Approved (policy).** Reversed the previous "onboarding offline resilience" draft
  per the owner's decision _"AI is required by the app and requires online, period."_ No offline/degraded mode
  is built; the existing AI-required gating + role-aware setup prompts (incl. `25`'s) stand and are not
  relaxed; `00` §7 amended; the onboarding hard gate (`18` §3.1) is confirmed unchanged. Renamed
  `31-ai-required.md` → `31-ai-required.md`.
