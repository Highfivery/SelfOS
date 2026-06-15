import type { BranchRule, IntakeSectionMeta, PersonFieldKey, Question } from '../schemas';

/**
 * The built-in intake catalog (18-personal-onboarding §14) — code, not vault (like the `16-guided-sessions`
 * exercise catalog). The 2026-06-15 redesign makes most sections **structured forms** (instant, no AI) with a
 * short gated **`core`** + deeper **`invited`** sections, and reserves **`chat`** for the few open topics
 * (family, story, what weighs on you). Form questions reuse the questionnaire **`Question`** shape so the
 * shared `@selfos/answering` renderer + its branching/validation are reused; a per-question **mapping** layers
 * the intake semantics (which answer promotes to a `Person` field, which is a `restricted` own-context fact).
 * The interviewer voice (chat) is appended AFTER PERSONA + SAFETY + the person's own context (§8.1).
 */

/** A form question + how its answer maps into the profile / context (host-only; never sent to the renderer). */
export interface IntakeFormQuestion {
  q: Question;
  /** Promote the answer to this owner-only `Person` field (18 §14.6). */
  field?: PersonFieldKey;
  /** A multi-select that maps to a list field (e.g. `values`/`languages`/`interests`). */
  list?: boolean;
  /** Lock the mapped field own-context-only (added to `Person.privateFields`, §8.3). */
  private?: boolean;
  /** A sensitive answer (intimacy/trauma) → a `restricted` Insight fact, own-context-only (§8.4). */
  restricted?: boolean;
  /** Offer an optional "Tell me more →" chat on this question (§14.3) — never on trivial facts. */
  deepen?: boolean;
}

export interface IntakeSectionDef {
  id: string;
  title: string;
  blurb: string;
  /** `core` gates first-run; `invited` is offered anytime afterward (§14.2). */
  tier: 'core' | 'invited';
  /** `form` = structured questions (no AI); `chat` = AI-guided interview (§14.3). */
  mode: 'form' | 'chat';
  /** Heavy/intimate → its facts are own-context-only, owner-visible, redacted from others (§8.4). */
  restricted: boolean;
  /** Gated behind the shared 18+ acknowledgement (§3.3/§14.5). */
  adult: boolean;
  /** chat: the static opening question (no model call). form: a short intro line. */
  opener: string;
  /** A kind heads-up shown before a heavy/intimate section (§3.3). */
  contentNote?: string;
  /** chat sections: what to explore — woven into the interviewer system prompt. */
  focus?: string;
  /** form sections: the questions + their mapping. */
  questions?: IntakeFormQuestion[];
}

// --- Question builders (terse; every intake question is optional/skippable) ---

function single(id: string, prompt: string, options: string[], branch?: BranchRule): Question {
  return {
    id,
    type: 'singleChoice',
    prompt,
    required: false,
    options,
    ...(branch ? { branch } : {}),
  };
}
function multi(id: string, prompt: string, options: string[], branch?: BranchRule): Question {
  return {
    id,
    type: 'multiChoice',
    prompt,
    required: false,
    options,
    ...(branch ? { branch } : {}),
  };
}
function rating(id: string, prompt: string, minLabel: string, maxLabel: string): Question {
  return {
    id,
    type: 'rating',
    prompt,
    required: false,
    scale: { min: 1, max: 5, minLabel, maxLabel },
  };
}
function yesno(id: string, prompt: string): Question {
  return { id, type: 'yesNo', prompt, required: false };
}
function longText(id: string, prompt: string, branch?: BranchRule): Question {
  return { id, type: 'longText', prompt, required: false, ...(branch ? { branch } : {}) };
}
function shortText(id: string, prompt: string): Question {
  return { id, type: 'shortText', prompt, required: false };
}
function dateQ(id: string, prompt: string): Question {
  return { id, type: 'date', prompt, required: false };
}
/** A branch: show this question only when an earlier singleChoice/yesNo answer equals `value`. */
function when(questionId: string, value: string | boolean): BranchRule {
  return { whenQuestionId: questionId, equals: value, action: 'show' };
}
/** Wrap a question with its intake mapping. */
function f(q: Question, m: Omit<IntakeFormQuestion, 'q'> = {}): IntakeFormQuestion {
  return { q, ...m };
}

// Shared option sets reused across questions.
const AGE_RANGES = ['Under 10', '10–12', '13–15', '16–18', '19–24', '25+', 'Prefer not to say'];
const FREQ = ['Rarely', 'A few times a month', 'Weekly', 'A few times a week', 'Daily'];
// The consensual-adult activity checklist, reused for into-it / curious-to-try / hard-limits (§14.5 D).
const ACTIVITIES = [
  'Oral (giving)',
  'Oral (receiving)',
  'Deepthroat',
  'Anal (giving)',
  'Anal (receiving)',
  'Rimming (giving)',
  'Rimming (receiving)',
  'Fingering',
  'Butt plugs / anal toys',
  'Vibrators / dildos',
  'Bondage',
  'Blindfolds',
  'Spanking (giving)',
  'Spanking (receiving)',
  'Choking (giving)',
  'Choking (receiving)',
  'Hair-pulling',
  'Biting',
  'BDSM / dom-sub play',
  'Role-play',
  'Dirty talk',
  'Sexting',
  'Face-sitting',
  'Squirting',
  'Threesomes',
  'Group sex / orgies',
  'Swinging',
  'Public / semi-public sex',
  'Exhibitionism',
  'Voyeurism',
];

export const INTAKE_CATALOG: ReadonlyArray<IntakeSectionDef> = [
  // ============================ CORE (gates first-run) ============================
  {
    id: 'basics',
    title: 'The basics',
    blurb: 'A few simple things — what to call you and where you are in life.',
    tier: 'core',
    mode: 'form',
    restricted: false,
    adult: false,
    opener: "Let's start simple — a few quick things about you.",
    questions: [
      f(shortText('preferredName', 'What should I call you?')),
      f(
        single('pronouns', 'Your pronouns', [
          'she/her',
          'he/him',
          'they/them',
          'she/they',
          'he/they',
          'Other',
        ]),
        { field: 'pronouns' },
      ),
      f(
        single('gender', 'Your gender identity', [
          'Woman',
          'Man',
          'Non-binary',
          'Genderfluid',
          'Trans woman',
          'Trans man',
          'Prefer not to say',
          'Other',
        ]),
        { field: 'gender' },
      ),
      f(dateQ('birthday', 'Your birthday'), { field: 'birthday' }),
      f(shortText('location', 'Where do you live?'), { field: 'location' }),
      f(shortText('grewUp', 'Where did you grow up?')),
      f(multi('languages', 'Languages you speak', ['English', 'Spanish', 'French', 'Other']), {
        field: 'languages',
        list: true,
      }),
      f(shortText('ethnicity', 'Your cultural or ethnic background'), { field: 'ethnicity' }),
      f(shortText('occupation', 'What do you do for work?'), { field: 'occupation' }),
      f(
        single('education', 'Highest level of education', [
          'High school',
          'Some college',
          'Associate / trade',
          "Bachelor's",
          "Master's",
          'Doctorate',
          'Prefer not to say',
        ]),
      ),
      f(
        single('chronotype', 'Are you more of a…', [
          'Morning person',
          'Night owl',
          'Somewhere between',
        ]),
      ),
    ],
  },
  {
    id: 'life-now',
    title: 'Your life now',
    blurb: 'A picture of your everyday — home, work, and the shape of your days.',
    tier: 'core',
    mode: 'form',
    restricted: false,
    adult: false,
    opener: 'A snapshot of your life right now.',
    questions: [
      f(
        single('livingSituation', 'Your living situation', [
          'Live alone',
          'With a partner',
          'With family',
          'With roommates',
          'With kids',
          'Other',
        ]),
        { field: 'livingSituation' },
      ),
      f(
        single('relationshipStatus', 'Relationship status', [
          'Single',
          'Dating',
          'In a relationship',
          'Engaged',
          'Married',
          'Separated',
          'Divorced',
          'Widowed',
          "It's complicated",
        ]),
        { field: 'relationshipStatus' },
      ),
      f(
        single('parentalStatus', 'Children', [
          'No children',
          'Expecting',
          'Have young kids',
          'Have grown kids',
          'Want them someday',
          "Don't want them",
        ]),
        { field: 'parentalStatus' },
      ),
      f(multi('pets', 'Any pets?', ['Dog', 'Cat', 'Other', 'None'])),
      f(longText('typicalDay', 'What does a typical weekday look like for you?'), { deepen: true }),
      f(multi('hobbies', 'How do you spend your free time?', ['Other']), {
        field: 'interests',
        list: true,
      }),
      f(
        rating(
          'workSatisfaction',
          'How satisfied are you with your work?',
          'Not at all',
          'Completely',
        ),
      ),
      f(
        rating(
          'moneyStress',
          'How much does money stress you right now?',
          'Not at all',
          'A great deal',
        ),
      ),
      f(rating('connected', 'How socially connected do you feel?', 'Isolated', 'Deeply connected')),
      f(
        multi('topStressor', "What's weighing on you most right now?", [
          'Work',
          'Money',
          'Relationship',
          'Health',
          'Family',
          'Purpose',
          'Loneliness',
          'Other',
        ]),
      ),
      f(longText('joy', "What's bringing you joy lately?")),
      f(longText('recentChange', 'Any big recent change in your life?')),
      f(longText('perfectDay', 'What would a perfect day look like for you?')),
      f(rating('mood', 'Your overall mood lately', 'Low', 'Great')),
    ],
  },
  {
    id: 'values',
    title: 'Values & identity',
    blurb: 'What matters most — your beliefs, what guides you, and how you see yourself.',
    tier: 'core',
    mode: 'form',
    restricted: false,
    adult: false,
    opener: 'What matters most to you, and how you see yourself.',
    questions: [
      f(
        multi('values', 'Your core values', [
          'Honesty',
          'Family',
          'Freedom',
          'Growth',
          'Kindness',
          'Ambition',
          'Loyalty',
          'Creativity',
          'Faith',
          'Adventure',
          'Security',
          'Justice',
          'Health',
          'Other',
        ]),
        { field: 'values', list: true },
      ),
      f(longText('meaning', 'What gives your life meaning?')),
      f(
        single('faith', 'Faith or spirituality', [
          'Christian',
          'Catholic',
          'Jewish',
          'Muslim',
          'Hindu',
          'Buddhist',
          'Spiritual but not religious',
          'Agnostic',
          'Atheist',
          'Prefer not to say',
          'Other',
        ]),
        { field: 'faith' },
      ),
      f(rating('faithImportance', 'How important is faith to you?', 'Not at all', 'Central')),
      f(
        multi('personality', 'Which feel true of you?', [
          'Introvert',
          'Extrovert',
          'Planner',
          'Spontaneous',
          'Thinker',
          'Feeler',
          'Optimist',
          'Realist',
        ]),
      ),
      f(rating('riskTolerance', 'Your appetite for risk', 'Cautious', 'Bold')),
      f(shortText('selfDescribe', 'Describe yourself in a few words')),
      f(
        single('communicationStyle', 'How do you prefer to communicate?', [
          'Direct',
          'Gentle',
          'Playful',
          'Reserved',
          'Expressive',
        ]),
        { field: 'communicationStyle' },
      ),
      f(longText('proudOf', 'What are you most proud of?')),
      f(longText('insecureAbout', 'What do you feel most insecure about?')),
      f(longText('neverCompromise', 'What would you never compromise on?')),
      f(shortText('roleModel', 'Someone you look up to')),
      f(longText('remembered', 'What do you want to be remembered for?')),
    ],
  },
  {
    id: 'want',
    title: 'What you want',
    blurb: "Where you're headed — goals, growth, and what you want from SelfOS.",
    tier: 'core',
    mode: 'form',
    restricted: false,
    adult: false,
    opener: "Where you're headed, and how I can help.",
    questions: [
      f(
        multi('goals', 'What do you most want to work on?', [
          'Confidence',
          'Relationships',
          'Career',
          'Health & fitness',
          'Mental health',
          'Habits',
          'Purpose',
          'Money',
          'Intimacy',
          'Spirituality',
          'Other',
        ]),
        { field: 'goals' },
      ),
      f(longText('specificGoal', 'One specific goal right now'), { deepen: true }),
      f(longText('goodLife', 'What does a good life look like to you?')),
      f(longText('fiveYears', 'Where do you want to be in five years?')),
      f(shortText('habitBuild', 'A habit you want to build')),
      f(shortText('habitBreak', 'A habit you want to break')),
      f(longText('avoiding', 'What do you keep avoiding?')),
      f(longText('unlimited', 'What would you do with unlimited time and money?')),
      f(longText('futureFear', 'Your biggest fear about the future')),
      f(
        multi('supportStyle', 'How do you want SelfOS to support you?', [
          'Hold me accountable',
          'Help me reflect',
          'Give me advice',
          'Just listen',
          'Challenge me',
          'Track my progress',
        ]),
      ),
      f(
        single('coachStyle', 'How do you like to be coached?', [
          'Gently',
          'Directly',
          'Challenge me',
          'With data & structure',
        ]),
      ),
    ],
  },

  // ============================ INVITED (anytime, after the gate) ============================
  {
    id: 'health',
    title: 'Health & wellbeing',
    blurb: 'How you’re doing in body and mind — kept private to your own coaching.',
    tier: 'invited',
    mode: 'form',
    restricted: false,
    adult: false,
    opener: 'How you’re doing in body and mind. This stays private to your own coaching.',
    contentNote: 'Everything here stays private to your own coaching. Share only what you want to.',
    questions: [
      f(rating('sleep', 'How well do you sleep?', 'Poorly', 'Great')),
      f(
        single('sleepSchedule', 'Your usual sleep schedule', [
          'Early to bed / early up',
          'Late nights',
          'Irregular',
          'Shift work',
        ]),
      ),
      f(rating('energy', 'Your energy through the day', 'Drained', 'Energized')),
      f(rating('stress', 'Your stress level lately', 'Calm', 'Overwhelmed')),
      f(
        single('exercise', 'How often do you move or exercise?', [
          'Rarely',
          '1–2× a week',
          '3–4× a week',
          'Most days',
          'Daily',
        ]),
      ),
      f(
        single('eating', 'How would you describe your eating?', [
          'Healthy',
          'Average',
          'Irregular',
          'A struggle',
        ]),
      ),
      f(single('caffeine', 'Caffeine', ['None', 'A little', 'Moderate', 'A lot'])),
      f(single('alcohol', 'Alcohol', ['None', 'Occasionally', 'Weekly', 'Most days', 'Daily'])),
      f(single('smoking', 'Smoking / vaping', ['No', 'Occasionally', 'Daily'])),
      f(
        single('substances', 'Recreational substances', [
          'No',
          'Occasionally',
          'Regularly',
          'Prefer not to say',
        ]),
        {
          restricted: true,
        },
      ),
      f(
        single('therapy', 'Therapy or counseling', [
          'Currently',
          'In the past',
          'Never',
          'Want to',
        ]),
      ),
      f(longText('physicalConditions', 'Any physical conditions to keep in mind?'), {
        field: 'healthNotes',
        private: true,
      }),
      f(longText('mentalConditions', 'Any mental-health diagnoses?'), { restricted: true }),
      f(
        multi('neurodivergence', 'Do any of these apply?', [
          'ADHD',
          'Autism',
          'Dyslexia',
          'None',
          'Prefer not to say',
        ]),
        { restricted: true },
      ),
      f(longText('medications', 'Medications that affect your mood or energy?'), {
        restricted: true,
      }),
      f(longText('chronicPain', 'Chronic pain or illness?'), { restricted: true }),
      f(longText('disability', 'Any disability or accessibility needs?'), { restricted: true }),
      f(longText('eatingHistory', 'Your relationship with food (any history)?'), {
        restricted: true,
      }),
      f(rating('bodyRelationship', 'How you feel about your body', 'Critical', 'At peace')),
      f(longText('healthOther', 'Anything else to keep in mind?'), {
        field: 'healthNotes',
        private: true,
        deepen: true,
      }),
    ],
  },
  {
    id: 'relationships',
    title: 'Relationships',
    blurb: 'How you connect — your patterns, what you need, and how you love.',
    tier: 'invited',
    mode: 'form',
    restricted: false,
    adult: false,
    opener: 'How you connect with the people in your life.',
    questions: [
      f(
        single('attachment', 'Which attachment style fits you best?', [
          'Secure — comfortable with closeness',
          'Anxious — crave closeness, fear abandonment',
          'Avoidant — value independence, wary of closeness',
          'Mixed / not sure',
        ]),
      ),
      f(
        single('conflictStyle', 'When conflict comes up, you tend to…', [
          'Avoid it',
          'Accommodate / give in',
          'Confront it head-on',
          'Work it through together',
        ]),
      ),
      f(
        multi('needs', 'What do you need most from people close to you?', [
          'Reassurance',
          'Space',
          'Quality time',
          'Honesty',
          'Affection',
          'Reliability',
          'To be understood',
        ]),
      ),
      f(
        multi('expressLove', 'How do you express love?', [
          'Words',
          'Touch',
          'Quality time',
          'Gifts',
          'Acts of service',
        ]),
      ),
      f(
        multi('receiveLove', 'How do you best receive love?', [
          'Words',
          'Touch',
          'Quality time',
          'Gifts',
          'Acts of service',
        ]),
      ),
      f(rating('trust', 'How easily do you trust people?', 'Slowly', 'Easily')),
      f(rating('openUp', 'How easily do you open up?', 'Guarded', 'Open book')),
      f(
        single('jealousy', 'How do you handle jealousy?', [
          'Rarely feel it',
          'Feel it but manage',
          'It gets to me',
        ]),
      ),
      f(longText('dealBreakers', 'Your relationship deal-breakers')),
      f(
        single('closeFriends', 'How many close friends do you have?', ['None', '1–2', '3–5', '6+']),
      ),
      f(
        rating(
          'friendshipSatisfaction',
          'Satisfaction with your friendships',
          'Lonely',
          'Fulfilled',
        ),
      ),
      f(shortText('crisisPerson', 'Who do you turn to in a crisis?')),
      f(rating('loneliness', 'How lonely do you feel?', 'Never', 'Often')),
      f(longText('showUp', 'How do you show up as a partner, friend, or parent?')),
      f(longText('relationshipPattern', 'A pattern you notice in your relationships'), {
        deepen: true,
      }),
      f(longText('relationshipChallenge', 'Your biggest relationship challenge')),
    ],
  },
  {
    id: 'family',
    title: 'Family & upbringing',
    blurb: 'Where you come from — family, how you were raised, what you carry.',
    tier: 'invited',
    mode: 'chat',
    restricted: false,
    adult: false,
    opener:
      'Where did you grow up, and who was around as you were growing up? Paint me a picture of your family.',
    focus:
      'Their family of origin and upbringing — who raised them, siblings and birth order, closeness with each ' +
      'parent/caregiver, how affection and conflict were handled, family faith and culture, family wounds and ' +
      'gifts, any family mental-health or addiction history (gently), the patterns they inherited, their ' +
      'relationship with family now, chosen family, and (if a parent) what they do the same or differently. ' +
      'Cover these specifically but let them set the depth; never push.',
  },
  {
    id: 'story',
    title: 'Your story',
    blurb: 'The chapters that shaped you — turning points and what you carry from them.',
    tier: 'invited',
    mode: 'chat',
    restricted: false,
    adult: false,
    opener:
      'If you told the story of your life so far in a few chapters, what would they be? Start wherever feels right.',
    focus:
      'The key chapters of their life — formative experiences, turning points, their proudest achievement, ' +
      'their lowest moments, a moment that changed everything, biggest regrets, defining relationships, their ' +
      'biggest failure and what it taught them, what they have survived, how they have changed, and who they ' +
      'are becoming. Held as the person chooses to share.',
  },
  {
    id: 'weighs',
    title: 'What weighs on you',
    blurb: 'The heavier things — struggles, grief, or patterns you feel stuck in.',
    tier: 'invited',
    mode: 'chat',
    restricted: true,
    adult: false,
    opener:
      'Is there anything weighing on you right now — something heavy you carry? We can go as light or as deep as you want, and skip anything.',
    contentNote:
      'We can go as light or as deep as you want, and skip anything. This stays private to your own coaching. If you’re ever in crisis, please reach out to the resources below — I’m not a substitute for real help.',
    focus:
      'The heavier parts of their inner life — current stressors, grief and loss, recurring worries, what keeps ' +
      'them up at night, their inner critic / self-talk, coping mechanisms (healthy and not), shame, things ' +
      'they don’t tell anyone, what they’re avoiding dealing with, and (gently, only if they offer) past ' +
      'trauma. Trauma-informed: let them set the depth, validate whatever they share, never dig for specifics. ' +
      'Watch for crisis and route to professional help per your safety guidance — never manage it alone.',
  },
  {
    id: 'intimacy',
    title: 'Intimacy & sexuality',
    blurb: 'Optional and 18+ — your desires, history, preferences, and what closeness means.',
    tier: 'invited',
    mode: 'form',
    restricted: true,
    adult: true,
    opener:
      'An optional, grown-up space to help SelfOS understand your sexuality. Everything is private to your own coaching, and every question is skippable.',
    contentNote:
      'This block is entirely optional and only for adults (18+). Everything here stays private to your own coaching, is never shared with anyone else, and every question is skippable. It covers your own consensual adult sexuality — including fantasies; real limits are yours to set at the end.',
    questions: [
      // --- A. Orientation & identity ---
      f(
        multi('sexualOrientation', 'Your sexual orientation', [
          'Straight',
          'Gay',
          'Lesbian',
          'Bisexual',
          'Pansexual',
          'Asexual',
          'Demisexual',
          'Queer',
          'Questioning',
          'Other',
        ]),
        { field: 'sexualOrientation', private: true },
      ),
      f(
        multi('drawnTo', 'Who are you drawn to?', [
          'Men',
          'Women',
          'Non-binary people',
          'Everyone',
        ]),
        { restricted: true },
      ),
      f(yesno('attractedPenis', 'Are you attracted to partners with a penis?'), {
        restricted: true,
      }),
      f(yesno('attractedVulva', 'Are you attracted to partners with a vulva?'), {
        restricted: true,
      }),
      f(
        single('relationshipStyle', 'Your relationship style', [
          'Monogamous',
          'Open',
          'Polyamorous',
          'Exploring',
          'Other',
        ]),
        { field: 'relationshipStyle', private: true },
      ),
      f(
        rating(
          'intimacyImportance',
          'How big a part of life is intimacy for you?',
          'Small',
          'Huge',
        ),
        {
          restricted: true,
        },
      ),
      f(single('libido', 'Your sex drive', ['Very low', 'Low', 'Moderate', 'High', 'Very high']), {
        restricted: true,
      }),
      f(shortText('sexualityWord', 'Describe your sexuality in a word or phrase'), {
        restricted: true,
      }),
      // --- B. Your sexual story ---
      f(single('firstMasturbatedAge', 'How old were you when you first masturbated?', AGE_RANGES), {
        restricted: true,
      }),
      f(single('firstOrgasmAge', 'How old were you at your first orgasm?', AGE_RANGES), {
        restricted: true,
      }),
      f(
        single('firstPartneredAge', 'How old were you at your first partnered experience?', [
          ...AGE_RANGES.slice(0, -1),
          "Haven't yet",
          'Prefer not to say',
        ]),
        { restricted: true },
      ),
      f(
        single('partnerCount', 'How many sexual partners have you had?', [
          '0',
          '1',
          '2–5',
          '6–10',
          '11–20',
          '20+',
          'Prefer not to say',
        ]),
        { restricted: true },
      ),
      f(longText('discoveredMasturbation', 'How did you first discover masturbation?'), {
        restricted: true,
      }),
      f(longText('firstExperience', 'Your first sexual experience, in your own words'), {
        restricted: true,
      }),
      f(longText('bestExperience', 'Your best or most memorable experience'), { restricted: true }),
      f(longText('embarrassingExperience', 'Your most awkward or embarrassing moment'), {
        restricted: true,
      }),
      f(longText('sexualRegret', 'Anything you regret?'), { restricted: true }),
      f(longText('sexualityEvolved', 'How has your sexuality changed over time?'), {
        restricted: true,
      }),
      f(longText('messagesGrowingUp', 'What messages about sex did you absorb growing up?'), {
        restricted: true,
      }),
      f(longText('sexualShame', 'Any sexual shame or hang-ups you carry?'), { restricted: true }),
      // --- C. Current partner & sex life (branch on hasPartner) ---
      f(yesno('hasPartner', 'Do you have a sexual partner right now?'), { restricted: true }),
      f(rating('sexSatisfaction', 'Satisfaction with your sex life', 'Unhappy', 'Thrilled'), {
        restricted: true,
      }),
      f(single('sexFrequency', 'How often are you intimate now?', FREQ, when('hasPartner', true)), {
        restricted: true,
      }),
      f(
        single(
          'desiredFrequency',
          'How often would you like to be?',
          FREQ,
          when('hasPartner', true),
        ),
        {
          restricted: true,
        },
      ),
      f(
        single(
          'initiates',
          'Who usually initiates?',
          ['Me', 'My partner', 'Both equally', 'Neither, much'],
          when('hasPartner', true),
        ),
        { restricted: true },
      ),
      f(
        single(
          'orgasmTogether',
          'How often do you orgasm together?',
          ['Rarely', 'Sometimes', 'Usually', 'Almost always'],
          when('hasPartner', true),
        ),
        { restricted: true },
      ),
      f(rating('talkAboutSex', 'How easily can you talk about sex with them?', 'Hard', 'Easy'), {
        restricted: true,
      }),
      f(yesno('sharedFantasies', 'Have you shared your fantasies with them?'), {
        restricted: true,
      }),
      f(longText('unspokenWant', 'Something you want but haven’t asked for'), { restricted: true }),
      f(longText('sexWorking', "What's working well?"), { restricted: true }),
      f(longText('sexDifferent', 'What do you wish were different?'), { restricted: true }),
      f(longText('partnerAttractive', 'What do you find most attractive about them?'), {
        restricted: true,
      }),
      // --- D. Arousal & what you like ---
      f(multi('turnOns', 'Your turn-ons', ['Other']), { restricted: true }),
      f(multi('turnOffs', 'Your turn-offs', ['Other']), { restricted: true }),
      f(
        multi('inTheMood', 'What gets you in the mood?', [
          'Touch',
          'Words / dirty talk',
          'Anticipation',
          'Visuals',
          'Scent',
          'Romance',
          'A few drinks',
          'Stress relief',
        ]),
        { restricted: true },
      ),
      f(
        multi('touchAreas', 'Where do you most like to be touched?', [
          'Neck',
          'Ears',
          'Lips',
          'Chest / nipples',
          'Back',
          'Thighs',
          'Genitals',
          'Butt',
          'All over',
        ]),
        { restricted: true },
      ),
      f(
        multi('positions', 'Favorite positions', [
          'Missionary',
          'Doggy',
          'On top / riding',
          'Spooning',
          'Standing',
          'Oral (giving)',
          'Oral (receiving)',
          '69',
          'Other',
        ]),
        { restricted: true },
      ),
      f(
        single('paceIntensity', 'Preferred pace & intensity', [
          'Slow & sensual',
          'In between',
          'Rough & intense',
        ]),
        {
          restricted: true,
        },
      ),
      f(
        single('domSub', 'Dominant or submissive?', [
          'Dominant',
          'Submissive',
          'Switch',
          'Vanilla',
        ]),
        {
          restricted: true,
        },
      ),
      f(multi('intoIt', 'What are you into?', ACTIVITIES), { restricted: true }),
      f(multi('curiousToTry', 'What are you curious to try?', ACTIVITIES), { restricted: true }),
      f(multi('hardLimits', "What's off the table for you?", ACTIVITIES), { restricted: true }),
      f(
        single('dirtyTalk', 'How do you feel about dirty talk?', [
          'Love it',
          'Sometimes',
          'Not for me',
        ]),
        {
          restricted: true,
        },
      ),
      f(
        multi('toys', 'Toys you own or want', [
          'Vibrator',
          'Dildo',
          'Butt plug',
          'Cock ring',
          'Restraints',
          'None',
        ]),
        { restricted: true },
      ),
      f(
        single('sessionLength', 'Quickies or long sessions?', [
          'Quickies',
          'Long sessions',
          'Both',
        ]),
        {
          restricted: true,
        },
      ),
      f(longText('kinks', 'Kinks or fetishes, in your own words'), { restricted: true }),
      // --- D2. Acts & specifics (explicit, branched) ---
      f(yesno('givesOralPenis', 'Do you give oral sex on a penis?'), { restricted: true }),
      f(
        single(
          'swallowSpit',
          'When you give a blowjob, do you swallow or spit?',
          ['Swallow', 'Spit', 'Either', 'Depends'],
          when('givesOralPenis', true),
        ),
        { restricted: true },
      ),
      f(yesno('swallowTurnsOn', 'Does swallowing turn you on?'), { restricted: true }),
      f(
        multi('cumWhere', 'Where do you like your partner to cum?', [
          'In my mouth',
          'On my face',
          'On my chest / body',
          'On my ass',
          'Inside me (vaginal)',
          'Inside me (anal)',
          'Wherever they want',
          "I don't have a preference",
        ]),
        { restricted: true },
      ),
      f(
        single('assPlay', 'Do you like having your ass fingered or played with during sex?', [
          'Love it',
          'Sometimes',
          'Not for me',
          'Curious',
        ]),
        {
          restricted: true,
        },
      ),
      f(
        single('analPref', 'How do you feel about anal?', [
          'Give',
          'Receive',
          'Both',
          'Not for me',
          'Curious',
        ]),
        {
          restricted: true,
        },
      ),
      f(
        single('choking', 'Do you like choking or being choked?', [
          'Being choked',
          'Doing the choking',
          'Both',
          'Neither',
          'Curious',
        ]),
        { restricted: true },
      ),
      f(rating('roughness', 'How rough do you like it?', 'Gentle', 'Very rough'), {
        restricted: true,
      }),
      f(
        single('degradePraise', 'Do you like to be degraded or praised?', [
          'Degradation',
          'Praise',
          'Both',
          'Neither',
        ]),
        {
          restricted: true,
        },
      ),
      f(single('loudQuiet', 'Loud or quiet?', ['Loud', 'Quiet', 'In between']), {
        restricted: true,
      }),
      f(single('lights', 'Lights on or off?', ['On', 'Off', 'No preference']), {
        restricted: true,
      }),
      f(
        longText(
          'idealEncounter',
          'Describe your ideal sexual encounter, start to finish, in as much detail as you like',
        ),
        {
          restricted: true,
        },
      ),
      // --- E. Body & physical preferences (branched on attraction) ---
      f(
        single(
          'penisSizePref',
          'Penis size you prefer on a partner',
          ['No preference', 'On the smaller side', 'Average', 'Large', 'Very large'],
          when('attractedPenis', true),
        ),
        { restricted: true },
      ),
      f(
        single(
          'breastPref',
          'Breast size you prefer on a partner',
          ['No preference', 'Smaller', 'Average', 'Larger'],
          when('attractedVulva', true),
        ),
        { restricted: true },
      ),
      f(
        multi('bodyTypePref', "Body types you're drawn to", [
          'Slim',
          'Athletic',
          'Average',
          'Curvy',
          'Bigger',
          'No preference',
        ]),
        {
          restricted: true,
        },
      ),
      f(
        single('partnerGrooming', 'Pubic hair you prefer on a partner', [
          'Shaved / bare',
          'Trimmed',
          'Natural / grown out',
          'No preference',
        ]),
        { restricted: true },
      ),
      f(
        single('ownGrooming', 'How do you keep your own grooming?', [
          'Shaved / bare',
          'Trimmed',
          'Natural',
          'Varies',
        ]),
        {
          restricted: true,
        },
      ),
      f(
        rating(
          'bodyConfidence',
          'How confident do you feel in your own body?',
          'Self-conscious',
          'Very confident',
        ),
        {
          restricted: true,
        },
      ),
      f(
        multi('erogenousZones', 'Your most sensitive spots', [
          'Neck',
          'Ears',
          'Nipples',
          'Inner thighs',
          'Genitals',
          'Butt',
          'Lower back',
        ]),
        { restricted: true },
      ),
      f(
        longText(
          'bodyFeelings',
          'Anything about your body you love or feel self-conscious about sexually?',
        ),
        {
          restricted: true,
        },
      ),
      // --- F. Fantasies & media ---
      f(longText('wildestFantasy', 'Your wildest fantasy, in as much detail as you like'), {
        restricted: true,
      }),
      f(longText('fantasiesToTry', "Fantasies you'd actually like to try"), { restricted: true }),
      f(
        multi('commonFantasies', 'Which of these appeal to you?', [
          'Threesome / group',
          'Voyeurism',
          'Exhibitionism',
          'Domination',
          'Submission',
          'CNC / "ravishment" roleplay',
          'Bondage',
          'Being watched',
          'Strangers / one-night roleplay',
          'Boss / employee',
          'Teacher / student roleplay',
          'Cheating roleplay',
          'Gangbang',
        ]),
        { restricted: true },
      ),
      f(longText('neverActOn', "A fantasy you'd love but would never actually do"), {
        restricted: true,
      }),
      f(
        single(
          'cncInterest',
          'Any consensual-non-consent (CNC) / "ravishment" roleplay interest?',
          ['Yes', 'Curious', 'No'],
        ),
        { restricted: true },
      ),
      f(
        single('watchPorn', 'Do you watch porn?', [
          'Never',
          'Rarely',
          'Sometimes',
          'Often',
          'Daily',
        ]),
        {
          restricted: true,
        },
      ),
      f(multi('pornGenres', 'What kind do you like?', ['Other'], when('watchPorn', 'Sometimes')), {
        restricted: true,
      }),
      f(longText('pornRole', 'How does porn fit into your life?'), { restricted: true }),
      f(single('erotica', 'Do you read or listen to erotica?', ['Never', 'Sometimes', 'Often']), {
        restricted: true,
      }),
      f(single('sexting', 'Do you sext or share nudes?', ['Never', 'Sometimes', 'Often']), {
        restricted: true,
      }),
      f(
        single('recording', 'Are you into recording yourselves having sex or you masturbating?', [
          'Love it',
          'Sometimes',
          'Curious',
          'Not for me',
        ]),
        { restricted: true },
      ),
      f(
        single('broadcasting', 'Would you ever broadcast / livestream (cam) yourself?', [
          'I do already',
          'Want to',
          'Curious',
          'No',
        ]),
        { restricted: true },
      ),
      f(
        single('mirror', 'Do you like watching yourself in a mirror or on camera?', [
          'Yes',
          'Sometimes',
          'No',
        ]),
        {
          restricted: true,
        },
      ),
      f(longText('recurringDreams', 'Any recurring sexual dreams?'), { restricted: true }),
      // --- G. Sexual wellbeing (private) ---
      f(
        multi('difficulties', "Anything you'd want support with?", [
          'Getting aroused',
          'Reaching orgasm',
          'Pain during sex',
          'Erectile difficulty',
          'Dryness',
          'Mismatched desire',
          'None',
        ]),
        { restricted: true },
      ),
      f(rating('performanceAnxiety', 'Performance anxiety', 'None', 'A lot'), { restricted: true }),
      f(longText('moodLibido', 'How does your mood affect your libido?'), { restricted: true }),
      f(longText('sexWellbeing', 'How does sex affect your overall wellbeing?'), {
        restricted: true,
      }),
      // --- H. Boundaries, consent & meaning ---
      f(longText('boundaries', 'Consent, safety, or boundaries SelfOS should always hold'), {
        restricted: true,
      }),
      f(shortText('safeword', 'A safeword or signal you use')),
      f(longText('feelSafe', 'What makes you feel safe and present during sex?'), {
        restricted: true,
      }),
      f(longText('closenessMeaning', 'What does great intimacy or closeness mean to you?'), {
        restricted: true,
      }),
      f(
        longText(
          'understandSexuality',
          'What do you most want SelfOS to understand about your sexuality?',
        ),
        {
          restricted: true,
        },
      ),
    ],
  },
];

/** Find a section definition by id (null if unknown — a retired id is ignored, §7). */
export function getIntakeSection(id: string): IntakeSectionDef | undefined {
  return INTAKE_CATALOG.find((s) => s.id === id);
}

/** The renderer-facing catalog metadata (the host-only field/restricted mapping is stripped). */
export function intakeSectionMeta(): IntakeSectionMeta[] {
  return INTAKE_CATALOG.map((s) => ({
    id: s.id,
    title: s.title,
    blurb: s.blurb,
    restricted: s.restricted,
    adult: s.adult,
    tier: s.tier,
    mode: s.mode,
    opener: s.opener,
    ...(s.contentNote !== undefined ? { contentNote: s.contentNote } : {}),
    ...(s.questions ? { questions: s.questions.map((x) => x.q) } : {}),
    ...(s.questions?.some((x) => x.deepen) ? { canDeepen: true } : {}),
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
  if (section.focus) {
    parts.push(`Right now you are exploring this section — "${section.title}": ${section.focus}`);
  }
  if (section.restricted) {
    parts.push(
      `This is a sensitive section. Open gently, let the person set the depth, validate whatever they ` +
        `share, and never dig for specifics they don't offer. If there is any sign of crisis, respond ` +
        `with warmth and route to professional help per your safety guidance — never manage it alone.`,
    );
  }
  return parts.join('\n\n');
}
