import { useNavigate } from 'react-router-dom';
import { Banner, Text } from '../design-system/components';
import { useSessionStore } from '../stores/sessionStore';
import styles from './AiUnavailableNotice.module.css';

const OFFLINE_TEXT = 'You appear to be offline — SelfOS needs a connection for this.';
const MEMBER_TEXT = 'AI isn’t set up yet — ask the person who set up this household to turn it on.';
const OWNER_LEAD = 'AI isn’t set up yet. ';
const OWNER_LINK = 'Set up Claude in Settings → AI';

/**
 * True when the renderer knows the device has no network. jsdom/SSR default `navigator.onLine` to
 * `true`, so this fails to "online" (the safe default — show the set-up copy, not a wrong offline hint).
 */
export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * The single source of truth for AI-unavailable copy as plain text (no link), for callers that need a
 * string (a transient note, an `aria` label). The component below renders the same words, adding the
 * owner's clickable Settings → AI link. Role-aware (25-household-ai-credentials: the owner sets the key
 * once and shares it household-wide, so a member can't and shouldn't touch a key — they ask the owner)
 * and offline-aware (31-ai-required: AI needs a connection; never imply set-up when the real cause is
 * connectivity). When the role is momentarily unknown (mid person-switch) it falls to the safer member
 * copy (no Settings link, no key implication) — see §7.
 */
export function aiUnavailableMessage(opts: { canManageAi: boolean; offline?: boolean }): string {
  if (opts.offline ?? isOffline()) return OFFLINE_TEXT;
  return opts.canManageAi ? `${OWNER_LEAD}${OWNER_LINK}.` : MEMBER_TEXT;
}

/**
 * The one role-aware "AI isn't available" notice every AI surface renders (41 §3.3). Surfaces mount it
 * only once they've determined AI is unavailable for them (no resolved key / AI off); it then decides
 * the right words from the active person's role and the device's connectivity. `banner` (default) reads
 * as a calm info strip; `inline` is a quiet secondary line for tighter spots (e.g. the Sessions
 * "Suggested for you" row).
 */
export function AiUnavailableNotice({
  variant = 'banner',
}: {
  variant?: 'banner' | 'inline';
}): JSX.Element {
  const navigate = useNavigate();
  const canManageAi = useSessionStore((s) => s.can('settings.manage'));
  const offline = isOffline();

  const body = offline ? (
    OFFLINE_TEXT
  ) : canManageAi ? (
    <>
      {OWNER_LEAD}
      <button type="button" className={styles.link} onClick={() => navigate('/settings')}>
        {OWNER_LINK}
      </button>
      .
    </>
  ) : (
    MEMBER_TEXT
  );

  if (variant === 'inline') {
    return (
      <Text tone="secondary" size="sm">
        {body}
      </Text>
    );
  }
  return <Banner tone="info">{body}</Banner>;
}
