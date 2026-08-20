import { categoryForKey, type IntimacyCategory } from '../intimacy/topics';
import {
  type SkipKind,
  LIFE_AREAS,
  SUGGESTABLE_ANSWER_TYPES,
  type RelationshipType,
  type SensitivityTier,
} from '../schemas';

/**
 * Relationship-aware framing (08 §24.4-B2): a questionnaire for a PARTNER should read nothing like one for a
 * COWORKER or a CHILD. Each `RelationshipType` gets a tone/depth/register directive, modulated by `closeness`
 * (1–5). This is what makes "partner vs coworker" finally diverge instead of the bare type word doing nothing.
 */
const RELATIONSHIP_REGISTER: Record<RelationshipType, string> = {
  partner:
    'This is for their romantic PARTNER — warm, intimate, and "us"-oriented; it is safe to go deep on connection, desire, and the relationship.',
  ex: 'This is for an EX — careful, respectful, and low-pressure; avoid reopening wounds or presuming closeness.',
  parent:
    'This is for their PARENT — reflective and respectful; welcome history, legacy, gratitude, and the evolving adult relationship.',
  child:
    "This is for their CHILD — warm, curious about the child's inner world and interests, and age-appropriate; never intrusive or heavy.",
  stepParent:
    'This is for their STEP-PARENT — respectful and warm about a bond that grew over time; welcome the relationship as it is now without presuming lifelong closeness.',
  stepChild:
    "This is for their STEP-CHILD — warm, curious about the child's world, and age-appropriate; respect an evolving bond and never presume depth.",
  guardian:
    'This is for the person who RAISED or is GUARDIAN to them — reflective, respectful, and gratitude-aware; welcome history and the caring bond.',
  ward: 'This is for someone in their CARE — warm, protective, encouraging, and age-appropriate; supportive without being heavy.',
  grandparent:
    'This is for their GRANDPARENT — warm, reflective, and unhurried; welcome family history, legacy, stories, and gratitude across generations.',
  grandchild:
    'This is for their GRANDCHILD — warm, playful, curious about their world, and age-appropriate; nurturing and never intrusive.',
  greatGrandparent:
    'This is for their GREAT-GRANDPARENT — gentle, reverent, and reflective; welcome long family history, legacy, and gratitude.',
  greatGrandchild:
    'This is for their GREAT-GRANDCHILD — warm, gentle, playful, and age-appropriate; keep it light and loving.',
  sibling:
    'This is for their SIBLING — candid and familiar; shared history, growing up together, and how the bond is now.',
  stepSibling:
    'This is for their STEP-SIBLING — familiar and candid about a bond that formed later; relaxed, honest, and unforced.',
  halfSibling:
    'This is for their HALF-SIBLING — candid and familiar; shared family, honest check-ins, and the bond as it is.',
  auntUncle:
    'This is for their AUNT or UNCLE — warm, familial, and supportive; a touch more relaxed than a parent, welcoming shared family and care.',
  nieceNephew:
    'This is for their NIECE or NEPHEW — warm, curious, encouraging, and age-appropriate; supportive and never heavy.',
  cousin:
    'This is for their COUSIN — familiar and peer-like; shared family history, candid and easygoing.',
  parentInLaw:
    'This is for their PARENT-IN-LAW — respectful, warm, and boundaried; family by marriage — do not presume intimacy or reopen sensitive family matters.',
  childInLaw:
    'This is for their CHILD-IN-LAW — warm and welcoming, respectful of their own family and boundaries; supportive without presuming closeness.',
  siblingInLaw:
    'This is for their SIBLING-IN-LAW — friendly, familiar, and relaxed; family by marriage, warm but unforced.',
  friend:
    'This is for their FRIEND — candid, playful, and genuine; what the friendship means, shared fun, and honest check-ins.',
  roommate:
    'This is for their ROOMMATE — friendly, practical, and everyday; shared space and daily life; keep it light and boundaried.',
  neighbor:
    'This is for their NEIGHBOR — friendly and neighborly; light, warm, and boundaried; do NOT ask intrusive personal questions.',
  acquaintance:
    'This is for an ACQUAINTANCE — light, warm, and low-pressure; keep it fairly surface-level unless the connection is clearly deepening.',
  coworker:
    'This is for a COWORKER — professional and boundaried; stay on work, collaboration, and rapport; do NOT ask intrusive personal, family, or intimate questions.',
  mentor:
    'This is for their MENTOR — respectful and growth-oriented; gratitude for guidance, learning, and the evolving professional-personal bond.',
  mentee:
    'This is for their MENTEE — encouraging, supportive, and growth-oriented; be a steady, generous guide without being heavy.',
  other:
    'Keep the tone warm and adaptable; match the depth to how close they seem from the context.',
};

/** Frame the questionnaire for the author↔recipient relationship (type + optional 1–5 closeness). */
export function relationshipFraming(type: RelationshipType, closeness?: number): string {
  const depth =
    closeness == null
      ? ''
      : closeness >= 4
        ? ' They are very close — it is safe to go deep and personal.'
        : closeness <= 2
          ? ' They are not especially close — keep it lighter and less intrusive.'
          : '';
  return `\nRELATIONSHIP: ${RELATIONSHIP_REGISTER[type]}${depth}`;
}

/**
 * Prompt builders for AI question generation + the gap-finder (08-questionnaires §3.1/§3.7/§5.1). The
 * **system** prefix is stable (so it can be prompt-cached); the per-request detail goes in the user
 * message. Safety/policy framing is embedded here (§8.1: original, evidence-informed, never clinical/
 * diagnostic; §8.3: sensitive tiers stay within Anthropic's usage policy) — there is no separate judge
 * call; output is schema-validated by the caller and the model refuses gracefully when it must.
 */

/** The answer-type catalog the model must choose from, with the fields each type needs + an intent→type rubric
 *  (08 §24.4-B3) so the FORMAT of each question is chosen to fit what it's trying to learn, not stylistically. */
const ANSWER_TYPE_GUIDE = `Each question is an object with:
- "type": one of ${SUGGESTABLE_ANSWER_TYPES.join(', ')}.
- "prompt": the question text (warm, clear, first- or second-person as fits).
- "required": boolean.
- "help": optional one-line clarifier.
- "options": string[] — REQUIRED for singleChoice, multiChoice, ranking, thisOrThat (>= 2 items).

THE OPTIONS MUST ACTUALLY ANSWER THE PROMPT. This is where generated questions most often fail the person: the prompt is good, and then the choices don't fit it, don't fit them, or leave no true answer. Every option must be a direct, plausible answer to the exact question asked — read the prompt back and check that each one is something a real person could mean. They must be DISTINCT (never two that mean the same thing) and mutually exclusive for a single-answer type. Together they must COVER the honest range: if someone's real answer could sit outside your list — both, neither, it depends, it varies, it's changed recently — include that as an option, worded plainly. Reserve a two-option forced choice for a genuine either/or; anything nuanced (feelings, desire, identity, "which pull is stronger") needs the honest middle and outside answers too, or the only way to answer truthfully is to skip. If a question can't be given a fair set of choices, ask it as shortText or longText instead.
- "scale": {"min":number,"max":number} — REQUIRED for rating and slider (e.g. 1..5).
- "topics": string[] — REQUIRED, 1–2 entries. The FIRST must be the broad family this belongs to, copied exactly from the CATEGORIES list given below. The optional SECOND is one name for the durable ground underneath — the theme, never a description of this particular question. It must be something ten different questions could sit under and that would still mean something in six months ("Who initiates" yes; "What felt different" no). Omit it entirely when the family already says it — that is usually the right answer (e.g. ["Group & swinging", "FFM threesome"], ["Power exchange / D-s", "Who initiates"]). The family tag is what lets the app notice a whole area has been worked through even when each question was filed under a different specific name; the specific tags are what keep it precise. Use the exact label of a thread you were given when one fits, and name new ground plainly when none does. This is how the app remembers what it has asked, so be accurate — a wrong or missing tag means this question can be asked again forever.
- "gist": string — REQUIRED, at most 120 characters: what this question asks, in plain words, as a note to yourself (e.g. "how it feels when he takes control, and what she wants more of"). Never shown to the person.
Do NOT use matrix or allocation. No prose, no markdown fences.
MATCH the answer type to what the question is trying to learn: a story/feeling/nuance → shortText or longText; "how much" or something to track over time → rating or slider; a quick, playful, or rapport-building choice → thisOrThat or singleChoice/yesNo; ranking priorities → ranking. Vary DELIBERATELY — never stack many rating scales in a row; pick the type that earns the best answer for each question.`;

export const SAFETY = `You draft questions for SelfOS, a wellness / self-help tool — NOT medical, NOT diagnosis, NOT treatment. Write ORIGINAL, evidence-informed questions in a supportive voice. Never reproduce or imitate copyrighted or clinical/diagnostic instruments, never score diagnostically, never ask for medical/clinical self-assessment. Stay strictly within Anthropic's usage policy. If a request would require unsafe or out-of-policy content, return an empty questions array.`;

// Generation returns an OBJECT so it can also propose a short title (08 §16.4). The title is advisory —
// the builder applies it only when the author hasn't typed one.
export const GENERATION_SYSTEM = `${SAFETY}

Be specific, perceptive, and varied: write questions that earn a real answer and avoid generic survey clichés.

Every question in the set must be DISTINCT: no two may ask essentially the same thing or draw basically the same answer — even worded differently, from a slightly different angle, or as a narrower sub-aspect of another. If two questions would overlap, keep the stronger one and replace the other with something genuinely different.

TAILOR TO WHO THEY ARE (08 §24.4): when you're given context about the person — their name, work, interests, values, goals, relationship, personality, and everything already known about them — use it to make the questions feel written for THIS person and their actual life, not a generic template. Address them directly ("you"), use their name where natural, and use their pronouns. Build ON what is already known (go deeper — the why/how/nuance behind it) rather than asking the obvious or repeating it.

EVERY QUESTION MUST STAND ENTIRELY ON ITS OWN (08 §25.4). The recipient sees ONLY the question text — never the context you were given and never their other answers. So a question must be fully self-contained: NEVER refer to "that/the [thing] you mentioned/said/told me/described", "your earlier answer", "as we discussed", or anything the recipient hasn't been shown in THIS question. When you tailor using something you know (e.g. a health worry, a relationship, a goal), NAME it plainly inside the question itself ("When a worry about your health shows up, …") rather than gesturing at it ("When that health worry shows up, …"). A question that presupposes shared context the recipient can't see reads as broken.

Let their PERSONALITY shape HOW you ask when you know it: gentle and reassurance-aware for an anxious attachment style; hypotheticals and open exploration welcome for high openness; concrete and practical for someone conscientious; and so on.

Compose a COHERENT SET, not a bag of questions: open with lighter, easy questions that build rapport, deepen through the middle, and close on a warm or forward-looking note. Return the array IN that intended order.

When a FOCUS is given it GOVERNS: every question must serve that focus, and all other guidance (tailoring, avoiding repetition, sensitivity register) applies only WITHIN it — never drift off the focus just to find something new.

Return ONLY a JSON object: {"title": string (a short, warm questionnaire title, <= 6 words), "questions": [ ... ]}.
${ANSWER_TYPE_GUIDE}`;

// `improveQuestion` rewrites ONE question's prompt — its own system so it isn't muddled by the
// object/questions generation contract.
export const IMPROVE_SYSTEM = `${SAFETY}\n\nYou rewrite a single questionnaire question's prompt on request. Return ONLY the rewritten question text — no quotes, no prose, no options, no JSON.`;

/**
 * The "Too vague → sharpen" instruction (08 §28.2) reused through `improveQuestion`. Turns a broad, generic
 * question into a concrete, probing one — same topic, but specific enough to draw out a real, considered
 * answer instead of a shrug.
 */
export const SHARPEN_INSTRUCTION =
  'This question is too vague and invites a generic answer. Rewrite it to be specific and probing — name concrete situations, choices, or details, and gently push them to really think and give a considered, honest answer. Keep the same underlying topic; do not make it a different question.';

const SENSITIVITY_NOTE: Record<SensitivityTier, string> = {
  standard: '',
  // Intimacy/scenario at `intimacyGeneral` route through `sensitiveGeneralFraming` (08 §22.2); this key is
  // the fallback for any other combination that ever carries the tier.
  intimacyGeneral:
    '\nThis is an intimacy questionnaire (general). Keep it respectful and consenting; nothing explicit.',
  explicit:
    '\nThis is a sensitive questionnaire. Adults only; keep it consenting, respectful, and within Anthropic policy.',
  unfiltered:
    '\nThis is a sensitive questionnaire. Adults only; keep it consenting, respectful, and within Anthropic policy.',
};

/** Cap the "already rated — go deeper" sample (spec 71 §5.7). See the block that uses it for why. */
const MAX_DEEPEN_ACTS = 8;

/** Cap the open-ground list. A long-explored person can have dozens of open topics; the planner has already
 *  chosen this set's threads, so this is supporting vocabulary and a long tail adds tokens, not signal. */
const MAX_GROUND = 14;

/** The two questionnaire types whose sensitivity tiers carry an explicit register (08 §15.2/§22.2). */
export const INTIMACY_TYPE = 'intimacy';
export const SCENARIO_TYPE = 'scenario';

/**
 * The per-tier explicit content directive — a genuine intensity ladder (08 §22.2). `explicit` is frank and
 * specific; `unfiltered` is the frankest tier and reads like it. Neither loosens the boundary stated in
 * `explicitFraming`. This is the single place the two explicit tiers meaningfully diverge.
 */
const EXPLICIT_TIER_DIRECTIVE: Record<'explicit' | 'unfiltered', string> = {
  explicit:
    'Write frank, specific questions — name sex acts and preferences plainly (oral, penetration, positions, toys, kink, and so on). Be candid and direct, a deliberate step back from the most graphic: explicit enough to draw out honest, revealing answers.',
  unfiltered:
    'Write the MOST graphic, extreme, no-holds-barred questions within the boundary below — this is the FRANKEST tier and must read like it: push hard to the far explicit adult edge, not one notch of restraint. Use blunt, filthy, plain sexual language for bodies and acts. Go well BEYOND vanilla into the extreme: hardcore kinks and fetishes; BDSM and power exchange (dominance/submission, bondage, impact, degradation, humiliation); rough, intense, and edge-play acts; GROUP sex — threesomes, foursomes, orgies, gangbangs, swinging, cuckolding/hotwifing; EXHIBITIONISM and voyeurism — being watched, public and semi-public sex, sex clubs, strip clubs, swingers and play parties; and taboo fantasies/roleplay (e.g. consensual non-consent (CNC) as pre-agreed roleplay, stranger/one-night scenarios). Ask what they do, what they crave done to them, their filthiest and most secret fantasies, and the boundary-pushing edges they have NOT yet explored. Assume nothing is too explicit or too kinky for this tier — hold nothing back short of the boundary. Those examples name the RANGE this tier covers, not the subject of THIS set: where the material below says an area has been worked through, do not go there — bring the same intensity to the ground that IS open.',
};

/**
 * Tier-aware explicit framing for an **intimacy** OR **scenario** questionnaire at the `explicit`/`unfiltered`
 * tiers (08-questionnaires §16.5/§22.2). This **positively permits and requests** genuinely explicit, specific
 * questions (or, for a scenario, described situations to react to) for consenting adults — replacing the old
 * refusal-default that produced tasteful, emotional-closeness output — and draws its concrete subject matter
 * from the recipient's own topic map (spec 71 §5.3), never a fixed inventory. `unfiltered` is the most graphic within the boundary; `explicit`
 * a notch below (the `EXPLICIT_TIER_DIRECTIVE` ladder). The shared `SAFETY` prefix is NOT loosened — only this
 * one path gains the explicit direction. The 18+/DOB+consent gate stays recipient-side.
 *
 * BOUNDARY (stated in-prompt, same as the intake §14.5): consensual adults only; taboo content **only** as
 * fantasy/roleplay (e.g. CNC as pre-agreed roleplay); NEVER minors, real non-consent, or illegal acts; within
 * Anthropic's usage policy (refuse → empty array only when genuinely out of policy, not merely explicit).
 */
export function explicitFraming(
  tier: 'explicit' | 'unfiltered',
  // The acts the recipient ALREADY rated in onboarding (08 §19.3). Reframed as "go deeper, don't re-ask" so
  // generation doesn't re-ask what the onboarding matrix already covered. `key` is the stable,
  // anatomy-independent matrix-row key (46 §4.2) — the only reliable way back to a topic, since an
  // anatomy-resolved label ("Receiving oral (blowjob)") can't be reverse-mapped.
  coveredActs: readonly { key: string; label: string; rating: string }[] = [],
  // A `scenario`-type questionnaire (08 §15.2) frames each item as a described intimate SITUATION to react to,
  // not a direct question — otherwise identical (same explicit register, same boundary). `focused` = a brief was
  // given (08 §23.3), so the explicit REGISTER stays but the SUBJECT follows the focus.
  //
  // `openGround` is the SUBJECT MATTER, and it comes from this person's own topic map (spec 71 §5.3) — never a
  // fixed inventory. Before, the prompt pasted a ~95-item catalogue of acts + fantasies identical for everyone,
  // which was redundant with the planner's chosen threads, drowned the message, and re-offered ground the
  // planner had just closed. The map is per-person, saturation-aware, and grows as the model names real
  // ground, so the vocabulary improves with the person instead of being frozen at the taxonomy's guess.
  //
  // `closedTopicIds` (spec 71 §5.2/§5.7) bounds the "go deeper" act list so it can't re-mine worked-through
  // ground forever (#314) — each re-ask is genuinely new WORDING about the same act, which de-dup cannot catch.
  //
  // Ground SELECTION is not this function's job — the planner owns it (§5.5) and states it once, above.
  opts: {
    scenario?: boolean;
    focused?: boolean;
    openGround?: readonly { label: string; blurb?: string }[];
    closedTopicIds?: readonly string[];
  } = {},
): string {
  const scenario = opts.scenario === true;
  const closed = new Set(opts.closedTopicIds ?? []);
  // An act whose key resolves to no topic is KEPT — unknowable ground, and withholding it would silently
  // shrink the vocabulary.
  const onOpenGround = (category: IntimacyCategory | undefined): boolean =>
    category === undefined || !closed.has(`Intimacy:${category}`);
  // Establish the legitimate context FIRST so the model is confident this is appropriate — a private adult who
  // has opted into exploring their own sexuality, not a request to a public assistant.
  const context = scenario
    ? `\nCONTEXT: This is a private, 18+ scenario questionnaire inside a personal wellness app, for a consenting adult who has opted in to explore their sexuality through described situations. Each item is a short, explicit intimate SITUATION or roleplay to react to. Frank, graphic sexual scenarios are appropriate and expected here — a normal, in-policy use; do NOT shy away or substitute tasteful, emotional-closeness scenes.`
    : `\nCONTEXT: This is a private intimacy questionnaire inside a personal wellness app, written for a consenting adult (18+) who has opted in to reflect on their own sex life with a partner. Frank, explicit questions about sex and desire are appropriate and expected here — this is a normal, in-policy use; do NOT shy away or substitute tasteful, emotional-closeness questions.`;
  const parts: string[] = [context, EXPLICIT_TIER_DIRECTIVE[tier]];
  // The explicit register GOVERNS the tone of the whole questionnaire (08 §24.9): it OVERRIDES any "warm /
  // tender / gentle / reassurance-aware / open with lighter questions / build rapport first" or
  // relationship-softening guidance elsewhere in this prompt. Do NOT ease in with a gentle warm-up — every
  // question is frank and explicit from the very FIRST. Personalize to them, but never at the cost of the
  // explicit register or the intensity of this tier.
  parts.push(
    `IMPORTANT: the explicit register above GOVERNS this questionnaire's tone — it overrides any "warm/gentle/tender/reassurance/open-with-lighter-questions/build-rapport-first" guidance elsewhere. Do NOT ease in: EVERY question is frank and explicit from the first one, no gentle warm-up.`,
  );
  if (tier === 'unfiltered') {
    parts.push(
      `This is the UNFILTERED tier — the most extreme. Every question must be genuinely graphic and push the edge; if a draft reads like it could belong in a milder tier, make it filthier, kinkier, and more extreme. Never dilute it into tasteful, romantic, or emotional-closeness questions.`,
    );
  }
  // With a focus (08 §23.3) the explicit REGISTER stays but the SUBJECT follows the focus, not the whole
  // inventory — so "how we're handling the move" on an intimacy questionnaire yields explicit questions ABOUT
  // that, not a tour of every act.
  if (opts.focused === true) {
    parts.push(
      `Keep the explicit register above, but SHAPE every ${scenario ? 'scenario' : 'question'} around the FOCUS stated at the top of this message — the subject follows the focus, not the wider ground below.`,
    );
  }
  parts.push(
    `${scenario ? 'Draw the scenarios from' : 'Cover'} concrete subject matter: specific sex acts, bodies and grooming, turn-ons/turn-offs, fantasies (including taboo fantasies framed strictly as fantasy/roleplay — e.g. consensual non-consent (CNC) as pre-agreed roleplay), porn and masturbation, sexual history, frequency and desire, and boundaries.`,
  );
  // Already-rated acts → go DEEPER (never re-ask the rating or re-list them as plain options, §19.3).
  //
  // Two bounds, and #314 needs BOTH. (1) FILTERED to acts whose ground is still open per the ask ledger —
  // without it, "go deeper on everything they ever rated" is act-level re-mining, the exact reported
  // complaint ("how many more ways it wants me to describe Ben giving me oral"). De-dup structurally cannot
  // catch that: each re-ask is genuinely new WORDING about the same act. (2) CAPPED (spec 71 §5.7): unbounded
  // this was the single largest block in the prompt — on a real vault it listed all 101 rated acts (2,463
  // chars, 29% of the whole message). It is vocabulary, not ground selection, so a short sample is enough.
  const deepenable = coveredActs
    .filter((a) => onOpenGround(categoryForKey(a.key)))
    .slice(0, MAX_DEEPEN_ACTS);
  if (deepenable.length > 0) {
    parts.push(
      `They have ALREADY RATED acts like these in onboarding — do NOT re-ask whether they like them and do NOT re-offer them as plain multiple-choice options. Where one is relevant to the ground for this set, go DEEPER on it: the how/when/with whom, what would make it better, the specific fantasies and edges around it: ${deepenable
        .map((a) => `${a.label} (${a.rating})`)
        .join('; ')}.`,
    );
  }
  // The subject matter, from this person's OWN map. Each entry is a real area of their intimate life with the
  // planner's one-line sense of what it covers — richer and more specific than a catalogue of act names, and
  // already saturation-filtered, since only OPEN ground is passed in.
  const ground = (opts.openGround ?? []).filter((g) => g.label.trim() !== '');
  parts.push(
    ground.length > 0
      ? `Subject matter to draw on — ground still open with this person:\n${ground
          .slice(0, MAX_GROUND)
          .map((g) => `- ${g.label}${g.blurb ? ` — ${g.blurb}` : ''}`)
          .join(
            '\n',
          )}\nDraw the specifics from these. Go for what has NOT been asked yet within them, and name acts, bodies and scenarios plainly.`
      : // Everything open has been worked through: say so plainly rather than printing an empty list, and let
        // the tier directive above carry the direction.
        `Every area explored with this person so far has been worked through. Do NOT return to any of them, even in new words — go somewhere genuinely new: combinations, scenarios, and edges between areas they have not been asked about.`,
  );
  parts.push(
    `Boundary: consensual adults only; taboo content only as fantasy/roleplay; never minors, real (non-roleplay) non-consent, or illegal acts. Within those limits this content IS in policy, so generate the ${scenario ? 'scenarios' : 'questions'} normally — only return an empty array for genuinely prohibited requests, never merely because the topic is sexually explicit.`,
  );
  return parts.join('\n');
}

/**
 * The gentle 18+ tier (`intimacyGeneral`, for an intimacy OR scenario questionnaire, 08 §22.2). Richer than a
 * cliché one-liner so even the general tier asks real, specific questions about desire and connection — but
 * deliberately **non-graphic** (no explicit anatomy or act detail), so it does NOT receive the explicit
 * activity inventory (which would contradict "nothing explicit").
 */
export function sensitiveGeneralFraming(scenario = false): string {
  const noun = scenario ? 'intimate situations to react to' : 'questions';
  return `\nThis is an intimacy questionnaire (general, 18+). Ask real, specific ${noun} about desire, connection, what turns them on, frequency, and what they want more of — warm, curious, and revealing. Keep it non-graphic (no explicit anatomy or act detail); this is the gentle tier.`;
}

/** What an intimacy "Draft with AI" should produce (08 §17.12-C). Scenarios = described situations to react to. */
export type IntimacyGenerateMode = 'questions' | 'scenarios' | 'mix';

/** Format direction for an intimacy generation (08 §17.12-C) — questions vs described scenarios vs a mix. */
function intimacyModeDirection(mode: IntimacyGenerateMode): string {
  if (mode === 'scenarios') {
    return `\nFORMAT — SCENARIOS: each item is a short DESCRIBED SITUATION or roleplay (1–3 sentences) the person reacts to, NOT a direct question. Set up a concrete intimate situation, then have them react — use answer types that fit reacting: \`rating\` (e.g. how appealing, 1–5), \`yesNo\`, or \`shortText\`/\`longText\`. The scenario itself is the question \`prompt\`.`;
  }
  if (mode === 'mix') {
    return `\nFORMAT — MIX: include BOTH direct questions AND described scenarios (a short situation/roleplay the person reacts to, answered with a rating, yes/no, or free text).`;
  }
  return '';
}

export function buildGenerationUserMessage(input: {
  type: string;
  sensitivity: SensitivityTier;
  brief?: string;
  context?: string;
  existingPrompts: string[];
  count: number;

  // The ground still open with this recipient, from their own topic map (spec 71 §5.3) — the subject matter
  // for an explicit-tier set. Seeded ground when they have no history yet; empty for a non-intimacy draft.
  openGround?: readonly { label: string; blurb?: string }[];
  /** The recipient's hard nos (74 §8.4) — unconditional, passed on every explicit generation. */
  suppressedTexts?: readonly string[];
  // What an intimacy draft should produce (08 §17.12-C): direct questions, described scenarios, or a mix.
  intimacyMode?: IntimacyGenerateMode;
  // The recipient's full answered content (08 §17.4/§19.1), assembled host-side. Used to AVOID overlap AND to
  // go DEEPER / personalize (08 §24 — the owner directed tailoring may use all of it). The model weaves it in
  // naturally; it must not recite it back verbatim.
  recipientHistory?: string;
  // The intimacy acts the recipient already rated in onboarding (08 §19.3) — reframes the intimacy seeding.
  coveredIntimacyActs?: readonly { key: string; label: string; rating: string }[];
  // Ground the ask ledger says is closed — worked through, cooling down, or paused (spec 71 §5.2). Bounds the
  // "go deeper" acts + the fantasy material so neither re-mines ground the planner has just shut (#314).
  closedTopicIds?: readonly string[];
  // Who the questionnaire is FOR (08 §24.4): name + pronouns + the author↔recipient relationship — so questions
  // read as written for this specific person, in the right register for the relationship.
  recipient?: {
    name?: string;
    pronouns?: string;
    relationship?: { type: RelationshipType; closeness?: number };
  };
  // Differentiated steering from the recipient's Personalization Profile (spec 69 §5.9): avoid / boundary /
  // reword blocks built from their prior skips/declines. This is how the app learns what NOT to ask over time.
  // Since spec 71 §5.5 this is BOUNDARIES ONLY — choosing ground is the planner's job.
  feedbackGuidance?: string;
  // The ground the planner chose for this set (spec 71 §5.5). Threads, never finished questions: handing the
  // model polished question text is what produced the reported near-verbatim repeat.
  threads?: readonly { label: string; angle?: string }[];
  // The built-in families each question's first topic tag must come from (spec 71 §5.3) — the roll-up that
  // stops an emergent vocabulary fragmenting one area across several names.
  rollUpCategories?: readonly string[];
  // Partner-shared context for a SELF-send (spec 69 §5.4): facts people close to them shared TO them, so a
  // check-in can personalize + reciprocate a partner's desire. Restricted facts never reach here.
  partnerContext?: string;
}): string {
  const parts: string[] = [];
  parts.push(`Draft ${input.count} questions for a "${input.type}" questionnaire.`);
  // Who it's for (08 §24.4-B2/B3): name + pronouns + relationship register lead so tailoring frames everything.
  const rcpt = input.recipient;
  if (rcpt?.name?.trim()) {
    const pron = rcpt.pronouns?.trim() ? ` (${rcpt.pronouns.trim()})` : '';
    parts.push(
      `\nThis questionnaire is FOR ${rcpt.name.trim()}${pron}. Write it for them — address them directly, use their name where natural, and use their pronouns.`,
    );
  }
  if (rcpt?.relationship) {
    parts.push(relationshipFraming(rcpt.relationship.type, rcpt.relationship.closeness));
  }
  // A present brief is the GOVERNING focus (08 §23.3): it LEADS the message and every question must serve it;
  // the sensitivity register, context, and de-dup guidance below all apply WITHIN this focus. Blank brief ⇒
  // fall back to recipient-tailored / structured-context generation (the pre-§23 behaviour).
  const focus = input.brief?.trim();
  if (focus) {
    parts.push(
      `\nFOCUS — this entire questionnaire is about: ${focus}\nEvery question must serve this focus. Do NOT drift onto unrelated topics. The sensitivity register, the context about the people, and the "avoid repetition" guidance below all apply WITHIN this focus.`,
    );
  }
  // Sensitivity tiers only carry an explicit register on the intimacy + scenario types (08 §15.2/§22.2). At the
  // explicit/unfiltered tiers request genuinely explicit content (a real intensity ladder); at the gentle 18+
  // tier use a richer, non-graphic directive; every other type/tier keeps the conservative note.
  const isSensitiveType = input.type === INTIMACY_TYPE || input.type === SCENARIO_TYPE;
  const isExplicitTier = input.sensitivity === 'explicit' || input.sensitivity === 'unfiltered';
  if (isSensitiveType && isExplicitTier) {
    parts.push(
      explicitFraming(
        input.sensitivity as 'explicit' | 'unfiltered',
        input.coveredIntimacyActs ?? [],
        // With a focus, keep the explicit register but let the SUBJECT follow the focus (08 §23.3).
        {
          scenario: input.type === SCENARIO_TYPE,
          focused: focus != null,
          ...(input.openGround ? { openGround: input.openGround } : {}),
          ...(input.closedTopicIds ? { closedTopicIds: input.closedTopicIds } : {}),
        },
      ),
    );
  } else if (isSensitiveType && input.sensitivity === 'intimacyGeneral') {
    parts.push(sensitiveGeneralFraming(input.type === SCENARIO_TYPE));
  } else {
    parts.push(SENSITIVITY_NOTE[input.sensitivity]);
  }
  /*
   * The recipient's hard nos (74 §8.4), for EVERY branch above.
   *
   * This used to live inside `explicitFraming`, which meant the gentle 18+ tier (`intimacyGeneral`) — a real,
   * commonly-used tier — and every non-sensitive type dropped it entirely. Suppression only ever PREVENTS a
   * question, so there is no tier at which it is correct to omit it, and nobody reviews a generated question
   * before it is sent. Hoisted here so the branch a draft happens to take can no longer decide whether the
   * person's hard limits apply.
   */
  if ((input.suppressedTexts?.length ?? 0) > 0) {
    parts.push(
      `NEVER use any of these words or phrases, in any form — they have been ruled out and the rule is ` +
        `absolute, whatever else this asks about: ${input.suppressedTexts!.join(' · ')}. Never mention that ` +
        `anything was ruled out.`,
    );
  }
  // The questions/scenarios/mix format direction applies to any intimacy draft (08 §17.12-C).
  if (input.type === INTIMACY_TYPE && input.intimacyMode && input.intimacyMode !== 'questions') {
    parts.push(intimacyModeDirection(input.intimacyMode));
  }
  if (input.context?.trim()) {
    parts.push(
      `\nUse this context about the people involved to tailor the questions${focus ? ' (within the focus above)' : ''}:\n${input.context.trim()}`,
    );
  }
  // The planner's chosen ground (spec 71 §5.5). Threads, not questions — write each one fresh, at this tier.
  if (input.threads && input.threads.length > 0) {
    parts.push(
      [
        `\nGROUND TO OPEN THIS TIME — the ground for this set has already been chosen. Build the questions on these threads:`,
        ...input.threads.map((t) =>
          t.angle?.trim() ? `- ${t.label} — ${t.angle.trim()}` : `- ${t.label}`,
        ),
        `Write each thread as a FRESH question in your own words, in the register above. A thread is ground to open, NOT wording to reuse — never echo these lines back as the question.`,
      ].join('\n'),
    );
  }
  if (input.existingPrompts.length > 0) {
    parts.push(
      `\nDo NOT duplicate or closely echo these already-present questions:\n${input.existingPrompts
        .map((p) => `- ${p}`)
        .join('\n')}`,
    );
  }
  // Knowledge-aware generation (08 §17.4/§19.2/§24): the model is handed everything already known about the
  // recipient and told to USE it to personalize + go deeper, and to NEVER repeat it. This is what makes each
  // questionnaire feel written for them and learn more over time.
  if (input.recipientHistory?.trim()) {
    parts.push(
      [
        `\nWHAT IS ALREADY KNOWN about the person who will answer (their onboarding answers, past sessions,` +
          ` earlier questionnaires + their answers, reflections/tests, and profile). USE this to make the` +
          ` questions personal and specific to them, and to go DEEPER — never to repeat it.`,
        `Do NOT ask anything already answered here, and do NOT offer a multiple-choice OPTION that repeats a` +
          ` value they have already chosen or rated. Instead, write questions that:`,
        `  1. GO DEEPER on what is known — the why/how/when behind it, what would change it, the nuance and` +
          ` feelings underneath, concrete follow-ups to a known fact.`,
        `  2. Explore the UNKNOWN — topics, situations, and specifics there is no data on yet.`,
        `  3. Are genuinely USEFUL — serve the focus (when one is given) and this relationship; ask what is` +
          ` worth learning next, not novelty or edginess for its own sake.`,
        `  4. Are CREATIVE — mix in scenarios to react to, "would you rather", this-or-that, and short` +
          ` hypotheticals, not only flat questions.`,
        `Weave this knowledge in NATURALLY to make questions feel personal — do not recite it back word-for-word` +
          ` or turn a known fact into "you said X, tell me about X". "Avoid overlap" means don't RE-ASK it.`,
        input.recipientHistory.trim(),
      ].join('\n'),
    );
  }
  // Partner-shared context for a self-send (spec 69 §5.4) — positive personalization + reciprocity. Placed with
  // the "what is known" material (it's the person's own coaching context); restricted facts never reach here.
  if (input.partnerContext?.trim()) {
    parts.push(`\n${input.partnerContext.trim()}`);
  }
  // The differentiated skip/decline steering (spec 69 §5.9) — placed AFTER the "what is known" block so it
  // governs it: even if a topic is unexplored, an "it doesn't apply" / boundary signal keeps it off-limits.
  if (input.feedbackGuidance?.trim()) {
    parts.push(`\n${input.feedbackGuidance.trim()}`);
  }
  // The register is restated LAST, so the governing instruction is also the most recent one the model reads
  // (spec 71 §5.5). The reported failure was structural, not stylistic: the steering blocks that used to sit
  // here outranked an explicit register stated ~6,000 chars earlier, and the model followed the closer
  // instruction. Nothing may sit between this and the return contract.
  if (isSensitiveType && isExplicitTier) {
    parts.push(
      `\nREMINDER — this is a ${input.sensitivity.toUpperCase()} ${input.type} questionnaire, and that register GOVERNS: every question is frank, explicit and sexual, in the plain language described above. If a draft question could belong in a gentler tier, or drifts to a non-sexual part of their life, rewrite it before returning it.`,
    );
  }
  // The roll-up vocabulary each question's FIRST topic tag must come from (spec 71 §5.3). Scoped to this
  // questionnaire's own life areas so an intimacy set is offered intimacy families, not the whole taxonomy.
  if (input.rollUpCategories && input.rollUpCategories.length > 0) {
    parts.push(
      `\nCATEGORIES — the FIRST entry of every question's "topics" must be copied exactly from this list:\n${input.rollUpCategories
        .map((c) => `- ${c}`)
        .join('\n')}`,
    );
  }
  parts.push(`\nReturn the JSON object with a short "title" and the "questions" array.`);
  return parts.filter((p) => p !== '').join('\n');
}

export function buildImproveUserMessage(input: {
  prompt: string;
  type: string;
  instruction: string;
}): string {
  return [
    `Rewrite this questionnaire question. Instruction: ${input.instruction}.`,
    `Answer type: ${input.type}. Original: "${input.prompt}"`,
    `Return ONLY the rewritten question text — no quotes, no prose, no options.`,
  ].join('\n');
}

export const GAP_FINDER_SYSTEM = `${SAFETY}\n\nYou suggest the NEXT questionnaires a person could send to people in their life to understand them better. Base suggestions only on the structured context provided (profiles, relationships, prior Insights) — never invent facts. Return a JSON array of up to 3 objects, each:
{"title": string, "type": string, "rationale": short string (why this, now), "questions": [{"type": string, "prompt": string, "required": boolean, "options": string[] (REQUIRED for singleChoice/multiChoice/ranking/thisOrThat, >= 2 items; omit for other types)}] (2-4 sample questions)}.
When a specific recipient and what is already known about them are provided, tailor EVERY suggestion to that one person: go deeper on themes they have only partly explored, and open entirely new areas there is no data on yet. NEVER repeat a question they have already been asked, and never restate something already known about them — steer clear of it, do not mention it. Make the sample questions concrete and specific to this person, not generic.
Each sample question's "type" MUST be one of EXACTLY these values: ${SUGGESTABLE_ANSWER_TYPES.join(', ')}. Use no other type. Return ONLY the JSON array.`;

export const ANALYSIS_SYSTEM = `${SAFETY}

Turn a person's questionnaire answers into a durable coaching Insight. Return ONLY a JSON object:
{"summary": string (2-4 sentences, what this means for supporting them), "facts": [{"text": string, "shareable": boolean}] (3-6 concise facts; "shareable" = safe to share with the person the fact is about), "confidence": "low" | "medium" | "high", "categories": 1-2 life-area tags from EXACTLY this list: ${LIFE_AREAS.join(', ')}, "crisisFlag": boolean}.
Set "crisisFlag": true ONLY if the answers disclose risk of self-harm, abuse, or acute crisis. Never diagnose. Do not quote the raw answers back verbatim — synthesize.
The "summary" may use light Markdown (paragraphs, **bold**, *italic*, "-" lists); the "facts" stay PLAIN text. No tables, images, raw HTML, or code fences.

If you are shown questions the person did NOT answer: that is feedback about those QUESTIONS. Never infer a trait, a circumstance, a feeling, a boundary or a motive from a refusal, and never state or imply why someone might have declined beyond what they said themselves. A silence is not evidence about a person.`;

export function buildAnalysisUserMessage(input: {
  title: string;
  qa: { prompt: string; answer: string }[];
  /** Questions that came back refused, if any (08 §34.3). */
  skips?: SkipLine[];
}): string {
  const lines = input.qa.map((x) => `Q: ${x.prompt}\nA: ${x.answer}`).join('\n\n');
  const skipped = buildSkipBlock(input.skips ?? []);
  return `Questionnaire: "${input.title}"\n\nAnswers:\n${lines}${skipped}\n\nProduce the Insight JSON.`;
}

/**
 * One refused question as the analysis sees it. `reason` is the recipient's OWN words and is only ever set
 * for a Standard send — on a Private send they were told the sender would not see their written answers, and
 * a skip reason is a written answer (08 §34.2). `kind` is the preset it came from, which is safe either way.
 */
export interface SkipLine {
  prompt: string;
  kind: SkipKind;
  reason?: string;
}

const SKIP_KIND_PHRASE: Record<SkipKind, string> = {
  unclear: 'said it was not clear enough to answer',
  'prefer-not-to-say': 'preferred not to say',
  'not-applicable': 'said it does not apply to them',
  other: 'skipped it',
};

/** Cap the block so a long questionnaire can't crowd out the answers it is supposed to be secondary to. */
const MAX_SKIP_LINES = 8;

/**
 * What the model is told about refusals (08 §34.3). The framing is the safety-bearing part, not the data:
 * a refusal is feedback about the QUESTION, so the model is told in the same breath never to infer anything
 * about the person from one. Without that, "she wouldn't discuss her mother" becomes a fact in an Insight
 * that is partner-shared by default — precisely what §25.5 excludes declines from the Q&A to prevent.
 */
export function buildSkipBlock(skips: SkipLine[]): string {
  if (skips.length === 0) return '';
  const shown = skips.slice(0, MAX_SKIP_LINES);
  const lines = shown
    .map(
      (s) =>
        `- "${s.prompt}" — they ${SKIP_KIND_PHRASE[s.kind]}${s.reason ? `: "${s.reason}"` : ''}`,
    )
    .join('\n');
  const more = skips.length > shown.length ? `\n- …and ${skips.length - shown.length} more` : '';
  return `\n\nQUESTIONS THEY DID NOT ANSWER — this is feedback about the QUESTIONS, not information about the person. Use it ONLY to judge which questions to rewrite or drop. NEVER infer a trait, a circumstance, a feeling or a boundary from the fact that someone declined to answer, and never state or imply anything about why they might have declined beyond what they said themselves:\n${lines}${more}`;
}

/**
 * The explicit register for INTERPRETING intimacy answers — questionnaire analysis (`analyzeAssignment` /
 * `distillContextOnly`) AND the compatibility report (`generateAlignment`) — for an intimacy/scenario
 * questionnaire at the `explicit`/`unfiltered` tiers (08-questionnaires §22.7 — the read-side counterpart of
 * generation's `explicitFraming`). Without it, the generic "coaching Insight … supporting them" register + the
 * question-drafting `SAFETY` prefix (whose "return an empty questions array" primes emptiness) makes the model
 * return a structurally-valid but EMPTY result for frank sexual answers — it has no license to synthesize
 * explicit content, so it says nothing. This establishes the legitimate consensual-adult context, positively
 * DIRECTS a substantive frank synthesis, and restates the SAME boundary as generation. Applied only for
 * intimacy/scenario at the explicit tiers; standard analysis/reports are unchanged.
 */
const INTIMACY_ANALYSIS_FRAMING = [
  `CONTEXT: This questionnaire is a private, 18+ intimacy check-in inside a personal wellness app. The answers are a consenting adult's candid reflections on their own sex life — desires, preferences, fantasies, turn-ons, dynamics, and boundaries. Interpreting them for the coaching that supports their intimate life is appropriate, expected, and IN POLICY — a normal use of this app, NOT a request to decline.`,
  `So DO produce a real, substantive result. Name the desires, preferences, turn-ons, fantasies, dynamics, and boundaries in the answers plainly and frankly in the summary and the facts — do not sanitize them into vague euphemism, and do NOT return an empty summary or empty facts merely because the content is sexually explicit. Synthesize (never quote the raw answers back verbatim). If the answers are genuinely sparse, still summarize what little is there rather than returning nothing.`,
  `Boundary: consensual adults only; taboo content only as fantasy/roleplay; never minors, real non-consent, or illegal acts. Within those limits this content IS in policy — interpret it normally. Only decline for genuinely prohibited content, never because the topic is sexually explicit.`,
].join('\n');

/** A light note for a NON-explicit intimacy check-in (`intimacyGeneral`): permit warm reflection on intimate
 *  and relational content without graphic language, and never return empty just because it's intimate. */
const INTIMACY_GENERAL_ANALYSIS_NOTE = `CONTEXT: This is a private intimacy check-in for a consenting adult reflecting on connection and desire with a partner. Reflecting on intimate, relational content is appropriate and expected here — keep it respectful and non-graphic, and do not return an empty result merely because the topic is intimate.`;

/** Whether a questionnaire's type + tier carries the EXPLICIT intimacy register (08 §15.2/§22.2). */
export function isExplicitIntimacyTier(type: string, tier: SensitivityTier): boolean {
  return (
    (type === INTIMACY_TYPE || type === SCENARIO_TYPE) &&
    (tier === 'explicit' || tier === 'unfiltered')
  );
}

/**
 * Append the explicit intimacy register (or the lighter `intimacyGeneral` note) to a base analysis/report
 * system prompt for an intimacy/scenario questionnaire at the matching tier; any other questionnaire keeps the
 * base prompt unchanged. Shared by `buildAnalysisSystem` + `buildAlignmentSystem` so every read-side path that
 * interprets intimacy content gets the register (08 §22.7 — never half-apply it).
 */
function withIntimacyRegister(base: string, type: string, tier: SensitivityTier): string {
  if (isExplicitIntimacyTier(type, tier)) return `${base}\n\n${INTIMACY_ANALYSIS_FRAMING}`;
  if ((type === INTIMACY_TYPE || type === SCENARIO_TYPE) && tier === 'intimacyGeneral') {
    return `${base}\n\n${INTIMACY_GENERAL_ANALYSIS_NOTE}`;
  }
  return base;
}

/**
 * The analysis system prompt for a questionnaire, register-aware (08 §22.7). An intimacy/scenario questionnaire
 * at an explicit tier gets the explicit framing appended so the model actually synthesizes frank sexual content
 * into an insight (instead of returning valid-but-empty JSON); `intimacyGeneral` gets the lighter note; every
 * other questionnaire keeps the base `ANALYSIS_SYSTEM` unchanged.
 */
export function buildAnalysisSystem(type: string, tier: SensitivityTier): string {
  return withIntimacyRegister(ANALYSIS_SYSTEM, type, tier);
}

/**
 * Compatibility variant personalization (08-questionnaires §3.6). The author writes the canonical
 * questions once; this rewrites each prompt warmly for one specific answerer, keeping the SAME meaning and
 * the SAME answer type so the two variants stay aligned by `canonicalId`. The model returns only the
 * reworded prompt text — the answer structure (type/options/scale) is preserved by the caller.
 */
export const VARIANT_SYSTEM = `${SAFETY}

You personalize a compatibility questionnaire for ONE of the two people answering it ("the answerer"), about their partner ("the other person"). For EACH question, rewrite it so it speaks directly and warmly to the answerer and asks about THEIR experience with the other person:
- Rewrite the PROMPT from the answerer's point of view (the answerer is "you"); refer to the other person by their name.
- Rewrite EACH answer OPTION the same way: the answerer speaks in the first person ("I"…), and any reference to the partner is the OTHER PERSON — refer to them by name, or with the correct pronouns for THEIR gender.

PRONOUNS ARE CRITICAL: use ONLY the other person's gender's pronouns when referring to them (e.g. a female partner is "she/her", a male partner is "he/him", a non-binary partner is "they/them"). NEVER use the wrong gender's pronoun for the other person — a question for a man about his female partner must say "her", never "him". When unsure, use the other person's name instead of a pronoun.

Keep the exact same meaning, the same number of options, and the same order. Do not add, drop, reorder, or merge questions or options. Return ONLY a JSON array — one object per input question, IN ORDER: { "prompt": string, "options": string[] | null }. Set "options" to null when the question has no options; otherwise return the rewritten options in the SAME order and count.`;

/** A pronoun hint for the prompt from a free-text gender string (null = unknown → use the name / they-them). */
export function pronounHint(gender?: string): string | null {
  const g = gender?.trim().toLowerCase() ?? '';
  if (g === 'female' || g === 'woman' || g === 'f') return 'she/her';
  if (g === 'male' || g === 'man' || g === 'm') return 'he/him';
  if (g.startsWith('non-binary') || g === 'nonbinary' || g === 'enby') return 'they/them';
  return null;
}

/** Describe a participant for the variant prompt: "Angel (she/her)" / "Angel" when gender is unknown. */
function describeParticipant(name: string, gender?: string): string {
  const hint = pronounHint(gender);
  return hint ? `${name} (${hint})` : name;
}

/**
 * Build the variant user message (08-questionnaires §17.12/§17.14e). The questionnaire compares `forName`
 * (the answerer this variant is for) with `aboutName` (the other participant). Each prompt AND its options
 * are rewritten to ask `forName` about their experience with `aboutName` — from `forName`'s point of view,
 * with the correct pronouns for each participant's gender (so a man asked about his female partner reads
 * "her", never "him"). `context` is `forName`'s shareable facts only (the §13.3 boundary).
 */
export function buildVariantUserMessage(input: {
  forName: string;
  forGender?: string;
  aboutName: string;
  aboutGender?: string;
  context?: string;
  questions: { prompt: string; options?: string[] }[];
}): string {
  const answerer = describeParticipant(input.forName, input.forGender);
  const other = describeParticipant(input.aboutName, input.aboutGender);
  const aboutPronoun = pronounHint(input.aboutGender);
  const parts: string[] = [
    `The answerer is ${answerer}. The other person is ${other}. Rewrite each question for ${input.forName} to answer about THEIR experience with ${input.aboutName}: write from ${input.forName}'s point of view, and when referring to ${input.aboutName} use their name or ${
      aboutPronoun ? `${aboutPronoun} pronouns` : '"they/them"'
    } — NEVER the wrong gender's pronoun for ${input.aboutName}.`,
  ];
  if (input.context?.trim()) {
    parts.push(
      `\nWhat you know about ${input.forName} (shareable facts only):\n${input.context.trim()}`,
    );
  }
  parts.push(
    `\nQuestions (rewrite each prompt + its options; same order, same count, same meaning):\n${input.questions
      .map((q, i) => {
        const opts =
          q.options && q.options.length > 0
            ? `\n   OPTIONS: ${JSON.stringify(q.options)}`
            : '\n   OPTIONS: none';
        return `${i + 1}. PROMPT: ${q.prompt}${opts}`;
      })
      .join('\n')}`,
  );
  parts.push(
    `\nReturn ONLY a JSON array of ${input.questions.length} objects { "prompt", "options" } in order.`,
  );
  return parts.join('\n');
}

/**
 * Compatibility alignment (08-questionnaires §3.6/§13.5d). Two answerers answered aligned variants of the
 * same questions; this compares their answers question-by-question into a warm, honest report + a coaching
 * Insight for the sender. Never diagnoses; frames differences as information, not verdicts.
 */
export const ALIGNMENT_SYSTEM = `${SAFETY}

Two people answered personalized variants of the same questionnaire. Compare their answers question by question and produce a warm, honest compatibility report for the person who sent it. Return ONLY a JSON object:
{"summary": string (2-4 sentences on where they align and where they differ, supportive not judgemental), "items": [{"canonicalId": string, "agreement": "aligned" | "mixed" | "divergent", "note": string (one sentence on how the two answers relate)}], "crisisFlag": boolean (true ONLY if an answer discloses risk of self-harm, abuse, or acute crisis), "facts": [{"text": string, "shareable": boolean}] (3-6 concise coaching facts for the sender; "shareable" = safe to share with the other person)}.
Use each item's canonicalId exactly as given. Never diagnose. Synthesize — do not quote raw answers verbatim.
The "summary" and each item "note" may use light Markdown (paragraphs, **bold**, *italic*, "-" lists); the "facts" stay PLAIN text. No tables, images, raw HTML, or code fences.`;

/**
 * The compatibility-report system prompt, register-aware (08 §22.7): an intimacy/scenario compatibility
 * questionnaire at an explicit tier gets the explicit register so the report isn't empty for frank answers —
 * the same gap `buildAnalysisSystem` closes for one-person analysis. Standard reports are unchanged.
 */
export function buildAlignmentSystem(type: string, tier: SensitivityTier): string {
  return withIntimacyRegister(ALIGNMENT_SYSTEM, type, tier);
}

export function buildAlignmentUserMessage(input: {
  title: string;
  personAName: string;
  personBName: string;
  items: { canonicalId: string; prompt: string; a: string; b: string }[];
}): string {
  const blocks = input.items
    .map(
      (x) =>
        `[${x.canonicalId}] ${x.prompt}\n  ${input.personAName}: ${x.a || '(no answer)'}\n  ${input.personBName}: ${x.b || '(no answer)'}`,
    )
    .join('\n\n');
  return `Questionnaire: "${input.title}"\nAnswerers: ${input.personAName} and ${input.personBName}\n\nAligned answers:\n${blocks}\n\nProduce the compatibility report JSON.`;
}

// The caller guarantees non-empty context (the gap-finder returns an empty-state hint pre-call, 37 §11).
// `recipientName`/`recipientHistory`/`avoidSuggestions` drive the recipient-first tailoring (08 §18.2): the
// history is the recipient's full answered content as AVOID-only grounding (the §17.4 author-blind boundary —
// the model must never quote or allude to it), and `avoidSuggestions` are the titles of ideas already saved
// (so "Suggest more" returns genuinely NEW ones). All optional — the generic Home path passes only `context`.
export function buildGapFinderUserMessage(input: {
  context: string;
  recipientName?: string;
  recipientHistory?: string;
  avoidSuggestions?: string[];
  /** Ground the ask ledger says is worked through — the TOPIC-level signal (spec 71 §5.2). Prior TITLES alone
   *  are opaque ("The Art of You" says nothing about what it covered), so without this the selector picks the
   *  focus blind to saturation, and the focus GOVERNS generation downstream. */
  workedThrough?: string[];
  /** Ground barely touched — what to prefer instead. */
  openGround?: string[];
}): string {
  const parts: string[] = [
    `Here is the structured context about this person and their relationships:\n${input.context.trim()}`,
  ];
  if (input.recipientName?.trim()) {
    parts.push(
      `\nThese suggestions are specifically for ${input.recipientName.trim()}. Tailor every questionnaire to them — fit it to who they are and what would deepen this relationship.`,
    );
  }
  if (input.recipientHistory?.trim()) {
    parts.push(
      [
        `\n${input.recipientName?.trim() ?? 'This person'} has ALREADY shared the material below with the app (their onboarding, past sessions, earlier questionnaires, and profile). Use it ONLY to avoid repetition: do NOT suggest a questionnaire that re-asks what they have already answered, and steer clear of topics they have already covered.`,
        `Instead, go DEEPER on themes they have only partly explored, and open ENTIRELY NEW areas there is no data on yet.`,
        `CRITICAL: never quote, restate, reference, hint at, or reveal any of this material in a question — the questions must stand on their own. "Avoid overlap" means steer clear, NOT mention.`,
        input.recipientHistory.trim(),
      ].join('\n'),
    );
  }
  if (input.workedThrough && input.workedThrough.length > 0) {
    parts.push(
      `\nGROUND ALREADY WORKED THROUGH — do NOT build a questionnaire around any of these; they have been asked about repeatedly and there is little left to learn:\n${input.workedThrough
        .map((t) => `- ${t}`)
        .join('\n')}`,
    );
  }
  if (input.openGround && input.openGround.length > 0) {
    parts.push(
      `\nGROUND BARELY TOUCHED — strongly PREFER these, or name something genuinely new that is on neither list:\n${input.openGround
        .map((t) => `- ${t}`)
        .join('\n')}`,
    );
  }
  if (input.avoidSuggestions && input.avoidSuggestions.length > 0) {
    parts.push(
      `\nYou have ALREADY proposed these questionnaire ideas — propose DIFFERENT ones this time (do not repeat or lightly reword them):\n${input.avoidSuggestions
        .map((t) => `- ${t}`)
        .join('\n')}`,
    );
  }
  parts.push(`\nSuggest up to 3 questionnaires that would help them learn something useful next.`);
  return parts.join('\n');
}

/**
 * Reading a questionnaire that came back entirely unanswered (08 §34.3). The whole prompt is about the
 * QUESTIONS: the one thing it must never do is turn a silence into a claim about the person.
 */
export const REFUSAL_ANALYSIS_SYSTEM = `${SAFETY}

Someone sent a questionnaire and every question came back unanswered — skipped, or left blank. You are
helping the SENDER understand why it did not land, so they can ask better next time.

You are reading the QUESTIONS, not the person. Absolute rules:
- NEVER infer a trait, a circumstance, a feeling, a boundary or a motive from the fact that someone did not
  answer. Silence is not evidence about them.
- NEVER speculate about why they might have declined beyond the reason they gave in their own words.
- Say nothing about the person at all. Every observation is about a question: what made it hard to answer,
  what it assumed, what it should have asked instead.
- If the reasons do not actually tell you much, say so plainly and briefly rather than inventing a pattern.

Return ONLY a JSON object:
{
  "summary": "2-4 sentences to the sender about what these questions got wrong and what would work better",
  "facts": [{ "text": "one concrete change to a question", "shareable": false }],
  "confidence": "low" | "medium" | "high",
  "categories": ["Other"],
  "crisisFlag": false
}`;

export function buildRefusalUserMessage(input: { title: string; skips: SkipLine[] }): string {
  return `Questionnaire: "${input.title}"\n\nEvery question came back unanswered.${buildSkipBlock(
    input.skips,
  )}\n\nProduce the JSON.`;
}
