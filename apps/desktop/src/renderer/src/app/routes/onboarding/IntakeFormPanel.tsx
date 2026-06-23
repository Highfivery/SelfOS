import { useMemo, useState } from 'react';
import { QuestionnaireForm } from '@selfos/answering';
import { stripIntakeFieldMarkers } from '@selfos/core/intake';
import { resolveIntakeActivityRows } from '@selfos/core/intimacy';
import type { AnswerMap, AnswerValue } from '@selfos/core/questionnaires';
import type { Question } from '@selfos/core/schemas';
import type { IntakeAnswerValue, IntakeSection, IntakeSectionMeta } from '@shared/channels';
import { ArrowRight, MessageCircle, ShieldCheck } from 'lucide-react';
import { Banner, Button, Card, Heading, Markdown, Text } from '../../../design-system/components';
import { Composer } from '../sessions/Composer';
import { useIntakeStore } from '../../../stores/intakeStore';
import styles from './Onboarding.module.css';

/**
 * A structured **form** intake section (18-personal-onboarding §14.3/§14.6) — renders the section's questions
 * through the shared `@selfos/answering` `QuestionnaireForm` (branch-aware, the host owns the answer state),
 * with Continue (submit, fills the profile, no AI) + Skip. The intimacy block is gated behind the one-time 18+
 * acknowledgement first. The crisis footer lives in the container, always present.
 */
export function IntakeFormPanel({
  meta,
  section,
  adultAcknowledged,
  profileGender,
  onAdvance,
}: {
  meta: IntakeSectionMeta;
  section: IntakeSection | undefined;
  adultAcknowledged: boolean;
  /** The person's gender (from the `basics` section / profile) — tailors the intimacy activity matrix's oral
   * rows alongside the live `drawnTo` answer (27 §4.2). */
  profileGender?: string;
  onAdvance: () => void;
}): JSX.Element {
  const busy = useIntakeStore((s) => s.busy);
  const submitForm = useIntakeStore((s) => s.submitForm);
  const skipSection = useIntakeStore((s) => s.skipSection);
  const acknowledgeAdult = useIntakeStore((s) => s.acknowledgeAdult);
  const runTurn = useIntakeStore((s) => s.runTurn);
  const running = useIntakeStore((s) => s.running);
  const streaming = useIntakeStore((s) => s.streaming);
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

        <QuestionnaireForm
          questions={questions}
          answers={answers}
          onChange={onChange}
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

        <div className={styles.controls}>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => void submitForm(meta.id, toSubmit()).then(onAdvance)}
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
