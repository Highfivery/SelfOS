<div align="center">

<img src="site/favicon.svg" alt="SelfOS" width="76" height="76" />

# SelfOS

### A coach that truly knows you — and never leaves your device.

A calm, private **AI therapist &amp; life coach** for macOS. SelfOS gets to know you, remembers
across time, and keeps everything in encrypted files that live on **your** computer — powered by
your own Claude API key.

**[🌱 Visit the website](https://highfivery.github.io/SelfOS/)** &nbsp;·&nbsp;
**[⬇️ Download for macOS](https://github.com/Highfivery/SelfOS/releases/latest)** &nbsp;·&nbsp;
**[🛠️ Build from source](CONTRIBUTING.md)**

![Platform: macOS](https://img.shields.io/badge/platform-macOS-2e2a25?style=flat-square)
![Latest release](https://img.shields.io/github/v/release/Highfivery/SelfOS?style=flat-square&color=4f7388)
![Powered by Claude](https://img.shields.io/badge/AI-Claude-4f7388?style=flat-square)
![Local-first](https://img.shields.io/badge/data-local--first%20%26%20encrypted-5e8c6a?style=flat-square)

</div>

---

> [!IMPORTANT]
> **SelfOS is a wellness and self-help tool — it is _not_ a medical device, _not_ therapy in the
> clinical sense, and _not_ a substitute for professional care.** It does not diagnose or treat.
> If you are in crisis or may be a danger to yourself or others, contact local emergency services
> or a crisis line right away.

## What is SelfOS?

Most AI tools forget you the moment you close the tab. SelfOS is the opposite: a deeply personal
companion for reflection and self-coaching that **remembers, connects the dots, and gently moves you
forward** — across conversations, dreams, relationships, and time. And it does all of it **privately**:
there is no SelfOS server and no account. Your inner life stays in files you own.

## Highlights

- **🗣️ Coaching sessions** — a streaming, judgment-free AI coach grounded in who you actually are.
- **🌱 It gets to know you** — a warm, guided onboarding builds a rich personal portrait that keeps
  itself up to date as life changes.
- **🧠 Living memory** — confidence-rated insights organized by life-area that reconcile over time;
  you can edit, flag, or correct anything it learns.
- **✨ Proactive coaching** — it follows up on your goals, spots patterns across sessions and dreams,
  and nudges next steps. Fully tunable, never naggy.
- **🧭 Guided exercises** — a library of self-guided exercises informed by CBT, ACT, GROW and more,
  plus a smart "suggested for you".
- **🌙 Dreams + AI imagery** — capture dreams in seconds, work through a guided analysis, track
  recurring patterns, and visualize any dream as private AI art.
- **🤝 Built for couples &amp; households** — multiple people and the relationships between them, with
  **relationship-scoped privacy**: "shared" means it can _inform_ another person's coach, never that
  it's shown to them.
- **📋 Questionnaires &amp; compatibility** — send hand-written or AI-drafted questionnaires in-app or
  via a private zero-knowledge link, or run a two-person compatibility check.
- **💞 Relationship &amp; intimacy tracking** — a frictionless check-in and a partner dashboard
  (connection, desire, appreciation, conflict) — both-consent, never covert.
- **🔐 You hold the keys** — encrypted at rest with a master key only your devices hold; recovery
  phrase, multi-device join, device revocation, and key rotation.
- **💸 Transparent cost control** — bring your own Claude key with per-person and household budgets,
  prompt caching, and a usage view to keep spend visible.

→ See it all on the **[website](https://highfivery.github.io/SelfOS/)**.

## Your data is yours

SelfOS keeps everything in plain, encrypted files inside a folder **you** choose — on your Mac, or a
synced folder like iCloud or Dropbox if you want it on more than one device. Nothing is uploaded to
us or stored on a server.

The only things that ever leave your computer are:

1. The messages you send to the **Claude API** when you choose to use an AI feature — using **your
   own** Claude API key, billed directly to your Anthropic account.
2. A lightweight **update check** to GitHub so the app can tell you when a newer version exists. It
   sends no personal data, and you can turn it off in **Settings → About**.

There is no SelfOS in that picture. Your content stays yours.

## Install (macOS)

1. Go to the **[Releases](https://github.com/Highfivery/SelfOS/releases)** page and download the
   latest **`SelfOS-x.y.z.dmg`**.
2. Open the `.dmg` and drag **SelfOS** into your **Applications** folder.
3. **First time you open it:** because SelfOS isn't yet signed with an Apple Developer certificate,
   macOS blocks it — usually with **"SelfOS is damaged and can't be opened"** (this is the standard
   warning for unsigned apps; the app is **not** actually damaged). To allow it, open **Terminal**,
   run the one-time command below, then open SelfOS normally:

   ```sh
   xattr -cr /Applications/SelfOS.app
   ```

   You only need to do this once. (On older macOS you may instead see "unidentified developer", in
   which case **right-click the app → Open → Open** also works — the `xattr` command fixes both.)

4. On first launch, SelfOS helps you **pick a vault folder** (where your data lives) and **add your
   own Claude API key** for the AI features.
   - The AI features call the Claude API using your key, which **may incur cost** on your Anthropic
     account. SelfOS includes budgets and a usage view to keep that in check.

## How it works

1. **Choose your vault** — a folder for your data (local, or a synced folder for multiple devices).
2. **Add your Claude key** — SelfOS uses it directly; there's no middleman and no subscription to us.
3. **Tell it about you** — a guided intake builds your portrait so the first session already gets you.
4. **Reflect &amp; grow** — talk, journal, dream, set goals; SelfOS remembers and checks back in.

## Platforms &amp; status

SelfOS is in active development, built spec-first and slice by slice (see
[`docs/specs/`](docs/specs)). Today it ships for **macOS** (currently unsigned — see the Gatekeeper
note above). An **iPhone** companion that shares the same vault over iCloud Drive is in progress;
Windows and Linux are later phases.

## Developers

Building from source, the architecture, the tech stack, the spec-driven workflow, and how releases
work are all in **[CONTRIBUTING.md](CONTRIBUTING.md)**. The full design is documented spec-by-spec in
**[`docs/specs/`](docs/specs)**.

---

<div align="center">

_An AI therapist &amp; life coach for reflection and self-coaching — calm, private, and entirely yours._

**Not medical software.** If you are in crisis, contact local emergency services or a crisis line.

</div>
