import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { InboxItem, Insight, QuestionnaireSentOverview } from '@shared/channels';
import { QuestionnairesSection } from './QuestionnairesSection';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';
import { useQuestionnaireStore } from '../../../stores/questionnaireStore';
import { useInboxStore } from '../../../stores/inboxStore';
import { useInsightStore } from '../../../stores/insightStore';

const OVERVIEW: Record<string, QuestionnaireSentOverview> = {
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
  },
};

const QUESTIONNAIRE_INSIGHT: Insight = {
  id: 'i1',
  schemaVersion: 1,
  source: 'questionnaire',
  subjectPersonId: 'me',
  summary: 'Angel feels most connected through unhurried time together.',
  facts: [],
  confidence: 'high',
  categories: [],
  approved: true,
  provenance: { at: 'now', aboutName: 'Angel' },
  createdAt: 'now',
  updatedAt: '2026-07-10',
};

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
  insights?: Insight[];
  inbox?: InboxItem[];
}): void {
  useQuestionnaireStore.setState({
    sentOverview: opts.overview ?? {},
    questionnaires: [],
  });
  useInsightStore.setState({ insights: opts.insights ?? [] });
  useInboxStore.setState({ items: opts.inbox ?? [] });
}

function renderSection(props: Partial<Parameters<typeof QuestionnairesSection>[0]> = {}): void {
  render(
    <MemoryRouter>
      <QuestionnairesSection
        canCreate
        canViewResults
        canAnswer
        configured
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
  it('renders the stat strip, an answer row, and the latest insight', async () => {
    seed({ overview: OVERVIEW, insights: [QUESTIONNAIRE_INSIGHT], inbox: [INBOX_UNANSWERED] });
    renderSection();

    expect(screen.getByRole('region', { name: 'Questionnaires' })).toBeInTheDocument();
    // Stats
    expect(screen.getByText('Sent')).toBeInTheDocument();
    expect(screen.getByText('Response rate')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument(); // 1 answered of 2 sends
    expect(screen.getByText('Insights')).toBeInTheDocument();
    // Needs you — the unanswered inbox item shows as an answer row
    expect(
      await screen.findByText(/1 questionnaire waiting for you to answer/i),
    ).toBeInTheDocument();
    // Latest insight, attributed + linkable
    expect(screen.getByText(/most connected through unhurried time/i)).toBeInTheDocument();
    expect(screen.getByText(/Latest insight · from Angel/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /view in memory/i })).toBeInTheDocument();
  });

  it('shows a warm invitation (not an empty grid) when the person can create but has nothing yet', () => {
    seed({});
    renderSection();
    expect(
      screen.getByRole('button', { name: /create your first questionnaire/i }),
    ).toBeInTheDocument();
  });

  it('renders nothing when the person can neither create nor answer', () => {
    seed({ overview: OVERVIEW });
    const { container } = render(
      <MemoryRouter>
        <QuestionnairesSection
          canCreate={false}
          canViewResults={false}
          canAnswer={false}
          configured={false}
          adultAcknowledged={false}
          showIdeas={false}
          subjectPersonId="me"
        />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the "Ideas for you" pushes only when showIdeas is on; the spicy idea is 18+ gated', () => {
    seed({ overview: OVERVIEW });
    const { rerender } = render(
      <MemoryRouter>
        <QuestionnairesSection
          canCreate
          canViewResults
          canAnswer
          configured
          adultAcknowledged={false}
          showIdeas={false}
          subjectPersonId="me"
        />
      </MemoryRouter>,
    );
    // Pushes suppressed
    expect(screen.queryByText('Ideas for you')).toBeNull();

    // Turn ideas on, still no 18+ ack → no spicy card
    rerender(
      <MemoryRouter>
        <QuestionnairesSection
          canCreate
          canViewResults
          canAnswer
          configured
          adultAcknowledged={false}
          showIdeas
          subjectPersonId="me"
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Ideas for you')).toBeInTheDocument();
    expect(screen.queryByText(/spicy/i)).toBeNull();

    // With the ack, the spicy idea appears
    rerender(
      <MemoryRouter>
        <QuestionnairesSection
          canCreate
          canViewResults
          canAnswer
          configured
          adultAcknowledged
          showIdeas
          subjectPersonId="me"
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/spicy · 18\+/i)).toBeInTheDocument();
  });
});
