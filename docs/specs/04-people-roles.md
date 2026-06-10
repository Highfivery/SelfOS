# 04 — People, relationships, roles & encryption

> **Status:** Draft · _last updated 2026-06-09_
>
> The household model: SelfOS serves a graph of **people** — some are **subjects** with their own
> coaching experience, all are connected by **relationships** that are themselves data-bearing.
> Access is governed by **capability-based roles** plus a concealed **super-admin**, and private data
> is **encrypted at rest** with a device-held master key so it can't be read by browsing the vault.
> This is the second-most-important feature in SelfOS and the substrate for conversations,
> questionnaires, and AI context.

Builds on [`00-architecture.md`](00-architecture.md) (vault, IPC, crypto boundary),
[`01-design-system.md`](01-design-system.md), [`02-app-shell.md`](02-app-shell.md) (nav, boot), and
[`03-settings.md`](03-settings.md) (the registry pattern is reused for capabilities).

---

## 1. Overview

A SelfOS install is a **household**: one shared vault holding many `Person` records. A person is
either a **subject** (has their own sessions, journal, questionnaires — e.g. you and your partner) or
a **contact** (a profile used only as context — e.g. a coworker you mention). People connect via
**relationships** (partner, parent, child, friend…), and each relationship can carry its own data (a
relationship questionnaire, an "about us" chat).

At any moment one person is the **active person**; the app scopes to them. When a subject has a
session, the AI is enriched with context they've **consented to share** about the people they mention
— without exposing anyone's private therapy data. Who can do what is governed by **roles** (bundles
of capabilities), with a hidden **super-admin** for the owner. All private content is **encrypted at
rest**.

## 2. Goals / Non-goals

**Goals**

- A `Person` + `Relationship` data model (a relationship graph), each data-bearing.
- **Active-person** selection ("Who's here?") + optional per-person PIN; capability-gated UI.
- **Capability-based, configurable roles** (Owner / Member / Guest defaults) + a registry features
  extend, plus a concealed all-access **super-admin** unlocked by a secret passphrase.
- **Encryption at rest** of private data via a device-keychain master key (opaque to file-browsing,
  other household members, and cloud sync).
- A **shareable-vs-private** model so consented context can feed the AI without leaking private data.

**Non-goals (deferred)**

- Multi-device sync of encrypted data (needs a recovery-key flow) — v1 is single-device.
- Zero-knowledge privacy from the owner/app (incompatible with the required super-admin — see §8).
- Questionnaires and per-person/relationship chat surfaces (separate later specs that build on this).
- Remote/per-device person access (post-sync concern).

## 3. UX & flows

### 3.1 Who's here? (active person)

- A **switcher** (launch and on-demand) lists people who have **access** (an account). Pick one →
  if a PIN is set, enter it → that person becomes active. The Owner can switch freely.
- The active person's **role** gates nav and actions; their sessions/journal/questionnaires scope to
  them; switching away locks the prior person's private views.

### 3.2 People & relationships

- **People** screen: list (subjects + contacts), create/edit/archive, promote a contact → subject.
- **Person** detail: profile, their relationships, their data (sessions/questionnaires — later), and
  (Owner/Admin) their access/role + PIN reset.
- **Relationships**: create a typed link between two people; edit attributes; open relationship data.

### 3.3 Concealed super-admin

- Entered via a **non-obvious action** (e.g. long-press the version in About) → a **passphrase**
  prompt → on success, an **inspect-all** mode for the session. Never shown in normal UI, never in
  the switcher; other people are unaware it exists (§8).

### 3.4 Sharing context

- Per person/relationship, the owner (or the person themselves) marks fields as **shareable** vs
  **private**. Shareable data is what other subjects' AI may use; private data never leaves that
  person's own sessions.

## 4. Data model

All persisted formats are **Zod-backed** (`schemaVersion` + migrations) and written through the vault
service. Private content is encrypted (§5).

### 4.1 Person

```ts
interface Person {
  id: string; // uuid
  schemaVersion: number;
  displayName: string;
  isSubject: boolean; // true = has their own SelfOS experience
  pronouns?: string;
  birthday?: string; // ISO date
  avatarPath?: string; // within the vault
  tags: string[];
  publicNotes?: string; // shareable
  privateNotes?: string; // encrypted, owner/self only
  createdAt: string;
  updatedAt: string;
}
```

### 4.2 Relationship (the graph edge)

```ts
interface Relationship {
  id: string;
  schemaVersion: number;
  fromPersonId: string;
  toPersonId: string;
  type: 'partner' | 'parent' | 'child' | 'sibling' | 'friend' | 'coworker' | 'ex' | 'other';
  label?: string; // free-text refinement, e.g. "wife"
  closeness?: 1 | 2 | 3 | 4 | 5;
  since?: string;
  publicNotes?: string;
  privateNotes?: string;
  createdAt: string;
  updatedAt: string;
}
```

Most relationships are mutual; the inverse type is derived for display (parent↔child, etc.).

### 4.3 Access, roles, capabilities

```ts
type CapabilityKey = string; // e.g. 'people.manage', 'sessions.own', 'questionnaires.answer'

interface Role {
  id: string;
  name: string;
  builtin: boolean; // owner/member/guest are builtin
  capabilities: Record<CapabilityKey, boolean>;
}

interface Account {
  personId: string; // a Person who can sign in
  roleId: string;
  pinHash?: string; // scrypt/argon2; optional
}
```

- **Capabilities** are registered like settings (a registry features extend). v1 set:
  `people.manage`, `people.viewOthers`, `relationships.manage`, `settings.manage`, `users.manage`,
  `roles.manage`, `sessions.own`, `questionnaires.answer`, `questionnaires.assign`.
- **Default roles**: **Owner** (all visible capabilities), **Member** (own data + own relationships +
  answer questionnaires), **Guest** (answer assigned questionnaires only). Owner-editable matrix.
- **Super-admin** is **not** a normal role — it's a concealed elevation above all roles (§8).

### 4.4 Vault layout

```
vault/
  config/
    settings.json          # plain (03-settings)
    access.enc             # encrypted: roles + accounts (pin hashes)
  people/
    <person-id>/
      profile.enc          # encrypted Person
      avatar.<ext>         # (optional) image
      …                    # sessions/, questionnaires/ added by later features
  relationships/
    <rel-id>.enc           # encrypted Relationship
```

Device-local (`userData`, never synced): the **master key** (keychain), the **super-admin passphrase
hash**, and the **active person** + session lock.

## 5. Encryption (at rest)

- A 256-bit **master key** is generated at first run and stored device-local via Electron
  `safeStorage` (OS keychain) — never in the vault.
- A main-process **crypto service** encrypts/decrypts with **AES-256-GCM** (random IV per write;
  auth tag verified on read), emitting a small JSON envelope `{ v, iv, tag, data }` (base64) written
  as `*.enc` files.
- **Encrypted:** all person/relationship content and the access config. **Plain:** non-sensitive app
  config (settings, theme) — preserves some inspectability.
- The vault service routes encrypted formats through the crypto service transparently; the renderer
  never sees ciphertext or the key.
- **Consequence:** browsing the vault folder, other household members, and cloud providers see only
  ciphertext. It is **not** zero-knowledge — the app (and the super-admin) hold the master key and
  can decrypt (§8). Encrypted data is no longer human-readable.

## 6. Architecture & modules

### 6.1 Main process

- **cryptoService** — master-key lifecycle (keychain) + `encrypt`/`decrypt`; pure crypto split out
  for unit tests (key injected).
- **peopleService / relationshipService** — CRUD over encrypted vault files; list/get/save/archive;
  Zod-validated + migrated.
- **accessService** — roles + accounts (encrypted `access.enc`); PIN hash/verify; capability lookups.
- **superAdminService** — passphrase hash/verify; elevation state (per app session, in-memory).
- Reuses the vault service (atomic writes, watching) and migration runner from 00/03.

### 6.2 Renderer

- **capabilityRegistry** — declarative capability definitions (key, label, group), features register
  into it (mirrors the settings registry).
- **peopleStore / relationshipStore** (Zustand) — loaded lists + selected entity.
- **sessionStore** — active person + their role + `can(capability)` selector + super-admin flag.
- **Screens**: People list/detail/edit, Relationship editor, "Who's here?" switcher, Roles &
  capabilities matrix (Owner), concealed super-admin unlock. Built on the design-system primitives;
  nav entries are capability-gated.
- A `<Gated capability="…">` guard + `useCan()` hook gate UI uniformly.

## 7. IPC / API contracts

Typed channels (declared in `src/shared`, validated both sides):

- `people:list` / `people:get(id)` / `people:save(person)` / `people:archive(id)`
- `relationships:list` / `:save` / `:delete`
- `access:get` (roles + accounts, redacted: no pin hashes to renderer) / `access:saveRole` /
  `access:setAccount` / `access:verifyPin({ personId, pin })`
- `session:listAccounts` / `session:setActive({ personId, pin? })` / `session:getActive`
- `superadmin:setup({ passphrase })` / `superadmin:unlock({ passphrase })` / `superadmin:lock`
- Crypto and the master key are **never** exposed over IPC; only decrypted domain objects cross the
  boundary, and only per the active person's permissions.

## 8. Safety, privacy & the super-admin

- **Privacy guarantee (stated plainly):** encryption protects private data from **other household
  members, file-browsing, and cloud** — _not_ from the app/owner. The concealed **super-admin** (the
  install owner, via secret passphrase) can decrypt and inspect everything for verification/debugging
  and is never surfaced to other users. This is a deliberate owner prerogative over their own install
  and device; the spec records it so the privacy claim is honest rather than overstated.
- **Consent & sharing:** a person controls what's shareable; private therapy data never feeds another
  person's AI. Shareable context is curated and consented.
- **Wellness boundary:** unchanged — SelfOS is wellness/self-help, not medical (per
  [`CLAUDE.md`](../../CLAUDE.md)); conversational/crisis behavior lives in the chat spec.
- **PINs/passphrase** are salted-hashed (scrypt), never stored plaintext; rate-limit verification.

## 9. Accessibility

Per [`01-design-system.md`](01-design-system.md) §9: the switcher, people/relationship forms, and the
roles matrix are fully keyboard-operable, labeled, and screen-reader friendly; the super-admin unlock
is reachable but unobtrusive.

## 10. Testing strategy

- **Unit (node):** cryptoService (encrypt→decrypt round-trip with an injected key; tamper → fails),
  people/relationship/access services against a temp vault (encrypted round-trip, migrations,
  archive), PIN + passphrase hash/verify, capability resolution per role, super-admin elevation.
- **Component (RTL):** people list/detail/edit; relationship editor; the switcher (PIN gate); the
  roles matrix; `<Gated>`/`useCan` behavior; super-admin unlock prompt.
- **E2E (Playwright):** create a person, link a relationship, set roles, switch active person with a
  PIN, confirm capability-gated nav, and (with a test master key) confirm vault files are ciphertext.
  Uses the existing `SELFOS_FAKE_*` determinism hooks where needed.

## 11. Proposed build slices (after approval)

1. **Crypto + data foundation** — cryptoService + master key; people/relationship/access services +
   schemas + IPC; capability registry + default roles; active-person store. Minimal/no new UI.
2. **People & relationships UI** — people list/detail/edit, relationship editor, the "Who's here?"
   switcher + PIN, capability-gated nav.
3. **Roles matrix + super-admin + sharing** — Owner-editable role×capability matrix, concealed
   super-admin unlock, shareable/private flags + the AI-context assembly hook.

(Questionnaires and per-person/relationship chat are later specs that consume this foundation.)

## 12. Open questions

1. **Default capabilities for Member/Guest** — confirm the exact matrix (who can see other people's
   profiles vs only their own relationships?).
2. **Avatars** — store images in the vault unencrypted (just a photo) or encrypt them too?
3. **Recovery** — what happens if the super-admin passphrase or a person's PIN is forgotten? (Owner
   reset via super-admin; master-key loss = data loss until a recovery-key flow exists.)
4. **First-run** — does onboarding now also create the first person (the owner/self) + set the
   super-admin passphrase, or is that a separate setup step after the vault?
5. **"Self" representation** — is the owner just `Person #1` with the Owner account, or a
   distinguished record? (Proposed: a normal Person with the Owner account.)

## 13. Changelog

- 2026-06-09 — created (draft) after a design brainstorm: household model, relationship graph,
  capability roles + concealed super-admin, master-key encryption at rest.
