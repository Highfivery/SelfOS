import { INTIMACY_FANTASIES } from '../intimacy/topics';
import {
  ACTIVITY_LIMIT_LABELS,
  ACTIVITY_POINT_LABELS,
  resolveIntakeActivityRows,
} from '../intimacy/activityRows';
import type {
  BranchRule,
  IntakeSectionMeta,
  PersonFieldKey,
  Question,
  RosterColumn,
} from '../schemas';

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
/** A repeatable list of rows with configurable columns (e.g. kids: name/gender/age; pets). */
function roster(
  id: string,
  prompt: string,
  columns: RosterColumn[],
  branch?: BranchRule,
): Question {
  return {
    id,
    type: 'roster',
    prompt,
    required: false,
    roster: columns,
    ...(branch ? { branch } : {}),
  };
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
    ],
  },
  {
    id: 'life-now',
    title: 'Your life now',
    blurb: 'A picture of your everyday — home, family, and the shape of your days.',
    tier: 'core',
    mode: 'form',
    restricted: false,
    adult: false,
    opener: 'A snapshot of your life right now.',
    questions: [
      // One question for the home setup. Picking "Children" auto-fills the Children question below
      // (handled in the onboarding form panel).
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
      // Shown when they have kids (incl. via the liveWith→Children auto-fill). Portrait/context only.
      f(
        roster(
          'children',
          'Tell me about your kids',
          [
            { key: 'name', label: 'Name', type: 'text', placeholder: 'e.g. Emma' },
            {
              key: 'gender',
              label: 'Gender',
              type: 'select',
              options: ['Girl', 'Boy', 'Non-binary', 'Prefer not to say'],
            },
            // Date of birth, not age — an age goes stale as time passes; a DOB stays correct.
            { key: 'dob', label: 'Date of birth', type: 'date' },
          ],
          whenAny('parentalStatus', ['Have young kids', 'Have grown kids']),
        ),
      ),
      f(multi('pets', 'Any pets?', ['Dog', 'Cat', 'Other', 'None'])),
      // Shown when a pet is selected above. Portrait/context only.
      f(
        roster(
          'petsDetail',
          'Tell me about your pets',
          [
            { key: 'name', label: 'Name', type: 'text', placeholder: 'e.g. Rex' },
            {
              key: 'species',
              label: 'Species',
              type: 'select',
              options: ['Dog', 'Cat', 'Bird', 'Fish', 'Reptile', 'Small animal', 'Other'],
            },
            {
              key: 'gender',
              label: 'Gender',
              type: 'select',
              options: ['Female', 'Male', 'Unknown'],
            },
            // Date of birth, not age — a DOB stays correct as time passes (matches the children roster).
            { key: 'dob', label: 'Date of birth', type: 'date' },
          ],
          whenAny('pets', ['Dog', 'Cat', 'Other']),
        ),
      ),
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
    title: 'What matters',
    blurb: 'What guides you — your values, beliefs, and how you see yourself.',
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
        shortText(
          'selfDescribe',
          'Describe yourself in a few words',
          'e.g. curious, loyal, a bit anxious',
        ),
      ),
      f(
        longText(
          'guidingBelief',
          'A belief or principle that guides you',
          'Something you come back to.',
        ),
      ),
    ],
  },
  {
    id: 'want',
    title: 'What you want',
    blurb: "Where you're headed — goals, growth, and how I can help.",
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
        longText(
          'avoiding',
          'What do you keep avoiding, or what holds you back?',
          'Something you keep putting off.',
        ),
      ),
    ],
  },

  // ============================ INVITED (anytime, after the gate) ============================
  {
    id: 'health',
    title: 'Health & body',
    blurb: 'How you’re doing in body and mind — kept private to your own coaching.',
    tier: 'invited',
    mode: 'form',
    restricted: false,
    adult: false,
    opener: 'How you’re doing in body and mind. This stays private to your own coaching.',
    contentNote: 'Everything here stays private to your own coaching. Share only what you want to.',
    questions: [
      ...grouped('Sleep, energy & lifestyle', [
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
      ]),
      ...grouped('Mind & medical', [
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
          { restricted: true },
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
          { restricted: true },
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
          { field: 'healthNotes', private: true },
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
            'peoplePleasing',
            'How often do you put others’ needs ahead of your own?',
            'Rarely',
            'Sometimes',
            'Almost always',
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
        f(slider('loneliness', 'How lonely do you feel?', 'Never', 'Sometimes', 'Often')),
        f(
          shortText(
            'crisisPerson',
            'Who do you turn to in a crisis?',
            'e.g. my sister, my best friend, my partner',
          ),
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
      ...grouped('Patterns & history', [
        f(
          longText(
            'dealBreakers',
            'Your relationship deal-breakers',
            'e.g. dishonesty, no ambition, poor communication…',
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
        f(
          longText(
            'pastRelationships',
            'Your relationship history, in brief',
            'As much or as little as you like.',
          ),
        ),
        f(longText('heartbreak', 'A heartbreak that shaped you', 'Only if you want to share.')),
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
            'comfortThing',
            'Your comfort movie, show, album, or book',
            'The one you always return to.',
          ),
        ),
      ]),
    ],
  },
  {
    id: 'family',
    title: 'Family & roots',
    blurb: 'Where you come from — family, how you were raised, what you carry.',
    tier: 'invited',
    mode: 'form',
    restricted: false,
    adult: false,
    opener: 'A little about where you come from. Share what feels right, and skip anything.',
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
        f(
          shortText(
            'closestGrowingUp',
            'Who were you closest to growing up?',
            'e.g. my mom, my older brother',
          ),
        ),
        // Parent figures — portrait/context only (no Person field), like the kids/pets rosters. Framed
        // gently in the prompt because it can touch grief; the "Date they passed" column is always shown
        // (the roster has no per-column conditional visibility) but labelled "(if applicable)" so a living
        // parent's row simply leaves it blank.
        f(
          roster('parentFigures', 'Your parents — tell me a little about them, if you’d like', [
            {
              key: 'relation',
              label: 'Relation',
              type: 'select',
              options: ['Mother', 'Father', 'Stepmother', 'Stepfather', 'Guardian', 'Other'],
            },
            {
              key: 'status',
              label: 'Status',
              type: 'select',
              options: ['Living', 'Passed away', 'Not in my life', 'Prefer not to say'],
            },
            { key: 'birthday', label: 'Birthday', type: 'date' },
            { key: 'passedOn', label: 'Date they passed (if applicable)', type: 'date' },
          ]),
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
      ]),
      ...grouped('What you carry', [
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
          longText(
            'familyCarry',
            'What did you take from your upbringing — the gifts and the wounds?',
            'What shaped you, for better and worse.',
          ),
        ),
        f(
          longText(
            'favoriteMemory',
            'A favorite memory from growing up',
            'A moment that still makes you smile.',
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
    focus:
      'The key chapters of their life — formative experiences, turning points, their proudest achievement, ' +
      'their lowest moments, a moment that changed everything, biggest regrets, defining relationships, their ' +
      'biggest failure and what it taught them, what they have survived, how they have changed, what gives ' +
      'their life meaning, and the legacy they hope to leave. Held as the person chooses to share.',
    questions: [
      f(shortText('childhoodWord', 'Your childhood in one word', 'e.g. happy, chaotic, carefree')),
      f(longText('hardest', 'A hard time you came through', 'Only what you want to share.')),
      f(
        longText(
          'turningPoint',
          'A turning point that changed your direction',
          'A moment or decision that shifted things.',
        ),
      ),
      f(
        longText(
          'proudest',
          'Something you’re proud of',
          'An achievement or a moment you stood by yourself.',
        ),
      ),
      f(longText('regret', 'A decision you regret', 'Only what you want to share.')),
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
      f(
        longText(
          'becoming',
          'Who are you becoming, and what do you want the rest of your story to be?',
          'Where you feel yourself heading.',
        ),
      ),
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
      f(slider('supported', 'How supported do you feel right now?', 'Alone', 'Somewhat', 'Held')),
      f(
        longText(
          'whatHelps',
          'When things get dark, what helps you?',
          'People, habits, places that ground you.',
        ),
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
      'This block is entirely optional and only for adults (18+). Everything here stays private to your own coaching, is never shared with anyone else, and every question is skippable. It covers your own consensual adult sexuality — including fantasies; real limits are yours to set with the activity list and the consent & safety questions. The explicit specifics sit behind one optional toggle near the end.',
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
          { restricted: true },
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
        f(yesno('exclusiveNow', 'Are you exclusive / monogamous right now?'), { restricted: true }),
        f(
          slider(
            'intimacyImportance',
            'How big a part of life is intimacy for you?',
            'A small part',
            'Important',
            'Huge — central to me',
          ),
          { restricted: true },
        ),
        f(
          single('libido', 'Your sex drive', ['Very low', 'Low', 'Moderate', 'High', 'Very high']),
          { restricted: true },
        ),
        f(
          single('desireType', 'How does desire usually work for you?', [
            'Spontaneous — it hits out of the blue',
            'Responsive — it builds once things get going',
            'A mix of both',
            'Not sure',
          ]),
          { restricted: true },
        ),
      ]),
      ...grouped('Your sexual story', [
        f(
          single('firstPartneredAge', 'How old were you at your first partnered experience?', [
            ...AGE_RANGES.slice(0, -1),
            "Haven't yet",
            'Prefer not to say',
          ]),
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
      ...grouped('Your current sex life', [
        f(yesno('hasPartner', 'Do you have a sexual partner right now?'), { restricted: true }),
        f(
          {
            ...slider(
              'sexSatisfaction',
              'How satisfied are you with your sex life?',
              'Unhappy',
              'It’s okay',
              'Thrilled',
            ),
            branch: when('hasPartner', true),
          },
          { restricted: true },
        ),
        f(
          single('sexFrequency', 'How often are you intimate now?', FREQ, when('hasPartner', true)),
          { restricted: true },
        ),
        f(
          single(
            'desiredFrequency',
            'How often would you like to be?',
            FREQ,
            when('hasPartner', true),
          ),
          { restricted: true },
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
          {
            ...slider(
              'talkAboutSex',
              'How easily can you talk about sex with them?',
              'Really hard',
              'It’s okay',
              'Totally open',
            ),
            branch: when('hasPartner', true),
          },
          { restricted: true },
        ),
        f(
          {
            ...longText(
              'unspokenWant',
              'Something you want but haven’t asked for',
              'What would you ask for if it were easy?',
            ),
            branch: when('hasPartner', true),
          },
          { restricted: true },
        ),
        f(
          {
            ...longText(
              'sexDifferent',
              'What do you wish were different?',
              'More of, less of, something new…',
            ),
            branch: when('hasPartner', true),
          },
          { restricted: true },
        ),
      ]),
      ...grouped('Body & wellbeing', [
        f(
          slider(
            'bodyConfidence',
            'How confident do you feel in your own body sexually?',
            'Self-conscious',
            'It’s alright',
            'Very confident',
          ),
          { restricted: true },
        ),
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
            'sexEmotionalSecurity',
            'How do sex and closeness connect to feeling emotionally secure for you?',
            'What intimacy gives you beyond the physical.',
          ),
          { restricted: true },
        ),
      ]),
      ...grouped('Consent, safety & meaning', [
        f(
          single('consentPractices', 'How do you and partners handle consent and checking in?', [
            'We talk about it explicitly',
            'We mostly read each other',
            'It varies',
            'We struggle with it',
            'Prefer not to say',
            'Other',
          ]),
          { restricted: true },
        ),
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
            'understandSexuality',
            'What do you most want SelfOS to understand about your sexuality?',
            'The one thing you’d want it to really get.',
          ),
          { restricted: true },
        ),
      ]),
      // The explicit specifics sit behind ONE opt-in toggle (27 §4.3) — the always-visible core above covers
      // identity, the relational picture, body confidence, and all the safety/consent/meaning signal; only the
      // granular preference/act/fantasy detail is gated, so a casual user answers a short form.
      ...grouped('Getting specific (optional)', [
        f(
          yesno(
            'getSpecific',
            'Want to get into the explicit specifics — your turn-ons, kinks, acts, and fantasies?',
          ),
          { restricted: true },
        ),
        f(
          multi(
            'turnOns',
            'What turns you on or gets you in the mood?',
            [
              'Kissing',
              'Foreplay',
              'Oral',
              'Dirty talk',
              'Being teased',
              'Lingerie',
              'Sensual massage',
              'Anticipation',
              'Visuals',
              'Scent',
              'Confidence',
              'Romance',
              'Spontaneity',
              'Roleplay',
              'Being desired',
              'A partner taking control',
              'A few drinks',
              'Stress relief',
              'Other',
            ],
            when('getSpecific', true),
          ),
          { restricted: true },
        ),
        f(
          multi(
            'turnOffs',
            'Your turn-offs',
            [
              'Bad hygiene',
              'Rushing',
              'Pressure',
              'Lack of confidence',
              'Too rough',
              'Too gentle',
              'Distractions / phones',
              'Silence',
              'Selfishness',
              'Other',
            ],
            when('getSpecific', true),
          ),
          { restricted: true },
        ),
        f(
          {
            ...slider(
              'roughness',
              'How rough do you like it?',
              'Gentle & slow',
              'A good balance',
              'Rough & hard',
            ),
            branch: when('getSpecific', true),
          },
          { restricted: true },
        ),
        f(
          single(
            'domSub',
            'Dominant or submissive?',
            ['Dominant', 'Submissive', 'Switch', 'Vanilla', 'Other'],
            when('getSpecific', true),
          ),
          { restricted: true },
        ),
        // The activity inventory as ONE 5-point feeling matrix — Hard no · Not interested · Curious · Like it
        // · Love it (27 §4.2). Rows default to the NEUTRAL list (= `resolveIntakeActivityRows({})`); the
        // renderer re-resolves them per-person from gender + drawnTo (oral directionality only), and synthesis
        // re-resolves with the same context so the keys line up. The two relationship dynamics + the boundary
        // ("Hard no") tone are folded in by the resolver / labels.
        f(
          {
            id: 'activities',
            type: 'matrix',
            prompt:
              'For each, tap where you stand — a hard no, not for you, curious, or something you’re into:',
            required: false,
            matrix: {
              rows: resolveIntakeActivityRows(),
              min: 1,
              max: 5,
              pointLabels: [...ACTIVITY_POINT_LABELS],
              limitLabels: [...ACTIVITY_LIMIT_LABELS],
            },
            branch: when('getSpecific', true),
          },
          { restricted: true },
        ),
        f(
          {
            ...longText(
              'dirtyTalkLikes',
              'Dirty talk — things you love to hear',
              'e.g. praise, being told what to do, descriptions of what they want to do to you…',
            ),
            branch: when('getSpecific', true),
          },
          { restricted: true },
        ),
        f(
          {
            ...longText(
              'idealEncounter',
              'Describe your ideal sexual encounter, start to finish, in as much detail as you like',
              'From the first touch to the end — paint the picture.',
            ),
            branch: when('getSpecific', true),
          },
          { restricted: true },
        ),
        f(
          {
            ...longText(
              'fantasies',
              'Fantasies you’d love to explore',
              'Set the scene — no judgment. The ones you’d say yes to in real life, and the ones just for your head.',
            ),
            branch: when('getSpecific', true),
          },
          { restricted: true },
        ),
        f(
          // Sourced from the SHARED `INTIMACY_TOPICS` inventory (08 §16.5a); `'Other'` is the form escape.
          multi(
            'commonFantasies',
            'Which of these appeal to you?',
            [...INTIMACY_FANTASIES, 'Other'],
            when('getSpecific', true),
          ),
          { restricted: true },
        ),
        f(
          single(
            'watchPorn',
            'Do you watch porn?',
            ['Never', 'Rarely', 'Sometimes', 'Often', 'Daily'],
            when('getSpecific', true),
          ),
          { restricted: true },
        ),
        // Two follow-ups revealed when they watch porn (anything but "Never"). The genre list is NOT
        // orientation-filtered — people watch across categories. Each has an "Other" write-in.
        f(
          multi(
            'pornGenres',
            'What kind of porn are you into?',
            [
              'Amateur',
              'Professional / studio',
              'Straight',
              'Lesbian',
              'Gay',
              'Bi / threesome',
              'Trans',
              'BDSM / kink',
              'Rough',
              'Romantic / passionate',
              'POV',
              'Animated / hentai',
              'Audio / erotica',
              'Roleplay / cosplay',
              'Prefer not to say',
              'Other',
            ],
            whenAny('watchPorn', ['Rarely', 'Sometimes', 'Often', 'Daily']),
          ),
          { restricted: true },
        ),
        f(
          multi(
            'pornWhen',
            'When do you like to watch it?',
            [
              'Alone',
              'With a partner',
              'To unwind / de-stress',
              'Before bed',
              'In the morning',
              'Late at night',
              'When stressed or bored',
              'Other',
            ],
            whenAny('watchPorn', ['Rarely', 'Sometimes', 'Often', 'Daily']),
          ),
          { restricted: true },
        ),
        f(
          multi(
            'eroticaMedia',
            'Erotica & sharing — anything you’re into?',
            [
              'Read / listen to erotica',
              'Sext / share nudes',
              'Record ourselves',
              'Camming / broadcasting',
              'Curious',
              'None of these',
              'Prefer not to say',
            ],
            when('getSpecific', true),
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
