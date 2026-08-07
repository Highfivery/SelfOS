import { describe, expect, it } from 'vitest';
import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';
import { updateEmailConfig } from './emailConfig';
import { readEmailPrefs, setEmailPrefs } from './emailPrefs';
import {
  drainEmailTaps,
  editEmailResponse,
  listEmailResponses,
  mintEmailToken,
  type TapDrainer,
} from './emailResponse';

const key = generateMasterKey();
const PERSON = 'me';
const now = new Date('2026-08-20T12:00:00.000Z');

/** A fake relay tap-drainer that reports a fixed set of tokens as tapped. */
function drainerFor(tapped: Record<string, string>): TapDrainer {
  return {
    drainTaps: (tokens) =>
      Promise.resolve(
        tokens
          .filter((t) => tapped[t] !== undefined)
          .map((t) => ({ token: t, at: tapped[t] as string })),
      ),
  };
}

async function mintReeng(fs: ReturnType<typeof memFileSystem>, interactionId: string) {
  await mintEmailToken(fs, key, PERSON, {
    token: 'T-here',
    schemaVersion: 1,
    interactionId,
    family: 're-engagement',
    kind: 'reaction',
    answer: 'im-here',
    mintedAt: now.toISOString(),
  });
  await mintEmailToken(fs, key, PERSON, {
    token: 'T-pause',
    schemaVersion: 1,
    interactionId,
    family: 're-engagement',
    kind: 'reaction',
    answer: 'pause',
    mintedAt: now.toISOString(),
  });
}

describe('drainEmailTaps (67 §3.5/§3.6 / Phase 4)', () => {
  it('maps a tapped token → an EmailResponse, consumes the whole interaction, drops nothing untapped', async () => {
    const fs = memFileSystem();
    await mintReeng(fs, 'ix-1');
    const created = await drainEmailTaps(
      fs,
      key,
      PERSON,
      drainerFor({ 'T-here': '2026-08-21T09:00:00.000Z' }),
      now,
    );
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      family: 're-engagement',
      kind: 'reaction',
      answer: 'im-here',
      source: 'relay-tap',
      respondedAt: '2026-08-21T09:00:00.000Z',
    });
    // The tap is recorded in the history.
    expect(await listEmailResponses(fs, key, PERSON)).toHaveLength(1);
    // Both option tokens (the tapped one + its sibling) are consumed — a second drain finds nothing.
    const again = await drainEmailTaps(
      fs,
      key,
      PERSON,
      drainerFor({ 'T-pause': '2026-08-21T09:00:00.000Z' }),
      now,
    );
    expect(again).toHaveLength(0);
  });

  it('a `pause` reaction on re-engagement turns that family OFF (one-click unsubscribe)', async () => {
    const fs = memFileSystem();
    await updateEmailConfig(fs, key, { fromAddress: 'hi@fam.example' }, now);
    await setEmailPrefs(fs, key, PERSON, { address: 'me@inbox.example' }, false, now);
    await mintReeng(fs, 'ix-2');
    await drainEmailTaps(
      fs,
      key,
      PERSON,
      drainerFor({ 'T-pause': '2026-08-21T09:00:00.000Z' }),
      now,
    );
    const prefs = await readEmailPrefs(fs, key, PERSON);
    expect(prefs?.families?.['re-engagement']).toBe(false);
  });

  it('a re-engagement `pause` preserves a legitimately-true intimacy opt-in (no silent unsubscribe)', async () => {
    const fs = memFileSystem();
    await updateEmailConfig(fs, key, { fromAddress: 'hi@fam.example' }, now);
    // The person is eligible + opted in to intimacy email (Phase-5 state) — a re-engagement pause must NOT
    // strip it (setEmailPrefs coerces intimacyEmailOptIn off when told the person is ineligible).
    await setEmailPrefs(
      fs,
      key,
      PERSON,
      { address: 'me@inbox.example', intimacyEmailOptIn: true },
      true,
      now,
    );
    await mintReeng(fs, 'ix-int-preserve');
    await drainEmailTaps(
      fs,
      key,
      PERSON,
      drainerFor({ 'T-pause': '2026-08-21T09:00:00.000Z' }),
      now,
    );
    const prefs = await readEmailPrefs(fs, key, PERSON);
    expect(prefs?.families?.['re-engagement']).toBe(false);
    expect(prefs?.intimacyEmailOptIn).toBe(true); // preserved
  });

  it('prunes tokens older than the tap TTL so the local store stays bounded', async () => {
    const fs = memFileSystem();
    // A stale token minted 31 days ago (past the relay's 30-day tap TTL) — can never resolve.
    await mintEmailToken(fs, key, PERSON, {
      token: 'T-stale',
      schemaVersion: 1,
      interactionId: 'ix-stale',
      family: 're-engagement',
      kind: 'reaction',
      answer: 'im-here',
      mintedAt: new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString(),
    });
    await mintReeng(fs, 'ix-fresh'); // fresh tokens
    await drainEmailTaps(fs, key, PERSON, drainerFor({}), now); // nothing tapped
    // The stale token is gone; the fresh ones remain (a later tap still resolves).
    const [res] = await drainEmailTaps(
      fs,
      key,
      PERSON,
      drainerFor({ 'T-stale': now.toISOString(), 'T-here': now.toISOString() }),
      now,
    );
    expect(res?.answer).toBe('im-here'); // T-stale was pruned, so only the fresh T-here resolves
  });

  it('an intimacy reaction is stored at the intimacy tier', async () => {
    const fs = memFileSystem();
    await mintEmailToken(fs, key, PERSON, {
      token: 'T-int',
      schemaVersion: 1,
      interactionId: 'ix-int',
      family: 'ai-suggestion-intimacy',
      kind: 'intimacy-reaction',
      answer: 'im-game',
      mintedAt: now.toISOString(),
    });
    const [res] = await drainEmailTaps(
      fs,
      key,
      PERSON,
      drainerFor({ 'T-int': '2026-08-21T09:00:00.000Z' }),
      now,
    );
    expect(res?.sensitivity).toBe('intimacy');
  });

  it('editing a response stamps `edited` and changes the answer', async () => {
    const fs = memFileSystem();
    await mintReeng(fs, 'ix-3');
    const [res] = await drainEmailTaps(
      fs,
      key,
      PERSON,
      drainerFor({ 'T-here': '2026-08-21T09:00:00.000Z' }),
      now,
    );
    const edited = await editEmailResponse(
      fs,
      key,
      PERSON,
      res!.id,
      'im-here (later changed my mind)',
    );
    expect(edited).toMatchObject({ answer: 'im-here (later changed my mind)', edited: true });
    expect((await listEmailResponses(fs, key, PERSON))[0]?.edited).toBe(true);
  });

  it('no pending tokens → drains nothing (no relay call needed)', async () => {
    const fs = memFileSystem();
    let called = false;
    const relay: TapDrainer = {
      drainTaps: () => {
        called = true;
        return Promise.resolve([]);
      },
    };
    expect(await drainEmailTaps(fs, key, PERSON, relay, now)).toHaveLength(0);
    expect(called).toBe(false);
  });
});
