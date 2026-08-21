import { z } from 'zod';
import { PERSONA, SAFETY } from '../conversations/promptBuilder';
import { classifyParseFailure, extractJsonObject, tolerantArray } from '../ai/jsonSalvage';
import { runClaude, type AiDeps } from '../questionnaires/aiCall';
import { normalizeOptions } from '../questionnaires/questionnaireService';
import { readLexicon, suppressedTexts, violatesBoundary } from '../tests/adaptive/lexicon';
import {
  EmailAnswerStanceSchema,
  type NoteAnswer,
  type NoteDraftInput,
  type NoteDraftResult,
} from '../schemas';
import type { FileSystem } from '../host';
import { buildNoteContext } from './noteContext';

/**
 * The note draft pass (76 §5.1) — one bounded, budget-gated, metered Claude call.
 *
 * Two rules make this different from every other generation in the app, and both are enforced in CODE
 * rather than left to the prompt:
 *
 *  1. **It goes out AS SelfOS.** No sender, no signature, no first-person singular. The prompt says so
 *     AND `containsFirstPerson` rejects a draft that slips — one "I thought you'd like this" and the
 *     framing breaks completely, in the first sentence, where it is most visible.
 *  2. **Suppression is unconditional** (74 §5.8a). The recipient's hard-no list constrains the draft
 *     whatever the note is about; a boundary can only ever PREVENT, so no note type makes withholding
 *     it correct. Checked on the subject, the body, and every answer label.
 */

const MAX_TOKENS = 2000;

const DraftSchema = z.object({
  subject: z.string().min(1).catch(''),
  body: z.string().min(1).catch(''),
  // Per-ELEMENT tolerant: one malformed answer drops itself rather than sinking the whole draft
  // (37 §3.1). The sentinel is an empty label, filtered out below.
  answers: tolerantArray(
    z.object({
      label: z.string().min(1),
      stance: EmailAnswerStanceSchema.catch('other'),
    }),
    { label: '', stance: 'other' as const },
    (v) => v.label !== '',
  ).catch([]),
});

/**
 * Whether a draft speaks as a person rather than as the app.
 *
 * Deliberately narrow: the capitalised first-person pronoun and its contractions, plus "myself".
 * Case-SENSITIVE, because lowercase "i" is not the pronoun in English prose. "me"/"my" are excluded
 * on purpose — they false-positive on ordinary copy ("your memories", "my" inside a quoted phrase),
 * and the sentence that actually breaks the framing always contains an "I".
 */
export function containsFirstPerson(text: string): boolean {
  return /\b(I|I['’](m|ve|d|ll)|myself)\b/.test(text);
}

const TYPE_DIRECTIVE: Record<NoteDraftInput['type'], string> = {
  announcement:
    'This is an ANNOUNCEMENT — something new they can now do. `answers` MUST be an empty array: ' +
    'there is nothing to answer, and a button would turn a piece of news into homework.',
  question:
    'This is a QUESTION. `answers` MUST be 2–5 short, direct, plausible answers to THIS body, ' +
    'written for THIS body — distinct, mutually exclusive, covering the honest range. Someone reading ' +
    'them should be able to tell which question they belong to.',
  suggestion:
    'This is a SUGGESTION — something worth trying. `answers` MUST be 2–4 options expressing ' +
    'willingness, e.g. keen / maybe later / not for me, written in their register rather than fixed wording.',
};

function suppressionLine(nos: readonly string[]): string {
  if (nos.length === 0) return '';
  return (
    'NEVER use any of these words or phrases, in any form — they have been ruled out and the rule is ' +
    `absolute, whatever else this note says: ${nos.join(' · ')}. Never mention that anything was ruled out.`
  );
}

export async function draftNote(
  deps: AiDeps & { fs: FileSystem },
  input: NoteDraftInput,
): Promise<NoteDraftResult> {
  const { recipientName, digest } = await buildNoteContext(
    deps.fs,
    deps.key,
    input.recipientPersonId,
  );
  const lexicon = await readLexicon(deps.fs, deps.key, input.recipientPersonId);
  const nos = lexicon ? suppressedTexts(lexicon) : [];

  const system = [
    PERSONA,
    SAFETY,
    suppressionLine(nos),
    `You are writing ONE short note that will reach ${recipientName} by email and in their SelfOS inbox.`,
    // The voice rule. It is the whole design: the note must read as the app noticing, not as a person
    // speaking, because it carries no sender and no signature.
    'It is sent BY SELFOS, not by a person. Write in the app’s own voice: never sign it, never refer ' +
      'to a sender, and NEVER use "I", "me", "my" or "myself". Say what SelfOS knows and what it can do. ' +
      '"You’ve written most nights this month" is right; "I noticed you’ve been writing" is wrong.',
    'You may draw on anything in WHAT WE KNOW below, and you may refer to it directly — it is what ' +
      'SelfOS holds about them. Be specific rather than generic; a note that could have been sent to ' +
      'anyone is a failure.',
    TYPE_DIRECTIVE[input.type],
    'Return ONLY a JSON object: {"subject": string, "body": string, "answers": [{"label": string, ' +
      '"stance": "yes"|"maybe"|"no"|"other"}]}. The subject is ≤ 8 words. The body is 2–4 plain ' +
      'sentences. No markdown, no lists, no links, no greeting, no sign-off.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const user = [
    `WHAT THEY ASKED FOR (rough intent, not copy): ${input.intent}`,
    digest ? `WHAT WE KNOW ABOUT ${recipientName.toUpperCase()}\n${digest}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const call = await runClaude(deps, system, user, 'note.draft', MAX_TOKENS);
  if (!call.ok) return { ok: false, reason: call.reason, message: call.message };

  const raw = extractJsonObject(call.text);
  const parsed = raw ? DraftSchema.safeParse(raw) : null;
  const draft = parsed?.success ? parsed.data : null;

  if (!draft || !draft.subject.trim() || !draft.body.trim()) {
    const reason = classifyParseFailure(call.text);
    return {
      ok: false,
      reason,
      message:
        reason === 'TRUNCATED'
          ? 'The draft was cut off before it finished. Try again.'
          : 'The draft came back in an unexpected shape. Try again.',
    };
  }

  // The voice rule, in code. A first-person draft is refused rather than quietly sent — the note carries
  // no sender, so a single "I" is a contradiction the recipient sees immediately.
  if (containsFirstPerson(draft.subject) || containsFirstPerson(draft.body)) {
    return {
      ok: false,
      reason: 'MALFORMED',
      message: 'That draft spoke as a person. Try again — a note goes out in SelfOS’s voice.',
    };
  }

  // Suppression, unconditional (74 §5.8a). Nothing that touches a boundary is sent, whatever came back.
  if (
    lexicon &&
    (violatesBoundary(lexicon, draft.subject) || violatesBoundary(lexicon, draft.body))
  ) {
    return {
      ok: false,
      reason: 'MALFORMED',
      message: 'That draft used something they’ve ruled out. Try again.',
    };
  }

  // Answers: an announcement carries none; the rest reuse the ONE shared validator so the note surface
  // can never drift from the in-app one (08 §32.8).
  let answers: NoteAnswer[] = [];
  if (input.type !== 'announcement' && draft.answers.length > 0) {
    const labels = normalizeOptions(draft.answers.map((a) => a.label));
    if (labels) {
      const kept = labels
        .map((label) => draft.answers.find((a) => a.label.trim() === label))
        .filter((a): a is NoteAnswer => Boolean(a));
      if (!kept.some((a) => lexicon && violatesBoundary(lexicon, a.label))) answers = kept;
    }
  }

  return { ok: true, subject: draft.subject.trim(), body: draft.body.trim(), answers };
}
