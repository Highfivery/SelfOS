# 04 — People, relationships, roles & encryption

> **Status:** Approved · _last updated 2026-06-09_
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

- Live multi-device sync of encrypted data — v1 is single-device, but a **recovery phrase** is built
  now (§5) so the master key can be restored after keychain loss or on a future device.
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
  email?: string; // encrypted; prefills questionnaire delivery (08); excluded from buildContext
  phone?: string; // encrypted; prefills questionnaire delivery (08); excluded from buildContext

  // Descriptive profile fields (13-dream-images §4.6). SHAREABLE — feed `buildContext` for the person AND
  // for related people (like `publicNotes`); the depiction subset (appearanceDescription + gender +
  // ethnicity + approx age derived from `birthday`) also feeds the dream-image prompt (13 §8.2).
  gender?: string;
  appearanceDescription?: string;
  ethnicity?: string;
  occupation?: string;
  interests?: string[];
  location?: string;
  goals?: string;
  communicationStyle?: string;
  values?: string[];
  languages?: string[];
  importantDates?: { label: string; date: string }[];
  // PRIVATE — own coaching context only; never shared with other people's coach, never sent to the image
  // provider (13 §8.2). Encrypted with the rest of the profile.
  healthNotes?: string;
  faith?: string;

  createdAt: string;
  updatedAt: string;
}
```

> **Amended** (built 2026-06-11, [`08-questionnaires.md`](08-questionnaires.md) slice 1) — added optional
> encrypted **`email?`** / **`phone?`** contact fields (prefill questionnaire `mailto:`/SMS delivery;
> **excluded from `buildContext`** — operational, not coaching data). Additive-optional, so existing person
> files parse unchanged — **no `schemaVersion` bump or migration**. The People-editor contact inputs land
> with the questionnaire-delivery slice.

> **Amended** (Draft — [`13-dream-images.md`](13-dream-images.md) §4.6/§13.1, build slice 1) — added optional
> **descriptive profile fields** used as coaching context **app-wide**, not only for images. The **shareable**
> set (`gender`, `appearanceDescription`, `ethnicity`, `occupation`, `interests`, `location`, `goals`,
> `communicationStyle`, `values`, `languages`, `importantDates`) feeds `buildContext` for the person **and**
> related people — the same "may feed others' AI" bucket as `publicNotes` (§3.4); the depiction subset
> (`appearanceDescription` + `gender` + `ethnicity` + approx age from the existing **`birthday`**, which is
> **reused**, not duplicated) additionally feeds the dream-image prompt (13 §8.2). The **private** set
> (`healthNotes`, `faith`) feeds **only** the person's own context, never another person's coach and never the
> image provider — the same shareable-vs-private split as `privateNotes`. All **additive-optional**, so
> existing person files parse unchanged — **no `schemaVersion` bump or migration** (the `email`/`phone`
> precedent). Surfaced in the tabbed `PersonEditor` (an About group for the shareable fields, a Private group
> for `healthNotes`/`faith`). **Built 2026-06-12 (13-dream-images slice 1):** the schema fields,
> `upsertPerson` threading, the `buildContext`/`buildLinkedPeopleContext` surfacing (shareable own + related;
> private own-only), and the `PersonEditor` Profile-tab **birthday** input + **About** tab (shared + private
> field groups; `gender` = the §11.3 preset enum + free-text "Other"; `interests`/`values`/`languages` via
> `ChipEditor`; an `importantDates` label+date row editor). The depiction subset that feeds the image prompt
> lands with 13 slice 2.

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
type CapabilityKey = string; // e.g. 'people.manage', 'sessions.own', 'budgets.manage'

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
  `roles.manage`, `budgets.manage`, `sessions.own`, plus the questionnaires set
  (`questionnaires.create` / `.answer` / `.viewResults` / `.sendExternal`, registered in `08` slice 1;
  `questionnaires.readRaw` is deferred to the break-glass slice and ships OFF even for the Owner).
  (Feature-specific capabilities are added only when that feature is actually specced and built; we do not
  pre-register capabilities for unbuilt features.)
- **Default roles**: **Owner** (all visible capabilities), **Member** (own data + own relationships +
  their own sessions), **Guest** (no capabilities yet — a login slot with nothing enabled until a
  Guest purpose is specced). Owner-editable matrix.
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
- **Recovery phrase (built now).** At setup a human-readable **recovery phrase** is generated and
  shown once. A key-encryption key derived from it (scrypt) **wraps** the master key; the wrapped
  master key is stored in the vault (`config/recovery.enc`, syncable). If the keychain key is lost (or
  on a future device), entering the phrase unwraps and restores the master key; the phrase can also
  reset the super-admin passphrase. The phrase itself is never stored — losing both the keychain key
  and the phrase means the data is unrecoverable.
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

## 12. Resolved decisions

Confirmed with the user (2026-06-09):

1. **First-run** — onboarding becomes: choose vault → create the **owner** (Person #1, Owner account)
   → set the **super-admin passphrase** → show the **recovery phrase** (write it down). One guided
   flow (extends 02-app-shell onboarding).
2. **Default capability matrix** — **Owner** = all capabilities; **Member** = manage their own
   profile + their own relationships + have their own sessions (no access to others' private data, no
   household management); **Guest** = no capabilities yet (a login slot, nothing enabled until a Guest
   purpose is specced). _Updated 2026-06-10: the questionnaires capabilities were removed as unbuilt
   scaffolding; updated 2026-06-11: questionnaires is now specced + built (`08` slice 1), so **Member** also
   gains `questionnaires.create/answer/viewResults/sendExternal`; `readRaw` stays deferred + OFF._
3. **Recovery** — build a **recovery phrase** now (§5): the super-admin can reset any person's PIN;
   the recovery phrase restores the master key and can reset the super-admin passphrase; losing both
   the keychain key and the phrase = unrecoverable data.
4. **Avatars** — stored as a plain image file in the vault (not encrypted) for v1; revisit if image
   privacy becomes a concern.
5. **"Self"** — a normal `Person` (Person #1) holding the Owner account; no distinguished record type.

## 13. Changelog

- 2026-06-09 — created (draft) after a design brainstorm: household model, relationship graph,
  capability roles + concealed super-admin, master-key encryption at rest.
- 2026-06-09 — resolved open questions (first-run owner+passphrase+recovery-phrase, capability
  defaults, recovery phrase in scope, plain avatars, self = Person #1) and added the recovery-phrase
  design to §5; marked Approved.
- 2026-06-10 — removed the `questionnaires.answer` / `questionnaires.assign` capabilities (§4.3, §12)
  — they were registered for a feature that was never specced or built, contradicting "no scaffolding
  for unbuilt features." Member now defaults to own profile + own relationships + own sessions; Guest
  defaults to no capabilities. Questionnaires stays on the roadmap (still referenced as a future
  surface throughout); its capabilities return when it is specced.
