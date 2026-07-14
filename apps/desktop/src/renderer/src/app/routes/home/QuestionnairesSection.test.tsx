import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type {
  DreamPatternStats,
  InboxItem,
  Insight,
  Person,
  Questionnaire,
  QuestionnaireSentOverview,
} from '@shared/channels';
import { QuestionnairesSection } from './QuestionnairesSection';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';
import { useQuestionnaireStore } from '../../../stores/questionnaireStore';
import { useInboxStore } from '../../../stores/inboxStore';
import { useInsightStore } from '../../../stores/insightStore';
import { useDreamPatternStore } from '../../../stores/dreamPatternStore';
import { usePeopleStore } from '../../../stores/peopleStore';

function questionnaire(id: string, title: string, type = 'general'): Questionnaire {
  return {
    id,
    schemaVersion: 1,
    version: 1,
    title,
    type,
    sensitivity: 'standard',
    questions: [],
    createdAt: 'now',
    updatedAt: 'now',
  } as Questionnaire;
}

function person(id: string, displayName: string): Person {
  return {
    id,
    schemaVersion: 1,
    displayName,
    isSubject: true,
    tags: [],
    createdAt: 'now',
    updatedAt: 'now',
  };
}

const ANALYZED_OVERVIEW: Record<string, QuestionnaireSentOverview> = {
  q1: {
    questionnaireId: 'q1',
    lastSentAt: 'now',
    recipients: [
      { name: 'Angel', status: 'submitted', answered: true },
      { name: 'Sam', status: 'sent', answered: false },
    ],
    answeredCount: 1,
    newResponses: 0,
    analyzed: true,
    answeredAt: '2026-07-10',
    insightId: 'ins1',
    insightSummary: 'Angel feels most connected through unhurried time together.',
  },
};

const QUESTIONNAIRE_INSIGHT: Insight = {
  id: 'ins1',
  schemaVersion: 1,
  source: 'questionnaire',
  subjectPersonId: 'me',
  summary: 'Angel feels most connected through unhurried time together.',
  facts: [],
  confidence: 'high',
  categories: ['Relationships'],
  approved: true,
  provenance: { at: 'now', aboutName: 'Angel' },
  createdAt: 'now',
  updatedAt: '2026-07-10',
};

function sessionInsight(id: string, category: string): Insight {
  return {
    id,
    schemaVersion: 1,
    source: 'session',
    subjectPersonId: 'me',
    summary: 'A session reflection.',
    facts: [],
    confidence: 'medium',
    categories: [category],
    approved: true,
    provenance: { at: 'now' },
    createdAt: 'now',
    updatedAt: 'now',
  };
}

const INBOX_UNANSWERED: InboxItem = {
  assignmentId: 'a1',
  title: 'How am I doing as a friend?',
  type: 'general',
  questionCount: 3,
  status: 'sent',
  privacy: 'private',
  senderName: 'Sam',
  createdAt: 'now',
  favorite: false,
  answerable: true,
  hasDraft: false,
  fromSelf: false,
};

function seed(opts: {
  overview?: Record<string, QuestionnaireSentOverview>;
  questionnaires?: Questionnaire[];
  insights?: Insight[];
  inbox?: InboxItem[];
  people?: Person[];
  dreamStats?: DreamPatternStats | null;
}): void {
  useQuestionnaireStore.setState({
    sentOverview: opts.overview ?? {},
    questionnaires: opts.questionnaires ?? [],
  });
  useInsightStore.setState({ insights: opts.insights ?? [] });
  useInboxStore.setState({ items: opts.inbox ?? [] });
  usePeopleStore.setState({ people: opts.people ?? [] });
  useDreamPatternStore.setState({ stats: opts.dreamStats ?? null });
}

function renderSection(props: Partial<Parameters<typeof QuestionnairesSection>[0]> = {}): void {
  render(
    <MemoryRouter>
      <QuestionnairesSection
        canCreate
        canViewResults
        canAnswer
        adultAcknowledged={false}
        showIdeas={false}
        subjectPersonId="me"
        {...props}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  installMockBridge();
});

afterEach(() => {
  clearMockBridge();
  seed({});
});

describe('QuestionnairesSection (59)', () => {
  it('renders stats with context, an answer row, and a rich insight naming who it is for + about', async () => {
    seed({
      overview: ANALYZED_OVERVIEW,
      questionnaires: [questionnaire('q1', 'What lights you up')],
      insights: [QUESTIONNAIRE_INSIGHT],
      inbox: [INBOX_UNANSWERED],
      people: [person('me', 'Me'), person('sam', 'Sam')],
    });
    renderSection();

    expect(screen.getByRole('region', { name: 'Questionnaires' })).toBeInTheDocument();
    // Stats with context sub-lines
    expect(screen.getByText('Response rate')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 answered/i)).toBeInTheDocument();
    // Needs-you answer row
    expect(
      await screen.findByText(/1 questionnaire waiting for you to answer/i),
    ).toBeInTheDocument();
    // Rich insight — who it's ABOUT + which questionnaire + the life-area
    expect(screen.getByText(/About Angel · from “What lights you up”/i)).toBeInTheDocument();
    expect(screen.getByText(/most connected through unhurried time/i)).toBeInTheDocument();
    expect(screen.getByText('Relationships')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /view in memory/i })).toBeInTheDocument();
  });

  it('shows the engagement banner — what you learned + who you have not asked yet', () => {
    seed({
      overview: ANALYZED_OVERVIEW,
      questionnaires: [questionnaire('q1', 'What lights you up')],
      insights: [QUESTIONNAIRE_INSIGHT],
      // Angel + Sam are recipients of q1 (already asked); Dad has never been sent one.
      people: [person('me', 'Me'), person('dad', 'Dad')],
    });
    renderSection();
    expect(
      screen.getByText(
        /You've gathered 1 insight about 1 person.*haven't asked Dad anything yet/is,
      ),
    ).toBeInTheDocument();
  });

  it('surfaces "go deeper" threads from recent sessions, dreams, and Together (a push)', () => {
    seed({
      overview: ANALYZED_OVERVIEW,
      insights: [sessionInsight('s1', 'Work'), sessionInsight('s2', 'Work')],
      dreamStats: {
        window: '30d',
        dreamCount: 4,
        analyzedCount: 3,
        symbols: [{ label: 'the ocean', count: 3 }],
        themes: [],
        people: [],
        emotions: [],
        lucidCount: 0,
        nightmareCount: 0,
        moodTrend: [],
        vividnessTrend: [],
        nightmareNudge: false,
      },
    });
    renderSection({ showIdeas: true, togetherPartnerName: 'Angel' });
    expect(screen.getByText(/reflecting on work lately/i)).toBeInTheDocument();
    expect(screen.getByText(/recurring dream about the ocean/i)).toBeInTheDocument();
    expect(screen.getByText(/You and Angel could use a gentle check-in/i)).toBeInTheDocument();
  });

  it('promotes a fun band always, and the 18+ spicy band only after the ack', () => {
    seed({ overview: ANALYZED_OVERVIEW });
    const { rerender } = render(
      <MemoryRouter>
        <QuestionnairesSection
          canCreate
          canViewResults
          canAnswer
          adultAcknowledged={false}
          showIdeas
          subjectPersonId="me"
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('For fun · for the two of you')).toBeInTheDocument();
    expect(screen.getByText(/just for fun/i)).toBeInTheDocument();
    expect(screen.queryByText(/spice it up/i)).toBeNull(); // no ack → no spicy

    rerender(
      <MemoryRouter>
        <QuestionnairesSection
          canCreate
          canViewResults
          canAnswer
          adultAcknowledged
          showIdeas
          subjectPersonId="me"
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/spice it up · 18\+/i)).toBeInTheDocument();
  });

  it('shows the "Ideas" pushes only when showIdeas is on', () => {
    seed({ overview: ANALYZED_OVERVIEW });
    renderSection({ showIdeas: false });
    expect(screen.queryByText('For fun · for the two of you')).toBeNull();
    expect(screen.queryByText('Explore more types')).toBeNull();
  });

  it('shows a warm invitation (not an empty grid) when the person can create but has nothing yet', () => {
    seed({});
    renderSection();
    expect(
      screen.getByRole('button', { name: /create your first questionnaire/i }),
    ).toBeInTheDocument();
  });

  it('renders nothing when the person can neither create nor answer', () => {
    seed({ overview: ANALYZED_OVERVIEW });
    const { container } = render(
      <MemoryRouter>
        <QuestionnairesSection
          canCreate={false}
          canViewResults={false}
          canAnswer={false}
          adultAcknowledged={false}
          showIdeas={false}
          subjectPersonId="me"
        />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
