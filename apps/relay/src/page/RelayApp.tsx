import { useMemo, useState } from 'react';
import { CrisisFooter, Markdown, QuestionnaireForm } from '@selfos/answering';
import {
  contentKeyFromFragment,
  openContent,
  openImageBytes,
  openResult,
  sealResponse,
} from '@selfos/core/relay';
import { responseSizeGuard, unansweredRequired, visibleAnswers } from '@selfos/core/questionnaires';
import type { AnswerMap, AnswerValue } from '@selfos/core/questionnaires';
import { toBase64 } from '@selfos/core/encoding';
import type {
  AgeAttestation,
  Answer,
  RelayContent,
  RelayResponsePayload,
  RelayResult,
  SensitivityTier,
} from '@selfos/core/schemas';

const NOT_MEDICAL = 'SelfOS is a wellness tool — not medical care, diagnosis, or treatment.';

/** Sprout brand tile + wordmark, matching the app lockup (01-design-system). */
function Brand(): JSX.Element {
  return (
    <div className="brand">
      <span className="brandTile" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M12 21V11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path
            d="M12 12c0-3 2.5-5 6-5 0 3-2.5 5-6 5zM12 14c0-3-2.5-5-6-5 0 3 2.5 5 6 5z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      SelfOS
    </div>
  );
}

async function api(path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json: unknown = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

/** Whole-card message states (unavailable / already-submitted / thanks / declined / withdrawn). */
function Message({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: JSX.Element;
}): JSX.Element {
  return (
    <div className="card">
      <h1 className="title">{title}</h1>
      <p className="subtitle">{body}</p>
      {children}
      <CrisisFooter />
    </div>
  );
}

const AGREEMENT_LABEL: Record<string, string> = {
  aligned: 'You agree',
  mixed: 'Some overlap',
  divergent: 'You differ',
};

/**
 * The sender's pushed outcome (08 §17.12-D), shown to a returning recipient who's already answered: a
 * combined compatibility report (kind 'report') or a plain acknowledgement (kind 'thanks'). Decrypted
 * client-side with the recipient's fragment content key — the relay only ever held the sealed form.
 */
function ResultView({ result }: { result: RelayResult }): JSX.Element {
  return (
    <div className="card">
      <h1 className="title">{result.headline}</h1>
      {result.summary ? <Markdown className="subtitle">{result.summary}</Markdown> : null}
      {result.kind === 'report' && result.items && result.items.length > 0 ? (
        <ul className="resultList">
          {result.items.map((item) => (
            <li key={item.canonicalId} className="resultItem">
              <p className="resultPrompt">{item.prompt}</p>
              <span className={`resultBadge resultBadge--${item.agreement}`}>
                {AGREEMENT_LABEL[item.agreement] ?? item.agreement}
              </span>
              {item.note ? <Markdown className="muted">{item.note}</Markdown> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <CrisisFooter />
    </div>
  );
}

function PinGate({
  busy,
  error,
  onUnlock,
}: {
  busy: boolean;
  error: string | null;
  onUnlock: (pin: string) => void;
}): JSX.Element {
  const [pin, setPin] = useState('');
  return (
    <div className="card">
      <h1 className="title">You’ve been asked to share your perspective</h1>
      <p className="subtitle">Enter the PIN from your invite to open this questionnaire.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (pin.length >= 4) onUnlock(pin);
        }}
      >
        <label className="label" htmlFor="pin">
          Your PIN
        </label>
        <input
          id="pin"
          className="input pinInput"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          aria-describedby={error ? 'pin-error' : undefined}
        />
        {error ? (
          <p className="error" id="pin-error" role="alert" style={{ marginTop: 'var(--space-3)' }}>
            {error}
          </p>
        ) : null}
        <div className="row" style={{ marginTop: 'var(--space-4)' }}>
          <button className="button buttonPrimary" type="submit" disabled={busy || pin.length < 4}>
            {busy ? 'Opening…' : 'Open questionnaire'}
          </button>
        </div>
      </form>
      <CrisisFooter />
    </div>
  );
}

/** Age gate for sensitive tiers (§8.3): 18+ acknowledgement (general) or a DOB gate (explicit/unfiltered). */
function useAgeGate(tier: SensitivityTier): {
  node: JSX.Element | null;
  attestation: AgeAttestation | undefined;
  ok: boolean;
} {
  const [ack, setAck] = useState(false);
  const [dob, setDob] = useState('');

  if (tier === 'standard') return { node: null, attestation: undefined, ok: true };

  if (tier === 'intimacyGeneral') {
    return {
      ok: ack,
      attestation: ack ? { tier, method: 'checkbox' } : undefined,
      node: (
        <label className="checkRow">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span>I confirm I am 18 or older. This questionnaire may include adult themes.</span>
        </label>
      ),
    };
  }

  // explicit / unfiltered → date-of-birth gate.
  const adult = (() => {
    if (!dob) return false;
    const born = new Date(dob);
    if (Number.isNaN(born.getTime())) return false;
    const eighteen = new Date();
    eighteen.setFullYear(eighteen.getFullYear() - 18);
    return born <= eighteen;
  })();
  return {
    ok: adult,
    attestation: adult ? { tier, method: 'dob', bornBefore: dob } : undefined,
    node: (
      <div>
        <label className="label" htmlFor="dob">
          Your date of birth
        </label>
        <input
          id="dob"
          className="input"
          type="date"
          value={dob}
          onChange={(e) => setDob(e.target.value)}
        />
        <p className="muted" style={{ marginTop: 'var(--space-2)' }}>
          This questionnaire contains explicit adult content. You must be 18 or older and consent to
          continue.
        </p>
        {dob && !adult ? (
          <p className="error" role="alert">
            You must be 18 or older.
          </p>
        ) : null}
      </div>
    ),
  };
}

function ConsentScreen({
  content,
  onContinue,
}: {
  content: RelayContent;
  onContinue: (attestation: AgeAttestation | undefined) => void;
}): JSX.Element {
  const tier = content.questionnaire.sensitivity;
  const gate = useAgeGate(tier);
  const asker = content.senderName ?? 'Someone';
  return (
    <div className="card">
      <h1 className="title">{content.questionnaire.title}</h1>
      {content.questionnaire.description ? (
        <p className="subtitle">{content.questionnaire.description}</p>
      ) : null}
      <p className="muted">
        <strong>{asker}</strong> asked you to answer this to understand you better. You can skip
        questions or stop any time.
      </p>
      <div className="disclosure">{content.disclosure}</div>
      {gate.node}
      <p className="notice">{NOT_MEDICAL}</p>
      <p className="notice">
        Your answers are encrypted in your browser and can only be read by the person who sent this
        — the service that delivers them can’t read them. Nothing is shared until you submit, and
        you can delete your response afterward.
      </p>
      <div className="row">
        <button
          className="button buttonPrimary"
          type="button"
          disabled={!gate.ok}
          onClick={() => onContinue(gate.attestation)}
        >
          Continue
        </button>
      </div>
      <CrisisFooter />
    </div>
  );
}

function answersToArray(content: RelayContent, answers: AnswerMap): Answer[] {
  // Drop orphaned answers for branch-hidden questions (47 §3.3/§7) via the one shared helper, so the relay
  // and the in-app Inbox can't drift on this rule.
  return Object.entries(visibleAnswers(content.questionnaire.questions, answers)).map(
    ([questionId, value]) => ({ questionId, value }),
  );
}

function FormScreen({
  token,
  pin,
  content,
  contentKey,
  attestation,
  onDone,
}: {
  token: string;
  pin: string;
  content: RelayContent;
  contentKey: string;
  attestation: AgeAttestation | undefined;
  onDone: (kind: 'thanks' | 'awaiting' | 'declined') => void;
}): JSX.Element {
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState('');

  const loadImage = useMemo(
    () => async (path: string) => {
      const env = content.images[path];
      if (!env) return null;
      try {
        return toBase64(await openImageBytes(env, contentKey));
      } catch {
        return null;
      }
    },
    [content, contentKey],
  );

  const consent = {
    disclosureShown: content.disclosure,
    senderShown: content.senderName,
    ...(attestation ? { ageAttestation: attestation } : {}),
  };

  // A compatibility send still owes a combined result, so its post-submit state is "waiting"; an ordinary
  // send is simply done (§17.12-D).
  const submittedState = content.questionnaire.compatibility?.enabled ? 'awaiting' : 'thanks';

  const send = async (
    payload: RelayResponsePayload,
    done: 'thanks' | 'awaiting' | 'declined',
  ): Promise<void> => {
    // Guard the serialized payload against the relay's size cap BEFORE sealing/uploading, so a too-long
    // response gets a clear message instead of an opaque relay rejection (38 §3.9). The relay's own
    // MAX_RESPONSE_BYTES check stays the backstop.
    if (!responseSizeGuard(payload).ok) {
      setError('This response is too long to send — please shorten your written answers.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sealed = await sealResponse(payload, content.publicKey);
      const res = await api('/api/respond', { token, pin, sealed });
      if (res.status === 200) {
        onDone(done);
      } else if (res.status === 409) {
        onDone(submittedState);
      } else {
        setError('Something went wrong sending your answers. Please try again.');
      }
    } catch {
      setError('Something went wrong sending your answers. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (): void => {
    const missing = unansweredRequired(content.questionnaire.questions, answers);
    if (missing.length > 0) {
      setError(
        `Please answer the ${missing.length} required question${missing.length === 1 ? '' : 's'}.`,
      );
      return;
    }
    void send(
      {
        kind: 'submit',
        answers: answersToArray(content, answers),
        submittedAt: new Date().toISOString(),
        consent,
      },
      submittedState,
    );
  };

  const onDecline = (): void => {
    void send(
      {
        kind: 'decline',
        ...(note.trim() ? { note: note.trim() } : {}),
        at: new Date().toISOString(),
      },
      'declined',
    );
  };

  return (
    <div className="card">
      <h1 className="title">{content.questionnaire.title}</h1>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {declining ? (
        <div>
          <label className="label" htmlFor="note">
            Add a short note (optional)
          </label>
          <textarea
            id="note"
            className="input"
            style={{ height: 'auto', minHeight: '72px', padding: 'var(--space-2) var(--space-3)' }}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="row" style={{ marginTop: 'var(--space-3)' }}>
            <button
              className="button buttonSecondary"
              type="button"
              disabled={busy}
              onClick={onDecline}
            >
              Send decline
            </button>
            <button
              className="button buttonSecondary"
              type="button"
              onClick={() => setDeclining(false)}
            >
              Back
            </button>
          </div>
          <CrisisFooter />
        </div>
      ) : (
        /* One question at a time (08 §21.3): the shared wizard owns Back/Next + the action bar. An
           external relay recipient can't resume, so there's no "Save for later" — Submit + Decline only. */
        <QuestionnaireForm
          questions={content.questionnaire.questions}
          answers={answers}
          loadImage={loadImage}
          onChange={(id, value: AnswerValue) => {
            setError(null);
            setAnswers((prev) => ({ ...prev, [id]: value }));
          }}
          wizard={{
            onSubmit,
            submitLabel: busy ? 'Sending…' : 'Submit',
            onDecline: () => setDeclining(true),
            busy,
          }}
        />
      )}
    </div>
  );
}

type Phase =
  | { kind: 'pin' }
  | { kind: 'consent'; content: RelayContent }
  | { kind: 'form'; content: RelayContent; attestation: AgeAttestation | undefined }
  | { kind: 'thanks' }
  | { kind: 'awaiting' } // answered; the sender hasn't shared the combined result yet (compatibility)
  | { kind: 'outcome'; result: RelayResult } // the sender's pushed report / acknowledgement (§17.12-D)
  | { kind: 'declined' }
  | { kind: 'withdrawn' }
  | { kind: 'alreadySubmitted' }
  | { kind: 'unavailable' };

export function RelayApp(): JSX.Element {
  const token = useMemo(() => {
    const match = /\/q\/([^/?#]+)/.exec(window.location.pathname);
    return match?.[1] ?? '';
  }, []);
  const contentKey = useMemo(() => contentKeyFromFragment(window.location.hash), []);

  const [phase, setPhase] = useState<Phase>(
    !token || !contentKey ? { kind: 'unavailable' } : { kind: 'pin' },
  );
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onUnlock = async (entered: string): Promise<void> => {
    if (!contentKey) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api('/api/unlock', { token, pin: entered });
      const json = res.json as {
        sealedContent?: Parameters<typeof openContent>[0];
        sealedResult?: Parameters<typeof openResult>[0];
        submitted?: boolean;
        attemptsRemaining?: number;
        lockedUntil?: number;
      };
      if (res.status === 200 && json.sealedContent) {
        setPin(entered);
        if (json.submitted) {
          // Already answered. If the sender has pushed an outcome, show it; otherwise show the right
          // "waiting"/"thanks" state — a compatibility send still owes a combined result, an ordinary
          // send doesn't (§17.12-D).
          if (json.sealedResult) {
            setPhase({ kind: 'outcome', result: await openResult(json.sealedResult, contentKey) });
            return;
          }
          const answered = await openContent(json.sealedContent, contentKey);
          setPhase(
            answered.questionnaire.compatibility?.enabled
              ? { kind: 'awaiting' }
              : { kind: 'alreadySubmitted' },
          );
          return;
        }
        const content = await openContent(json.sealedContent, contentKey);
        setPhase({ kind: 'consent', content });
      } else if (res.status === 401) {
        const left = json.attemptsRemaining ?? 0;
        setError(`That PIN didn’t match. ${left} attempt${left === 1 ? '' : 's'} left.`);
      } else if (res.status === 429) {
        setError('Too many tries. Please wait about 15 minutes and try again.');
      } else {
        setPhase({ kind: 'unavailable' });
      }
    } catch {
      setError('Could not reach the questionnaire. Please check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const onWithdraw = async (): Promise<void> => {
    const res = await api('/api/withdraw', { token, pin });
    if (res.status === 200) setPhase({ kind: 'withdrawn' });
  };

  let body: JSX.Element;
  switch (phase.kind) {
    case 'pin':
      body = <PinGate busy={busy} error={error} onUnlock={(p) => void onUnlock(p)} />;
      break;
    case 'consent':
      body = (
        <ConsentScreen
          content={phase.content}
          onContinue={(attestation) =>
            setPhase({ kind: 'form', content: phase.content, attestation })
          }
        />
      );
      break;
    case 'form':
      body = (
        <FormScreen
          token={token}
          pin={pin}
          content={phase.content}
          contentKey={contentKey ?? ''}
          attestation={phase.attestation}
          onDone={(kind) => setPhase({ kind })}
        />
      );
      break;
    case 'thanks':
      body = (
        <Message
          title="Thanks for filling this out."
          body="Your answers were sent securely. You can withdraw them before they’re collected."
        >
          <div className="row">
            <button
              className="button buttonSecondary"
              type="button"
              onClick={() => void onWithdraw()}
            >
              Withdraw my response
            </button>
          </div>
        </Message>
      );
      break;
    case 'awaiting':
      body = (
        <Message
          title="Thanks for answering."
          body="Once everyone has answered, the results will appear here. Revisit this link with your PIN to check back."
        >
          <div className="row">
            <button
              className="button buttonSecondary"
              type="button"
              onClick={() => void onWithdraw()}
            >
              Withdraw my response
            </button>
          </div>
        </Message>
      );
      break;
    case 'outcome':
      body = <ResultView result={phase.result} />;
      break;
    case 'declined':
      body = (
        <Message
          title="Thanks for letting them know."
          body="Your response was recorded. Nothing else was shared."
        />
      );
      break;
    case 'withdrawn':
      body = <Message title="Your response was withdrawn." body="Nothing you entered was kept." />;
      break;
    case 'alreadySubmitted':
      body = (
        <Message
          title="Thanks for filling this out."
          body="You’ve already answered this questionnaire."
        />
      );
      break;
    case 'unavailable':
      body = (
        <Message
          title="This questionnaire is no longer available."
          body="The link may have expired or been withdrawn."
        />
      );
      break;
  }

  return (
    <div className="shell">
      <Brand />
      {body}
      <p className="trust">🔒 Sent securely via SelfOS</p>
    </div>
  );
}
