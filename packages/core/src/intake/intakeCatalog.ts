import { INTIMACY_ACTIVITIES, INTIMACY_FANTASIES } from '../intimacy/topics';
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
function yesno(id: string, prompt: string): Question {
  return { id, type: 'yesNo', prompt, required: false };
}
function longText(id: string, prompt: string, placeholder?: string): Question {
  return { id, type: 'longText', prompt, required: false, ...(placeholder ? { placeholder } : {}) };
}
function shortText(id: string, prompt: string, placeholder?: string): Question {
  return {
    id,
    type: 'shortText',
    prompt,
    required: false,
    ...(placeholder ? { placeholder } : {}),
  };
}
function dateQ(id: string, prompt: string): Question {
  return { id, type: 'date', prompt, required: false };
}
/** A repeatable list of {label, date} rows (e.g. anniversaries) — maps to `Person.importantDates`. */
function dateList(id: string, prompt: string): Question {
  return { id, type: 'dateList', prompt, required: false };
}
/** A sleek 0–10 slider with example anchors at the start, middle, and end of the track (§14.5). */
function slider(
  id: string,
  prompt: string,
  minLabel: string,
  midLabel: string,
  maxLabel: string,
): Question {
  return {
    id,
    type: 'slider',
    prompt,
    required: false,
    scale: { min: 0, max: 10, minLabel, midLabel, maxLabel },
  };
}
/** A branch: show this question only when an earlier answer equals `value`. The trigger is usually a
 * singleChoice/yesNo (a scalar), but a multiChoice trigger also works — it matches when the selected
 * array CONTAINS `value` (e.g. a per-substance frequency under "which substances do you use"). */
function when(questionId: string, value: string | boolean): BranchRule {
  return { whenQuestionId: questionId, equals: value, action: 'show' };
}
/** A branch: show this question when an earlier answer is ANY of `values` (e.g. unless "Not for me"). */
function whenAny(questionId: string, values: (string | boolean)[]): BranchRule {
  return { whenQuestionId: questionId, equalsAny: values, action: 'show' };
}
/** Wrap a question with its intake mapping. */
function f(q: Question, m: Omit<IntakeFormQuestion, 'q'> = {}): IntakeFormQuestion {
  return { q, ...m };
}

/** Tag a batch of form questions with an accordion group heading (18 §14.3). */
function grouped(group: string, items: IntakeFormQuestion[]): IntakeFormQuestion[] {
  return items.map((it) => ({ ...it, q: { ...it.q, group } }));
}

// Shared option sets reused across questions.
const AGE_RANGES = ['Under 10', '10–12', '13–15', '16–18', '19–24', '25+', 'Prefer not to say'];
const FREQ = ['Rarely', 'A few times a month', 'Weekly', 'A few times a week', 'Daily'];
// Per-substance use frequency (§ health Lifestyle) — each shown only when that substance is selected.
const SUBSTANCE_FREQ = [
  'Rarely',
  'Occasionally',
  'Weekly',
  'Most days',
  'Daily',
  'Prefer not to say',
];
// The consensual-adult activity checklist, reused for into-it / curious-to-try / hard-limits (§14.5 D).
// Sourced from the SHARED `INTIMACY_TOPICS` inventory (08 §16.5a — one source of truth with questionnaire
// generation); `'Other'` is the intake form's free-text escape, appended here.
const ACTIVITIES = [...INTIMACY_ACTIVITIES, 'Other'];
// A comprehensive sex-toy checklist, reused for "toys you own" / "toys you want" (§14.5). Covers the modern
// app/remote-controlled range (Lovense-style) plus the broader categories; "Other"/"None" appended per use.
const TOYS = [
  'Bullet vibrator',
  'Wand vibrator',
  'Rabbit vibrator',
  'Clitoral suction toy',
  'G-spot vibrator',
  'App / remote-controlled vibrator',
  'Wearable / panty vibrator',
  'Finger vibrator',
  'Dildo',
  'Realistic dildo',
  'Glass / metal dildo',
  'Suction-cup dildo',
  'Thrusting toy / sex machine',
  'Double-ended dildo',
  'Strap-on',
  'Butt plug',
  'Vibrating butt plug',
  'Anal beads',
  'Prostate massager',
  'Cock ring',
  'Vibrating cock ring',
  'Stroker / masturbator sleeve',
  'Automatic stroker',
  'Penis pump',
  'Cock cage / chastity',
  'App-controlled couples toy',
  'Nipple clamps',
  'Nipple suckers',
  'Restraints / cuffs',
  'Blindfold',
  'Paddle / flogger',
  'Gag',
  'Collar & leash',
  'Rope / bondage kit',
  'Kegel / Ben Wa balls',
  'Sex wedge / pillow',
  'Sex swing',
  'E-stim toy',
  'Lube',
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
      f(shortText('preferredName', 'What should I call you?', 'e.g. Sam')),
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
      f(dateList('importantDates', 'Any important dates to remember?'), {
        field: 'importantDates',
      }),
      f(shortText('location', 'Where do you live?', 'e.g. Seattle, WA'), { field: 'location' }),
      f(shortText('grewUp', 'Where did you grow up?', 'e.g. a small town in Ohio')),
      f(multi('languages', 'Languages you speak', ['English', 'Spanish', 'French', 'Other']), {
        field: 'languages',
        list: true,
      }),
      f(
        multi('ethnicity', 'Your cultural or ethnic background', [
          'White / European',
          'Black / African',
          'Hispanic / Latino',
          'East Asian',
          'South Asian',
          'Southeast Asian',
          'Middle Eastern / North African',
          'Indigenous / Native',
          'Pacific Islander',
          'Mixed / Multiple',
          'Other',
          'Prefer not to say',
        ]),
        { field: 'ethnicity' },
      ),
      f(
        longText(
          'appearanceDescription',
          'How would you describe how you look?',
          'Hair, build, distinctive features — helps SelfOS picture you (e.g. for dream images).',
        ),
        { field: 'appearanceDescription' },
      ),
      f(
        shortText(
          'occupation',
          'What do you do for work?',
          'e.g. nurse, teacher, software engineer',
        ),
        { field: 'occupation' },
      ),
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
      f(shortText('nickname', 'Any nicknames?', 'What friends or family call you')),
      f(shortText('nationality', 'Your nationality', 'e.g. American, British')),
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
      // One question for the home setup (replaces the old livingSituation + liveWith pair). Picking
      // "Children" auto-fills the Children question below (handled in the onboarding form panel).
      f(
        multi('liveWith', 'Who do you live with?', [
          'Partner',
          'Children',
          'Parents',
          'Other family',
          'Roommates',
          'Pets',
          'I live alone',
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
      f(
        longText(
          'typicalDay',
          'What does a typical weekday look like for you?',
          'Walk me through a normal day, start to finish.',
        ),
      ),
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
      f(
        longText(
          'meaning',
          'What gives your life meaning?',
          'e.g. family, faith, making a difference, creating things',
        ),
      ),
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
      f(
        slider(
          'faithImportance',
          'How important is faith to you?',
          'Not at all',
          'Somewhat',
          'Central',
        ),
      ),
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
      f(slider('riskTolerance', 'Your appetite for risk', 'Cautious', 'Balanced', 'Bold')),
      f(
        shortText(
          'selfDescribe',
          'Describe yourself in a few words',
          'e.g. curious, loyal, a bit anxious',
        ),
      ),
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
      f(
        longText(
          'proudOf',
          'What are you most proud of?',
          'A moment, a relationship, something you built…',
        ),
      ),
      f(
        longText(
          'insecureAbout',
          'What do you feel most insecure about?',
          'Only what you want to share.',
        ),
      ),
      f(
        longText(
          'neverCompromise',
          'What would you never compromise on?',
          'A line you won’t cross.',
        ),
      ),
      f(
        shortText(
          'roleModel',
          'Someone you look up to',
          'e.g. a parent, a mentor, a public figure',
        ),
      ),
      f(
        longText(
          'remembered',
          'What do you want to be remembered for?',
          'The mark you’d like to leave.',
        ),
      ),
      f(
        multi('causes', 'Causes you care about', [
          'Environment',
          'Equality',
          'Animal welfare',
          'Education',
          'Poverty',
          'Health',
          'Faith',
          'Politics',
          'None in particular',
          'Other',
        ]),
      ),
      f(
        single('politicalLeaning', 'Where do you sit politically?', [
          'Left',
          'Centre-left',
          'Centre',
          'Centre-right',
          'Right',
          'Apolitical',
          'Prefer not to say',
        ]),
      ),
      f(
        single('decisionStyle', 'You make big decisions mostly with your…', [
          'Head',
          'Heart',
          'Gut',
        ]),
      ),
      f(longText('success', 'What does success mean to you?', 'In your own words.')),
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
      f(
        longText(
          'specificGoal',
          'One specific goal right now',
          'e.g. run a 10k, change careers, feel calmer',
        ),
      ),
      f(
        longText(
          'goodLife',
          'What does a good life look like to you?',
          'What it looks and feels like for you.',
        ),
      ),
      f(
        longText(
          'fiveYears',
          'Where do you want to be in five years?',
          'Work, home, how you feel…',
        ),
      ),
      f(shortText('habitBuild', 'A habit you want to build', 'e.g. daily walks, journaling')),
      f(
        shortText(
          'habitBreak',
          'A habit you want to break',
          'e.g. doomscrolling, late-night snacking',
        ),
      ),
      f(longText('avoiding', 'What do you keep avoiding?', 'Something you keep putting off.')),
      f(
        longText(
          'unlimited',
          'What would you do with unlimited time and money?',
          'Dream a little.',
        ),
      ),
      f(
        longText(
          'futureFear',
          'Your biggest fear about the future',
          'What worries you about what’s ahead.',
        ),
      ),
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
      f(
        shortText(
          'learnSkill',
          'A skill you’d love to learn',
          'e.g. a language, an instrument, to cook',
        ),
      ),
      f(
        multi('motivates', 'What motivates you most?', [
          'Achievement',
          'Recognition',
          'Security',
          'Freedom',
          'Impact',
          'Connection',
          'Mastery',
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
      ...grouped('Sleep & energy', [
        f(slider('sleep', 'How well do you sleep?', 'Poorly', 'Okay', 'Great')),
        f(
          single('sleepSchedule', 'Your usual sleep schedule', [
            'Early to bed / early up',
            'Late nights',
            'Irregular',
            'Shift work',
          ]),
        ),
        f(slider('energy', 'Your energy through the day', 'Drained', 'Steady', 'Energized')),
        f(slider('stress', 'Your stress level lately', 'Calm', 'Manageable', 'Overwhelmed')),
      ]),
      ...grouped('Lifestyle', [
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
          multi('substancesUsed', 'Which recreational substances do you use, if any?', [
            'Cannabis / weed',
            'Cocaine',
            'MDMA / ecstasy',
            'Psychedelics (LSD, mushrooms)',
            'Ketamine',
            'Prescription meds (recreationally)',
            'None',
            'Other',
            'Prefer not to say',
          ]),
          { restricted: true },
        ),
        // Per-substance frequency — each appears directly below, only when that substance is selected.
        f(
          single(
            'cannabisFreq',
            'Cannabis — how often?',
            SUBSTANCE_FREQ,
            when('substancesUsed', 'Cannabis / weed'),
          ),
          { restricted: true },
        ),
        f(
          single(
            'cocaineFreq',
            'Cocaine — how often?',
            SUBSTANCE_FREQ,
            when('substancesUsed', 'Cocaine'),
          ),
          { restricted: true },
        ),
        f(
          single(
            'mdmaFreq',
            'MDMA / ecstasy — how often?',
            SUBSTANCE_FREQ,
            when('substancesUsed', 'MDMA / ecstasy'),
          ),
          { restricted: true },
        ),
        f(
          single(
            'psychedelicsFreq',
            'Psychedelics — how often?',
            SUBSTANCE_FREQ,
            when('substancesUsed', 'Psychedelics (LSD, mushrooms)'),
          ),
          { restricted: true },
        ),
        f(
          single(
            'ketamineFreq',
            'Ketamine — how often?',
            SUBSTANCE_FREQ,
            when('substancesUsed', 'Ketamine'),
          ),
          { restricted: true },
        ),
        f(
          single(
            'rxRecreationalFreq',
            'Prescription meds (recreationally) — how often?',
            SUBSTANCE_FREQ,
            when('substancesUsed', 'Prescription meds (recreationally)'),
          ),
          { restricted: true },
        ),
        f(
          {
            ...shortText(
              'substanceOther',
              'Which other substance(s)?',
              'Whatever you’d like to share',
            ),
            branch: when('substancesUsed', 'Other'),
          },
          { restricted: true },
        ),
      ]),
      ...grouped('Mind & body', [
        f(
          single('therapy', 'Therapy or counseling', [
            'Currently',
            'In the past',
            'Never',
            'Want to',
          ]),
        ),
        f(
          longText(
            'physicalConditions',
            'Any physical conditions to keep in mind?',
            'e.g. asthma, a recent injury, a chronic condition…',
          ),
          { field: 'healthNotes', private: true },
        ),
        f(
          longText(
            'mentalConditions',
            'Any mental-health diagnoses?',
            'e.g. anxiety, depression, ADHD — only if you want to share',
          ),
          {
            restricted: true,
          },
        ),
        f(
          multi('neurodivergence', 'Do any of these apply?', [
            'ADHD',
            'Autism',
            'Dyslexia',
            'Other',
            'None',
            'Prefer not to say',
          ]),
          { restricted: true },
        ),
        f(
          longText(
            'medications',
            'Medications that affect your mood or energy?',
            'e.g. an SSRI, thyroid meds — only if you want to share',
          ),
          {
            restricted: true,
          },
        ),
        f(
          longText(
            'chronicPain',
            'Chronic pain or illness?',
            'e.g. back pain, migraines — only if relevant',
          ),
          { restricted: true },
        ),
        f(
          longText(
            'disability',
            'Any disability or accessibility needs?',
            'Anything that helps SelfOS support you.',
          ),
          { restricted: true },
        ),
        f(
          longText(
            'eatingHistory',
            'Your relationship with food (any history)?',
            'Only what you want to share.',
          ),
          {
            restricted: true,
          },
        ),
        f(
          slider(
            'bodyRelationship',
            'How you feel about your body',
            'Critical',
            'Neutral',
            'At peace',
          ),
        ),
        f(
          longText(
            'healthOther',
            'Anything else to keep in mind?',
            'Anything that helps SelfOS support you well.',
          ),
          {
            field: 'healthNotes',
            private: true,
          },
        ),
      ]),
      ...grouped('Mind & mood', [
        f(
          multi('stressRelief', 'How do you de-stress?', [
            'Exercise',
            'Time with people',
            'Alone time',
            'Hobbies',
            'Nature',
            'Food',
            'A drink',
            'Scrolling',
            'Other',
          ]),
        ),
        f(
          multi('selfCare', 'Self-care that actually works for you', [
            'Movement',
            'Rest',
            'Journaling',
            'Therapy',
            'Faith',
            'Creativity',
            'Nature',
            'Friends',
            'Music',
            'None yet',
          ]),
        ),
        f(slider('screenTime', 'Your screen / phone use', 'Minimal', 'Moderate', 'Constant')),
        f(
          single('outdoors', 'Time outside or in nature', [
            'Rarely',
            'Now and then',
            'Weekly',
            'Most days',
          ]),
        ),
        f(
          longText(
            'goodHealth',
            'What does good health mean to you?',
            'Beyond just not being sick.',
          ),
        ),
        f(
          shortText(
            'healthGoal',
            'A health goal you have',
            'e.g. sleep better, get stronger, drink less',
          ),
        ),
      ]),
      ...grouped('Your body', [
        f(
          slider(
            'dailyEnergy',
            'Your physical energy on a typical day',
            'Running on empty',
            'Enough to get by',
            'Plenty to spare',
          ),
        ),
        f(
          single('bodyAches', 'Do you carry any recurring aches or tension?', [
            'Rarely',
            'Now and then',
            'Most days',
            'Constantly',
            'Prefer not to say',
          ]),
        ),
        f(
          multi('acheAreas', 'Where does tension tend to show up?', [
            'Neck & shoulders',
            'Lower back',
            'Head',
            'Jaw',
            'Hips & legs',
            'Stomach',
            'Nowhere in particular',
            'Other',
          ]),
        ),
        f(
          single('digestion', 'How settled does your digestion usually feel?', [
            'Very settled',
            'Mostly fine',
            'A bit up and down',
            'Often unsettled',
            'Prefer not to say',
          ]),
        ),
        f(
          single('illnessFrequency', 'How often do you catch colds or minor illnesses?', [
            'Rarely',
            'A few times a year',
            'Fairly often',
            'It feels constant',
          ]),
        ),
        f(
          multi('allergies', 'Do any of these affect your daily comfort?', [
            'Seasonal allergies',
            'Food sensitivities',
            'Skin reactions',
            'None',
            'Prefer not to say',
            'Other',
          ]),
        ),
        f(
          single('lastCheckup', 'Your last health check-up', [
            'Within a year',
            '1–2 years ago',
            'Longer than that',
            'Never',
          ]),
        ),
      ]),
      ...grouped('Movement & fitness', [
        f(
          multi('movementTypes', 'What kinds of movement do you actually enjoy?', [
            'Walking',
            'Running',
            'Strength training',
            'Yoga or pilates',
            'Cycling',
            'Swimming',
            'Team sports',
            'Dancing',
            'None yet',
            'Other',
          ]),
        ),
        f(
          single('strengthVsCardio', 'Which do you naturally lean toward?', [
            'Mostly strength',
            'Mostly cardio',
            'A balance of both',
            'Neither, really',
          ]),
        ),
        f(
          slider(
            'movementConfidence',
            'How confident do you feel in your body’s capability?',
            'Not at all',
            'Fairly confident',
            'Very confident',
          ),
        ),
        f(
          single('movementBarrier', 'The biggest thing in the way of moving more', [
            'Time',
            'Energy',
            'Motivation',
            'Injury or pain',
            'Cost or access',
            'Nothing, really',
            'Other',
          ]),
        ),
        f(
          shortText(
            'fitnessGoal',
            'A physical goal you quietly hope to reach',
            'e.g. a 5k, a pull-up',
          ),
        ),
      ]),
      ...grouped('Food & fuel', [
        f(
          single('cookingHabits', 'How much of your food do you cook yourself?', [
            'Almost all of it',
            'About half',
            'Now and then',
            'Rarely',
            'Other',
          ]),
        ),
        f(
          slider(
            'waterIntake',
            'How well do you stay hydrated?',
            'Barely drink',
            'About average',
            'Always topped up',
          ),
        ),
        f(
          single('sugarRelationship', 'Your relationship with sugar', [
            'Easy-going',
            'A bit of a sweet tooth',
            'Hard to resist',
            'I avoid it',
            'Prefer not to say',
          ]),
        ),
        f(
          multi('supplements', 'Do you take any of these regularly?', [
            'Vitamins',
            'Protein',
            'Minerals',
            'Herbal remedies',
            'None',
            'Prefer not to say',
            'Other',
          ]),
        ),
        f(
          single('emotionalEating', 'Do feelings shape when or what you eat?', [
            'Rarely',
            'Sometimes',
            'Often',
            'Prefer not to say',
          ]),
        ),
        f(
          slider(
            'hungerCues',
            'How tuned-in are you to hunger and fullness?',
            'Out of touch',
            'Somewhat tuned-in',
            'Very tuned-in',
          ),
        ),
        f(
          shortText(
            'foodComfort',
            'A food that makes you feel cared for',
            'e.g. a home-cooked meal',
          ),
        ),
      ]),
      ...grouped('Rest & recovery', [
        f(yesno('napsRegularly', 'Do you nap during the day?')),
        f(
          single('daysOff', 'How protected are your true days off?', [
            'Sacred',
            'Mostly mine',
            'Often eroded',
            'What days off?',
          ]),
        ),
        f(
          slider(
            'burnoutLevel',
            'How close to burnout do you feel right now?',
            'Far from it',
            'Holding steady',
            'On the edge',
          ),
        ),
        f(
          slider(
            'recoveryQuality',
            'After a hard day, how well do you bounce back?',
            'Slowly',
            'Eventually',
            'Quickly',
          ),
        ),
        f(
          multi('unwindWays', 'How do you genuinely switch off?', [
            'Time outdoors',
            'A bath or shower',
            'Reading',
            'Music',
            'Doing nothing',
            'Time with others',
            'Screens',
            'Other',
          ]),
        ),
        f(
          shortText(
            'restfulPlace',
            'Where or when do you feel most rested?',
            'e.g. Sunday mornings',
          ),
        ),
      ]),
      ...grouped('Mind & focus', [
        f(yesno('meditates', 'Do you have any mindfulness or meditation practice?')),
        f(
          slider(
            'focusAbility',
            'How easily can you focus when you need to?',
            'Easily scattered',
            'It varies',
            'Laser-focused',
          ),
        ),
        f(
          single('moodSteadiness', 'How steady does your mood feel day to day?', [
            'Very steady',
            'Mild ups and downs',
            'Noticeable swings',
            'Prefer not to say',
          ]),
        ),
        f(
          slider(
            'dailyMotivation',
            'How motivated do you feel to do what you care about?',
            'Flat',
            'Steady',
            'Driven',
          ),
        ),
        f(yesno('gratitudePractice', 'Do you pause to notice things you appreciate?')),
        f(
          longText(
            'mindAtEase',
            'What helps quiet your mind when it gets busy?',
            'a few words is plenty',
          ),
        ),
      ]),
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
      ...grouped('How you connect', [
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
            'Other',
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
        f(slider('trust', 'How easily do you trust people?', 'Slowly', 'It depends', 'Easily')),
        f(slider('openUp', 'How easily do you open up?', 'Guarded', 'Selectively', 'Open book')),
        f(
          single('jealousy', 'How do you handle jealousy?', [
            'Rarely feel it',
            'Feel it but manage',
            'It gets to me',
          ]),
        ),
        f(
          longText(
            'dealBreakers',
            'Your relationship deal-breakers',
            'e.g. dishonesty, no ambition, poor communication…',
          ),
        ),
        f(
          longText(
            'showUp',
            'How do you show up as a partner, friend, or parent?',
            'How you tend to be for the people close to you.',
          ),
        ),
        f(
          longText(
            'relationshipPattern',
            'A pattern you notice in your relationships',
            'e.g. I pull away when things get serious',
          ),
        ),
        f(
          longText(
            'relationshipChallenge',
            'Your biggest relationship challenge',
            'The thing that comes up again and again.',
          ),
        ),
      ]),
      ...grouped('Your circle', [
        f(
          single('closeFriends', 'How many close friends do you have?', [
            'None',
            '1–2',
            '3–5',
            '6+',
          ]),
        ),
        f(
          slider(
            'friendshipSatisfaction',
            'Satisfaction with your friendships',
            'Lonely',
            'Doing okay',
            'Fulfilled',
          ),
        ),
        f(
          shortText(
            'crisisPerson',
            'Who do you turn to in a crisis?',
            'e.g. my sister, my best friend, my partner',
          ),
        ),
        f(slider('loneliness', 'How lonely do you feel?', 'Never', 'Sometimes', 'Often')),
        f(
          single('makeFriends', 'How easily do you make new friends?', [
            'Easily',
            'With time',
            'I find it hard',
          ]),
        ),
        f(
          single('groupRole', 'Your role in a group tends to be…', [
            'The organizer',
            'The listener',
            'The funny one',
            'The quiet one',
            'The leader',
            'It depends',
          ]),
        ),
        f(
          slider(
            'socialBattery',
            'Your social battery',
            'Drains fast',
            'Middle of the road',
            'Always on',
          ),
        ),
      ]),
      ...grouped('How you handle people', [
        f(
          slider(
            'boundaries',
            'How good are you at boundaries?',
            'I struggle',
            'Working on it',
            'Firm',
          ),
        ),
        f(
          slider(
            'forgiveness',
            'How easily do you forgive?',
            'I hold on',
            'It depends',
            'I let go',
          ),
        ),
        f(
          single('beingWrong', 'When you’re in the wrong, you…', [
            'Own it quickly',
            'Get defensive first',
            'Avoid it',
            'It depends',
          ]),
        ),
        f(
          single('othersEmotions', 'When someone close is upset, you…', [
            'Lean in',
            'Try to fix it',
            'Give them space',
            'Feel overwhelmed',
          ]),
        ),
      ]),
      ...grouped('Your history', [
        f(
          longText(
            'pastRelationships',
            'Your relationship history, in brief',
            'As much or as little as you like.',
          ),
        ),
        f(longText('pastLesson', 'What past relationships taught you', 'What you took from them.')),
        f(longText('heartbreak', 'A heartbreak that shaped you', 'Only if you want to share.')),
        f(
          longText(
            'repair',
            'A relationship you wish you could repair',
            'A rift you still think about.',
          ),
        ),
      ]),
      ...grouped('Love & partnership', [
        f(
          single('partnerWanted', 'What matters most to you in a partner?', [
            'Kindness',
            'Shared values',
            'Ambition',
            'Emotional depth',
            'A sense of humour',
            'Stability',
            'Adventure',
            'Other',
          ]),
        ),
        f(
          single('romanticLifeFeeling', 'How do you feel about your romantic life right now?', [
            'Happily partnered',
            'Content but working on it',
            'Single and okay with it',
            'Single and longing for connection',
            'Complicated',
            'Prefer not to say',
          ]),
        ),
        f(
          slider(
            'partnerCommunication',
            'With a partner, how easily do you talk through hard things?',
            'We avoid it',
            'We manage',
            'We talk openly',
          ),
        ),
        f(
          single('closenessPreference', 'Which kind of closeness do you crave most?', [
            'Emotional intimacy',
            'Physical affection',
            'Shared activities',
            'Deep conversation',
            'Quiet companionship',
            'Other',
          ]),
        ),
        f(
          longText(
            'partnershipFuture',
            'What do you hope your romantic future looks like?',
            'No wrong answer — dream a little.',
          ),
        ),
        f(
          longText(
            'whatEnded',
            'When past relationships ended, what was usually at the heart of it?',
            'Looking back gently.',
          ),
        ),
      ]),
      ...grouped('Friendship', [
        f(yesno('hasBestFriend', 'Do you have someone you’d call a best friend?')),
        f(
          single('connectFrequency', 'How often do you meaningfully connect with close friends?', [
            'Almost daily',
            'A few times a week',
            'Weekly',
            'A few times a month',
            'Rarely',
            'Hardly ever',
          ]),
        ),
        f(
          single('socialPreference', 'One-on-one or groups with friends?', [
            'One-on-one',
            'Small groups',
            'Big lively groups',
            'A mix',
            'Depends on my mood',
          ]),
        ),
        f(
          longText(
            'driftingApart',
            'A friendship you feel drifting that you wish you could hold onto',
            'Optional — share what comes to mind.',
          ),
        ),
        f(
          slider(
            'loyaltyValue',
            'How central is loyalty to your idea of friendship?',
            'Not essential',
            'Pretty important',
            'Everything',
          ),
        ),
        f(
          single('connectionMode', 'Where do most of your friendships live these days?', [
            'Mostly in person',
            'Mostly online',
            'An even blend',
            'Long-distance',
            'Other',
          ]),
        ),
      ]),
      ...grouped('How you relate', [
        f(
          slider(
            'peoplePleasing',
            'How often do you put others’ needs ahead of your own?',
            'Rarely',
            'Sometimes',
            'Almost always',
          ),
        ),
        f(
          single('askingForHelp', 'How do you feel about asking others for help?', [
            'It comes naturally',
            'I manage when I must',
            'I find it hard',
            'I almost never do',
            'Depends who it is',
            'Prefer not to say',
          ]),
        ),
        f(
          slider(
            'vulnerabilityComfort',
            'How comfortable are you being emotionally vulnerable?',
            'Very guarded',
            'Depends who',
            'Wide open',
          ),
        ),
        f(
          single('receivingCriticism', 'When someone criticizes you, you usually…', [
            'Take it in calmly',
            'Get defensive',
            'Shut down',
            'Overthink it later',
            'Appreciate the honesty',
            'Other',
          ]),
        ),
        f(
          single('givingFeedback', 'Giving someone hard feedback, you…', [
            'Are direct and kind',
            'Soften it a lot',
            'Avoid it',
            'Get nervous but do it',
            'Depends on the person',
            'Other',
          ]),
        ),
        f(
          slider(
            'independenceCloseness',
            'Independence ↔ closeness — where do you sit?',
            'Fiercely independent',
            'A balance',
            'Deeply interconnected',
          ),
        ),
        f(
          slider(
            'emotionalAvailability',
            'How emotionally available do you feel to others?',
            'Often distant',
            'Sometimes present',
            'Fully present',
          ),
        ),
      ]),
      ...grouped('Community & belonging', [
        f(yesno('hasMentor', 'Do you have a mentor or guide you look up to?')),
        f(
          longText(
            'admireWho',
            'Someone you admire — and what it is about them',
            'A person you look up to.',
          ),
        ),
        f(
          single('neighborConnection', 'How connected do you feel to the people near you?', [
            'Very connected',
            'Somewhat',
            'Barely',
            'Not at all',
            'I’d like to be more',
            'Prefer not to say',
          ]),
        ),
        f(
          slider(
            'belonging',
            'How much do you feel part of something bigger than yourself?',
            'Not at all',
            'Somewhat',
            'Deeply',
          ),
        ),
        f(
          multi('communitySources', 'Where do you find a sense of community?', [
            'Family',
            'Friends',
            'Work',
            'Faith or spiritual group',
            'Hobbies or clubs',
            'Neighbourhood',
            'Online communities',
            'Nowhere right now',
            'Other',
          ]),
        ),
        f(
          shortText('belongingWish', 'A community or group you wish you were part of', 'Optional.'),
        ),
      ]),
    ],
  },
  {
    id: 'work-money',
    title: 'Work & money',
    blurb: 'What you do, what you’re building, and how money sits with you.',
    tier: 'invited',
    mode: 'form',
    restricted: false,
    adult: false,
    opener: 'Your work, your ambitions, and your relationship with money.',
    focus:
      'Their working life and finances — what they do, how they feel about it, their ambitions and ' +
      'work–life balance, money mindset and worries, financial goals, and how money was modeled growing up. ' +
      'Money can be sensitive — let them set the depth and never push.',
    questions: [
      ...grouped('Your work', [
        f(
          single('employmentStatus', 'Your work situation', [
            'Employed full-time',
            'Employed part-time',
            'Self-employed',
            'Business owner',
            'Student',
            'Unemployed',
            'Retired',
            'Full-time caregiver',
            'Other',
          ]),
        ),
        f(shortText('industry', 'Your field or industry', 'e.g. healthcare, tech, education')),
        f(
          shortText(
            'roleSummary',
            'What you actually do day-to-day',
            'e.g. I manage a small team and…',
          ),
        ),
        f(
          slider(
            'workEnjoy',
            'How much do you enjoy your work?',
            'Not at all',
            "It's fine",
            'Love it',
          ),
        ),
        f(
          single('workMeaning', 'Work is mostly…', [
            'A calling',
            'A career I care about',
            'A paycheck',
            'A means to an end',
            'Still figuring it out',
          ]),
        ),
        f(slider('workStress', 'How stressful is your work?', 'Calm', 'Moderate', 'Intense')),
      ]),
      ...grouped('Ambition', [
        f(
          longText(
            'careerGoal',
            'Where you want your work or career to go',
            'Next step or big picture.',
          ),
        ),
        f(shortText('dreamJob', 'Your dream job or venture', 'e.g. run my own studio')),
        f(
          slider(
            'ambition',
            'How ambitious do you feel right now?',
            'Content as I am',
            'Steady',
            'Driven',
          ),
        ),
        f(
          slider(
            'workLifeBalance',
            'Your work–life balance',
            'Out of balance',
            'Getting by',
            'Healthy',
          ),
        ),
        f(
          longText(
            'proudWork',
            'Something you’ve built or achieved',
            'A project, a win, something you made.',
          ),
        ),
      ]),
      ...grouped('Money', [
        f(
          single('moneySituation', 'How would you describe your finances?', [
            'Comfortable',
            'Getting by',
            'Stretched',
            'Struggling',
            'Prefer not to say',
          ]),
        ),
        f(single('moneyStyle', 'You’re more of a…', ['Saver', 'Spender', 'Somewhere in between'])),
        f(
          slider(
            'moneyWorry',
            'How much does money worry you?',
            'Not at all',
            'Some',
            'A great deal',
          ),
        ),
        f(
          single('moneyMeaning', 'Money mostly means…', [
            'Security',
            'Freedom',
            'Status',
            'Stress',
            'Options',
            'Not much to me',
          ]),
        ),
        f(
          single('debt', 'Debt — where are you?', [
            'None',
            'Manageable',
            'A burden',
            'Prefer not to say',
          ]),
        ),
        f(
          longText(
            'financialGoal',
            'A money goal you’re working toward',
            'e.g. save for a home, clear debt, retire early',
          ),
        ),
        f(
          longText(
            'moneyUpbringing',
            'How money was handled growing up — and how that shaped you',
            'Tight, comfortable, never discussed…',
          ),
        ),
      ]),
      ...grouped('Your career path', [
        f(
          single('careerOrigin', 'How did you end up in the work you do?', [
            'Followed a clear plan',
            'Fell into it by chance',
            'Followed family footsteps',
            'Pivoted from something else',
            'Built it myself',
            'Still figuring it out',
            'Other',
          ]),
        ),
        f(yesno('consideredCareerSwitch', 'Are you currently thinking about changing careers?')),
        f(longText('careerRegret', 'A career path you wish you’d taken', 'A road not taken.')),
        f(
          single('workArrangement', 'Your work setup', [
            'Fully remote',
            'Fully in-office',
            'Hybrid',
            'On the road / field',
            'No fixed workplace',
            'Other',
          ]),
        ),
        f(
          single('preferredArrangement', 'The setup you’d choose if you could', [
            'Fully remote',
            'Fully in-office',
            'Hybrid',
            'On the road / field',
            'Whatever pays best',
            'Other',
          ]),
        ),
        f(
          single('commute', 'Your typical commute', [
            'No commute',
            'Under 15 min',
            '15–30 min',
            '30–60 min',
            'Over an hour',
            'Varies a lot',
          ]),
        ),
      ]),
      ...grouped('At work day-to-day', [
        f(
          single('hoursWorked', 'Hours you usually work per week', [
            'Under 20',
            '20–35',
            '35–45',
            '45–55',
            '60+',
            'Hard to say',
          ]),
        ),
        f(
          slider(
            'workPace',
            'How does the pace of your work feel?',
            'Too slow',
            'About right',
            'Too frantic',
          ),
        ),
        f(
          slider(
            'managerRelationship',
            'Your relationship with your manager or boss',
            'Strained',
            'Okay',
            'Excellent',
          ),
        ),
        f(
          slider(
            'coworkerConnection',
            'How connected do you feel to coworkers?',
            'Isolated',
            'Friendly',
            'Close-knit',
          ),
        ),
        f(
          multi('workFrustrations', 'What drains you most at work?', [
            'Meetings',
            'Office politics',
            'Unclear expectations',
            'Workload',
            'Difficult people',
            'Boredom',
            'Commute',
            'Nothing much',
            'Other',
          ]),
        ),
        f(
          longText(
            'idealWorkday',
            'Your ideal workday, start to finish',
            'When everything clicks.',
          ),
        ),
      ]),
      ...grouped('Growth & purpose', [
        f(
          multi('strengthsAtWork', 'What are you genuinely good at?', [
            'Leading people',
            'Solving problems',
            'Creativity',
            'Organization',
            'Communication',
            'Technical skills',
            'Building relationships',
            'Other',
          ]),
        ),
        f(longText('skillsToGrow', 'Skills you most want to develop', 'Where you want to grow.')),
        f(
          slider(
            'feelRecognized',
            'How recognized do you feel for your work?',
            'Overlooked',
            'Sometimes',
            'Well appreciated',
          ),
        ),
        f(
          slider(
            'feelImpact',
            'How much does your work make a difference?',
            'Very little',
            'Some',
            'A great deal',
          ),
        ),
        f(yesno('hasSideProjects', 'Do you have side projects outside your main work?')),
        f(
          slider(
            'entrepreneurialDrive',
            'How strong is your pull to build something of your own?',
            'None',
            'A little',
            'Very strong',
          ),
        ),
        f(
          single('retirementVision', 'When you picture life after work…', [
            'Travel and adventure',
            'Rest and simplicity',
            'Time with loved ones',
            'New projects / encore career',
            'I’d never fully stop',
            'Haven’t thought about it',
            'Other',
          ]),
        ),
        f(
          longText(
            'workLegacy',
            'What you hope your work adds up to over a lifetime',
            'The mark you want to leave.',
          ),
        ),
      ]),
      ...grouped('Money mindset', [
        f(
          single('budgetingHabit', 'How do you handle budgeting?', [
            'A detailed budget I track',
            'A loose mental budget',
            'I wing it',
            'Someone else handles it',
            'Prefer not to say',
          ]),
        ),
        f(
          slider(
            'financialConfidence',
            'How confident do you feel managing money?',
            'Lost',
            'Getting there',
            'Very confident',
          ),
        ),
        f(
          slider(
            'financialLiteracy',
            'How well do you understand finances and investing?',
            'Beginner',
            'Comfortable',
            'Expert',
          ),
        ),
        f(
          multi('spendingTriggers', 'What tends to make you spend more?', [
            'Stress',
            'Celebration',
            'Boredom',
            'Social pressure',
            'Sales and deals',
            'Feeling down',
            'Nothing in particular',
            'Prefer not to say',
            'Other',
          ]),
        ),
        f(
          single('savingHabit', 'Your saving style', [
            'Save automatically',
            'Save what’s left over',
            'Struggle to save',
            'Don’t save right now',
            'Prefer not to say',
          ]),
        ),
        f(
          longText(
            'financialRegret',
            'A money decision you wish you could redo',
            'Optional — only if you want to.',
          ),
        ),
        f(
          single('moneyTaboo', 'How openly do you talk about money?', [
            'Very openly',
            'With a few trusted people',
            'Rarely',
            'It’s off-limits',
            'Prefer not to say',
          ]),
        ),
      ]),
      ...grouped('Your finances', [
        f(yesno('hasInvestments', 'Do you invest (stocks, retirement, property, etc.)?')),
        f(
          single('retirementReadiness', 'How prepared do you feel for retirement?', [
            'Well on track',
            'Making progress',
            'Just starting',
            'Behind where I want to be',
            'Haven’t begun',
            'Prefer not to say',
          ]),
        ),
        f(
          single('bigFinancialGoal', 'Your biggest financial goal right now', [
            'Buy a home',
            'Pay off debt',
            'Build savings',
            'Start a business',
            'Fund education',
            'Retire comfortably',
            'Prefer not to say',
            'Other',
          ]),
        ),
        f(
          slider(
            'generosity',
            'How important is giving or generosity to you?',
            'Not a focus',
            'Fairly important',
            'Central to me',
          ),
        ),
        f(
          slider(
            'moneyAndRelationships',
            'How much does money create tension in close relationships?',
            'Never',
            'Sometimes',
            'Often',
          ),
        ),
        f(
          longText(
            'financialDream',
            'If money were no object, what would you do differently?',
            'Optional — dream a little.',
          ),
        ),
      ]),
    ],
  },
  {
    id: 'joy-play',
    title: 'Joy & play',
    blurb: 'What lights you up — fun, hobbies, and the things that make you, you.',
    tier: 'invited',
    mode: 'form',
    restricted: false,
    adult: false,
    opener: 'The lighter side — what you love, just because you love it.',
    focus:
      'What brings them joy and energy — passions, hobbies, creativity, play, what they’re curious about, ' +
      'how they have fun alone and with others, and what’s on their wishlist. Keep it light and warm.',
    questions: [
      ...grouped('What you love', [
        f(
          multi('passions', 'What are you into?', [
            'Music',
            'Sports',
            'Gaming',
            'Reading',
            'Cooking',
            'Art & making',
            'Photography',
            'Film & TV',
            'Travel',
            'Fitness',
            'Nature & outdoors',
            'Fashion',
            'Tech',
            'Cars',
            'Collecting',
            'Dancing',
            'Writing',
            'Other',
          ]),
          { field: 'interests', list: true },
        ),
        f(
          shortText(
            'currentObsession',
            'Something you’re a bit obsessed with right now',
            'A show, a hobby, a rabbit hole…',
          ),
        ),
        f(
          shortText(
            'talkForHours',
            'A topic you could talk about for hours',
            'e.g. film, football, philosophy',
          ),
        ),
        f(
          shortText(
            'creativeOutlet',
            'A creative outlet you have (or wish you had)',
            'e.g. painting, music, writing',
          ),
        ),
      ]),
      ...grouped('Fun & play', [
        f(longText('idealWeekend', 'Your ideal weekend', 'From Friday night to Sunday.')),
        f(shortText('funAlone', 'What you love doing alone', 'e.g. reading, long walks, gaming')),
        f(
          shortText(
            'funWithOthers',
            'What you love doing with people',
            'e.g. dinners, hikes, board games',
          ),
        ),
        f(slider('playfulness', 'How playful are you?', 'Serious', 'In between', 'Goofy')),
        f(
          shortText(
            'makesYouLaugh',
            'What reliably makes you laugh',
            'A person, a show, a kind of humor…',
          ),
        ),
      ]),
      ...grouped('Wonder & wishlist', [
        f(shortText('travelDream', 'A place you’re dying to visit', 'e.g. Japan, Patagonia')),
        f(
          longText(
            'bucketList',
            'Something on your bucket list',
            'Something you’d love to do once.',
          ),
        ),
        f(
          shortText(
            'newToTry',
            'Something new you want to try',
            'e.g. surfing, pottery, a language',
          ),
        ),
        f(
          shortText(
            'comfortThing',
            'Your comfort movie, show, album, or book',
            'The one you always return to.',
          ),
        ),
        f(
          shortText(
            'flowActivity',
            'An activity that puts you in “flow”',
            'When you lose track of time.',
          ),
        ),
        f(
          shortText(
            'childhoodJoy',
            'Something you loved as a kid and miss',
            'e.g. building forts, drawing',
          ),
        ),
      ]),
      ...grouped('What you watch & listen to', [
        f(
          multi('musicGenres', 'Music genres you reach for most', [
            'Pop',
            'Rock',
            'Hip-hop / Rap',
            'Electronic / Dance',
            'Jazz / Blues',
            'Classical',
            'Country / Folk',
            'R&B / Soul',
            'Metal / Punk',
            'Other',
          ]),
        ),
        f(
          multi('filmGenres', 'Films and shows that pull you in', [
            'Comedy',
            'Drama',
            'Sci-fi / Fantasy',
            'Thriller / Mystery',
            'Horror',
            'Romance',
            'Documentary',
            'Action / Adventure',
            'Animation',
            'Other',
          ]),
        ),
        f(
          shortText(
            'comfortRewatch',
            'A film or show you happily rewatch',
            'The one that always feels like home.',
          ),
        ),
        f(
          shortText('favoritePodcast', 'A podcast or two you never miss', 'What do you tune into?'),
        ),
        f(
          longText(
            'lastGreatRead',
            'The last book that really stuck with you',
            'Tell me a little about it.',
          ),
        ),
        f(
          shortText(
            'concertMemory',
            'A concert or festival you still think about',
            'Who, where, when.',
          ),
        ),
      ]),
      ...grouped('Hobbies & making', [
        f(
          longText(
            'hobbyGoPro',
            'A hobby you’d go pro at if you could',
            'The thing you secretly love doing.',
          ),
        ),
        f(
          multi('handsOnHobbies', 'Hands-on things you enjoy', [
            'Cooking / baking',
            'Gardening',
            'Crafts / DIY',
            'Painting / drawing',
            'Knitting / sewing',
            'Woodworking / building',
            'Photography',
            'Music / instruments',
            'Other',
          ]),
        ),
        f(yesno('collectsThings', 'Do you collect anything?')),
        f(
          shortText(
            'collectionDetails',
            'What’s in your collection?',
            'Records, plants, mugs, stamps…',
          ),
        ),
        f(
          multi('sportsYouPlay', 'Sports or movement you enjoy playing', [
            'Running / walking',
            'Cycling',
            'Swimming',
            'Team sports',
            'Racket sports',
            'Yoga / pilates',
            'Climbing / hiking',
            'Weights / gym',
            'Other',
          ]),
        ),
        f(
          shortText('sportsYouWatch', 'Sports or teams you love to watch', 'Who do you cheer for?'),
        ),
      ]),
      ...grouped('Travel & adventure', [
        f(
          longText(
            'bestTripEver',
            'The best trip you’ve ever taken',
            'Where did you go, and what made it special?',
          ),
        ),
        f(
          single('travelStyle', 'Your travel style', [
            'Plan every detail',
            'Loose plan, go with the flow',
            'Totally spontaneous',
            'Relax and recharge',
            'Pack it full of activity',
            'Other',
          ]),
        ),
        f(
          single('soloOrGroup', 'Solo or with others?', [
            'Solo — my own pace',
            'With a partner',
            'A small group of friends',
            'Big group / family',
            'Depends on the trip',
            'Other',
          ]),
        ),
        f(
          slider(
            'adventurousness',
            'How adventurous are you when you travel?',
            'Comfort and familiarity',
            'A bit of both',
            'Throw me in the deep end',
          ),
        ),
        f(
          shortText(
            'nextAdventure',
            'A small adventure you’d love to do soon',
            'Near or far, big or tiny.',
          ),
        ),
      ]),
      ...grouped('Curiosity & learning', [
        f(
          shortText(
            'learningNow',
            'Something you’re learning or improving lately',
            'A skill, topic, anything.',
          ),
        ),
        f(
          longText(
            'classYoudTake',
            'A class you’d love to take, just for the love of it',
            'No grades, just curiosity.',
          ),
        ),
        f(
          shortText(
            'googleAt2am',
            'The kind of thing you Google at 2am',
            'Those late-night rabbit holes.',
          ),
        ),
        f(
          multi('curiosityTopics', 'Topics that make you instantly curious', [
            'Science / space',
            'History',
            'Psychology / people',
            'Art / design',
            'Technology',
            'Nature / animals',
            'Philosophy / big questions',
            'Food / cooking',
            'Other',
          ]),
        ),
        f(
          single('learningStyle', 'How you most love to learn something new', [
            'Hands-on / trying it',
            'Reading deeply',
            'Videos / documentaries',
            'Talking it through',
            'Taking a class',
            'Other',
          ]),
        ),
      ]),
      ...grouped('Your happy place', [
        f(
          shortText(
            'whatRelaxesYou',
            'What genuinely relaxes you after a long day',
            'Your go-to for unwinding.',
          ),
        ),
        f(
          shortText('guiltyPleasure', 'A guilty pleasure you happily indulge', 'No judgment here.'),
        ),
        f(
          longText(
            'nostalgiaHit',
            'What reliably hits you with happy nostalgia',
            'A song, smell, place, snack…',
          ),
        ),
        f(
          single('idealCelebration', 'Your ideal way to celebrate something good', [
            'A big party with everyone',
            'Dinner with a few favourites',
            'A quiet treat to myself',
            'A trip or experience',
            'Something silly and spontaneous',
            'Other',
          ]),
        ),
        f(
          multi('simplePleasures', 'Simple pleasures that make your day better', [
            'Morning coffee or tea',
            'A good nap',
            'Fresh air / a walk',
            'A great meal',
            'Music',
            'Time with a pet',
            'A clean, cozy space',
            'Sunshine',
            'Other',
          ]),
        ),
        f(
          slider(
            'savorsLittleThings',
            'How easily do you savour the little things?',
            'Often rushing past them',
            'Sometimes',
            'I really soak them in',
          ),
        ),
      ]),
    ],
  },
  {
    id: 'family',
    title: 'Family & upbringing',
    blurb: 'Where you come from — family, how you were raised, what you carry.',
    tier: 'invited',
    mode: 'form',
    restricted: false,
    adult: false,
    opener: 'A little about where you come from. Share what feels right, and skip anything.',
    // Kept for the section-level "Tell me more →" chat, which goes deeper than the structured prompts.
    focus:
      'Their family of origin and upbringing — who raised them, siblings and birth order, closeness with each ' +
      'parent/caregiver, how affection and conflict were handled, family faith and culture, family wounds and ' +
      'gifts, any family mental-health or addiction history (gently), the patterns they inherited, their ' +
      'relationship with family now, chosen family, and (if a parent) what they do the same or differently. ' +
      'Cover these specifically but let them set the depth; never push.',
    questions: [
      ...grouped('Where you come from', [
        f(
          single('raisedBy', 'Who mainly raised you?', [
            'Both parents',
            'Mostly my mother',
            'Mostly my father',
            'Grandparents',
            'Other family',
            'Adoptive parents',
            'Foster or care system',
            'Other',
          ]),
        ),
        f(
          single('siblings', 'Where do you fall among siblings?', [
            'Only child',
            'Oldest',
            'Middle',
            'Youngest',
            'Twin or multiple',
            'Other',
          ]),
        ),
        f(
          shortText(
            'familyCulture',
            'Your family’s faith or culture growing up',
            'e.g. big Catholic family, secular, two cultures at home',
          ),
        ),
      ]),
      ...grouped('How your family worked', [
        f(
          slider(
            'closenessMother',
            'Closeness with your mother (or mother figure)',
            'Distant',
            'Somewhat close',
            'Very close',
          ),
        ),
        f(
          slider(
            'closenessFather',
            'Closeness with your father (or father figure)',
            'Distant',
            'Somewhat close',
            'Very close',
          ),
        ),
        f(
          single('affectionShown', 'How was affection shown in your family?', [
            'Openly and often',
            'Through actions, not words',
            'Rarely',
            'It was complicated',
          ]),
        ),
        f(
          single('conflictHandled', 'How was conflict handled growing up?', [
            'Talked through calmly',
            'Avoided or swept aside',
            'Loud or explosive',
            'It varied a lot',
          ]),
        ),
        f(yesno('familyHistory', 'Any family history of mental-health or addiction struggles?')),
      ]),
      ...grouped('More about your family', [
        f(
          shortText(
            'parentsWork',
            'What your parents (or carers) did for work',
            'e.g. teacher, factory worker',
          ),
        ),
        f(
          single('movedAround', 'Did you move around growing up?', [
            'Stayed in one place',
            'Moved sometimes',
            'Moved a lot',
          ]),
        ),
        f(
          single('childhoodVibe', 'Your childhood home mostly felt…', [
            'Warm',
            'Tense',
            'Chaotic',
            'Strict',
            'Loving but hard',
            'Mixed',
          ]),
        ),
        f(
          single('familyMoney', 'How was money handled / talked about?', [
            'Openly',
            'A source of stress',
            'Never discussed',
            'We had little',
            'We were comfortable',
          ]),
        ),
        f(
          single('discipline', 'How strict was your upbringing?', [
            'Very strict',
            'Balanced',
            'Relaxed',
            'Inconsistent',
          ]),
        ),
        f(
          shortText(
            'closestGrowingUp',
            'Who were you closest to growing up?',
            'e.g. my mom, my older brother',
          ),
        ),
      ]),
      ...grouped('What you carry', [
        f(
          longText(
            'favoriteMemory',
            'A favorite memory from growing up',
            'A moment that still makes you smile.',
          ),
        ),
        f(
          longText(
            'hardMemory',
            'A harder memory from growing up',
            'Only if you want to — skip anytime.',
          ),
        ),
        f(
          longText(
            'familyTradition',
            'A family tradition you treasure (or wish you’d had)',
            'e.g. Sunday dinners, holiday rituals',
          ),
        ),
        f(shortText('shapedBy', 'A family member who shaped who you are', 'e.g. my grandmother')),
        f(longText('wishDifferent', 'What you wish had been different', 'Optional.')),
        f(
          longText(
            'familyCarry',
            'What did you take from your upbringing — the gifts and the wounds?',
            'What shaped you, for better and worse.',
          ),
        ),
        f(
          longText(
            'parentingNow',
            'If you’re a parent: same or different from how you were raised?',
            'What you keep, and what you do differently.',
          ),
        ),
      ]),
      ...grouped('Your parents', [
        f(
          single(
            'motherPersonality',
            'How would you describe your mother (or the woman who raised you)?',
            [
              'Warm and nurturing',
              'Strong and capable',
              'Quiet and steady',
              'Anxious or worried',
              'Strict',
              'Distant',
              'Complicated',
              'Other',
            ],
          ),
        ),
        f(
          single(
            'fatherPersonality',
            'How would you describe your father (or the man who raised you)?',
            [
              'Warm and present',
              'A hard-working provider',
              'Quiet',
              'Strict',
              'Playful',
              'Distant',
              'Complicated',
              'Other',
            ],
          ),
        ),
        f(
          single('relationshipWithMotherNow', 'Your relationship with your mother these days', [
            'Close',
            'Good, with some distance',
            'Up and down',
            'Strained',
            'We don’t speak',
            'She’s passed away',
            'Other',
            'Prefer not to say',
          ]),
        ),
        f(
          single('relationshipWithFatherNow', 'Your relationship with your father these days', [
            'Close',
            'Good, with some distance',
            'Up and down',
            'Strained',
            'We don’t speak',
            'He’s passed away',
            'Other',
            'Prefer not to say',
          ]),
        ),
        f(
          shortText(
            'inheritedFromMother',
            'Something you inherited from your mother',
            'e.g. her stubbornness, her kindness.',
          ),
        ),
        f(
          shortText(
            'inheritedFromFather',
            'Something you inherited from your father',
            'A temper, a work ethic, a sense of humour.',
          ),
        ),
        f(
          single(
            'parentsRelationship',
            'Growing up, your parents’ relationship with each other was…',
            [
              'Loving and close',
              'Steady but not very affectionate',
              'Tense',
              'Often in conflict',
              'They separated / divorced',
              'One raised me alone',
              'Other',
              'Prefer not to say',
            ],
          ),
        ),
        f(
          shortText(
            'stepParentExperience',
            'If you had a step-parent or a parent’s partner around, how was that?',
            'Gentle and optional — leave blank if it doesn’t apply.',
          ),
        ),
      ]),
      ...grouped('Siblings & extended family', [
        f(
          slider(
            'siblingCloseness',
            'How close are you with your sibling(s) now?',
            'Not close',
            'Fairly close',
            'Very close',
          ),
        ),
        f(
          single('siblingDynamic', 'Growing up, the dynamic with your sibling(s) was…', [
            'Best friends',
            'Friendly rivals',
            'Lots of rivalry',
            'We looked out for each other',
            'We kept our distance',
            'Doesn’t apply',
            'Other',
          ]),
        ),
        f(
          shortText(
            'grandparentMemory',
            'A grandparent who left a mark on you — what were they like?',
            'Only if you want to share.',
          ),
        ),
        f(
          yesno(
            'grewUpNearExtended',
            'Did you grow up near extended family (grandparents, cousins, aunts and uncles)?',
          ),
        ),
      ]),
      ...grouped('Heritage & roots', [
        f(
          shortText(
            'familyOrigins',
            'Where is your family originally from?',
            'Countries, regions, towns — as far back as you know.',
          ),
        ),
        f(
          single('religionInFamily', 'Religion or faith in your family growing up was…', [
            'Central to family life',
            'Present but relaxed',
            'Cultural more than religious',
            'Not really a factor',
            'A source of tension',
            'Other',
            'Prefer not to say',
          ]),
        ),
        f(
          longText(
            'familyStories',
            'A family story, legend, or bit of folklore that got passed down',
            'The one that always gets told.',
          ),
        ),
        f(
          shortText(
            'immigrationStory',
            'Any immigration or migration story in your family',
            'Who moved, from where, and why — if you know.',
          ),
        ),
        f(
          slider(
            'connectionToHeritage',
            'How connected do you feel to your heritage and roots?',
            'Not connected',
            'Somewhat',
            'Deeply connected',
          ),
        ),
      ]),
      ...grouped('Family patterns', [
        f(
          single('roleGrowingUp', 'The role you tended to play in your family growing up', [
            'The responsible one',
            'The peacemaker',
            'The caretaker',
            'The quiet one',
            'The rebel',
            'The funny one',
            'The achiever',
            'Other',
          ]),
        ),
        f(
          shortText(
            'familySaying',
            'A family motto or saying you heard a lot',
            'e.g. “We don’t quit”, “family first”.',
          ),
        ),
        f(
          longText(
            'passedDownValues',
            'What gets passed down in your family — values, ways of doing things, expectations',
            'The unspoken rules as much as the spoken ones.',
          ),
        ),
        f(
          shortText(
            'patternToBreak',
            'A family pattern you’d gently like to break',
            'Only if you want to — no need to go deep.',
          ),
        ),
        f(
          single('howEmotionsHandled', 'Growing up, feelings were handled by…', [
            'Talking openly',
            'Keeping them private',
            'Expressing them loudly',
            'Avoiding them',
            'It varied',
            'Other',
            'Prefer not to say',
          ]),
        ),
      ]),
      ...grouped('Family now', [
        f(
          single('familyNow', 'Your relationship with your family now', [
            'Close',
            'Friendly but distant',
            'Complicated',
            'Estranged',
            'It varies',
          ]),
        ),
        f(
          single(
            'inLawRelationship',
            'If you have a partner, your relationship with their family is…',
            [
              'Close',
              'Friendly',
              'Cordial but distant',
              'Complicated',
              'Doesn’t apply',
              'Other',
              'Prefer not to say',
            ],
          ),
        ),
        f(yesno('hasChosenFamily', 'Do you have “chosen family” — friends who feel like family?')),
        f(
          single('holidaysNow', 'Family holidays and gatherings these days feel…', [
            'Like something I look forward to',
            'Mixed — good and hard',
            'More obligation than joy',
            'Best kept small',
            'Like something I’ve stepped back from',
            'Other',
            'Prefer not to say',
          ]),
        ),
        f(
          longText(
            'familyNowDescribe',
            'Who makes up your family today, and what’s it like?',
            'Partner, kids, parents, friends — whoever counts for you.',
          ),
        ),
      ]),
    ],
  },
  {
    id: 'story',
    title: 'Your story',
    blurb: 'The chapters that shaped you — turning points and what you carry from them.',
    tier: 'invited',
    mode: 'form',
    restricted: false,
    adult: false,
    opener: 'A few prompts about the chapters that shaped you. Take any, skip any.',
    // Kept for the section-level "Tell me more →" chat, which goes deeper than the structured prompts.
    focus:
      'The key chapters of their life — formative experiences, turning points, their proudest achievement, ' +
      'their lowest moments, a moment that changed everything, biggest regrets, defining relationships, their ' +
      'biggest failure and what it taught them, what they have survived, how they have changed, and who they ' +
      'are becoming. Held as the person chooses to share.',
    questions: [
      ...grouped('Your chapters', [
        f(
          shortText('childhoodWord', 'Your childhood in one word', 'e.g. happy, chaotic, carefree'),
        ),
        f(
          longText(
            'chapters',
            'If your life so far were a few chapters, what would they be?',
            'Name the chapters, however you see them.',
          ),
        ),
        f(
          longText(
            'decadeMoments',
            'A defining moment from each decade of your life',
            'One that stands out for each.',
          ),
        ),
        f(longText('happiest', 'Your happiest chapter so far', 'A time you’d return to.')),
        f(longText('hardest', 'A hard time you came through', 'Only what you want to share.')),
      ]),
      ...grouped('Moments that mattered', [
        f(
          longText(
            'turningPoint',
            'A turning point that changed your direction',
            'A moment or decision that shifted things.',
          ),
        ),
        f(
          longText(
            'bravest',
            'The bravest thing you’ve ever done',
            'A moment you pushed through fear.',
          ),
        ),
        f(
          longText(
            'bestDecision',
            'The best decision you ever made',
            'A choice you’re glad you made.',
          ),
        ),
        f(longText('regret', 'A decision you regret', 'Only what you want to share.')),
        f(
          longText(
            'riskTaken',
            'A risk you took — and how it turned out',
            'What you risked, and how it turned out.',
          ),
        ),
        f(
          longText(
            'proudest',
            'Something you’re proud of',
            'An achievement or a moment you stood by yourself.',
          ),
        ),
      ]),
      ...grouped('People & places', [
        f(
          shortText(
            'personChanged',
            'A person who changed your life',
            'e.g. a mentor, a partner, a friend',
          ),
        ),
        f(
          shortText(
            'placeMatters',
            'A place that means a lot to you',
            'e.g. my grandparents’ house',
          ),
        ),
      ]),
      ...grouped('How you’ve grown', [
        f(longText('overcome', 'Something you’ve overcome', 'Something you got through.')),
        f(longText('reinvented', 'A time you reinvented yourself', 'A fresh start you made.')),
        f(longText('letGo', 'A dream you let go of', 'And how you feel about it now.')),
        f(
          longText(
            'changedMind',
            'A belief you’ve changed your mind about',
            'Something you see differently now.',
          ),
        ),
        f(
          shortText(
            'lifeLesson',
            'The biggest lesson life has taught you',
            'In a sentence, if you can.',
          ),
        ),
        f(
          longText(
            'youngerSelf',
            'What would you tell your younger self?',
            'The advice you wish you’d had.',
          ),
        ),
        f(longText('becoming', 'Who are you becoming?', 'Where you feel yourself heading.')),
        f(
          longText(
            'storyBecome',
            'What do you want the rest of your story to be?',
            'The next chapter, as you’d write it.',
          ),
        ),
      ]),
      ...grouped('Childhood', [
        f(
          longText(
            'earliestMemory',
            'The earliest memory you can reach back to',
            'A flash of light, a smell, a feeling — however small.',
          ),
        ),
        f(
          longText(
            'childhoodHome',
            'The home you grew up in — the rooms, the sounds, the feeling of being there',
            'Take me inside the front door.',
          ),
        ),
        f(
          single('schoolYearsFelt', 'When you think back on your school years…', [
            'Warmth and friendship',
            'Boredom or restlessness',
            'Pressure to perform',
            'Feeling out of place',
            'A mix of everything',
            'Other',
          ]),
        ),
        f(
          longText(
            'teacherWhoMattered',
            'A teacher or grown-up who saw something in you',
            'What did they notice, and what did it change?',
          ),
        ),
        f(
          shortText(
            'wantedToBe',
            'What you wanted to be when you grew up',
            'The very first answer you ever gave.',
          ),
        ),
      ]),
      ...grouped('Coming of age', [
        f(
          longText(
            'teenageYears',
            'What your teenage years were like',
            'The friends, the fears, the music.',
          ),
        ),
        f(
          longText(
            'firstLove',
            'Your first real experience of love — romantic or otherwise',
            'What it felt like, and what it taught you.',
          ),
        ),
        f(
          longText(
            'leavingHome',
            'What it was like to leave home — or to first feel your life was your own',
            'The leaving, or the longing to leave.',
          ),
        ),
        f(
          slider(
            'twentiesIntensity',
            'How turbulent were your twenties?',
            'Steady and settled',
            'Ups and downs',
            'Wild and uncertain',
          ),
        ),
        f(
          longText(
            'findingYourself',
            'When you first felt you were becoming yourself',
            'When the outline of “you” started to come clear.',
          ),
        ),
      ]),
      ...grouped('Defining experiences', [
        f(
          longText(
            'ideaThatChangedYou',
            'A book, film, or idea that genuinely changed how you see the world',
            'What it rearranged inside you.',
          ),
        ),
        f(
          longText(
            'tripThatChangedYou',
            'A journey or place that changed you',
            'Where you went, and who you were when you came back.',
          ),
        ),
        f(
          longText(
            'mentorFigure',
            'A mentor or guide in your life',
            'What they gave you that you still carry.',
          ),
        ),
        f(
          longText(
            'comebackFromLow',
            'A time you climbed back up from a low point',
            'How far down it went, and what brought you back.',
          ),
        ),
        f(
          longText(
            'crossroads',
            'A crossroads where your life could have taken another path',
            'The road taken, and the one you sometimes wonder about.',
          ),
        ),
      ]),
      ...grouped('How you’ve changed', [
        f(
          longText(
            'stayedConstant',
            'Through all the change, what has stayed constant about you',
            'The thread through every version of you.',
          ),
        ),
        f(
          longText(
            'maskWorn',
            'A mask you’ve worn — a face you show that isn’t quite the real one',
            'Take your time; this one can be tender.',
          ),
        ),
        f(
          longText(
            'reputationVsReality',
            'How people tend to see you — and where that differs from who you really are',
            'Your reputation on one hand, your reality on the other.',
          ),
        ),
        f(
          single('changedMostBy', 'What has changed you the most over the years?', [
            'Love and relationships',
            'Loss and grief',
            'Work and ambition',
            'Becoming a parent',
            'Hardship I survived',
            'Quiet, gradual growth',
            'Other',
          ]),
        ),
      ]),
      ...grouped('Legacy & meaning', [
        f(
          longText(
            'wantToLeaveBehind',
            'What you want to leave behind',
            'Not possessions — the mark, the feeling, the thing that outlasts you.',
          ),
        ),
        f(
          shortText(
            'epitaph',
            'The few words you’d put on your own headstone',
            'A line that sums up the whole of you.',
          ),
        ),
        f(
          longText(
            'lessonForNextGeneration',
            'One lesson you’d pass to those who come after you',
            'Something it took you a lifetime to learn.',
          ),
        ),
        f(
          longText(
            'mostGrateful',
            'Looking back over your whole story, what you’re most grateful for',
            'The thing you’d least want to have missed.',
          ),
        ),
        f(
          longText(
            'unfinishedBusiness',
            'What feels unfinished in your story',
            'A dream, a mend, a beginning you haven’t made yet.',
          ),
        ),
      ]),
    ],
  },
  {
    id: 'weighs',
    title: 'What weighs on you',
    blurb: 'The heavier things — struggles, grief, or patterns you feel stuck in.',
    tier: 'invited',
    mode: 'form',
    restricted: true,
    adult: false,
    opener:
      'Only if you want to — a few gentle prompts about the heavier things. Every one is skippable, and this stays private to your own coaching.',
    contentNote:
      'We can go as light or as deep as you want, and skip anything. This stays private to your own coaching. If you’re ever in crisis, please reach out to the resources below — I’m not a substitute for real help.',
    // Kept for the section-level "Tell me more →" chat — trauma-informed, lets the person set the depth.
    focus:
      'The heavier parts of their inner life — current stressors, grief and loss, recurring worries, what keeps ' +
      'them up at night, their inner critic / self-talk, coping mechanisms (healthy and not), shame, things ' +
      'they don’t tell anyone, what they’re avoiding dealing with, and (gently, only if they offer) past ' +
      'trauma. Trauma-informed: let them set the depth, validate whatever they share, never dig for specifics. ' +
      'Watch for crisis and route to professional help per your safety guidance — never manage it alone.',
    questions: [
      f(
        multi('weighsWhat', 'What’s weighing on you most right now?', [
          'Work',
          'Money',
          'A relationship',
          'Family',
          'Health',
          'Loneliness',
          'Grief or loss',
          'The future',
          'The past',
          'My own thoughts',
          'Nothing much right now',
          'Other',
        ]),
      ),
      f(slider('weighsHeavy', 'How heavy has it felt lately?', 'Light', 'Moderate', 'Heavy')),
      f(
        single('innerCritic', 'How do you talk to yourself when things go wrong?', [
          'Kindly',
          'Pretty harshly',
          'Somewhere in between',
        ]),
      ),
      f(
        longText(
          'recurringWorry',
          'A worry that keeps coming back',
          'Only what you want to put into words.',
        ),
      ),
      f(
        longText(
          'stuckPattern',
          'A pattern you feel stuck in',
          'Something you keep repeating or returning to.',
        ),
      ),
      f(
        longText(
          'weighsGrief',
          'Any grief or loss you’re carrying',
          'Share as little or as much as you like.',
        ),
      ),
      ...grouped('How you’re carrying it', [
        f(
          single('anxietyRelationship', 'Your relationship with anxiety', [
            'Rarely anxious',
            'It comes and goes',
            'A constant companion',
            'Prefer not to say',
          ]),
        ),
        f(
          single('lowMoodRelationship', 'Your relationship with low mood', [
            'Rarely',
            'Sometimes',
            'Often',
            'Prefer not to say',
          ]),
        ),
        f(
          longText(
            'whatKeepsUp',
            'What keeps you up at night?',
            'Only if you want to put it into words.',
          ),
        ),
        f(
          multi('copeOverwhelmed', 'When you’re overwhelmed, you tend to…', [
            'Talk to someone',
            'Withdraw',
            'Keep busy',
            'Shut down',
            'Exercise',
            'Numb out',
            'Push through',
            'Other',
          ]),
        ),
        f(
          longText(
            'avoidingHard',
            'Something you’ve been avoiding dealing with',
            'Only if you want to name it.',
          ),
        ),
        f(longText('fearHoldsBack', 'A fear that holds you back', 'What it stops you from doing.')),
        f(
          longText(
            'guiltShame',
            'Guilt or shame you carry',
            'Only what you want to — this stays private to you.',
          ),
        ),
      ]),
      ...grouped('What helps', [
        f(slider('supported', 'How supported do you feel right now?', 'Alone', 'Somewhat', 'Held')),
        f(
          longText(
            'whatHelps',
            'When things get dark, what helps you?',
            'People, habits, places that ground you.',
          ),
        ),
        f(
          multi('needMore', 'What do you need more of right now?', [
            'Rest',
            'Support',
            'Time',
            'Money',
            'Hope',
            'Connection',
            'Direction',
            'Peace',
            'Other',
          ]),
        ),
        f(
          slider(
            'hopeful',
            'How hopeful are you that things will improve?',
            'Not at all',
            'Cautiously',
            'Very',
          ),
        ),
      ]),
      ...grouped('Stress & burdens', [
        f(
          longText(
            'decisionStuckOn',
            'A decision you feel stuck on right now',
            'Only if you want to — even a few words helps.',
          ),
        ),
        f(
          longText(
            'drainingRelationship',
            'A relationship that tends to drain you these days',
            'You can keep it vague — no need to name anyone.',
          ),
        ),
        f(
          longText(
            'lingeringRegret',
            'A regret that still lingers',
            'Only share what feels okay to put into words.',
          ),
        ),
        f(
          longText(
            'oldWoundTender',
            'An old wound that’s still tender when something touches it',
            'Gently, and only if you want to.',
          ),
        ),
        f(
          single('carryAlone', 'How alone do you feel in what you carry right now?', [
            'Not at all alone',
            'A little alone',
            'Quite alone',
            'Very alone',
            'Prefer not to say',
          ]),
        ),
      ]),
      ...grouped('Your inner world', [
        f(
          multi('selfTalkThemes', 'When your inner voice gets unkind, what does it tend to say?', [
            'I’m not good enough',
            'I’m falling behind',
            'I’m a burden',
            'I should be doing more',
            'I’ll be found out',
            'It’s my fault',
            'Other',
          ]),
        ),
        f(
          longText(
            'hardestOnSelfAbout',
            'What are you hardest on yourself about?',
            'Be as gentle with yourself here as you need.',
          ),
        ),
        f(
          slider(
            'comparisonWeight',
            'How much do you compare your life to others’?',
            'Rarely',
            'Sometimes',
            'Constantly',
          ),
        ),
        f(
          slider(
            'perfectionismPull',
            'How strong is the pull to get things exactly right before you feel okay?',
            'Gentle',
            'Moderate',
            'Very strong',
          ),
        ),
        f(
          longText(
            'imposterFeeling',
            'Do you ever feel you don’t quite belong, or might be “found out”?',
            'Only if it resonates.',
          ),
        ),
      ]),
      ...grouped('Coping & support', [
        f(
          longText(
            'whoKnowsWhatYouCarry',
            'Who, if anyone, truly knows what you carry?',
            'It’s okay if the answer is no one yet.',
          ),
        ),
        f(
          single('asksForHelp', 'When things get hard, how easily can you ask for help?', [
            'Pretty easily',
            'With some effort',
            'It’s really hard',
            'I tend not to',
            'Prefer not to say',
          ]),
        ),
        f(
          longText(
            'whatYouDoToFeelBetter',
            'When you’re struggling, what helps you feel even a little better?',
            'Anything that soothes you, big or small.',
          ),
        ),
        f(
          longText(
            'honestCoping',
            'Ways you cope that you’re not proud of',
            'No judgment here — only share what feels safe.',
          ),
        ),
        f(
          longText(
            'wishPeopleUnderstood',
            'What you wish the people in your life understood about you',
            'As little or as much as you like.',
          ),
        ),
      ]),
      ...grouped('Looking forward', [
        f(
          longText(
            'whatWouldLighten',
            'What would help lighten the load, even a little?',
            'It can be small — small counts.',
          ),
        ),
        f(
          longText(
            'oneSmallStep',
            'One small step that might help',
            'No pressure to act on it — just naming it is enough.',
          ),
        ),
        f(
          longText(
            'whatHopeLooksLike',
            'What hope looks like for you right now, even a quiet version',
            'However hope shows up for you.',
          ),
        ),
        f(
          longText(
            'mightNeedToForgive',
            'Something you might need to forgive — in yourself or someone else',
            'Gently, and only if you’re ready.',
          ),
        ),
        f(
          slider(
            'gentlerWithSelf',
            'How ready do you feel to be a little gentler with yourself?',
            'Not yet',
            'Getting there',
            'Very ready',
          ),
        ),
      ]),
    ],
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
      ...grouped('Orientation & identity', [
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
            'Trans women',
            'Trans men',
            'Everyone',
            'Other',
          ]),
          {
            restricted: true,
          },
        ),
        f(
          single('relationshipStyle', 'Your relationship style', [
            'Monogamous',
            'Open',
            'Polyamorous',
            'Swinging',
            'Exploring',
            'Other',
          ]),
          { field: 'relationshipStyle', private: true },
        ),
        f(
          slider(
            'intimacyImportance',
            'How big a part of life is intimacy for you?',
            'A small part',
            'Important',
            'Huge — central to me',
          ),
          {
            restricted: true,
          },
        ),
        f(
          single('libido', 'Your sex drive', ['Very low', 'Low', 'Moderate', 'High', 'Very high']),
          {
            restricted: true,
          },
        ),
        f(
          shortText(
            'sexualityWord',
            'Describe your sexuality in a word or phrase',
            'e.g. adventurous, shy, passionate',
          ),
          { restricted: true },
        ),
      ]),
      ...grouped('Your sexual story', [
        f(
          single('firstMasturbatedAge', 'How old were you when you first masturbated?', AGE_RANGES),
          {
            restricted: true,
          },
        ),
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
        f(
          longText(
            'discoveredMasturbation',
            'How did you first discover masturbation?',
            'Share as much or as little as you like.',
          ),
          { restricted: true },
        ),
        f(
          longText(
            'firstExperience',
            'Your first sexual experience, in your own words',
            'Who, when, how it felt — only what you want to share.',
          ),
          { restricted: true },
        ),
        f(
          longText(
            'bestExperience',
            'Your best or most memorable experience',
            'What made it so good?',
          ),
          { restricted: true },
        ),
        f(
          longText(
            'embarrassingExperience',
            'Your most awkward or embarrassing moment',
            'We all have one — only if you want to share.',
          ),
          { restricted: true },
        ),
        f(
          longText(
            'sexualRegret',
            'Anything you regret?',
            'No judgment — only if you want to share.',
          ),
          {
            restricted: true,
          },
        ),
        f(
          longText(
            'sexualityEvolved',
            'How has your sexuality changed over time?',
            'e.g. what you’re into now vs. then, how confident you feel.',
          ),
          { restricted: true },
        ),
        f(
          longText(
            'messagesGrowingUp',
            'What messages about sex did you absorb growing up?',
            'From family, faith, culture, friends…',
          ),
          { restricted: true },
        ),
        f(
          longText(
            'sexualShame',
            'Any sexual shame or hang-ups you carry?',
            'Only what you want to — this stays private to you.',
          ),
          { restricted: true },
        ),
      ]),
      ...grouped('Your current partner', [
        f(yesno('hasPartner', 'Do you have a sexual partner right now?'), { restricted: true }),
        f(
          slider(
            'sexSatisfaction',
            'How satisfied are you with your sex life?',
            'Unhappy',
            'It’s okay',
            'Thrilled',
          ),
          { restricted: true },
        ),
        f(
          single('sexFrequency', 'How often are you intimate now?', FREQ, when('hasPartner', true)),
          {
            restricted: true,
          },
        ),
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
        f(
          slider(
            'talkAboutSex',
            'How easily can you talk about sex with them?',
            'Really hard',
            'It’s okay',
            'Totally open',
          ),
          { restricted: true },
        ),
        f(
          single(
            'sharedFantasies',
            'Have you shared your fantasies with them?',
            ['Yes, all of them', 'Some', 'Not yet', 'Not comfortable to'],
            when('hasPartner', true),
          ),
          { restricted: true },
        ),
        f(
          longText(
            'unspokenWant',
            'Something you want but haven’t asked for',
            'What would you ask for if it were easy?',
          ),
          { restricted: true },
        ),
        f(
          longText('sexWorking', 'What’s working well?', 'The stuff you’d keep exactly as it is.'),
          {
            restricted: true,
          },
        ),
        f(
          longText(
            'sexDifferent',
            'What do you wish were different?',
            'More of, less of, something new…',
          ),
          { restricted: true },
        ),
        f(
          {
            ...longText(
              'partnerAttractive',
              'What do you find most attractive about them?',
              'Looks, energy, the way they touch you…',
            ),
            branch: when('hasPartner', true),
          },
          { restricted: true },
        ),
      ]),
      ...grouped('What you like', [
        f(
          multi('turnOns', 'Your turn-ons', [
            'Kissing',
            'Foreplay',
            'Dirty talk',
            'Being teased',
            'Lingerie',
            'Oral',
            'Sensual massage',
            'Confidence',
            'Romance',
            'Spontaneity',
            'Roleplay',
            'Being desired',
            'A partner taking control',
            'Other',
          ]),
          { restricted: true },
        ),
        f(
          multi('turnOffs', 'Your turn-offs', [
            'Bad hygiene',
            'Rushing',
            'Pressure',
            'Lack of confidence',
            'Too rough',
            'Too gentle',
            'Distractions / phones',
            'Silence',
            'Selfishness',
            'Bad breath',
            'Other',
          ]),
          { restricted: true },
        ),
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
            'Other',
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
            'Other',
          ]),
          { restricted: true },
        ),
        f(
          multi('positionsPenetrative', 'Favorite positions — penetrative', [
            'Missionary',
            'Doggy style',
            'Cowgirl / on top',
            'Reverse cowgirl',
            'Spooning',
            'Standing',
            'Legs on shoulders',
            'Edge of the bed',
            'Other',
          ]),
          { restricted: true },
        ),
        f(
          multi('positionsOral', 'Favourite oral — what you’re into', [
            'Giving blowjobs',
            'Going down on a partner',
            'Getting head',
            'Getting eaten out',
            '69',
            'Face-sitting',
            'Other',
          ]),
          { restricted: true },
        ),
        f(
          multi('positionsAnal', 'Favorite positions — anal', [
            'Doggy style',
            'Missionary',
            'On top / riding',
            'Spooning',
            'Not into anal',
            'Other',
          ]),
          { restricted: true },
        ),
        f(
          multi('positionsNonPen', 'Favorite — non-penetrative', [
            'Making out',
            'Grinding / dry humping',
            'Mutual masturbation',
            'Sensual massage',
            'Frottage',
            'Other',
          ]),
          { restricted: true },
        ),
        f(
          single('paceIntensity', 'Preferred pace & intensity', [
            'Slow & sensual',
            'In between',
            'Rough & intense',
            'Other',
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
            'Other',
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
          {
            ...longText(
              'dirtyTalkLikes',
              'Dirty talk — things you love to hear',
              'e.g. praise, being told what to do, descriptions of what they want to do to you…',
            ),
            branch: whenAny('dirtyTalk', ['Love it', 'Sometimes']),
          },
          { restricted: true },
        ),
        f(
          {
            ...longText(
              'dirtyTalkDislikes',
              'Dirty talk — words or talk that turn you off',
              'e.g. certain names or terms that pull you out of the moment',
            ),
            branch: whenAny('dirtyTalk', ['Love it', 'Sometimes']),
          },
          { restricted: true },
        ),
        f(multi('toysOwn', 'Toys you already own', [...TOYS, 'Other', 'None']), {
          restricted: true,
        }),
        f(multi('toysWant', 'Toys you’d like to try', [...TOYS, 'Other', 'None right now']), {
          restricted: true,
        }),
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
        f(
          longText(
            'kinks',
            'Kinks or fetishes, in your own words',
            'e.g. specific scenarios, materials, sensations, dynamics…',
          ),
          {
            restricted: true,
          },
        ),
      ]),
      ...grouped('Acts & specifics', [
        f(yesno('givesOralPenis', 'Do you like giving blowjobs?'), { restricted: true }),
        f(
          single(
            'swallowSpit',
            'When you give a blowjob, do you swallow or spit?',
            ['Swallow', 'Spit', 'Either', 'Depends'],
            when('givesOralPenis', true),
          ),
          { restricted: true },
        ),
        f(
          {
            ...yesno('swallowTurnsOn', 'Does swallowing turn you on?'),
            branch: when('givesOralPenis', true),
          },
          { restricted: true },
        ),
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
            'Other',
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
          { restricted: true },
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
        f(
          slider(
            'roughness',
            'How rough do you like it?',
            'Gentle & slow',
            'A good balance',
            'Rough & hard',
          ),
          { restricted: true },
        ),
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
        f(
          single('squirting', 'Squirting?', ['Into it', 'Curious', 'Not for me', "Doesn't apply"]),
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
            'From the first touch to the end — paint the picture.',
          ),
          { restricted: true },
        ),
      ]),
      ...grouped('Body & preferences', [
        f(
          multi('bodyTypePref', "Body types you're drawn to", [
            'Slim',
            'Athletic',
            'Average',
            'Curvy',
            'Bigger',
            'No preference',
            'Other',
          ]),
          { restricted: true },
        ),
        f(
          single('breastPref', 'Breast size you’re drawn to on a partner', [
            'No preference',
            'Smaller',
            'Average',
            'Larger',
            'Other',
          ]),
          { restricted: true },
        ),
        f(yesno('attractedPenis', 'Are you attracted to partners with a penis?'), {
          restricted: true,
        }),
        f(
          {
            ...slider(
              'penisLengthPref',
              'Penis length you’re drawn to',
              'On the smaller side',
              'Average',
              'Big',
            ),
            branch: when('attractedPenis', true),
          },
          { restricted: true },
        ),
        f(
          {
            ...slider('penisGirthPref', 'Penis girth you like', 'Slim', 'Average', 'Thick'),
            branch: when('attractedPenis', true),
          },
          { restricted: true },
        ),
        f(yesno('attractedVulva', 'Are you attracted to partners with a vulva?'), {
          restricted: true,
        }),
        f(
          single(
            'vulvaLabiaPref',
            'Labia you’re drawn to on a partner',
            [
              'No preference',
              'Neat / tucked in',
              'Fuller / prominent lips',
              'I love prominent labia',
              'Other',
            ],
            when('attractedVulva', true),
          ),
          { restricted: true },
        ),
        f(
          single(
            'vulvaClitPref',
            'Anything you love about a partner’s clit?',
            [
              'No preference',
              'On the smaller side',
              'Larger / prominent',
              'I love a big clit',
              'Other',
            ],
            when('attractedVulva', true),
          ),
          { restricted: true },
        ),
        f(
          single('partnerGrooming', 'Pubic hair you prefer on a partner', [
            'Shaved / bare',
            'Trimmed',
            'Natural / grown out',
            'No preference',
            'Other',
          ]),
          { restricted: true },
        ),
        f(
          single('ownGrooming', 'How do you keep your own grooming?', [
            'Shaved / bare',
            'Trimmed',
            'Natural',
            'Varies',
            'Other',
          ]),
          {
            restricted: true,
          },
        ),
        f(
          slider(
            'bodyConfidence',
            'How confident do you feel in your own body?',
            'Self-conscious',
            'It’s alright',
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
            'Other',
          ]),
          { restricted: true },
        ),
        f(
          longText(
            'bodyFeelings',
            'Anything about your body you love or feel self-conscious about sexually?',
            'What you love, or what you’d like to feel better about.',
          ),
          {
            restricted: true,
          },
        ),
      ]),
      ...grouped('Fantasies & media', [
        f(
          longText(
            'wildestFantasy',
            'Your wildest fantasy, in as much detail as you like',
            'Set the scene — no judgment.',
          ),
          {
            restricted: true,
          },
        ),
        f(
          longText(
            'fantasiesToTry',
            'Fantasies you’d actually like to try',
            'The ones you’d say yes to in real life.',
          ),
          { restricted: true },
        ),
        f(
          // Sourced from the SHARED `INTIMACY_TOPICS` inventory (08 §16.5a); `'Other'` is the form escape.
          multi('commonFantasies', 'Which of these appeal to you?', [
            ...INTIMACY_FANTASIES,
            'Other',
          ]),
          { restricted: true },
        ),
        f(
          longText(
            'neverActOn',
            'A fantasy you’d love but would never actually do',
            'Hot in your head, staying there — no judgment.',
          ),
          { restricted: true },
        ),
        f(
          single(
            'cncInterest',
            'Any interest in consensual non-consent (CNC) — a “forced” roleplay where both people fully agree in advance?',
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
        f(
          multi(
            'pornGenres',
            'What kind of porn are you into?',
            [
              'Amateur',
              'Professional',
              'Lesbian',
              'Gay',
              'Threesome / group',
              'POV',
              'BDSM / kink',
              'Romantic / passionate',
              'Rough',
              'Hentai / animated',
              'Fetish-specific',
              'Audio / erotica',
              'Other',
            ],
            whenAny('watchPorn', ['Rarely', 'Sometimes', 'Often', 'Daily']),
          ),
          { restricted: true },
        ),
        f(
          {
            ...longText(
              'pornRole',
              'How does porn fit into your life?',
              'e.g. a turn-on, a habit, inspiration, complicated…',
            ),
            branch: whenAny('watchPorn', ['Rarely', 'Sometimes', 'Often', 'Daily']),
          },
          { restricted: true },
        ),
        f(single('erotica', 'Do you read or listen to erotica?', ['Never', 'Sometimes', 'Often']), {
          restricted: true,
        }),
        f(
          multi(
            'eroticaType',
            'What kind of erotica do you like?',
            [
              'Romance',
              'Explicit / smut',
              'Audio (apps like Quinn / Dipsea)',
              'Written stories',
              'Fan fiction',
              'BDSM / kink',
              'Other',
            ],
            whenAny('erotica', ['Sometimes', 'Often']),
          ),
          { restricted: true },
        ),
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
        f(
          longText(
            'recurringDreams',
            'Any recurring sexual dreams?',
            'The ones that keep coming back.',
          ),
          { restricted: true },
        ),
      ]),
      ...grouped('Sexual wellbeing', [
        f(
          multi('difficulties', "Anything you'd want support with?", [
            'Getting aroused',
            'Reaching orgasm',
            'Orgasming too quickly',
            'Lasting longer',
            'Pain during sex',
            'Erectile difficulty',
            'Dryness',
            'Low desire',
            'Mismatched desire with a partner',
            'Learning to squirt',
            'Body confidence',
            'Performance anxiety',
            'None',
            'Other',
          ]),
          { restricted: true },
        ),
        f(
          slider(
            'performanceAnxiety',
            'How much performance anxiety do you feel?',
            'None',
            'Some',
            'A lot',
          ),
          { restricted: true },
        ),
        f(
          longText(
            'moodLibido',
            'How does your mood affect your libido?',
            'e.g. stress kills it, or sex is how you de-stress.',
          ),
          { restricted: true },
        ),
        f(
          longText(
            'sexWellbeing',
            'How does sex affect your overall wellbeing?',
            'What it gives you — connection, release, confidence…',
          ),
          { restricted: true },
        ),
      ]),
      ...grouped('Boundaries & meaning', [
        f(
          longText(
            'boundaries',
            'Consent, safety, or boundaries SelfOS should always hold',
            'Anything that should always be respected.',
          ),
          { restricted: true },
        ),
        f(shortText('safeword', 'A safeword or signal you use', 'e.g. “red”')),
        f(
          longText(
            'feelSafe',
            'What makes you feel safe and present during sex?',
            'Trust, pace, words, a certain mood…',
          ),
          { restricted: true },
        ),
        f(
          longText(
            'closenessMeaning',
            'What does great intimacy or closeness mean to you?',
            'Beyond the physical — what it feels like at its best.',
          ),
          { restricted: true },
        ),
        f(
          longText(
            'understandSexuality',
            'What do you most want SelfOS to understand about your sexuality?',
            'The one thing you’d want it to really get.',
          ),
          { restricted: true },
        ),
      ]),
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
