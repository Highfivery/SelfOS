import { useState } from 'react';
import styles from './styles.module.css';

/**
 * Always-present crisis affordance + not-medical line (08-questionnaires §8.2, 05-conversations §7).
 * Self-contained (no app design-system) so the in-app answering form AND the relay page show the same
 * static resources — there is no Claude on the relay, so these are the safeguard for external recipients.
 * Never dismissable.
 */
export function CrisisFooter(): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <footer className={styles.crisis}>
      <div className={styles.crisisBar}>
        <p className={styles.crisisNote}>SelfOS is wellness support, not medical care.</p>
        <button type="button" className={styles.crisisButton} onClick={() => setOpen((v) => !v)}>
          {/* Inline life-buoy glyph so the relay bundle carries no icon dependency. */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
            <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
            <path
              d="M4.9 4.9l4.2 4.2M14.9 14.9l4.2 4.2M19.1 4.9l-4.2 4.2M9.1 14.9l-4.2 4.2"
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
          Get help now
        </button>
      </div>
      {open ? (
        <div className={styles.crisisPanel} role="region" aria-label="Crisis resources">
          <p className={styles.crisisLead}>
            If you’re in immediate danger, call your local emergency number.
          </p>
          <p className={styles.crisisResources}>
            US &amp; Canada: call or text <strong>988</strong> (Suicide &amp; Crisis Lifeline), or
            text <strong>HOME</strong> to <strong>741741</strong> (Crisis Text Line). UK &amp; ROI:
            call <strong>116 123</strong> (Samaritans). Anywhere else, find a helpline at{' '}
            <a href="https://findahelpline.com" target="_blank" rel="noreferrer noopener">
              findahelpline.com
            </a>
            . You can also reach out to someone you trust nearby.
          </p>
        </div>
      ) : null}
    </footer>
  );
}
