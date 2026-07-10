import { externalSendDisclosure } from '@selfos/core/questionnaires';
import type { CompatibilityVisibility, InboxItem, PrivacyMode } from '@shared/channels';

/**
 * The landing cards' privacy chip (08 §3.1 card privacy badges) — pure label/tooltip derivation, so the
 * card can state whether the answers are private or visible at a glance. Wording is DERIVED (the §8.4
 * honesty guard): the received side reuses `externalSendDisclosure` verbatim; the compatibility labels
 * mirror `compatibilityDisclosure` per mode (name-free — the other participant isn't known at list level).
 */
export interface PrivacyBadge {
  icon: 'lock' | 'eye' | 'report' | 'mixed';
  /** True for the accent-tinted "protected" family; false for the neutral "answers visible" outline. */
  protectedTone: boolean;
  label: string;
  /** The full honest sentence — the chip's tooltip. */
  detail: string;
}

/** The sender's chip on a Sent card (non-compatibility): the recipients' latest-send privacy. */
export function sentPrivacyBadge(privacy: PrivacyMode | 'mixed'): PrivacyBadge {
  if (privacy === 'private') {
    return {
      icon: 'lock',
      protectedTone: true,
      label: 'Private · insights only',
      detail:
        'You see the insight drawn from their answers — never the answers themselves. Numeric ratings may appear in your trends.',
    };
  }
  if (privacy === 'standard') {
    return {
      icon: 'eye',
      protectedTone: false,
      label: 'Answers visible',
      detail: 'Their answers are shown to you in Results.',
    };
  }
  return {
    icon: 'mixed',
    protectedTone: false,
    label: 'Mixed privacy',
    detail:
      'Recipients were sent this with different privacy settings — check each send in Results.',
  };
}

/** The sender's chip on a compatibility Sent card: the visibility mode IS the privacy promise. */
export function sentCompatibilityBadge(visibility: CompatibilityVisibility): PrivacyBadge {
  switch (visibility) {
    case 'sharedReport':
      return {
        icon: 'report',
        protectedTone: true,
        label: 'Combined report',
        detail: 'Neither of you sees the other’s answers — you both get one combined report.',
      };
    case 'eachSeesOwn':
      return {
        icon: 'report',
        protectedTone: true,
        label: 'Report + own answers',
        detail:
          'You each get the combined report and can review your own answers — never each other’s.',
      };
    case 'senderSeesAll':
      return {
        icon: 'eye',
        protectedTone: false,
        label: 'You see all answers',
        detail: 'You can see both sets of answers, and you both get a combined report.',
      };
    case 'contextOnly':
      return {
        icon: 'lock',
        protectedTone: true,
        label: 'Context only',
        detail:
          'No report, and no one sees the answers — they quietly inform each person’s own coach.',
      };
  }
}

/** The recipient's chip on a Received card — what the sender will (and won't) see. */
export function receivedPrivacyBadge(
  item: Pick<InboxItem, 'privacy' | 'senderName' | 'compatibilityVisibility'>,
): PrivacyBadge {
  const sender = item.senderName ?? 'Someone';
  if (item.compatibilityVisibility) {
    switch (item.compatibilityVisibility) {
      case 'sharedReport':
        return {
          icon: 'report',
          protectedTone: true,
          label: 'Combined report',
          detail:
            'Your answers stay private — neither of you sees the other’s. You’ll both get one combined report.',
        };
      case 'eachSeesOwn':
        return {
          icon: 'report',
          protectedTone: true,
          label: 'Report + your answers',
          detail:
            'Your answers stay private to you. You’ll both get a combined report, and you can review your own answers.',
        };
      case 'senderSeesAll':
        return {
          icon: 'eye',
          protectedTone: false,
          label: `Shared with ${sender}`,
          // Verbatim `compatibilityDisclosure('senderSeesAll', …)` for a non-sender viewer — pinned by a
          // unit test so the two sources can't drift.
          detail: `Your answers will be shared with ${sender}, and you'll both get a combined report.`,
        };
      case 'contextOnly':
        return {
          icon: 'lock',
          protectedTone: true,
          label: 'Context only',
          // Verbatim `compatibilityDisclosure('contextOnly', …)` (name-free by construction) — pinned.
          detail: `There's no report, and no one in this exchange sees your answers — they just help your own coach understand you a little better.`,
        };
    }
  }
  return item.privacy === 'private'
    ? {
        icon: 'lock',
        protectedTone: true,
        label: 'Your answers stay private',
        detail: externalSendDisclosure(sender, 'private'),
      }
    : {
        icon: 'eye',
        protectedTone: false,
        label: `${sender} sees your answers`,
        detail: externalSendDisclosure(sender, 'standard'),
      };
}
