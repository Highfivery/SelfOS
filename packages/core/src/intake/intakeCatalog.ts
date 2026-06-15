import type { IntakeSectionMeta, PersonFieldKey } from '../schemas';

/**
 * The built-in intake section catalog (18-personal-onboarding §4.2) — code, not vault (like the
 * `16-guided-sessions` exercise catalog). Each section carries a static opener (no spend), a `directFields`
 * map (which `Person` field a clearly-stated answer maps to 1:1), and `restricted`/`adult` flags. Direct
 * fields are filled mid-interview via an AI-embedded `[[SELFOS:FIELD:key=value]]` marker (the wrap-up /
 * step-marker precedent); inferred fields (values/communicationStyle/goals/faith) are filled at the final
 * synthesis. The interviewer voice is appended AFTER PERSONA + SAFETY + the person's own context, so the
 * non-negotiable boundary always leads (§8.1).
 */

/** A direct field-mapped capture for a section — the AI may emit a marker filling it during the interview. */
export interface IntakeDirectField {
  key: PersonFieldKey;
  /** A list field captured comma-separated in the marker value (interests/values/languages). */
  list?: boolean;
  /** When filled, lock the field to own-context-only (added to `Person.privateFields`, §8.3). */
  private?: boolean;
}

export interface IntakeSectionDef {
  id: string;
  title: string;
  blurb: string;
  /** Heavy/intimate → its facts are break-glass-only in owner views (§8.4). */
  restricted: boolean;
  /** Gated behind the 18+ acknowledgement (shared with guided sessions, §3.3). */
  adult: boolean;
  /** The static opening question shown first (no model call — works offline like guided openers). */
  opener: string;
  /** A kind heads-up shown before a heavy/intimate section (§3.3). */
  contentNote?: string;
  /** What this section explores — woven into the interviewer system prompt for the section. */
  focus: string;
  directFields: IntakeDirectField[];
  /** Fields the FINAL synthesis may infer + fill from this section (only when still empty). */
  inferredFields?: PersonFieldKey[];
}

export const INTAKE_CATALOG: ReadonlyArray<IntakeSectionDef> = [
  {
    id: 'basics',
    title: 'The basics',
    blurb: 'A few simple things — what to call you and where you are in life.',
    restricted: false,
    adult: false,
    opener:
      "Let's start simple. What should I call you, and what are your pronouns? Share whatever feels comfortable.",
    focus:
      'Gather the simple profile facts, ONE at a time, in a warm and natural way — do not interrogate. Make ' +
      'sure to ask about each of these before moving on (skip any the person would rather not share): their ' +
      'pronouns, their gender, their birthday (or age), where they live, the languages they speak, their ' +
      'cultural or ethnic background, and what they do for work. After each answer, record it with the field ' +
      'marker, then move to the next one you still need.',
    directFields: [
      { key: 'pronouns' },
      { key: 'gender' },
      { key: 'birthday' },
      { key: 'location' },
      { key: 'languages', list: true },
      { key: 'ethnicity' },
      { key: 'occupation' },
    ],
  },
  {
    id: 'life-now',
    title: 'Your life now',
    blurb: 'A picture of your everyday — work, home, and the shape of your days.',
    restricted: false,
    adult: false,
    opener:
      'Tell me a little about your life right now. What does an ordinary day look like for you?',
    focus:
      'Their present-day life: daily rhythms, work, living situation, the people and routines that fill their days, and how they feel about this season of life.',
    directFields: [{ key: 'occupation' }],
  },
  {
    id: 'family',
    title: 'Family & upbringing',
    blurb: 'Where you come from — family, how you were raised, and the culture around you.',
    restricted: false,
    adult: false,
    opener:
      'Where did you grow up, and who was around as you were growing up? Paint me a picture of your family.',
    focus:
      'Their family of origin and upbringing: parents, siblings, how they were raised, the culture and any faith they grew up around, and what that upbringing was like for them.',
    directFields: [],
  },
  {
    id: 'story',
    title: 'Your story',
    blurb:
      'The chapters that shaped you — turning points, milestones, and what you carry from them.',
    restricted: false,
    adult: false,
    opener:
      'If you told the story of your life so far in a few chapters, what would they be? Start wherever feels right.',
    focus:
      'The key chapters of their life: formative experiences, milestones, turning points, and meaningful losses — held as the person chooses to share them.',
    directFields: [],
  },
  {
    id: 'health',
    title: 'Health & wellbeing',
    blurb: 'How you’re doing in body and mind — energy, sleep, and anything relevant.',
    restricted: false,
    adult: false,
    opener:
      'How are you doing in body and mind these days? Anything about your health, sleep, or energy you’d want me to keep in mind?',
    contentNote:
      'This stays private to your own coaching and is never shared with anyone else. Share only what you want to.',
    focus:
      'Their physical and mental-health context as relevant to coaching: general wellbeing, sleep, energy, and anything they want SelfOS to hold gently. Not a clinical assessment.',
    directFields: [{ key: 'healthNotes', private: true }],
  },
  {
    id: 'weighs',
    title: 'What weighs on you',
    blurb: 'The heavier things — struggles, grief, or patterns you find yourself stuck in.',
    restricted: true,
    adult: false,
    opener:
      'Is there anything weighing on you right now — something heavy you carry? We can go as light or as deep as you want, and skip anything.',
    contentNote:
      'We can go as light or as deep as you want, and skip anything. This stays private to your own coaching. If you’re ever in crisis, please reach out to the resources below — I’m not a substitute for real help.',
    focus:
      'The heavier parts of their inner life — struggles, grief, traumas, stuck patterns, "what they carry" — held trauma-informed. Let them set the depth; never dig for specifics they don’t offer; validate "I’d rather not." Watch for crisis and route to help per your safety guidance.',
    directFields: [],
  },
  {
    id: 'relationships',
    title: 'Relationships',
    blurb: 'How you connect — patterns, what you need, and how you handle conflict.',
    restricted: false,
    adult: false,
    opener:
      'How would you describe yourself in relationships — with partners, friends, family? What patterns do you notice in how you connect?',
    focus:
      'Their relational world: current and past relationships, attachment and conflict patterns, what they need from others, and how they show up when things get hard.',
    directFields: [],
    inferredFields: ['communicationStyle'],
  },
  {
    id: 'values',
    title: 'Values & identity',
    blurb: 'What matters most — your beliefs, identity, and how you like to communicate.',
    restricted: false,
    adult: false,
    opener: 'What matters most to you? The values or beliefs you try to live by.',
    focus:
      'What they value and how they see themselves: core values, beliefs and faith, identity, and their communication style.',
    directFields: [{ key: 'values', list: true }, { key: 'faith' }],
    inferredFields: ['communicationStyle', 'values', 'faith'],
  },
  {
    id: 'want',
    title: 'What you want',
    blurb: 'Where you’re headed — goals, growth areas, and hopes for the road ahead.',
    restricted: false,
    adult: false,
    opener:
      'Looking ahead, what do you most want — to work on, to grow into, or to feel more of in your life?',
    focus:
      'Their goals and hopes: what they want to work on, the growth they’re reaching for, and what a good road ahead looks like to them.',
    directFields: [{ key: 'goals' }],
    inferredFields: ['goals'],
  },
  {
    id: 'intimacy',
    title: 'Intimacy & sexuality',
    blurb: 'Optional and 18+ — desire, intimacy, boundaries, and what closeness means to you.',
    restricted: true,
    adult: true,
    opener:
      'This is an optional, grown-up space. If you’d like, tell me what intimacy and closeness mean to you — only what you want to share.',
    contentNote:
      'This block is entirely optional and only for adults. Everything here stays private to your own coaching, and every question is skippable.',
    focus:
      'Intimacy and sexuality as the person chooses to explore it: what closeness and desire mean to them, preferences, boundaries, and what they want. Entirely opt-in; every question skippable; never pressure.',
    directFields: [],
  },
];

/** Find a section definition by id (null if unknown — a retired id is ignored, §7). */
export function getIntakeSection(id: string): IntakeSectionDef | undefined {
  return INTAKE_CATALOG.find((s) => s.id === id);
}

/** The renderer-facing catalog metadata (the catalog itself is host-only). */
export function intakeSectionMeta(): IntakeSectionMeta[] {
  return INTAKE_CATALOG.map((s) => ({
    id: s.id,
    title: s.title,
    blurb: s.blurb,
    restricted: s.restricted,
    adult: s.adult,
    opener: s.opener,
    ...(s.contentNote !== undefined ? { contentNote: s.contentNote } : {}),
  }));
}

/** The interviewer persona addendum (§5/§8.1) — appended AFTER PERSONA + SAFETY + the person's context. */
export function buildInterviewerAddendum(displayName: string, section: IntakeSectionDef): string {
  const parts: string[] = [];
  parts.push(
    `You are conducting a warm, gentle "getting to know you" onboarding for ${displayName} — helping ` +
      `SelfOS understand who they are. This is reflective self-knowledge, NOT a clinical intake, ` +
      `assessment, diagnosis, or treatment. Ask ONE open, curious question at a time. Listen, reflect ` +
      `back briefly, and follow their lead — go deeper only where they want to. NEVER pressure for ` +
      `detail; if they say "I'd rather not" or want to skip, honor it warmly with no push-back and move ` +
      `on. Keep replies concise and human.`,
  );
  parts.push(`Right now you are exploring this section — "${section.title}": ${section.focus}`);
  if (section.restricted) {
    parts.push(
      `This is a sensitive section. Open gently, let the person set the depth, validate whatever they ` +
        `share, and never dig for specifics they don't offer. If there is any sign of crisis, respond ` +
        `with warmth and route to professional help per your safety guidance — never manage it alone.`,
    );
  }
  if (section.directFields.length > 0) {
    const keys = section.directFields.map((f) => f.key).join(', ');
    parts.push(
      `When the person clearly states a fact that belongs in their profile, record it by appending a ` +
        `hidden marker on its own final line, EXACTLY as: [[SELFOS:FIELD:<key>=<value>]]. Use ONLY ` +
        `these keys here: ${keys}. One marker per fact; omit it entirely if you're unsure. Never ` +
        `mention the marker; keep your visible reply natural. Examples: [[SELFOS:FIELD:occupation=nurse]] ` +
        `or [[SELFOS:FIELD:languages=English, Spanish]].`,
    );
  }
  return parts.join('\n\n');
}
