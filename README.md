# SelfOS

SelfOS is a calm, private AI companion for reflection and self-coaching — a space to think things
through, notice patterns, and look after yourself. Everything stays on your own computer.

> ⚠️ SelfOS is a wellness and self-help tool. It is **not** a medical device and **not** a
> substitute for professional care. If you are in crisis, contact local emergency services or
> a crisis line.

## Your data is yours

SelfOS keeps everything in plain files inside a folder **you** choose — on your Mac, or a synced
folder like iCloud or Dropbox if you want it on more than one device. Nothing is uploaded to us or
stored on a server. The only thing that ever leaves your computer is the message you send to the
Claude AI when you choose to use an AI feature, using **your own** Claude API key.

## Install (macOS)

1. Go to the **[Releases](https://github.com/Highfivery/SelfOS/releases)** page and download the
   latest **`SelfOS-x.y.z.dmg`**.
2. Open the `.dmg` and drag **SelfOS** into your **Applications** folder.
3. **First time you open it:** because SelfOS isn't yet signed with an Apple Developer certificate,
   macOS blocks it — usually with **"SelfOS is damaged and can't be opened"** (this is the standard
   warning for unsigned apps; the app is **not** actually damaged). To allow it, open **Terminal**,
   run the one-time command below, then open SelfOS normally:

   ```
   xattr -cr /Applications/SelfOS.app
   ```

   - You only need to do this once. (On older macOS you may instead see "unidentified developer", in
     which case **right-click the app → Open → Open** also works — but the `xattr` command above
     fixes both cases.)

4. On first launch, SelfOS will help you **pick a vault folder** (where your data lives) and, for the
   AI features, **add your own Claude API key**.
   - The AI features call the Claude API using your key, which **may incur cost** on your Anthropic
     account. You can use SelfOS without an API key; the AI-powered parts simply stay off until you
     add one.

## Developers

Building from source, the tech stack, and how releases work are in
**[CONTRIBUTING.md](CONTRIBUTING.md)**.
