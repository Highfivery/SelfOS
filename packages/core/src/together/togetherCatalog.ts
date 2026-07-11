// The Together guided catalog (58 §3.10) — couples guided sessions, SEPARATE from the solo `guidedCatalog`
// (16): solo surfaces never list couples guides, `GuidedGroupId`/`GUIDE_LIFE_AREAS` are untouched, and
// `togetherPromptBuilder` resolves a Together session's `guideId` against THIS catalog only. Each entry is an
// ordinary Together session carrying a `guideId` (the 16 pattern: an addendum appended AFTER PERSONA + SAFETY
// + context, + optional `[[SELFOS:STEP:n]]` steps — the current step is DERIVED from the newest coach message,
// never stored, keeping session.enc single-writer). The 18+ `together-desire` group lands in Phase F and is
// withheld host-side until BOTH partners' acks exist; the invariant `adult === (group === 'together-desire')`
// is asserted by a test.

import type { TogetherCatalogEntry } from '../schemas';

export type TogetherGroupId = 'together-connect' | 'together-repair' | 'together-desire';

export interface TogetherGuide {
  /** Stable id, e.g. 'love-maps'. */
  id: string;
  group: TogetherGroupId;
  /** Card title — avoids the bare word "Therapy" (§8.1). */
  title: string;
  /** Recognisable framework, shown as a per-card tag (e.g. 'Gottman'). */
  framework: string;
  /** One-line blurb on the card. */
  blurb: string;
  kind: 'chat' | 'structured';
  /** The coach's static first message (§3.10) — framed + inviting, no model call. */
  openingMessage: string;
  /** Method/steps steering, appended after PERSONA + SAFETY + context (§6.3). */
  systemPromptAddendum: string;
  /** Structured exercises only — named steps for the stepper. */
  steps?: string[];
  /** The 18+ `together-desire` group → adult acknowledgement gating (§8.3). */
  adult?: boolean;
}

/** Ordered groups with non-clinical display titles (§3.10). `together-desire` is added in Phase F. */
export const TOGETHER_GROUPS: ReadonlyArray<{ id: TogetherGroupId; title: string }> = [
  { id: 'together-connect', title: 'Connect' },
  { id: 'together-repair', title: 'Repair' },
];

export function togetherGroupTitle(group: TogetherGroupId): string {
  return TOGETHER_GROUPS.find((g) => g.id === group)?.title ?? group;
}

/** The portrait life-areas a couples guide makes relevant (per-call fact selection). Core is always added. */
const TOGETHER_GUIDE_LIFE_AREAS: Record<TogetherGroupId, string[]> = {
  'together-connect': ['Relationships', 'Emotions & patterns'],
  'together-repair': ['Relationships', 'Emotions & patterns'],
  'together-desire': ['Intimacy', 'Relationships'],
};

export function togetherGuideLifeAreas(group: TogetherGroupId): string[] {
  return TOGETHER_GUIDE_LIFE_AREAS[group];
}

/** The couples not-therapy frame that leads every addendum (§8.1) — SAFETY still precedes it. */
function frame(framework: string): string {
  return `This is a Together guided practice for the two of you, inspired by ${framework} — it is NOT couples \
therapy, diagnosis, or treatment, and you are an AI facilitator, not a clinician. The persona and safety \
guidance above always take precedence: stay balanced, never take a side, hold space so both are heard, and \
route any crisis to professional help. Move at their pace, one gentle step at a time; they can go off-script \
anytime and you follow them.`;
}

export const TOGETHER_CATALOG: ReadonlyArray<TogetherGuide> = [
  // ── Connect ─────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'love-maps',
    group: 'together-connect',
    title: 'Love Maps',
    framework: 'Gottman',
    blurb: 'Take turns learning the little details of each other’s inner world.',
    kind: 'structured',
    steps: ['Warm up', 'Ask & answer', 'Go a layer deeper', 'What you learned'],
    openingMessage:
      'Welcome to Love Maps — a Together exercise (inspired by Gottman, not therapy) for getting to know the ' +
      'small, current details of each other’s world. You’ll take gentle turns asking and answering. To warm ' +
      'up: what’s something that’s been on your mind this week that your partner might not know about yet?',
    systemPromptAddendum: `${frame('the Gottman "Love Maps" practice')} Guide a gentle, turn-taking exchange \
where each partner asks and answers open questions about the other's current inner world — hopes, worries, \
small joys, what a good day looks like now. Keep turns balanced, reflect what each learns, and invite one \
layer deeper before moving on. Steps: (1) a light warm-up, (2) ask & answer in turns, (3) go a layer deeper \
on one thread, (4) each names one thing they learned.`,
  },
  {
    id: 'state-of-the-union',
    group: 'together-connect',
    title: 'State of the Union',
    framework: 'Gottman',
    blurb: 'A weekly ritual: appreciations first, then one issue, gently.',
    kind: 'structured',
    steps: ['Appreciations', 'What went well', 'One thing to raise', 'A small agreement'],
    openingMessage:
      'This is your State of the Union — a weekly Together ritual (inspired by Gottman, not therapy) to stay ' +
      'connected. We start with appreciation, always. To begin: what’s one thing each of you appreciated ' +
      'about the other this week?',
    systemPromptAddendum: `${frame('the Gottman "State of the Union" weekly ritual')} Lead a gentle weekly \
check-in in this order: (1) each shares appreciations, (2) what went well between you, (3) ONE issue to raise \
— softened start-up, speaker/listener turns, no blame, (4) land on one small, concrete agreement. Keep it \
balanced and warm; if it escalates, slow down and validate both before continuing.`,
  },
  {
    id: 'appreciation-exchange',
    group: 'together-connect',
    title: 'Appreciation Exchange',
    framework: 'Positive psychology',
    blurb: 'Trade specific, heartfelt appreciations — and let them land.',
    kind: 'chat',
    openingMessage:
      'Let’s do an Appreciation Exchange — a simple Together practice (not therapy) of naming what you value ' +
      'in each other, specifically, and letting it land. Who’d like to go first, and what’s one thing you ' +
      'genuinely appreciate about your partner lately?',
    systemPromptAddendum: `${frame('a positive-psychology appreciation practice')} Invite each partner to \
offer specific, concrete appreciations (not generic praise) and help the receiver truly take it in rather \
than deflect. Keep turns balanced and unhurried; draw out the detail behind each appreciation.`,
  },
  {
    id: 'dreams-within-conflict',
    group: 'together-connect',
    title: 'Dreams Within Conflict',
    framework: 'Gottman',
    blurb: 'Find the deeper hope or need underneath a recurring disagreement.',
    kind: 'chat',
    openingMessage:
      'This is Dreams Within Conflict — a Together practice (inspired by Gottman, not therapy) for looking ' +
      'beneath a recurring disagreement to the hope or need underneath it for each of you. What’s a ' +
      'disagreement that keeps coming back for the two of you?',
    systemPromptAddendum: `${frame('the Gottman "Dreams Within Conflict" method')} Help each partner explore \
the deeper hope, value, or need beneath their position in a recurring gridlocked disagreement — the story or \
meaning behind it — while the other listens to understand, not to persuade. Never push for resolution; the \
goal is understanding each other's dreams. Keep both voices heard.`,
  },
  // ── Repair ──────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'naming-your-cycle',
    group: 'together-repair',
    title: 'Naming Your Cycle',
    framework: 'EFT',
    blurb:
      'Map the negative pattern you both get pulled into — the cycle is the enemy, not each other.',
    kind: 'structured',
    steps: ['The trigger', 'Your moves', 'The feelings underneath', 'Name the cycle together'],
    openingMessage:
      'Let’s name your cycle — a Together exercise (inspired by Emotionally Focused Therapy, not therapy ' +
      'itself) for seeing the pattern the two of you get pulled into, so the cycle becomes the problem, not ' +
      'each other. To start: think of a recent moment you both got stuck. What set it off?',
    systemPromptAddendum: `${frame('Emotionally Focused Therapy (EFT)')} Help the couple externalize their \
negative interaction cycle: (1) the trigger, (2) each partner's surface move (e.g. pursue / withdraw), (3) \
the softer, vulnerable feeling underneath each move, (4) name the cycle together as the shared "enemy." Never \
assign blame — the cycle catches them both. Draw out the underlying attachment needs gently.`,
  },
  {
    id: 'repair-after-rupture',
    group: 'together-repair',
    title: 'Repair After a Rupture',
    framework: 'Gottman',
    blurb:
      'Process a specific fight so you both feel understood — without re-litigating who’s right.',
    kind: 'structured',
    steps: ['How each felt', 'Your realities', 'What you each own', 'A repair'],
    openingMessage:
      'This is Repair After a Rupture — a Together process (inspired by Gottman, not therapy) for a specific ' +
      'fight, so you both leave feeling more understood. It’s not about who was right. To start: can you each ' +
      'name how you felt during it, one at a time?',
    systemPromptAddendum: `${frame('the Gottman "Aftermath of a Fight" repair process')} Walk them through \
processing a specific past rupture WITHOUT re-litigating the facts: (1) each shares how they FELT (feelings, \
not accusations), (2) each describes their subjective reality and gets validated, (3) each owns their part, \
(4) plan one concrete repair for next time. Both realities are valid; never adjudicate who was right.`,
  },
  {
    id: 'four-horsemen',
    group: 'together-repair',
    title: 'The Four Horsemen & Antidotes',
    framework: 'Gottman',
    blurb:
      'Spot criticism, contempt, defensiveness, and stonewalling — and their gentle antidotes.',
    kind: 'chat',
    openingMessage:
      'Let’s look at the Four Horsemen — a Together practice (inspired by Gottman, not therapy) for noticing ' +
      'four communication habits that erode connection, and the gentler antidotes to each. Would it help to ' +
      'start with a recent exchange that didn’t go the way you wanted?',
    systemPromptAddendum: `${frame('the Gottman "Four Horsemen" framework')} Gently help the couple recognize \
criticism, contempt, defensiveness, and stonewalling in their own exchanges (never label one partner as \
"the problem"), and practice the antidotes: gentle start-up, building appreciation, taking responsibility, \
and physiological self-soothing / breaks. Keep it collaborative and non-blaming.`,
  },
  {
    id: 'speaker-listener',
    group: 'together-repair',
    title: 'Speaker & Listener',
    framework: 'Structured dialogue',
    blurb: 'One speaks, one reflects back — coach-enforced turns so you both feel truly heard.',
    kind: 'structured',
    steps: ['Speaker shares', 'Listener reflects', 'Swap', 'What shifted'],
    openingMessage:
      'This is the Speaker–Listener technique — a Together structure (not therapy) where one speaks and the ' +
      'other reflects back before responding, so you each feel truly heard. I’ll help keep the turns fair. ' +
      'Who would like to be the first Speaker, and what would you like to be heard about?',
    systemPromptAddendum: `${frame('the Speaker-Listener structured-dialogue technique')} Enforce clear turns: \
the Speaker shares one point using "I" language; the Listener paraphrases back what they heard (no rebuttal) \
until the Speaker feels understood; then swap roles; finally each names what shifted. Hold the structure \
firmly but warmly — interrupt gently if someone rebuts out of turn, and keep both turns balanced.`,
  },
];

/** Resolve a couples guide by id (either catalog group), or undefined. */
export function getTogetherGuide(id: string): TogetherGuide | undefined {
  return TOGETHER_CATALOG.find((g) => g.id === id);
}

/**
 * The catalog cards the active person may start. The 18+ `together-desire` group is WITHHELD unless
 * `allowAdult` (both partners' acks, Phase F) — host-side, never merely hidden in the UI (§3.10).
 */
export function togetherCatalogFor(opts: { allowAdult: boolean }): TogetherCatalogEntry[] {
  return TOGETHER_CATALOG.filter((g) => !g.adult || opts.allowAdult).map((g) => ({
    id: g.id,
    group: g.group,
    groupTitle: togetherGroupTitle(g.group),
    title: g.title,
    framework: g.framework,
    blurb: g.blurb,
    kind: g.kind,
    adult: Boolean(g.adult),
  }));
}
