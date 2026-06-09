---
name: write-spec
description: Scaffold or revise a SelfOS feature-set spec in docs/specs/. Use when starting a new feature set, when the user asks to "write/draft a spec", or before writing any feature code (spec-driven workflow). Produces a doc that follows _TEMPLATE.md.
---

# write-spec

SelfOS is **spec-driven**: no feature code without an approved spec. This skill creates or revises a
spec so it's consistent, complete, and ready for review.

## Steps

1. **Confirm scope.** Restate the feature set in one sentence and confirm with the user. Never guess
   at intent — ask focused questions about anything ambiguous.
2. **Pick the number.** Specs are ordered `NN-name.md` in `docs/specs/`. Read the directory, choose
   the next free `NN`, and use a short kebab-case name.
3. **Start from the template.** Copy [`docs/specs/_TEMPLATE.md`](docs/specs/_TEMPLATE.md). Fill every
   section. Do not leave placeholders — if a section doesn't apply, say why.
4. **Honor the architecture.** The spec must fit the feature-module registry, schema-driven settings,
   the vault storage model, and the IPC/security boundaries in
   [`docs/specs/00-architecture.md`](docs/specs/00-architecture.md). Reference, don't restate.
5. **Wellness safety.** If the feature touches user wellbeing or conversation, include a **Safety**
   subsection: the not-medical boundary and crisis-routing behavior.
6. **List open questions** explicitly at the bottom rather than assuming answers.
7. **Hand off for review.** Specs are perfected with the user before any code. Use the `spec-writer`
   agent for heavy drafting when useful.

## Definition of a good spec

Unambiguous, testable, internally consistent, and detailed enough that implementation needs no
guesswork — but it references shared architecture instead of duplicating it (DRY).
