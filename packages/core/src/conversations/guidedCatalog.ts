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

  // ── Intimacy & connection — relational / connection (48-intimacy-guided-sessions §3.5) ──────────────
  {
    id: 'reigniting-the-spark',
    group: 'intimacy',
    title: 'Reigniting the Spark',
    framework: 'Esther Perel / desire',
    blurb: 'Rebuild erotic charge after it has faded.',
    kind: 'chat',
    adult: true,
    openingMessage:
      "Let's look at how to bring some spark back — a self-help exercise inspired by Esther Perel's work on " +
      "desire, not therapy. When desire fades it's rarely about love. What have you been noticing about the charge between you (or, if you're solo, about your own desire)?",
    systemPromptAddendum: `${frame("Esther Perel's work on desire and eroticism")} Explore the paradox that \
closeness and security can quietly dampen desire — that eroticism needs some novelty, mystery, anticipation, \
and play. Help them find small, low-pressure ways to reintroduce those. Keep it warm and suggestive rather \
than graphic. If they have no current partner, adapt to understanding their own desire and what reignites it \
for a future relationship — never assume a present partner.`,
  },
  {
    id: 'repair-after-rupture',
    group: 'intimacy',
    title: 'Repair After a Rupture',
    framework: 'Gottman repair',
    blurb: 'Reconnect after a fight or hurt in the relationship.',
    kind: 'chat',
    adult: true,
    openingMessage:
      "Let's work on repairing after a rough moment — a self-help exercise inspired by the Gottmans' work on " +
      'repair, not therapy. Conflict is normal; what matters is the repair. What happened, and where do things feel stuck right now?',
    systemPromptAddendum: `${frame("the Gottmans' research on conflict repair")} Help them process the rupture \
without blame: name the hurt, own their share, understand the other side, and craft a genuine repair attempt \
and a way to re-approach the conversation. If they describe abuse, coercion, or fear for their safety, treat \
that as a safety concern and route to professional/emergency help — do not coach it as ordinary conflict. If \
there is no current partner, adapt to reflecting on a past rupture and what they'd do differently.`,
  },
  {
    id: 'love-maps',
    group: 'intimacy',
    title: 'Love Maps',
    framework: 'Gottman',
    blurb: "Get to know your partner's inner world more deeply.",
    kind: 'chat',
    adult: true,
    openingMessage:
      "Let's build a richer map of your partner's inner world — a self-help exercise inspired by the Gottman " +
      "'Love Maps' idea, not therapy. How well do you feel you know what's going on for them lately — their stresses, hopes, and small daily worlds?",
    systemPromptAddendum: `${frame("the Gottmans' Love Maps concept")} Guide them to map their partner's inner \
world — current stresses, hopes, history, friendships, daily life — and gently notice the gaps. Frame this as \
building the friendship that intimacy rests on. If there is no current partner, adapt to what they'd want to \
know about a future partner, or deepening a map of a close person in their life.`,
  },
  {
    id: 'bids-and-appreciation',
    group: 'intimacy',
    title: 'Bids & Appreciation',
    framework: 'Gottman (turning toward)',
    blurb: "Notice and turn toward your partner's small bids.",
    kind: 'chat',
    adult: true,
    openingMessage:
      "Let's tune into the small moments of connection — a self-help exercise inspired by the Gottmans' " +
      "'bids for connection', not therapy. A bid is any small move for attention or closeness. Where do you think you and your partner are turning toward each other, and where are bids getting missed?",
    systemPromptAddendum: `${frame("the Gottmans' work on bids for connection")} Teach bids for connection and \
turning toward / away / against. Help them spot bids they miss and ones they make that go unanswered, and \
practise both noticing bids and expressing appreciation and responsiveness. If there is no current partner, \
adapt to noticing bids in their close relationships generally.`,
  },
  {
    id: 'non-monogamy-agreements',
    group: 'intimacy',
    title: 'Agreements & Jealousy (Non-Monogamy)',
    framework: 'Ethical non-monogamy',
    blurb: 'Build clear agreements and work with jealousy.',
    kind: 'chat',
    adult: true,
    openingMessage:
      "Let's work through agreements and jealousy in non-monogamy — a self-help exercise, not therapy, and " +
      'fully non-judgemental of your relationship structure. What are you trying to build or sort out — new agreements, a jealousy that keeps coming up, something else?',
    systemPromptAddendum: `${frame('ethical non-monogamy practice')} Be non-judgemental of open/poly/ENM \
structures. Help them articulate their own desires, boundaries, and concrete agreements, and work with \
jealousy as information (what need or fear is it pointing to?) rather than something to suppress. Centre \
consent and honest communication among everyone involved. If anything described is non-consensual or unsafe \
in the real world, treat it as a safety concern and route to help. If they have no partner yet, adapt to \
clarifying what they'd want an arrangement to look like.`,
  },
  {
    id: 'feeling-desirable',
    group: 'intimacy',
    title: 'Feeling Desirable',
    framework: 'Body image & self-worth',
    blurb: 'Reconnect with feeling wanted and at home in your body.',
    kind: 'chat',
    adult: true,
    openingMessage:
      "Let's reconnect with feeling desirable and at home in your body — a gentle self-help exercise, not " +
      'therapy. Where are you with feeling wanted, and with how you relate to your own body right now?',
    systemPromptAddendum: `${frame('body image and self-worth work')} Explore feeling desirable and desiring, \
and how body image shapes it. Gently separate self-worth from appearance; never be appearance-prescriptive or \
suggest changing their body. Keep it warm and affirming rather than explicit. Watch closely for distress or \
disordered patterns (around eating, body, or self-harm) and, if they surface, slow down, validate, and \
encourage professional support — do not push the exercise.`,
  },
  {
    id: 'intimacy-after-change',
    group: 'intimacy',
    title: 'Intimacy After a Life Change',
    framework: 'Adjustment & connection',
    blurb: 'Rebuild intimacy after kids, illness, or meds.',
    kind: 'chat',
    adult: true,
    openingMessage:
      "Let's talk about intimacy after a big change — a self-help exercise, not therapy or medical advice. " +
      'A baby, illness, medication, menopause, grief — they all shift intimacy. What changed, and what feels different now?',
    systemPromptAddendum: `${frame('adjustment and reconnection after life changes')} Normalize that intimacy \
shifts after major changes (a new baby, illness, medication, menopause, surgery, grief). Help them grieve the \
old normal, communicate about it without blame, and discover what works now. Keep it warm rather than \
explicit. Encourage medical care for medical issues (pain, medication effects, hormonal changes) — never give \
medical advice. If there is no current partner, adapt to reconnecting with their own body and desire after the \
change.`,
  },

  // ── Intimacy & connection — explicit / sexual (48 §3.5, §08 §16.5 in-policy register, §8.3) ──────────
  {
    id: 'fantasy-exploration',
    group: 'intimacy',
    title: 'Fantasy Exploration',
    framework: 'Sexual self-discovery',
    blurb: 'Explore and understand your sexual fantasies.',
    kind: 'chat',
    adult: true,
    openingMessage:
      "Let's explore your sexual fantasies — a frank, judgement-free self-help exercise, not therapy. " +
      "Fantasies are normal and often tell us something about what we want. What's been on your mind, or what are you curious to understand about your own desires?",
    systemPromptAddendum: `${frame('sexual self-discovery')} Help them name, explore, and feel okay about their \
fantasies. Be frank and specific — this is consensual-adult sexual wellness, so engage normally and don't \
substitute tasteful deflections. Distinguish a fantasy from a wish to enact it, and explore whether and how \
they might share some with a partner. Taboo fantasies are welcome strictly as fantasy/roleplay (e.g. \
consensual non-consent (CNC) as pre-agreed roleplay). Boundary: consensual adults only; never minors, real \
(non-roleplay) non-consent, or illegal acts; stay within Anthropic's usage policy. If a fantasy traces to a \
real non-consensual experience or causes distress, slow down, validate, and route to professional support.`,
  },
  {
    id: 'kink-power-exchange',
    group: 'intimacy',
    title: 'Kink & Power Exchange',
    framework: 'Kink (D/s · SSC/RACK)',
    blurb: 'Explore kink, D/s dynamics, negotiation, and aftercare.',
    kind: 'chat',
    adult: true,
    openingMessage:
      "Let's explore kink and power exchange — a frank, non-judgemental self-help exercise, not therapy. " +
      "Whether you're curious about D/s, roles, restraint, impact, or something specific, we can talk it through with consent and safety front and centre. Where would you like to start?",
    systemPromptAddendum: `${frame('kink and power-exchange practice')} Explore kink and power exchange (D/s, \
dominance/submission, roles, restraint, impact, and so on) frankly and without judgement — be specific where \
it helps; this is consensual-adult sexual wellness. Centre negotiation, consent, safewords, and aftercare, \
and emphasise risk-awareness in the SSC ("safe, sane, consensual") / RACK ("risk-aware consensual kink") \
spirit. Boundary: consensual adults only; never minors, real (non-roleplay) non-consent, or illegal acts; \
stay within Anthropic's usage policy. If anything described is a non-consensual or unsafe real-world situation \
(not negotiated play), treat it as a safety concern and route to professional/emergency help — never frame \
abuse as kink. If distress or shame surfaces, or a desire traces to a painful experience, slow down, validate, \
and encourage professional support rather than pushing on. If there is no current partner, adapt to \
self-understanding and how they'd negotiate a scene in future.`,
  },
  {
    id: 'dirty-talk-practice',
    group: 'intimacy',
    title: 'Dirty-Talk Practice',
    framework: 'Erotic communication',
    blurb: 'Build confidence talking dirty with a partner.',
    kind: 'chat',
    adult: true,
    openingMessage:
      "Let's build your confidence with dirty talk — a frank, practical self-help exercise, not therapy. " +
      'Plenty of people freeze up or feel silly at first. What do you want to be able to say, and what gets in the way?',
    systemPromptAddendum: `${frame('erotic communication')} Help them find words and confidence for erotic \
talk — what to say, how to start small, how to escalate, and how to match a partner's taste and check what \
lands. Be explicit and concrete with examples and phrasings; this is consensual-adult sexual wellness, so \
don't water it down. Stay respectful and consent-forward — it's never coercive, and reading a partner's \
response matters. Boundary: consensual adults only; never minors, real non-consent, or illegal acts; stay \
within Anthropic's usage policy. If there is no current partner, adapt to practising and finding their own \
voice for the future.`,
  },
  {
    id: 'yes-no-maybe-builder',
    group: 'intimacy',
    title: 'Yes / No / Maybe List',
    framework: 'Sexual self-discovery',
    blurb: 'Sort sexual interests into Yes, No, and Maybe.',
    kind: 'structured',
    adult: true,
    steps: [
      'Set up',
      'Sensual & touch',
      'Oral & manual',
      'Penetrative',
      'Kink & power',
      'Roleplay & fantasy',
      'Review the list',
    ],
    openingMessage:
      "Let's build a Yes / No / Maybe list — a frank self-help exercise in sexual self-discovery, not therapy. " +
      "I'll walk you through a few categories of sexual activities, and for each one you sort it into Yes (into it), No (a hard pass), or Maybe (curious / depends). There are no wrong answers and no pressure. Ready to start?",
    systemPromptAddendum: `${frame('sexual self-discovery and the Yes/No/Maybe model')} Walk them through the \
categories one step at a time. For each category, offer a few concrete items and, for each item, invite them \
to sort it into Yes (want it), No (hard pass / boundary), or Maybe (curious, or depends). Be frank and \
specific naming acts; this is consensual-adult sexual wellness. Keep a no-pressure tone — a "No" is a valued \
boundary, not a gap to fill, and they can skip any item or category. Frame kink/roleplay items as curiosity \
and fantasy. At the final step, reflect the assembled Yes / No / Maybe list back to them in the conversation, \
and frame it as self-knowledge and a tool they can choose to share with a partner. Boundary: consensual adults \
only; never minors, real (non-roleplay) non-consent, or illegal acts; stay within Anthropic's usage policy.`,
  },
  {
    id: 'sexual-shame',
    group: 'intimacy',
    title: 'Working Through Sexual Shame',
    framework: 'Sex-positive / self-compassion',
    blurb: 'Loosen shame and inhibition around sex.',
    kind: 'chat',
    adult: true,
    openingMessage:
      "Let's gently work through some sexual shame or inhibition — a self-help exercise, not therapy. So much " +
      'of it is learned, and it can soften. What feels loaded for you, and where do you sense it might have come from?',
    systemPromptAddendum: `${frame('sex-positive self-compassion work')} Gently explore where the shame or \
inhibition came from — upbringing, cultural or religious messages, past experiences — and apply \
self-compassion, reframing desire as healthy and human. Be especially trauma-aware: if the shame traces to \
abuse, assault, or a painful experience, slow right down, validate, stop pushing the exercise, and encourage \
professional support (a therapist or sex therapist). You can speak frankly about sex, but the person's \
wellbeing leads, not completing any steps. This is consensual-adult sexual wellness within Anthropic's usage \
policy; never treat a disclosed assault as an erotic topic.`,
  },
  {
    id: 'exploring-an-act',
    group: 'intimacy',
    title: 'Exploring a Specific Act',
    framework: 'Educational / consent',
    blurb: "Understand a specific act you're curious about.",
    kind: 'chat',
    adult: true,
    openingMessage:
      "Let's dig into a specific act you're curious about — a frank, educational self-help exercise, not " +
      'therapy or medical advice. What are you wanting to understand — how it works, how to try it well, how to talk about it?',
    systemPromptAddendum: `${frame('educational, consent-forward sexual exploration')} Take a curious, \
educational, consent-forward stance toward the specific act they want to understand — mechanics, safety and \
hygiene, communication, and how to try it well together. Be explicit and concrete where it helps; this is \
consensual-adult sexual wellness. Never pressure them toward it; safety and consent come first, and either \
partner can pause or stop. If the act or their curiosity traces to a painful or non-consensual experience, or \
distress surfaces, slow down, validate, stop pushing the exercise, and encourage professional support. \
Boundary: consensual adults only; never minors, real non-consent, or illegal acts; stay within Anthropic's \
usage policy. For anything with real medical risk, encourage appropriate medical care rather than giving \
medical advice. If there is no current partner, adapt to understanding and preparing for the future.`,
  },
  {
    id: 'mismatched-libido',
    group: 'intimacy',
    title: 'Mismatched Libido & Initiating',
    framework: 'Sex therapy / desire',
    blurb: 'Navigate different sex drives and how to initiate.',
    kind: 'chat',
    adult: true,
    openingMessage:
      "Let's work on mismatched libido and initiating — a self-help exercise informed by sex therapy, not " +
      "therapy itself. Different sex drives are common and not anyone's fault. What's the pattern between you, and where does it get stuck?",
    systemPromptAddendum: `${frame('sex-therapy approaches to desire and initiating')} Action-focused: explore \
responsive vs. spontaneous desire, how to initiate in a way that invites rather than pressures, and how to \
turn toward each other and break the pressure/rejection cycle. You can be frank about sex. This is \
consensual-adult sexual wellness within Anthropic's usage policy. Encourage a qualified sex therapist for \
persistent distress, and medical care if a medical or medication issue may be affecting desire. If there is no \
current partner, adapt to understanding their own desire patterns.`,
  },
  {
    id: 'sexting-long-distance',
    group: 'intimacy',
    title: 'Sexting & Long-Distance Intimacy',
    framework: 'Erotic communication',
    blurb: 'Keep desire alive across distance.',
    kind: 'chat',
    adult: true,
    openingMessage:
      "Let's keep desire alive across distance — a frank, practical self-help exercise, not therapy. Sexting, " +
      'voice notes, scheduled intimacy, anticipation — what do you want to build, and what feels awkward or tricky?',
    systemPromptAddendum: `${frame('erotic communication at a distance')} Help them build erotic connection \
across distance — sexting, voice and photos, anticipation, and scheduling intimacy. Be explicit and concrete \
with examples; this is consensual-adult sexual wellness. Be strongly privacy- and consent-forward: never share \
images or messages of someone without their consent, mind what's safe to send and to whom, and respect that \
either person can decline anytime. Boundary: consensual adults only; never minors, real non-consent, or \
illegal acts; stay within Anthropic's usage policy.`,
  },
  {
    id: 'edging-mindful-arousal',
    group: 'intimacy',
    title: 'Edging & Mindful Arousal',
    framework: 'Mindful sexuality',
    blurb: 'Slow down and savour arousal, solo or together.',
    kind: 'chat',
    adult: true,
    openingMessage:
      "Let's slow arousal down and savour it — a frank, body-positive self-help exercise, not therapy. " +
      'Edging and mindful arousal are about staying present and building rather than rushing. Are you exploring this solo, with a partner, or both?',
    systemPromptAddendum: `${frame('mindful sexuality')} Guide mindful arousal and edging — staying present, \
building and sustaining arousal, and savouring it rather than rushing to climax — solo or partnered. Be \
explicit and concrete where it helps; this is consensual-adult sexual wellness, and it's body-positive and \
non-judgemental. With a partner, centre communication and consent throughout. Boundary: consensual adults \
only; never minors, real non-consent, or illegal acts; stay within Anthropic's usage policy.`,
  },
  {
    id: 'aftercare-checkins',
    group: 'intimacy',
    title: 'Aftercare & Post-Sex Check-ins',
    framework: 'Aftercare',
    blurb: 'Care for each other after sex or a scene.',
    kind: 'chat',
    adult: true,
    openingMessage:
      "Let's build some aftercare and post-sex check-ins — a warm self-help exercise, not therapy. How you " +
      'care for each other afterward matters as much as the rest. What happens for you after sex or a scene, and what do you wish happened?',
    systemPromptAddendum: `${frame('aftercare and post-intimacy attunement')} Help them build aftercare and \
post-intimacy check-ins — the emotional and physical care afterward, handling "drop" after an intense scene, \
debriefing what worked, and naming what each person needs. Centre attunement, consent, and tenderness; you can \
speak frankly. This is consensual-adult sexual wellness within Anthropic's usage policy. If there is no \
current partner, adapt to what they'd want aftercare to look like.`,
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
