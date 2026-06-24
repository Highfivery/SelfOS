import { useEffect, useMemo, useState } from 'react';
import { QuestionnaireForm, type QuestionSharing } from '@selfos/answering';
import {
  defaultScopeForQuestion,
  questionDefaultsPrivate,
  stripIntakeFieldMarkers,
} from '@selfos/core/intake';
import { resolveIntakeActivityRows } from '@selfos/core/intimacy';
import { SHARING_INLINE_EXPLAINER, describeScope } from '@selfos/core/sharing';
import type { AnswerMap, AnswerValue } from '@selfos/core/questionnaires';
import type { Question } from '@selfos/core/schemas';
import type {
  IntakeAnswerValue,
  IntakeSection,
  IntakeSectionMeta,
  Relationship,
  RelationshipType,
} from '@shared/channels';
import { ArrowRight, MessageCircle, ShieldCheck, Sparkles, Users } from 'lucide-react';
import {
  Banner,
  Button,
  Card,
  Heading,
  Markdown,
  RelationshipScopePicker,
  Text,
} from '../../../design-system/components';
import { Composer } from '../sessions/Composer';
import { availableRelationshipTypesFor } from '../../availableRelationshipTypes';
import { useIntakeStore } from '../../../stores/intakeStore';
import { useSessionStore } from '../../../stores/sessionStore';
import styles from './Onboarding.module.css';

/** Whether two scopes hold the same set of types (order-independent). */
function sameScope(a: readonly RelationshipType[], b: readonly RelationshipType[]): boolean {
  return a.length === b.length && a.every((t) => b.includes(t));
}

/**
 * A structured **form** intake section (18-personal-onboarding §14.3/§14.6) — renders the section's questions
 * through the shared `@selfos/answering` `QuestionnaireForm` (branch-aware, the host owns the answer state),
 * with Continue (submit, fills the profile, no AI) + Skip. The intimacy block is gated behind the one-time 18+
 * acknowledgement first. The crisis footer lives in the container, always present.
 *
 * 43 — each question carries a relationship-type sharing chip (defaulted by category, share-by-default), with a
 * per-section bulk control + the honest "informs their AI, never shown to them" explainer; the chosen scopes
 * ride the submit (`sharing`). After an edit makes the portrait stale, a one-tap "refresh your portrait" shows.
 */
export function IntakeFormPanel({
  meta,
  section,
  adultAcknowledged,
  profileGender,
  portraitStale,
  onAdvance,
}: {
  meta: IntakeSectionMeta;
  section: IntakeSection | undefined;
  adultAcknowledged: boolean;
  /** The person's gender (from the `basics` section / profile) — tailors the intimacy activity matrix's oral
   * rows alongside the live `drawnTo` answer (27 §4.2). */
  profileGender?: string;
  /** The existing portrait is now out of date (§15) — show the inline one-tap refresh (43 §3.5). */
  portraitStale?: boolean;
  onAdvance: () => void;
}): JSX.Element {
  const busy = useIntakeStore((s) => s.busy);
  const submitForm = useIntakeStore((s) => s.submitForm);
  const skipSection = useIntakeStore((s) => s.skipSection);
  const acknowledgeAdult = useIntakeStore((s) => s.acknowledgeAdult);
  const runTurn = useIntakeStore((s) => s.runTurn);
  const running = useIntakeStore((s) => s.running);
  const streaming = useIntakeStore((s) => s.streaming);
  const finishIntake = useIntakeStore((s) => s.finishIntake);
  const finalizing = useIntakeStore((s) => s.finalizing);
  const activePersonId = useSessionStore((s) => s.activePerson?.id ?? null);
  // Auto-open the go-deeper chat when the section already has a transcript (a resumed/ongoing "Tell me
  // more" conversation), so reopening the section shows it rather than hiding it behind the button.
  const [deepening, setDeepening] = useState((section?.messages?.length ?? 0) > 0);

  // Local answer state, seeded from any saved answers (resume / edit). The host owns it (§5.3); a Continue
  // persists it through the bridge. Re-seeds when the section identity changes (key on meta.id at the parent).
  const [answers, setAnswers] = useState<AnswerMap>(
    () => ({ ...(section?.answers ?? {}) }) as AnswerMap,
  );
  const onChange = (questionId: string, value: AnswerValue): void =>
    setAnswers((a) => {
      const next: AnswerMap = { ...a, [questionId]: value };
      // Auto-fill: choosing to live with children pre-selects the Children question (still editable),
      // so the two questions stay in sync without re-asking. Only fills when Children is still blank.
      if (
        questionId === 'liveWith' &&
        Array.isArray(value) &&
        (value as string[]).includes('Children') &&
        !next['parentalStatus']
      ) {
        next['parentalStatus'] = 'Have young kids';
      }
      return next;
    });

  // 43 — per-question sharing scope state, seeded from any saved `answerSharing` (resume / edit) else the
  // question's category preset (share-by-default; restricted questions default to Private). Re-seeds per
  // section (the parent keys on meta.id).
  const [scopes, setScopes] = useState<Record<string, RelationshipType[]>>(() => {
    const out: Record<string, RelationshipType[]> = {};
    for (const q of meta.questions ?? []) {
      out[q.id] = section?.answerSharing?.[q.id] ?? defaultScopeForQuestion(meta.id, q.id);
    }
    return out;
  });

  // The relationship graph → which types the picker offers (43 §5). Loaded once; undefined ⇒ full set.
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  useEffect(() => {
    let cancelled = false;
    void window.selfos?.relationshipsList?.().then((rels) => {
      if (!cancelled) setRelationships(rels ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const availableTypes = useMemo(
    () => availableRelationshipTypesFor(activePersonId, relationships),
    [activePersonId, relationships],
  );
  const hasRelationships = availableTypes !== undefined;

  // A sensitive opt-in (restricted question/section → non-empty scope) asks for an explicit confirm first
  // (43 §3.1/§8) — `Private` is always one tap away, sharing a sensitive answer is a deliberate gesture.
  const [pendingShare, setPendingShare] = useState<{ label: string; apply: () => void } | null>(
    null,
  );

  const promptOf = (qid: string): string =>
    (meta.questions ?? []).find((q) => q.id === qid)?.prompt ?? qid;

  const applyScope = (qid: string, types: RelationshipType[]): void =>
    setScopes((s) => ({ ...s, [qid]: types }));

  const setScope = (qid: string, types: RelationshipType[]): void => {
    const current = scopes[qid] ?? [];
    if (questionDefaultsPrivate(meta.id, qid) && current.length === 0 && types.length > 0) {
      setPendingShare({
        label: `“${promptOf(qid)}” is sensitive — share it with ${describeScope(types)}’s coaching?`,
        apply: () => applyScope(qid, types),
      });
      return;
    }
    applyScope(qid, types);
  };

  // The section bulk scope — a common value when every question agrees, else "mixed" (43 §3.2).
  const questionIds = (meta.questions ?? []).map((q) => q.id);
  const bulkScope: RelationshipType[] | null = (() => {
    const [firstId] = questionIds;
    if (firstId === undefined) return [];
    const first = scopes[firstId] ?? [];
    return questionIds.every((qid) => sameScope(scopes[qid] ?? [], first)) ? first : null;
  })();
  const applyBulk = (types: RelationshipType[]): void => {
    const doApply = (): void =>
      setScopes((s) => {
        const next = { ...s };
        for (const qid of questionIds) next[qid] = [...types];
        return next;
      });
    // Sharing (non-empty) via the bulk control still needs the §8 confirm when the section is sensitive OR
    // holds any sensitive (default-private) question — e.g. the substance answers inside the non-restricted
    // Health section — so bulk-share can't opt a restricted answer in without the explicit gesture. Locking a
    // section to Private (the safe direction) never confirms.
    const touchesSensitive =
      meta.restricted || questionIds.some((qid) => questionDefaultsPrivate(meta.id, qid));
    if (touchesSensitive && types.length > 0) {
      setPendingShare({
        label: `This section includes sensitive answers — share all of it with ${describeScope(types)}’s coaching?`,
        apply: doApply,
      });
      return;
    }
    doApply();
  };

  const sharing: QuestionSharing = {
    renderControl: (questionId) => (
      <RelationshipScopePicker
        value={scopes[questionId] ?? []}
        onChange={(types) => setScope(questionId, types)}
        label={promptOf(questionId)}
        {...(availableTypes ? { availableTypes } : {})}
      />
    ),
  };

  // The intimacy activity matrix's rows are tailored per-person (27 §4.2): only the oral rows are relabelled/
  // hidden by own anatomy (gender) + partner anatomy (the live `drawnTo` answer in this same form). Re-resolved
  // here so the customization updates live as they pick "Who are you drawn to?"; synthesis re-resolves with the
  // same context server-side, so the stored matrix keys line up.
  const drawnTo = useMemo(() => {
    const v = answers['drawnTo'];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
  }, [answers]);
  const questions = useMemo<Question[]>(() => {
    const base = meta.questions ?? [];
    return base.map((q) =>
      q.id === 'activities' && q.type === 'matrix' && q.matrix
        ? {
            ...q,
            matrix: {
              ...q.matrix,
              rows: resolveIntakeActivityRows({ gender: profileGender, drawnTo }),
            },
          }
        : q,
    );
  }, [meta.questions, profileGender, drawnTo]);
  const locked = meta.adult && !adultAcknowledged;
  const complete = section?.status === 'complete';

  // A matrix answer is a row→point record (Record<string, number>) — keep it; every other intake answer is a
  // scalar/array. Any OTHER non-array object isn't a valid intake answer, so drop it defensively to match the
  // bridge contract (IntakeAnswerValueSchema).
  const toSubmit = (): Record<string, IntakeAnswerValue> => {
    const out: Record<string, IntakeAnswerValue> = {};
    for (const [qid, value] of Object.entries(answers)) {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        if (Object.values(value).every((v) => typeof v === 'number')) {
          out[qid] = value as IntakeAnswerValue;
        }
        continue;
      }
      out[qid] = value as IntakeAnswerValue;
    }
    return out;
  };

  // The intimacy block is gated behind the shared 18+ acknowledgement (§3.3/§14.5).
  if (locked) {
    return (
      <Card>
        <div className={styles.gate}>
          <Heading level={2}>{meta.title}</Heading>
          <Text tone="secondary">{meta.blurb}</Text>
          {meta.contentNote ? <Banner tone="info">{meta.contentNote}</Banner> : null}
          <div className={styles.controls}>
            <Button variant="primary" disabled={busy} onClick={() => void acknowledgeAdult()}>
              <ShieldCheck size={16} aria-hidden="true" />
              I’m 18 or older — continue
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void skipSection(meta.id).then(onAdvance)}
            >
              Skip this section
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <Heading level={2}>{meta.title}</Heading>
          <Text tone="secondary" className={styles.blurb}>
            {meta.opener}
          </Text>
        </div>

        {meta.contentNote ? <Banner tone="info">{meta.contentNote}</Banner> : null}

        {/* 43 §3.3 — the honest "informs their AI, never shown to them" explainer, by the sharing controls. */}
        <div className={styles.sharingExplainer}>
          <Users size={15} aria-hidden="true" />
          <Text tone="secondary">
            {SHARING_INLINE_EXPLAINER}
            {!hasRelationships
              ? ' Add the people you relate to in People to choose who each answer can help.'
              : ''}
          </Text>
        </div>

        {/* 43 §3.2 — the per-section bulk sharing control. */}
        {questionIds.length > 0 ? (
          <div className={styles.sectionSharing}>
            <span className={styles.sectionSharingLabel}>Sharing for this section</span>
            {bulkScope === null ? <span className={styles.mixedBadge}>Mixed</span> : null}
            <RelationshipScopePicker
              value={bulkScope ?? []}
              onChange={applyBulk}
              label="this whole section"
              {...(availableTypes ? { availableTypes } : {})}
            />
          </div>
        ) : null}

        {pendingShare ? (
          <Banner tone="info">
            <div className={styles.confirmShare}>
              <Text>{pendingShare.label}</Text>
              <div className={styles.confirmShareActions}>
                <Button
                  variant="primary"
                  onClick={() => {
                    pendingShare.apply();
                    setPendingShare(null);
                  }}
                >
                  Share it
                </Button>
                <Button variant="ghost" onClick={() => setPendingShare(null)}>
                  Keep private
                </Button>
              </div>
            </div>
          </Banner>
        ) : null}

        <QuestionnaireForm
          questions={questions}
          answers={answers}
          onChange={onChange}
          sharing={sharing}
          footer={<></>}
        />

        {/* Optional "Tell me more →" — a brief AI chat to elaborate. Available on every form section. */}
        <div className={styles.section}>
          {deepening ? (
            <>
              <div className={styles.thread} aria-live="polite" aria-busy={running}>
                <div className={`${styles.turn} ${styles.coachMsg}`}>
                  Anything you’d like to add or go a little deeper on here? Say as much or as little
                  as you like.
                </div>
                {(section?.messages ?? []).map((m, i) => (
                  <div
                    key={i}
                    className={`${styles.turn} ${m.role === 'user' ? styles.userMsg : styles.coachMsg}`}
                  >
                    {m.role === 'user' ? (
                      m.content
                    ) : (
                      // Assistant prose renders Markdown; strip any field markers first (order matters, §7).
                      <Markdown>{stripIntakeFieldMarkers(m.content)}</Markdown>
                    )}
                  </div>
                ))}
                {running ? (
                  streaming ? (
                    <div className={`${styles.turn} ${styles.coachMsg}`}>
                      <Markdown>{stripIntakeFieldMarkers(streaming)}</Markdown>
                    </div>
                  ) : (
                    <div className={styles.thinking}>Listening…</div>
                  )
                ) : null}
              </div>
              <Composer
                disabled={running}
                onSend={(text) => void runTurn(meta.id, text)}
                placeholder="Tell me more…"
                autoFocus={false}
              />
            </>
          ) : (
            <button
              type="button"
              className={styles.deepenPrompt}
              onClick={() => setDeepening(true)}
            >
              <span className={styles.deepenPromptText}>
                <span className={styles.deepenPromptTitle}>
                  <MessageCircle size={18} aria-hidden="true" />
                  Want to go deeper?
                </span>
                <span className={styles.deepenPromptHint}>
                  Tell me more about this in your own words — as much or as little as you like.
                </span>
              </span>
              <span className={styles.deepenPromptCta}>
                Tell me more
                <ArrowRight size={16} aria-hidden="true" />
              </span>
            </button>
          )}
        </div>

        {/* 43 §3.5 — one-tap "refresh your portrait" right where the person edits, once an edit makes the
            existing portrait stale. It never auto-spends — one explicit tap. */}
        {complete && portraitStale ? (
          <div className={styles.refreshRow}>
            <Text tone="secondary">
              You changed some answers — refresh your portrait so your coaching stays current.
            </Text>
            <Button variant="secondary" disabled={finalizing} onClick={() => void finishIntake()}>
              <Sparkles size={16} aria-hidden="true" />
              {finalizing ? 'Refreshing…' : 'Refresh your portrait'}
            </Button>
          </div>
        ) : null}

        <div className={styles.controls}>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => void submitForm(meta.id, toSubmit(), scopes).then(onAdvance)}
          >
            {complete ? 'Save changes' : 'Continue'}
            <ArrowRight size={16} aria-hidden="true" />
          </Button>
          {!complete ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void skipSection(meta.id).then(onAdvance)}
            >
              Skip this section
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
