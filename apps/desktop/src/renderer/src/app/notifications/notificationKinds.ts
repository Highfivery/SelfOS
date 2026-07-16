import type { LucideIcon } from 'lucide-react';
import {
  ClipboardCheck,
  ClipboardList,
  Clock,
  Download,
  Flag,
  Heart,
  Lock,
  MessageCircle,
  PencilLine,
  RefreshCw,
  Sparkles,
  Target,
} from 'lucide-react';
import type {
  Notification,
  NotificationAction,
  NotificationKind,
  NotificationSeverity,
  PersonNotificationState,
} from '@shared/channels';

/**
 * The extensible notification registry (35-notification-system §3.3/§5). Each kind declares its icon,
 * default severity (→ a design-system Banner tone, no new colors), and how a re-raise re-surfaces a
 * dismissed/read item. A new kind = a literal in `NOTIFICATION_KINDS` (core) + an entry here.
 */
interface KindDef {
  icon: LucideIcon;
  severity: NotificationSeverity;
  /**
   * Whether an item dismissed/read at `prevSig` should re-surface now its signature is `curSig`.
   * Default (`onChange`): any change re-surfaces. `sync-conflict`/`responses-arrived` use `onIncrease` so
   * resolving some (fewer conflicts) never re-pops a notification — only MORE does (35 §11).
   */
  resurfaces: (prevSig: string, curSig: string) => boolean;
}

const onChange = (prev: string, cur: string): boolean => prev !== cur;
const onIncrease = (prev: string, cur: string): boolean => {
  const p = Number(prev);
  const c = Number(cur);
  return Number.isFinite(p) && Number.isFinite(c) ? c > p : prev !== cur;
};
// For comma-joined id sets (profile-freshness): re-surface only when a BRAND-NEW id appears (§11) — a
// shrinking set (the user acted on a suggestion elsewhere) must NOT re-pop a dismissed notification.
const onNewMember = (prev: string, cur: string): boolean => {
  const prevSet = new Set(prev.split(',').filter(Boolean));
  return cur
    .split(',')
    .filter(Boolean)
    .some((id) => !prevSet.has(id));
};

export const NOTIFICATION_KIND_DEFS: Record<NotificationKind, KindDef> = {
  'update-available': { icon: Download, severity: 'warning', resurfaces: onChange },
  'profile-freshness': { icon: Sparkles, severity: 'info', resurfaces: onNewMember },
  'responses-arrived': { icon: ClipboardCheck, severity: 'info', resurfaces: onIncrease },
  // A gentle "still unanswered" nudge to the SENDER (38 §3.3). onIncrease so dismissing it never re-nags
  // unless ANOTHER send passes the window — answering/resolving some never re-pops it.
  'reminder-due': { icon: Clock, severity: 'info', resurfaces: onIncrease },
  'sync-conflict': { icon: RefreshCw, severity: 'warning', resurfaces: onIncrease },
  // A gentle check-in on a stale/due goal (40 §3.2). onChange: acting on the goal changes its signature
  // (id + updatedAt) so a dismissed nudge stays dismissed until the goal itself changes, and resolving the
  // stalest one surfaces the next (≤1 open at a time, coalesced by the fixed 'goal-followup' key).
  'goal-followup': { icon: Target, severity: 'info', resurfaces: onChange },
  // The cross-feature synthesis observation (40 §3.3). onChange: a NEW synthesis (a later computedAt)
  // supersedes a dismissed one; a same-area depth/freshness nudge suppresses it upstream (§3.7).
  'coaching-synthesis': { icon: Sparkles, severity: 'info', resurfaces: onChange },
  // A gentle "how did your challenge go?" check-in (52 §3.5). onChange: acting on the challenge changes its
  // signature (id + checkInAt) so a dismissed nudge stays dismissed until the challenge changes; ≤1 open at a
  // time, coalesced by the fixed 'challenge-followup' key.
  'challenge-followup': { icon: Flag, severity: 'info', resurfaces: onChange },
  // Completed onboarding has new/unanswered questions (55 §3.1). onIncrease so dismissing it never re-nags
  // unless MORE appears (a later app update adds questions/sections) — answering some never re-pops it.
  'onboarding-updated': { icon: ClipboardList, severity: 'info', resurfaces: onIncrease },
  // A recipient edited + resubmitted after the sender analyzed them (56 §3.2) — nudges a re-analyze. onIncrease
  // by revision: dismissing (or re-analyzing, which drops the candidate) never re-nags until they edit again.
  'answers-updated': { icon: PencilLine, severity: 'info', resurfaces: onIncrease },
  // A partner invited you to a Together session (58 §3.11). Registered now (Phase A); the candidate provider
  // lands in Phase B. onChange: a fresh invite (a new session id) re-surfaces.
  'together-invite': { icon: Heart, severity: 'info', resurfaces: onChange },
  // Your turn in a Together session (58 §3.11), coalesced per session. onChange by the latest message in the
  // recipient's PROJECTION — an aside never changes the partner's signature, so it never re-pops here.
  'together-turn': { icon: MessageCircle, severity: 'info', resurfaces: onChange },
  // The coach left a private note just for you (58 §3.14 Part B), coalesced per session. onChange by the
  // note's ts — a NEW private note re-surfaces; it never carries the note's text.
  'together-private': { icon: Lock, severity: 'info', resurfaces: onChange },
  // An auto-generated check-in is waiting (63 §6.4). onIncrease by count: dismissing never re-nags unless
  // ANOTHER arrives; answering some (a lower count) never re-pops it.
  'auto-checkin-ready': { icon: ClipboardList, severity: 'info', resurfaces: onIncrease },
  // The one-time "Auto check-ins is now on" seed notice (63 §5.1). onChange: the seed fires once (write-once),
  // so the candidate is pushed once and, once dismissed, never returns (the seed can't re-fire).
  'auto-checkin-enabled': { icon: Sparkles, severity: 'info', resurfaces: onChange },
};

/** The icon for a kind (used by the bell rows + toasts). */
export function notificationIcon(kind: NotificationKind): LucideIcon {
  return NOTIFICATION_KIND_DEFS[kind].icon;
}

/** A notification before read/dismissed resolution — what a source contributes for one slot. */
export interface NotificationCandidate {
  kind: NotificationKind;
  /** Stable per-slot key (one notification per key); re-raising the same key updates in place. */
  coalesceKey: string;
  /** The current condition value (count/version/id). Re-surfacing compares this to the persisted one. */
  signature: string;
  title: string;
  body?: string;
  /** Defaults to the kind's severity when omitted. */
  severity?: NotificationSeverity;
  action?: NotificationAction;
  /** ISO timestamp for newest-first ordering. Defaults to the resolve time when omitted. */
  createdAt?: string;
}

/** Whether a flag set at `prevSig` STILL covers `curSig` (i.e. the item should remain read/dismissed). */
function stillCovers(kind: NotificationKind, prevSig: string | undefined, curSig: string): boolean {
  if (prevSig === undefined) return false;
  return !NOTIFICATION_KIND_DEFS[kind].resurfaces(prevSig, curSig);
}

/**
 * Resolve raw candidates against the persisted read/dismissed signatures into the list the center renders.
 * A dismissed item whose condition hasn't changed (per its kind) is dropped entirely; a read item stays
 * but doesn't count toward the unread badge. Coalesces to one item per key, newest first. Pure — so the
 * coalescing + re-surfacing rules are unit-tested without a DOM (35 §10).
 */
export function resolveNotifications(
  candidates: NotificationCandidate[],
  persisted: PersonNotificationState,
  now: string,
): Notification[] {
  // Coalesce: one candidate per key (a source contributes a single slot per key; last wins defensively).
  const byKey = new Map<string, NotificationCandidate>();
  for (const candidate of candidates) byKey.set(candidate.coalesceKey, candidate);

  const out: Notification[] = [];
  for (const candidate of byKey.values()) {
    const dismissed = stillCovers(
      candidate.kind,
      persisted.dismissed[candidate.coalesceKey],
      candidate.signature,
    );
    if (dismissed) continue; // dismissed + condition unchanged → not shown at all
    const read = stillCovers(
      candidate.kind,
      persisted.read[candidate.coalesceKey],
      candidate.signature,
    );
    out.push({
      id: `${candidate.coalesceKey}#${candidate.signature}`,
      kind: candidate.kind,
      severity: candidate.severity ?? NOTIFICATION_KIND_DEFS[candidate.kind].severity,
      title: candidate.title,
      ...(candidate.body !== undefined ? { body: candidate.body } : {}),
      ...(candidate.action !== undefined ? { action: candidate.action } : {}),
      createdAt: candidate.createdAt ?? now,
      coalesceKey: candidate.coalesceKey,
      signature: candidate.signature,
      read,
      dismissed: false,
    });
  }
  // Newest first; stable tiebreak on key so the order never churns between equal-time items.
  out.sort((a, b) =>
    a.createdAt < b.createdAt
      ? 1
      : a.createdAt > b.createdAt
        ? -1
        : a.coalesceKey < b.coalesceKey
          ? -1
          : 1,
  );
  return out;
}

/** The unread count for the bell badge. */
export function unreadCount(notifications: Notification[]): number {
  return notifications.filter((n) => !n.read).length;
}
