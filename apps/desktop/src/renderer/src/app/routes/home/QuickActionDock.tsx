import { useNavigate } from 'react-router-dom';
import { ClipboardList, Compass, MessageCircle, Moon } from 'lucide-react';
import { quickActions, type QuickActionId } from '@selfos/core/home';
import styles from './Home.module.css';

const ICONS: Record<QuickActionId, typeof MessageCircle> = {
  'start-session': MessageCircle,
  'log-dream': Moon,
  'ask-someone': ClipboardList,
  'check-in': Compass,
};

/**
 * The quick-action dock (60 §3.1.2) — one-tap starters, each capability-gated so a dead action never
 * renders. Self-hides when the person can do none of them. Each is a real button that routes into the
 * owning surface.
 */
export function QuickActionDock({
  capabilities,
}: {
  capabilities: Set<string>;
}): JSX.Element | null {
  const navigate = useNavigate();
  const actions = quickActions(capabilities);
  if (actions.length === 0) return null;
  return (
    <div className={styles.dock}>
      {actions.map((action) => {
        const Icon = ICONS[action.id];
        return (
          <button
            key={action.id}
            type="button"
            className={styles.dockAction}
            onClick={() => navigate(action.route)}
          >
            <span className={styles.dockGlyph} aria-hidden="true">
              <Icon size={18} />
            </span>
            <span className={styles.dockText}>
              <span className={styles.dockLabel}>{action.label}</span>
              <span className={styles.dockHint}>{action.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
