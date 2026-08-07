import { useNavigate } from 'react-router-dom';
import { Moon, X } from 'lucide-react';
import type {
  Insight,
  OutboundSharingItem,
  PersonFieldKey,
  RelationshipType,
} from '@shared/schemas';
import { sharingItemCategory } from '@selfos/core/sharing';
import {
  Markdown,
  RelationshipScopePicker,
  ShareToggle,
  Text,
} from '../../../design-system/components';
import { FactSharingControl } from '../memory/FactSharingControl';
import { useInsightStore } from '../../../stores/insightStore';
import { describeSharingScope } from './sharingDashboard';
import styles from './SharingDashboard.module.css';

/** The kind eyebrow ("Memory · Values" / "Onboarding answer · Health & body" / "Profile" / "Dream image"). */
function kindEyebrow(item: OutboundSharingItem): string {
  switch (item.kind) {
    case 'fact':
      return `Memory · ${item.lifeArea ?? 'Other'}`;
    case 'intakeAnswer':
      return `Onboarding answer · ${sharingItemCategory(item)}`;
    case 'profileField':
      return 'Profile';
    case 'dreamImage':
      return 'Dream image';
  }
}

interface SharingItemRowProps {
  item: OutboundSharingItem;
  /** The active person's own insights (to resolve a fact row to its parent insight for the scope picker). */
  insights: Insight[];
  /** The relationship types the active person can scope to (the picker's offered set); undefined ⇒ full set. */
  availableTypes: RelationshipType[] | undefined;
  /** Whether the active person may edit intake-answer sharing (`intake.own`) — else a read-only chip (68 §7). */
  canEditAnswers: boolean;
}

/**
 * One shared item, rendered uniformly across By person / By category / Everything (68 §3.4): a kind eyebrow,
 * the item text, its recipient line, and a kind-appropriate inline control —
 * `RelationshipScopePicker`/`FactSharingControl` for facts + answers, `ShareToggle` for a profile field, and
 * per-recipient unshare chips (+ a "Manage in Dreams" link) for a dream image. Own data → shown in full.
 */
export function SharingItemRow({
  item,
  insights,
  availableTypes,
  canEditAnswers,
}: SharingItemRowProps): JSX.Element {
  const navigate = useNavigate();
  const setAnswerScope = useInsightStore((s) => s.setAnswerScope);
  const setProfileFieldShared = useInsightStore((s) => s.setProfileFieldShared);
  const setDreamImageShare = useInsightStore((s) => s.setDreamImageShare);

  const control = (): JSX.Element | null => {
    if (item.kind === 'fact') {
      // Intake-sourced facts are no longer emitted as items (68 §3.9), so a fact row is always an AI-inferred,
      // directly-editable fact. Resolve it to its parent insight for the scope picker.
      for (const insight of insights) {
        const fact = insight.facts.find((f) => f.id === item.id);
        if (fact) {
          return (
            <FactSharingControl
              insightId={insight.id}
              subjectPersonId={insight.subjectPersonId}
              fact={fact}
              {...(availableTypes ? { availableTypes } : {})}
            />
          );
        }
      }
      return null;
    }

    if (item.kind === 'intakeAnswer') {
      const dot = item.id.indexOf('.');
      const sectionId = dot >= 0 ? item.id.slice(0, dot) : item.id;
      const questionId = dot >= 0 ? item.id.slice(dot + 1) : '';
      if (!canEditAnswers) {
        // `memory.own` without `intake.own` (a custom role) → read-only, never a dead picker (68 §7).
        return (
          <Text size="xs" tone="tertiary">
            {describeSharingScope(item)} · manage in onboarding
          </Text>
        );
      }
      return (
        <RelationshipScopePicker
          value={item.types}
          label={item.text}
          {...(availableTypes ? { availableTypes } : {})}
          onChange={(types) => void setAnswerScope({ sectionId, questionId, types })}
        />
      );
    }

    if (item.kind === 'profileField') {
      // The id is `field:<PersonFieldKey>` (68 §4.1), so the suffix is always a valid key.
      const field = (
        item.id.startsWith('field:') ? item.id.slice('field:'.length) : item.id
      ) as PersonFieldKey;
      // A profile field in the outbound view is, by definition, currently shared; the toggle locks it.
      return (
        <ShareToggle
          shared
          label={item.text.split(':')[0] ?? 'Profile'}
          onChange={(shared) => void setProfileFieldShared({ field, shared })}
        />
      );
    }

    // dreamImage — per-recipient unshare chips + a "Manage in Dreams" link to add a share.
    const dreamId = item.id.startsWith('dreamImage:')
      ? item.id.slice('dreamImage:'.length)
      : item.id;
    return (
      <div className={styles.dreamControl}>
        {item.recipients.map((recipient) => (
          <button
            key={recipient.id}
            type="button"
            className={styles.unshareChip}
            aria-label={`Stop sharing this dream image with ${recipient.displayName}`}
            onClick={() =>
              void setDreamImageShare({ dreamId, targetPersonId: recipient.id, shared: false })
            }
          >
            {recipient.displayName}
            <X size={12} aria-hidden="true" />
          </button>
        ))}
        <button type="button" className={styles.manageLink} onClick={() => navigate('/dreams')}>
          <Moon size={12} aria-hidden="true" /> Manage in Dreams
        </button>
      </div>
    );
  };

  return (
    <div className={styles.itemRow}>
      <div className={styles.itemMain}>
        <Text size="xs" tone="tertiary" className={styles.itemKind}>
          {kindEyebrow(item)}
        </Text>
        {item.kind === 'fact' || item.kind === 'intakeAnswer' ? (
          <Markdown inline size="sm">
            {item.text}
          </Markdown>
        ) : (
          <Text size="sm">{item.text}</Text>
        )}
        <Text size="xs" tone="tertiary">
          {describeSharingScope(item)}
          {/* A per-person scope ("Shared with X") already names the recipients — only broadcast/type-scoped
              items add a "reaching …" clause (or note there's no one in the circle yet). */}
          {item.broadcast || item.types.length > 0
            ? item.recipients.length > 0
              ? ` · reaching ${item.recipients.map((r) => r.displayName).join(', ')}`
              : ' · no one in your circle yet'
            : null}
        </Text>
      </div>
      <div className={styles.itemControl}>{control()}</div>
    </div>
  );
}
