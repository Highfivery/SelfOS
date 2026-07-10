import { describe, expect, it } from 'vitest';
import { compatibilityDisclosure } from '@selfos/core/questionnaires';
import { receivedPrivacyBadge, sentCompatibilityBadge, sentPrivacyBadge } from './privacyBadge';

describe('privacyBadge (08 §3.1 card privacy badges)', () => {
  it('sent: private is the protected accent chip, standard the neutral "visible" one, mixed honest', () => {
    const priv = sentPrivacyBadge('private');
    expect(priv.label).toBe('Private · insights only');
    expect(priv.protectedTone).toBe(true);
    expect(priv.detail).toMatch(/never the answers themselves/);

    const std = sentPrivacyBadge('standard');
    expect(std.label).toBe('Answers visible');
    expect(std.protectedTone).toBe(false);

    const mixed = sentPrivacyBadge('mixed');
    expect(mixed.label).toBe('Mixed privacy');
    expect(mixed.detail).toMatch(/different privacy settings/);
  });

  it('sent compatibility: every visibility mode gets its own honest label — senderSeesAll is NOT "private"', () => {
    expect(sentCompatibilityBadge('sharedReport').label).toBe('Combined report');
    expect(sentCompatibilityBadge('eachSeesOwn').label).toBe('Report + own answers');
    expect(sentCompatibilityBadge('contextOnly').label).toBe('Context only');
    const all = sentCompatibilityBadge('senderSeesAll');
    expect(all.label).toBe('You see all answers');
    expect(all.protectedTone).toBe(false);
  });

  it('received: names the sender and reuses the derived externalSendDisclosure wording verbatim', () => {
    const priv = receivedPrivacyBadge({ privacy: 'private', senderName: 'Ben' });
    expect(priv.label).toBe('Your answers stay private');
    // The §8.4 honesty guard: the tooltip is the SAME derived sentence the answering surfaces show.
    expect(priv.detail).toMatch(/Ben won’t see your written answers/);
    expect(priv.detail).toMatch(/Numeric ratings may appear in their trends/);

    const std = receivedPrivacyBadge({ privacy: 'standard', senderName: 'Ben' });
    expect(std.label).toBe('Ben sees your answers');
    expect(std.detail).toMatch(/shared with Ben/);

    // An anonymous sender falls back to a neutral label instead of "null".
    expect(receivedPrivacyBadge({ privacy: 'standard', senderName: null }).label).toBe(
      'Someone sees your answers',
    );
  });

  it('received compatibility: the visibility mode wins over the plain privacy field', () => {
    const shared = receivedPrivacyBadge({
      privacy: 'private',
      senderName: 'Ben',
      compatibilityVisibility: 'sharedReport',
    });
    expect(shared.label).toBe('Combined report');
    expect(shared.protectedTone).toBe(true);

    const all = receivedPrivacyBadge({
      privacy: 'private',
      senderName: 'Ben',
      compatibilityVisibility: 'senderSeesAll',
    });
    expect(all.label).toBe('Shared with Ben');
    expect(all.protectedTone).toBe(false);
  });

  it('the name-free compat tooltips stay VERBATIM with compatibilityDisclosure (drift fence)', () => {
    // senderSeesAll + contextOnly never use the other participant's name, so the chip can (and must)
    // reuse the core sentence byte-for-byte — if core rewords, this fails and forces a conscious re-sync.
    const ctx = { otherParticipantName: 'unused', senderName: 'Ben', viewerIsSender: false };
    expect(
      receivedPrivacyBadge({
        privacy: 'private',
        senderName: 'Ben',
        compatibilityVisibility: 'senderSeesAll',
      }).detail,
    ).toBe(compatibilityDisclosure('senderSeesAll', ctx));
    expect(
      receivedPrivacyBadge({
        privacy: 'private',
        senderName: 'Ben',
        compatibilityVisibility: 'contextOnly',
      }).detail,
    ).toBe(compatibilityDisclosure('contextOnly', ctx));
  });
});
