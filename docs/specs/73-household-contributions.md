# 73 — Household contributions

> **Status:** **Draft** (awaiting approval) — _last updated 2026-08-14_
>
> A book is written from one person's own record, which means it can only ever know what that person
> thought to say. This lets the people who were **there** add to it — a memory, a question worth asking, a
> correction, something they heard the subject say — without ever letting anyone else write the subject's
> life for them. Spec [72](72-books.md) §2 names this "the highest-value fast-follow" and defers it
> explicitly because it needs its own consent and attribution model. This is that model.

---

## 1. Overview

**The gap.** Every book SelfOS writes is bounded by one person's self-report. The subject cannot tell the
biographer what they looked like the day their daughter was born, what their brother remembers about the
move, or the line they always said that everybody else can quote. The people who can are already in the
household, already related in the People graph, and currently have no way to say any of it.

**What this delivers.** A **contribution** — a small, typed offering from one household member to another
person's book, which reaches the corpus only when the author accepts it. Four kinds: a **memory**, a
**question** for the subject to answer, a **correction**, and an **attributed quote**.

**What it deliberately is not.** It is not co-authorship (that is spec 72 §5.8's `ourStory`, one book owned
by two people). It is not a comment thread. Nobody but the subject decides what their life story says.

**Related specs.** [72](72-books.md) (books, the corpus, the interview, quote mining, the reader),
[15](15-shareability.md) (what a connected person shares), [04](04-people-roles.md) (the relationship graph
and capabilities), [08](08-questionnaires.md) (the send/answer machinery a contributed question rides),
[35](35-notification-system.md) (the notification framework), [00](00-architecture.md) (vault, IPC,
security).

## 2. Goals / Non-goals

**Goals**

- **The people who were there can add to the record.** Four contribution kinds, each reusing machinery that
  already exists rather than inventing a parallel one.
- **The author decides, always.** Nothing a relative submits reaches the corpus, the prose, or the interview
  until the author accepts it (owner decision, 2026-08-14). A relative may offer; never insert.
- **Attribution is the author's call, per contribution.** Default named — a second voice is usually the point
  — with a switch to absorb it unattributed as ordinary material (owner decision, 2026-08-14).
- **The contributor is told what happened, and can take it back.** Pending / accepted / declined, and
  withdraw at any time (owner decision, 2026-08-14).
- **No new privacy surface.** A contribution is authored ABOUT someone by someone who is already related to
  them; it carries no third party's private data, and it never reveals the book to a non-reader.

**Non-goals**

- **Co-authored books** — that is `ourStory` (72 §5.8), a different model entirely.
- **Contributions from outside the household.** The relay (72 §2) is a later slice for reading; contributing
  from outside needs an identity model this does not have.
- **A discussion thread.** A contribution is a single offering with a single decision, not a conversation.
  If it needs discussion, that is what Together and the interview are for.
- **Editing the author's prose.** A correction says what is wrong; it never rewrites a chapter directly.
- **Notifying anyone that a book exists.** Contributing is invited by the author, so it never leaks the
  existence of a book to someone who was not already told (§8.2).

## 3. UX & flows

### 3.1 Inviting contributions (the author)

A book's **People** tab (72 §3.9) gains **"Ask them to add to it"** beside any household person the book
names. It opens a short composer: who, and an optional line of context ("anything you remember about the
Denver years?"). Sending mints an **invitation** and a `contribution-invited` notification for them.

An invitation is per **book** and per **person**, and it is the ONLY way to contribute — there is no
browsing to someone's book and adding to it uninvited. Revoking it stops further contributions and leaves
already-accepted ones in place (they are the author's material now).

### 3.2 Contributing (the household member)

The invitation opens **`/contribute/<invitationId>`** — deliberately its own small surface, not the Books
workspace, because a contributor is not a reader of the book and must not be shown one. It states plainly
what this is: _"Ben is writing his life story. He asked if you'd add what you remember. He decides what goes
in, and you can take anything back."_

Then one picker and one field. The four kinds:

| Kind           | The contributor writes                        | What reaches the book                                     |
| -------------- | --------------------------------------------- | --------------------------------------------------------- |
| **Memory**     | What they remember, in their own words        | The text, as corpus material                              |
| **Question**   | Something worth asking the subject            | **The subject's ANSWER** — never the question itself      |
| **Correction** | What the book gets wrong, and the right of it | A note the author resolves; never an automatic edit       |
| **Quote**      | A line they heard the subject say             | The quote, through the existing approval queue (72 §17.4) |

**Correction is only offered when the book is already shared with them** (72 §3.5 readers) — you cannot
correct what you cannot read, and offering it otherwise would be a control whose only outcome is confusion.

Below the composer: **what you've sent**, each with its state — _Waiting on Ben · Added · Not used_ — and a
**Take it back** on any of them.

### 3.3 Deciding (the author)

Contributions land in the book's **Needs you** strip (72 §3.5) as _"3 things people sent you"_, opening a
review list. Each shows the contributor, the kind, the text, and when. Per contribution:

- **Add it** — accepts it into the corpus. For a memory or quote, an **attribution** control sits beside the
  button: **Name them** (default) or **Just the material**.
- **Not this one** — declines it. The contributor sees _Not used_; they are never shown a reason, and the
  author is never asked for one (a decline about your own life story should not require a justification).
- A **question** accepted becomes a gap in the interview (72 §3.7) — it joins "what it wants next" like any
  other, and the answer is what feeds the book.
- A **correction** accepted opens the existing timeline/chapter correction path; the author still makes the
  edit.

### 3.4 In the book

An accepted memory or quote enters the corpus as a `{ kind: 'contribution' }` item carrying its contributor
and its attribution choice. Where attribution is **named**, the doctrine is told it may name them in the
prose ("Angel remembers the kitchen differently"); where it is **just the material**, the prose treats it as
ordinary source and the contributor is never named.

The **People** tab shows, per person, how many of their contributions the book carries — the honest
counterpart to "named in 8 chapters".

## 4. Data model (vault files & schemas)

All reads/writes through the vault service. Every schema below is new and versioned `schemaVersion: 1`; the
only touches to existing types are **additive-optional** (no `schemaVersion` bumps).

### 4.1 The invitation

`people/<authorId>/story/books/<bookId>/contributionInvites/<personId>.enc` — one file per invited person,
**one writer** (the author), so it never needs a second-writer conflict rule (58 §4).

```ts
ContributionInviteSchema = {
  schemaVersion: 1,
  personId: string,        // who is invited
  bookId: string,
  note?: string,           // the author's line of context
  invitedAt: string,
  revokedAt?: string,      // revoked ⇒ no new contributions; accepted ones stay
}
```

### 4.2 The contribution

`people/<contributorId>/story/contributions/<id>.enc` — written by the **contributor**, in their own vault
space, one writer. The author never writes this file; their decision lives in §4.3. That split is what keeps
"withdraw at any time" and "the author decides" from being two writers on one record.

```ts
ContributionKindSchema = z.enum(['memory', 'question', 'correction', 'quote']);

ContributionSchema = {
  schemaVersion: 1,
  id: string,
  toPersonId: string,      // the subject, i.e. the book's author
  bookId: string,
  kind: ContributionKind,
  text: string,
  /** `correction` only — the chapter it is about, when they were reading one. */
  chapterId?: string,
  createdAt: string,
  withdrawnAt?: string,    // set by the contributor; hides it everywhere, immediately
}
```

### 4.3 The author's decision

`people/<authorId>/story/books/<bookId>/contributionDecisions.enc` — one file, **one writer** (the author),
holding a decision per contribution id.

```ts
ContributionDecisionSchema = {
  contributionId: string,
  contributorId: string,        // denormalized so a decision resolves without a cross-person read
  status: z.enum(['accepted', 'declined']),
  /** Accepted memories/quotes only: may the prose name them? Default true. */
  attributed: z.boolean().default(true),
  decidedAt: string,
  /** Set when an accepted `question` became an interview gap, so it is not re-minted. */
  gapId?: string,
}
```

**State is DERIVED, never stored twice** (the 58 §4 rule): a contribution is `withdrawn` if its own file says
so, else `accepted`/`declined` if a decision exists, else `pending`. Neither side writes the other's file.

### 4.4 Additive touches

- `CorpusItem.sourceRef` gains a `{ kind: 'contribution', id }` arm (72 §5.2).
- `ConsentPerson` (72 §4.7) gains `contributions?: number` — how many of theirs the book carries.
- Two new `NotificationKind`s: `contribution-invited` (to the contributor) and `contribution-received` (to
  the author).

## 5. Architecture & modules

New core module **`packages/core/src/books/contributions.ts`**:

- `inviteContribution` / `revokeContributionInvite` / `listContributionInvites` (author-side, §4.1).
- `submitContribution` / `withdrawContribution` / `listMyContributions` (contributor-side, §4.2). Every one
  re-checks a **live invitation** and a **live relationship edge** — the 72 §5.8 pattern: the edge is the
  standing grant, so removing it stops contribution immediately with nothing to clean up.
- `listContributionsForBook` (author-side) — joins §4.2 files from each invited contributor with §4.3
  decisions, deriving status. Skips withdrawn.
- `acceptContribution` / `declineContribution` (author-side, writes §4.3 only).

**Corpus** (`bookCorpus.ts`): accepted, non-withdrawn memories and quotes enter as `contribution` items,
carrying the contributor's display name **only when `attributed`**. Excluded like any other source by the
exclusions filter.

**Interview** (`bookInterviewService.ts`): an accepted `question` seeds a gap, stamped with its
`contributionId` so the answer can credit it and so it is minted once.

**Renderer:** `ContributeRoute` (`/contribute/<invitationId>` — its own small surface, no Books chrome), the
**Needs you** review list, the People-tab invite control and per-person count.

## 6. IPC / API contracts

All gated `story.own` and active-person-scoped in the bridge (the trust boundary). **No Claude call is added
by this spec** — a contribution is text a person wrote; it reaches the model only as corpus material on a
generation the author already pays for.

| Channel                          | Request                                    | Response               | Notes                                          |
| -------------------------------- | ------------------------------------------ | ---------------------- | ---------------------------------------------- |
| `books:inviteContribution`       | `{ bookId, personId, note? }`              | `ContributionInvite`   | Author only; person must be related            |
| `books:revokeContributionInvite` | `{ bookId, personId }`                     | `ContributionInvite[]` | Accepted contributions survive                 |
| `books:myInvitations`            | —                                          | `InvitationView[]`     | Contributor-side; author's name + note         |
| `books:submitContribution`       | `{ invitationId, kind, text, chapterId? }` | `ContributionView`     | Re-checks live invite + edge                   |
| `books:withdrawContribution`     | `{ contributionId }`                       | `ContributionView[]`   | Contributor only, any time                     |
| `books:myContributions`          | —                                          | `ContributionView[]`   | Status only — never the book                   |
| `books:bookContributions`        | `{ bookId }`                               | `ContributionReview[]` | Author only                                    |
| `books:decideContribution`       | `{ contributionId, status, attributed? }`  | `ContributionReview[]` | Author only; accept seeds a gap for `question` |

**The read boundary.** `books:myContributions` returns the contributor's own text and its status — never the
book, its chapters, or any other contributor's submission. `books:bookContributions` returns only
contributions addressed to the active person's own book.

## 7. States & edge cases

1. **No invitation / revoked** — the contribute route shows a calm "this isn't open any more"; submit is
   refused in the bridge regardless of what the UI showed.
2. **The relationship edge is deleted** — contributing stops on the next call (the grant is the edge).
   Already-accepted material stays: it is the author's corpus now, and silently rewriting the book because a
   relationship changed would be worse than either alternative.
3. **Withdrawn after acceptance** — it leaves the corpus immediately, so it cannot inform a future rewrite.
   Prose already written is NOT retroactively edited (the author's chapters are theirs); the review list says
   so plainly, and the People count drops.
4. **The contributor is deleted** — their contributions and decisions are reaped with them (the 72
   `reapTogetherForPerson` precedent).
5. **A correction with no readable book** — the kind is not offered, and is refused at the bridge.
6. **Duplicate submissions** — allowed; two memories of the same day is material, not an error. The author
   declines what they don't want.
7. **Empty / oversized text** — bounded (`min(1)`, a sane max) at the schema, refused in the bridge.
8. **Concurrent edits** — impossible by construction: contributor and author write different files (§4.3).
9. **Offline / no AI** — contributing, reviewing, accepting and withdrawing are all free, deterministic vault
   operations. Only the eventual chapter rewrite needs AI.

## 8. Safety

### 8.1 The boundary

Unchanged: books are a wellness reflection, never clinical (72 §8.1). A contribution is ordinary text and is
never treated as clinical information about the subject.

### 8.2 Nobody learns a book exists unless they were told

A `contribution-invited` notification only ever goes to someone the author explicitly invited. Nothing else
in this spec surfaces the existence, title or contents of a book to a non-reader — the contribute route
deliberately shows no book, and `books:myContributions` returns no book data.

### 8.3 A contribution carries no third party's private data

It is free text one household member wrote about another they are related to. It is not sourced from
anyone's insights, intake or restricted facts, so it introduces no new cross-person read. The §15 sharing
model is untouched.

### 8.4 Crisis

The `CrisisFooter` renders on the contribute route like every other conversational surface. If a contribution
trips the shared crisis signal on the author's next analysis pass, existing routing applies unchanged.

### 8.5 The uncomfortable case, stated plainly

A relative can write something the subject finds hurtful, and the subject will read it in the review list.
That is inherent to inviting someone to contribute, and the mitigations are the model itself: it is invite-only,
the author decides, declining needs no reason, and nothing declined is ever seen again. The review list is
worded so declining is an ordinary act rather than a judgement.

## 9. Accessibility

Per [01](01-design-system.md). The contribute route is a labelled form with a single fieldset per kind, the
kind picker is a `radiogroup`, statuses are text (never colour alone), the review list is a list of articles
with the decision controls in each, and every state a contributor can reach has an honest, non-dead-end
message. 360px clean, no horizontal scroll.

## 10. Testing strategy

Vault via `memFileSystem`; no Claude call to fake.

**Unit (core)**

- Invite → submit → the author sees it pending; a submit with no invite, a revoked invite, or no live edge is
  refused (verified to fail if the re-check is removed).
- Status derivation across all four states, from both sides, with neither side writing the other's file.
- Withdraw removes it from the corpus AND from the author's review list, at any status.
- An accepted `memory` enters the corpus; `attributed: false` carries no contributor name into it (asserted
  on the assembled corpus text, not the flag).
- An accepted `question` seeds exactly one gap and is not re-minted on a second pass.
- A `correction` is refused when the book is not shared with the contributor.
- Person deletion reaps contributions and decisions both ways.

**Component (RTL)**

Contribute route: the four kinds, correction hidden without read access, the status list, withdraw. Review
list: accept with/without attribution, decline, and that no reason is requested.

**E2E (Playwright, decrypt-level)** — two personas: Ben invites Angel → Angel contributes a memory → Ben sees
it in Needs you → accepts it unattributed → decrypt asserts it is in the corpus and her name is not → Angel
sees _Added_ → withdraws → decrypt asserts it left the corpus. Plus: Angel cannot reach Ben's book, and a
revoked invitation refuses a submit at the bridge. 360px guard on both new surfaces.

## 11. Open questions

_None blocking._ The four defining decisions were resolved with the owner on 2026-08-14: the author approves
every contribution; attribution is the author's per-contribution choice (default named); all four kinds ship;
the contributor sees status only and may withdraw at any time.

One item is **deliberately deferred** rather than open: contributions from **outside the household**, which
would need the relay and an identity model for a non-member (72 §2).

## 12. Changelog

- 2026-08-14 — created. Written after spec 72 completed; realises 72 §2's named "highest-value fast-follow".
  The four consent/attribution decisions were resolved with the owner before drafting.
