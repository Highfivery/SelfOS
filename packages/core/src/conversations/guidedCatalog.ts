/**
 * The built-in, curated catalog of guided sessions (16-guided-sessions §4.1). This is **code, not vault
 * data** — the same for everyone, like the capability registry. Display metadata (`id`/`group`/`title`/
 * `framework`/`blurb`/`kind`/`steps`/`adult`) is importable by the renderer; `openingMessage` +
 * `systemPromptAddendum` are used host-side in prompt assembly (§5).
 *
 * SAFETY (16 §8.1): group titles are non-clinical and card titles avoid the bare word "Therapy"; the
 * recognisable framework lives in a per-card tag. Every addendum leads with "a self-help exercise inspired
 * by X — NOT therapy" and is appended AFTER persona + safety, which always take precedence.
 */

export type GuidedGroupId = 'therapy' | 'coaching' | 'intimacy';

export interface GuidedExercise {
  /** Stable id, e.g. 'cbt-thought-record'. */
  id: string;
  group: GuidedGroupId;
  /** Card title — avoids the bare word "Therapy" (§8.1). */
  title: string;
  /** Recognisable framework, shown as a per-card tag (e.g. 'CBT'). */
  framework: string;
  /** One-line blurb on the card. */
  blurb: string;
  kind: 'chat' | 'structured';
  /** The coach's static first message (§11.4) — framed + inviting, no model call. */
  openingMessage: string;
  /** Method/steps steering, appended after PERSONA + SAFETY + context (§5). */
  systemPromptAddendum: string;
  /** Structured exercises only — named steps for the stepper. */
  steps?: string[];
  /** Intimacy group → 18+ acknowledgement gating (§8.3). */
  adult?: boolean;
}

/** Ordered groups with their non-clinical display titles (§3.2). */
export const GUIDED_GROUPS: ReadonlyArray<{ id: GuidedGroupId; title: string }> = [
  { id: 'therapy', title: 'Reflective & therapy-informed' },
  { id: 'coaching', title: 'Coaching' },
  { id: 'intimacy', title: 'Intimacy & connection' },
];

export function guidedGroupTitle(group: GuidedGroupId): string {
  return GUIDED_GROUPS.find((g) => g.id === group)?.title ?? group;
}

/** The portrait life-areas (LIFE_AREAS) a guided session's group makes relevant, for per-call portrait-fact
 * selection (28-portrait-synthesis-optimization §4.4). The always-on CORE (emotions/goals/relationships/…) is
 * added by the selector regardless; this just foregrounds the topic-specific extras (e.g. a coaching session
 * surfaces Work/Money facts, an intimacy session surfaces Intimacy facts). A free-start (no guide) passes no
 * topic ⇒ core + fill. */
const GUIDE_LIFE_AREAS: Record<GuidedGroupId, string[]> = {
  therapy: ['Emotions & patterns', 'Family', 'Relationships'],
  coaching: ['Goals & growth', 'Work & purpose', 'Money'],
  intimacy: ['Intimacy', 'Relationships'],
};

export function guideLifeAreas(group: GuidedGroupId): string[] {
  return GUIDE_LIFE_AREAS[group];
}

/** Shared frame prepended to every addendum — the not-therapy boundary in the coach's own instructions. */
function frame(framework: string): string {
  return `This session is a self-guided wellness exercise inspired by ${framework} — it is NOT therapy, \
diagnosis, or treatment, and you are an AI companion, not a clinician. The persona and safety guidance \
above always take precedence: keep it reflective and warm, never diagnose or prescribe, and route any \
crisis to professional help. Move at the person's pace, one gentle question at a time; they can go \
off-script anytime and you follow them.`;
}

export const GUIDED_CATALOG: ReadonlyArray<GuidedExercise> = [
  // ── Reflective & therapy-informed ────────────────────────────────────────────────────────────────
  {
    id: 'reflective-session',
    group: 'therapy',
    title: 'Reflective Session',
    framework: 'Integrative',
    blurb: 'Talk something through with open, non-judgmental reflection.',
    kind: 'chat',
    openingMessage:
      "Let's take some quiet time to reflect together. This is a self-help reflection, not therapy — " +
      'just a space to think out loud. What feels most alive for you right now, or what would you like to explore?',
    systemPromptAddendum: `${frame('integrative reflective practice')} Help them slow down and notice what \
they're feeling and thinking. Reflect back what you hear, ask open questions, and let insight emerge from \
them rather than offering conclusions.`,
  },
  {
    id: 'cbt-thought-record',
    group: 'therapy',
    title: 'Thought Record',
    framework: 'CBT',
    blurb: 'Examine a difficult thought and find a more balanced perspective.',
    kind: 'structured',
    steps: ['Situation', 'Feelings', 'Automatic thoughts', 'Evidence', 'Balanced reframe'],
    openingMessage:
      "We'll work through a Thought Record together — a self-help exercise inspired by CBT, not therapy. " +
      "It helps untangle a thought that's weighing on you. To start: can you describe a recent situation that " +
      'stirred up a strong or difficult feeling?',
    systemPromptAddendum: `${frame('Cognitive Behavioral Therapy (CBT)')} Walk them through a Thought Record, \
one step at a time: (1) the Situation, (2) the Feelings and their intensity, (3) the Automatic thoughts, \
(4) the Evidence for and against the hottest thought, (5) a Balanced reframe. Don't rush ahead; confirm \
each step before moving on.`,
  },
  {
    id: 'cbt-decatastrophizing',
    group: 'therapy',
    title: 'Worry Decatastrophizing',
    framework: 'CBT',
    blurb: 'Gently test a worst-case worry and right-size it.',
    kind: 'chat',
    openingMessage:
      "Let's look at a worry that's been looping — a self-help exercise inspired by CBT, not therapy. " +
      "What's the fear that keeps coming back, and what's the worst-case version your mind jumps to?",
    systemPromptAddendum: `${frame('CBT decatastrophizing')} Help them name the feared worst case, then \
gently explore: how likely is it really, what's the most realistic outcome, and how would they cope even if \
it happened? Aim for right-sizing, not dismissing.`,
  },
  {
    id: 'behavioral-activation',
    group: 'therapy',
    title: 'Behavioral Activation Plan',
    framework: 'Behavioral Activation',
    blurb: 'Plan one small, doable action that lifts your mood.',
    kind: 'chat',
    openingMessage:
      "Let's find one small action that could lift things a little — a self-help exercise inspired by " +
      'Behavioral Activation, not therapy. When did you last feel even a bit more engaged or okay, and what were you doing?',
    systemPromptAddendum: `${frame('Behavioral Activation')} Help them identify activities tied to pleasure, \
mastery, or connection, then choose ONE small, concrete, achievable step for the near future. Keep it tiny \
and specific; explore what might get in the way and how to make it likelier to happen.`,
  },
  {
    id: 'values-clarification',
    group: 'therapy',
    title: 'Values Clarification',
    framework: 'ACT',
    blurb: 'Reconnect with what matters most to you.',
    kind: 'chat',
    openingMessage:
      "Let's reconnect with what matters to you — a self-help exercise inspired by ACT, not therapy. " +
      'If you imagine living a day fully in line with who you want to be, what stands out?',
    systemPromptAddendum: `${frame('Acceptance and Commitment Therapy (ACT)')} Help them explore their values \
across life domains (relationships, work, growth, health, play). Distinguish values (directions) from goals \
(destinations), and notice where their life is and isn't pointing toward what they care about.`,
  },
  {
    id: 'self-compassion-break',
    group: 'therapy',
    title: 'Self-Compassion Break',
    framework: 'Self-Compassion',
    blurb: 'Meet a hard moment with the kindness you would offer a friend.',
    kind: 'chat',
    openingMessage:
      "Let's take a self-compassion break together — a self-help exercise inspired by Dr. Kristin Neff's " +
      "work, not therapy. What's the hard moment or feeling you're carrying right now?",
    systemPromptAddendum: `${frame('Self-Compassion (Kristin Neff)')} Gently guide the three movements: \
(1) mindfulness — naming the pain without exaggerating it, (2) common humanity — that suffering is shared, \
not a personal failing, (3) self-kindness — offering themselves the warmth they'd give a friend. Keep it soft.`,
  },
  {
    id: 'grief-checkin',
    group: 'therapy',
    title: 'Grief & Loss Check-in',
    framework: 'Grief work',
    blurb: 'Make space for a loss, at whatever pace feels right.',
    kind: 'chat',
    openingMessage:
      "I'm glad you're making space for this. This is a gentle self-help check-in, not therapy or grief " +
      "counselling. There's no right way to grieve — would you like to tell me about who or what you're missing?",
    systemPromptAddendum: `${frame('grief and loss support')} Hold space without trying to fix or hurry the \
grief. Normalize that grief is non-linear and has no timeline. Be especially attentive to distress — if it \
points toward crisis, follow the safety guidance and encourage professional support.`,
  },

  // ── Coaching ─────────────────────────────────────────────────────────────────────────────────────
  {
    id: 'life-coaching-session',
    group: 'coaching',
    title: 'Life Coaching Session',
    framework: 'Integrative',
    blurb: 'Open coaching to move something forward in your life.',
    kind: 'chat',
    openingMessage:
      "Let's do some coaching. What's something in your life you'd like to move forward today — and what " +
      'would make this conversation worth your time?',
    systemPromptAddendum: `${frame('integrative life coaching')} Take a forward-looking, action-oriented \
coaching stance: clarify what they want, draw out their own ideas with powerful questions, and help them \
land on a concrete next step. Believe in their capacity; advise sparingly.`,
  },
  {
    id: 'grow-goal-setting',
    group: 'coaching',
    title: 'GROW Goal-Setting',
    framework: 'GROW',
    blurb: 'Turn a goal into a clear plan with the GROW model.',
    kind: 'structured',
    steps: ['Goal', 'Reality', 'Options', 'Will & way forward'],
    openingMessage:
      "Let's use the GROW model to turn something you want into a clear plan. To start with the Goal: what " +
      "would you like to achieve, and how will you know you've got there?",
    systemPromptAddendum: `${frame('the GROW coaching model')} Walk them through GROW, one stage at a time: \
(1) Goal — what they want and what success looks like, (2) Reality — where things stand now, (3) Options — \
what they could do, brainstormed freely, (4) Will & way forward — what they'll actually commit to and when. \
Confirm each stage before moving on.`,
  },
  {
    id: 'weekly-review',
    group: 'coaching',
    title: 'Weekly Review & Reset',
    framework: 'Reflective practice',
    blurb: 'Look back on your week and set up the next one.',
    kind: 'structured',
    steps: ['Look back', 'Wins & gratitude', 'Challenges & lessons', 'Reset priorities'],
    openingMessage:
      "Let's run a weekly review and reset. Looking back over the past week, what stands out — what " +
      'happened, and how did it feel overall?',
    systemPromptAddendum: `${frame('reflective weekly review practice')} Guide a structured review, one step \
at a time: (1) Look back over the week, (2) Wins & gratitude — what went well and what they're grateful for, \
(3) Challenges & lessons — what was hard and what it taught them, (4) Reset priorities — the few things that \
matter most next week. Confirm each step before moving on.`,
  },
  {
    id: 'decision-clarifier',
    group: 'coaching',
    title: 'Decision Clarifier',
    framework: 'Values-based',
    blurb: 'Think through a decision against what you value.',
    kind: 'structured',
    steps: ['The decision', 'Options', 'Values & trade-offs', 'Lean & next step'],
    openingMessage:
      "Let's get clear on a decision you're facing. To start: what's the decision, and by when do you need " +
      'to make it?',
    systemPromptAddendum: `${frame('values-based decision-making')} Walk them through, one step at a time: \
(1) The decision — frame it clearly, (2) Options — lay out the real choices, (3) Values & trade-offs — weigh \
each against what matters most to them, (4) Lean & next step — notice which way they're leaning and one step \
to test or act on it. The decision stays theirs; you clarify, never decide for them.`,
  },
  {
    id: 'hard-conversation-prep',
    group: 'coaching',
    title: 'Hard Conversation Prep',
    framework: 'DEAR MAN',
    blurb: 'Prepare for a tough conversation you need to have.',
    kind: 'chat',
    openingMessage:
      "Let's prepare for a conversation you're dreading a little — a self-help exercise inspired by the DBT " +
      'DEAR MAN skill, not therapy. Who is it with, and what do you most want them to hear?',
    systemPromptAddendum: `${frame('the DBT interpersonal-effectiveness skill DEAR MAN')} Help them prepare: \
Describe the situation, Express feelings, Assert the need/request, Reinforce the benefit — while staying \
Mindful, Appearing confident, and Negotiating. Help them rehearse phrasing and anticipate responses.`,
  },
  {
    id: 'boundary-setting',
    group: 'coaching',
    title: 'Boundary Setting',
    framework: 'Assertiveness',
    blurb: 'Find and voice a boundary that protects your wellbeing.',
    kind: 'chat',
    openingMessage:
      "Let's work on a boundary you'd like to set — a self-help exercise in assertiveness, not therapy. " +
      'Where in your life do you feel stretched, resentful, or over-committed?',
    systemPromptAddendum: `${frame('assertiveness and boundary-setting')} Help them locate where a boundary is \
needed, clarify what they will and won't accept, and craft a clear, kind, non-apologetic way to express it. \
Normalize that boundaries are an act of care, not aggression.`,
  },
  {
    id: 'burnout-energy-audit',
    group: 'coaching',
    title: 'Burnout & Energy Audit',
    framework: 'Energy management',
    blurb: 'Map what drains and restores you, and rebalance.',
    kind: 'chat',
    openingMessage:
      "Let's take stock of your energy — a self-help audit, not a medical assessment. Over a typical week, " +
      'what leaves you most drained, and what (if anything) genuinely restores you?',
    systemPromptAddendum: `${frame('energy management and burnout prevention')} Help them map their drains and \
restorers across work, relationships, body, and mind, then find one realistic shift toward balance. This is \
wellness reflection — if they describe symptoms that need medical attention, encourage professional care.`,
  },

  // ── Intimacy & connection (18+, §8.3) ──────────────────────────────────────────────────────────────
  {
    id: 'sensate-focus',
    group: 'intimacy',
    title: 'Sensate Focus',
    framework: 'Masters & Johnson',
    blurb: 'Reconnect through pressure-free, present touch.',
    kind: 'chat',
    adult: true,
    openingMessage:
      "Let's explore sensate focus — a self-help exercise inspired by the Masters & Johnson approach, not " +
      "sex therapy. It's about reconnecting through unhurried, pressure-free touch. What draws you to this right now?",
    systemPromptAddendum: `${frame('the Masters & Johnson Sensate Focus approach')} Explain the principle — \
taking performance and goals off the table, focusing on sensation and presence rather than outcome — and help \
them think through how to bring it into their relationship with consent and open communication. Keep it \
tasteful, respectful, and educational; stay within Anthropic's usage policy.`,
  },
  {
    id: 'desire-discrepancy',
    group: 'intimacy',
    title: 'Desire Discrepancy',
    framework: 'Sex therapy',
    blurb: 'Navigate differing levels of desire with care.',
    kind: 'chat',
    adult: true,
    openingMessage:
      "Let's talk through differences in desire — a self-help exercise informed by sex therapy, not therapy " +
      "itself. Mismatched desire is common and not anyone's fault. What have you been noticing between you?",
    systemPromptAddendum: `${frame('sex-therapy approaches to desire discrepancy')} Normalize that desire \
differences are common and rarely about love or attraction. Explore responsive vs. spontaneous desire, the \
pressure cycle, and how to talk about it without blame. Keep it respectful and non-explicit; encourage a \
qualified sex therapist for persistent distress.`,
  },
  {
    id: 'talking-about-sex',
    group: 'intimacy',
    title: 'Talking About Sex',
    framework: 'Communication',
    blurb: 'Build the words to talk openly about intimacy.',
    kind: 'chat',
    adult: true,
    openingMessage:
      "Let's build some language for talking about sex and intimacy — a self-help communication exercise, " +
      'not therapy. What feels hard to say, or what would you like to be able to talk about more openly?',
    systemPromptAddendum: `${frame('intimate-communication skills')} Help them find words for desires, limits, \
and needs, and practise raising them at a good time, without blame, with curiosity about their partner. Keep \
it respectful and within Anthropic's usage policy.`,
  },
];

/** Look up a catalog exercise by id; undefined if it isn't (or no longer) in the catalog (§7). */
export function getExercise(id: string): GuidedExercise | undefined {
  return GUIDED_CATALOG.find((e) => e.id === id);
}

/** All exercises (renderer + recommender). */
export function listExercises(): ReadonlyArray<GuidedExercise> {
  return GUIDED_CATALOG;
}
