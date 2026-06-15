# 19 — Distribution: versioning, release builds & the README

> **Status:** Review · _last updated 2026-06-15_
>
> SelfOS has no way to be installed by a normal person yet — there's no downloadable build, no release
> process, and the version is a hand-managed `0.0.0`. This spec adds **fully-automated versioning** (driven
> by the Conventional Commits the project already uses), a **GitHub Actions release pipeline** that builds the
> macOS desktop app and publishes the installer to **GitHub Releases**, an **auto-updating About-page
> version**, and a **friendly, non-technical README**. The maintainer never hand-edits a version again; a
> person installs by downloading the `.dmg` from the Releases page.

A release-engineering spec — it touches CI, packaging config, and docs, not app features or the vault. It
builds on the existing electron-builder config (`apps/desktop/electron-builder.yml`), the existing
`__APP_VERSION__` injection (`apps/desktop/electron.vite.config.ts` → About via `app:version` IPC), and the
project's **Conventional Commits + commitlint** (CLAUDE.md §9). References [`00`](00-architecture.md) /
[`07`](07-mobile-platform.md) (the iOS/App-Store path is separate — this is desktop only). No new app code of
substance.

---

## 1. Overview

Three coupled pieces, all automated:

1. **Versioning** — a **release-please** GitHub Action reads merged Conventional Commits on `main`, decides the
   next semver, and opens/maintains a **"Release vX.Y.Z" PR** with an auto-generated changelog. Merging that PR
   **bumps `apps/desktop/package.json`**, tags it, and creates a **GitHub Release**. The maintainer never types
   a version number.
2. **Release build** — when that release is created, a **macOS GitHub Actions job** builds the desktop app
   (electron-vite + electron-builder) and **publishes the `.dmg`** as an asset on the same Release.
3. **About + README** — the About page version **already** reads `apps/desktop/package.json` (which step 1
   bumps), so it updates automatically. The README is rewritten as a short, non-technical "what it is + how to
   install" page; existing dev/tech content moves to `CONTRIBUTING.md`.

**Scope decisions (resolved §12):** **macOS only** for now (the maintainer's platform; `.dmg`); **unsigned**
(no Apple Developer ID yet) with the one-time Gatekeeper bypass documented; **release-please** for versioning
(cloud, free Linux); **build in Actions** on a macOS runner (occasional releases fit the free private-repo
quota); **repo stays private** (downloads by the maintainer + collaborators signed in to GitHub).

## 2. Goals / Non-goals

**Goals**

- **Hands-off versioning** — semver derived from Conventional Commits; no manual bumps or tags.
- A **downloadable macOS installer** on the GitHub Releases page, produced + attached automatically.
- The **About page version auto-updates** (no code change — it already reads the bumped `package.json`).
- A **non-technical README**: a quick "about + install + your data is yours" for a normal person; dev docs
  preserved in `CONTRIBUTING.md`.
- An **auto-generated changelog** per release.

**Non-goals (deferred / out of scope)**

- **Code signing & notarization** — deferred (needs a paid Apple Developer ID). Until then, builds are
  unsigned and the README documents the bypass. (Signing is the prerequisite for the two items below.)
- **Auto-update** (`electron-updater` pulling from Releases) — a great phase 2, but macOS auto-update needs
  signed/notarized builds; deferred with signing.
- **Windows / Linux installers** — the electron-builder config already declares `nsis`/`AppImage`; enabling
  them in the release matrix is a later add (Windows also wants signing to avoid SmartScreen).
- **iOS / App Store** — the Capacitor path ([`07`](07-mobile-platform.md)), entirely separate.
- **Public distribution / a website** — releases live on the private repo's Releases page.

## 3. UX & flows

### 3.1 Maintainer flow (cutting a release)

1. Work lands on `main` as Conventional Commits (already the norm) — `feat:` → minor, `fix:` → patch,
   `feat!:`/`BREAKING CHANGE` → major (pre-1.0: breaking → minor, per release-please's `0.x` behavior).
2. **release-please** keeps a **"Release vX.Y.Z" PR** open, updating the version + `CHANGELOG.md` as commits
   accrue. The maintainer reviews it whenever they want to ship.
3. **Merge the Release PR** → release-please bumps `apps/desktop/package.json`, commits the changelog, creates
   the tag `vX.Y.Z`, and publishes a **GitHub Release**.
4. The **release build job** fires on that release: a macOS runner builds + packages the `.dmg` and uploads it
   to the Release. A few minutes later the installer is downloadable.
5. Nothing else — no version typed, no tag pushed, no local build.

### 3.2 End-user flow (installing)

1. Go to the repo's **Releases** page → download the latest **`SelfOS-x.y.z.dmg`**.
2. Open the `.dmg`, drag **SelfOS** to Applications.
3. **First open (unsigned):** macOS shows "SelfOS can't be opened because it is from an unidentified
   developer" (or "is damaged"). The README explains the one-time fix: **right-click the app → Open → Open**
   (or `xattr -cr /Applications/SelfOS.app`). After that it opens normally.
4. On first run, SelfOS walks them through choosing a vault folder and (for AI features) adding their own
   Claude API key — unchanged ([`02`](02-app-shell.md)).

### 3.3 About-page version

The About settings page already shows the app version from `__APP_VERSION__` (← `apps/desktop/package.json`,
surfaced via the `app:version` IPC). Because release-please bumps that file before the build, **the About
version is always correct with no code change**. _Optional enrichment (flagged §11):_ also show the **git
short-SHA + build date**, injected at build time, so a specific build is identifiable.

### 3.4 The README (non-technical)

Rewrite `README.md` to a short, friendly page aimed at a person, not a developer:

- **What SelfOS is** — a calm, private AI companion for reflection & self-coaching; one or two sentences.
- **The wellness / not-medical + crisis note** (kept verbatim from today's README — CLAUDE.md §1).
- **Your data is yours** — plain files in a folder you choose; nothing leaves your device except the Claude
  API calls you opt into.
- **Install** — download the latest `.dmg` from Releases → drag to Applications → the one-time
  right-click→Open step (unsigned) → on first launch, pick a vault + add your Claude API key (note: AI
  features use your own key and may incur Claude API cost).
- **A screenshot** (optional, nice).
- A one-line pointer: "Developers: see `CONTRIBUTING.md`."

Move the current technical content (tech stack, build phase status, dev commands) into **`CONTRIBUTING.md`**.

## 4. Data model & configuration

No vault data, no schema. The configuration artifacts:

- **Version source of truth** — `apps/desktop/package.json` `version` (read by both `__APP_VERSION__` and
  electron-builder for the installer + `appId`). release-please manages this file. (The root `package.json`
  version is the monorepo's and is left at `0.0.0` / kept in sync only if convenient — the **app** version is
  what ships.)
- **release-please config** — `release-please-config.json` + `.release-please-manifest.json` at the repo root,
  in **manifest mode** scoped to the **single package `apps/desktop`** (`release-type: node`,
  `package-name: SelfOS`), tagging `vX.Y.Z` and writing `apps/desktop/CHANGELOG.md` (or root — §11).
- **electron-builder `publish`** — add a `publish` block to `apps/desktop/electron-builder.yml`:
  `provider: github`, `owner: Highfivery`, `repo: SelfOS` (so `--publish` uploads the `.dmg` to the matching
  Release). `mac.target` stays `dmg`; `win`/`linux` remain declared but are not built by the release matrix
  yet.

## 5. Architecture & modules (CI + packaging)

- **`.github/workflows/release.yml`** (new) — on `push` to `main`:
  1. **`release-please` job** (ubuntu, cheap): runs `googleapis/release-please-action`, which maintains the
     Release PR and, on its merge, creates the tag + GitHub Release. Outputs `releases_created` / `tag_name`.
  2. **`build-macos` job** (`runs-on: macos-latest`, **`if: needs.release-please.outputs.releases_created`**):
     checkout the tag → `pnpm install --frozen-lockfile` → `pnpm --filter @selfos/desktop build` →
     `pnpm --filter @selfos/desktop exec electron-builder --mac --publish always`. Uses the default
     `GITHUB_TOKEN` (with `permissions: contents: write`) as `GH_TOKEN` to upload the `.dmg` to the Release —
     **no extra secret** needed for same-repo publishing, and **no API key or vault data** is in the build.
- **`apps/desktop/package.json`** — a convenience script `"release:build": "electron-builder --mac --publish always"` (also runnable locally for an emergency manual build).
- **About version** — unchanged code; works because the version file is bumped pre-build (§3.3). If §11's
  enrichment is taken: inject `__BUILD_SHA__`/`__BUILD_DATE__` via electron-vite `define` (the
  `__APP_VERSION__` pattern) and show them under the version in About.
- **Existing `ci.yml`** — unchanged (lint/typecheck/test on PRs + main); the release workflow is separate.
- **Docs** — `README.md` rewritten (§3.4); `CONTRIBUTING.md` created from the old technical README content.

## 6. IPC / API contracts

None new. The `app:version` IPC already returns `__APP_VERSION__`; About already consumes it. (If the §11
enrichment is taken, that IPC's payload grows to include sha/date — additive.)

## 7. States & edge cases

- **No releasable commits** (only `docs:`/`chore:`/`test:` since the last release) — release-please opens no
  Release PR; nothing ships. Expected.
- **Release created, build still running** — the Release exists briefly with no `.dmg` until the macOS job
  finishes; the maintainer waits for the asset. (A draft-until-asset option is §11.)
- **Build failure** — the release exists but has no installer; fix-forward (the next patch release) or re-run
  the job. Document in CONTRIBUTING.
- **Unsigned first-open** — handled by the README's right-click→Open / `xattr` instructions (§3.2); the app is
  otherwise fully functional.
- **Version drift** — guarded: the About version and the installer version both derive from the **same**
  `apps/desktop/package.json`, so they can't disagree. A unit/E2E assert (`__APP_VERSION__` === the file's
  version) backs this (§10).
- **Free-quota overage** — occasional releases fit the private-repo free Actions minutes (macOS bills 10×; a
  ~10-min build ≈ 100 minutes; ~2000 free/mo). If releases become frequent, revisit (local build, or sign +
  cache). Documented, not enforced.
- **First release from `0.0.0`** — the initial Release PR establishes the starting version (§11 — propose
  `0.1.0`); subsequent ones follow the commits.

## 8. Safety

Technical/release spec — no wellbeing surface. Two safety-adjacent points: (1) the **README keeps the
wellness/not-medical boundary + crisis line** (CLAUDE.md §1) prominently, since it's the first thing a new user
reads; (2) **no secrets ship** — the build contains no Claude API key (it's device-local, added by the user at
runtime) and the workflow uses only the ephemeral `GITHUB_TOKEN`; nothing sensitive is logged or bundled.

## 9. Accessibility

The README is plain, well-structured Markdown (headings, short sentences, clear install steps). The About
version display is unchanged (already accessible). N/A beyond that.

## 10. Testing strategy

- **Unit (desktop):** assert `__APP_VERSION__` equals `apps/desktop/package.json` `version` (drift guard); the
  `app:version` IPC returns it. (If §11 enrichment: the payload includes sha/date.)
- **Component (RTL):** the About page renders the injected version (already covered; extend if enriched).
- **CI validation:** the **release workflow is exercised by performing a real first release** (the pipeline
  can't be meaningfully E2E-mocked) — confirm the Release PR opens, merging it bumps the version + creates the
  Release, the macOS job builds + uploads a `.dmg`, and a downloaded build **opens and shows the matching
  version in About**. A workflow `--dry-run`/`act` lint pass is a nice-to-have.
- **Smoke:** the published `.dmg` installs and launches on a clean macOS (manual, by the maintainer — the
  unsigned bypass included).
- Run `pnpm typecheck` after any test changes (memory `vitest-does-not-typecheck`).

## 11. Open questions

_All resolved (2026-06-15):_

- **Initial version** → **`0.1.0`** (pre-1.0).
- **Changelog** → **root `CHANGELOG.md`** (single-app repo, most discoverable).
- **About enrichment** → **yes** — show version + **git short-SHA + build date** (e.g. "v0.1.0 · a1b2c3d ·
  2026-06-15"), injected at build time via the `__APP_VERSION__` pattern (`__BUILD_SHA__`/`__BUILD_DATE__`).
- **Draft-until-asset** → **yes** — the release is a **draft** until the macOS job attaches the `.dmg`, then
  flips to published (users never see an asset-less release).
- **CONTRIBUTING.md** → move the current README technical content **verbatim** now; refresh later.

The spec is build-ready pending final approval; only the real first-release smoke test (§10) remains.

## 12. Resolved decisions (2026-06-15)

- **Platforms** — **macOS only** (`.dmg`) for now; Windows/Linux deferred (config already declares them).
- **Signing** — **unsigned now**; the README documents the one-time Gatekeeper bypass; Developer-ID signing +
  notarization (and auto-update) are a later phase.
- **Versioning** — **release-please** (Conventional Commits → a Release PR → version bump + tag + GitHub
  Release); the maintainer never hand-edits a version.
- **Build** — **in GitHub Actions on a macOS runner**, triggered by the release; occasional releases fit the
  private-repo free Actions quota.
- **Repo** — stays **private**; downloads by the maintainer + collaborators signed in to GitHub.
- **About version** — auto-updates (already reads the release-please-bumped `apps/desktop/package.json`); no
  code change required.
- **README** — rewritten **non-technical** (about + install + privacy + crisis note); dev/tech content moves
  to `CONTRIBUTING.md` (verbatim now).
- **First version** `0.1.0`; **changelog** at root `CHANGELOG.md`; **About** shows version + short-SHA + build
  date; the GitHub Release is a **draft until the `.dmg` is attached**, then published.

## 13. Changelog

- 2026-06-15 — created (Review). Decisions resolved ask-first. Automates versioning (release-please), adds the
  macOS release-build workflow publishing the `.dmg` to GitHub Releases, auto-updates the About version, and
  rewrites the README for non-technical users (dev docs → CONTRIBUTING.md). Build-ready pending final approval.
