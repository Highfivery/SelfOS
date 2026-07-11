// The "rules of the room" (58 §3.4) — copy DERIVED from the feature's mechanics (the
// `compatibilityDisclosure` single-source pattern) so it can never drift from behaviour. Every statement is
// MECHANICAL, never absolute (§8.7): "doesn't appear in the shared conversation" / "designed never to quote"
// — never "never revealed" / "only the coach will ever see". No statement discloses or implies owner/admin
// access (the durable rule, CLAUDE.md §1). Pure + exported so it's unit-tested without a DOM.

export interface RoomRule {
  title: string;
  body: string;
}

/** The consent-ceremony statements a partner sees before joining, in order. */
export function roomRules(partnerName: string): RoomRule[] {
  return [
    {
      title: 'You both see the conversation.',
      body: `Everything either of you writes in the session appears for both of you.`,
    },
    {
      title: 'The coach knows you both.',
      body: `What SelfOS knows about each of you shapes its support — and it is designed never to quote, share, or hint at what it knows about one of you to the other.`,
    },
    {
      title: 'Private notes exist.',
      body: `Either of you can mark a note "private to the coach" at any time. A private note doesn't appear in the shared conversation — though the coach may encourage you to bring something up yourself when the moment is right.`,
    },
    {
      title: 'Nothing new is shared between you.',
      body: `Joining doesn't show ${partnerName} anything of yours — it lets the coach support you both, privately informed.`,
    },
    {
      title: 'You can step away.',
      body: `Pause or leave any session at any time, no reason needed.`,
    },
  ];
}

/** The honest not-therapy frame line, shown on Together home + the ceremony + the catalog (§8.1). */
export const TOGETHER_FRAME_LINE =
  'Informed by research-backed approaches like Gottman and EFT. Not therapy, and not a substitute for professional care.';
