import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Person, QuestionnaireSentOverview } from '@shared/schemas';
import { QuestionnairesCard } from './QuestionnairesCard';

const person = (id: string, displayName: string, isSubject = true): Person => ({
  id,
  schemaVersion: 1,
  displayName,
  isSubject,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
});

const overview = (
  id: string,
  recipients: { name: string; answered: boolean }[],
  newResponses = 0,
): QuestionnaireSentOverview => ({
  questionnaireId: id,
  lastSentAt: 'now',
  recipients: recipients.map((r) => ({ name: r.name, status: 'sent', answered: r.answered })),
  answeredCount: recipients.filter((r) => r.answered).length,
  newResponses,
  analyzed: false,
});

function renderCard(props: Partial<Parameters<typeof QuestionnairesCard>[0]> = {}): void {
  render(
    <MemoryRouter>
      <QuestionnairesCard
        sentOverview={{}}
        inboxCount={0}
        people={[]}
        subjectPersonId="me"
        canCreate
        canViewResults
        {...props}
      />
    </MemoryRouter>,
  );
}

describe('QuestionnairesCard', () => {
  it('shows the response rate, a new-answers action, and who has not been asked', () => {
    renderCard({
      sentOverview: {
        q1: overview(
          'q1',
          [
            { name: 'Angel', answered: true },
            { name: 'Mom', answered: false },
          ],
          2,
        ),
      },
      people: [person('me', 'Ben'), person('mom', 'Mom'), person('jordan', 'Jordan')],
    });
    expect(screen.getByRole('heading', { name: 'Questionnaires' })).toBeInTheDocument();
    expect(screen.getByText(/2 new answers to review/i)).toBeInTheDocument();
    // Jordan hasn't been asked (Mom has); the viewer (Ben) is excluded.
    expect(screen.getByText(/haven.t asked jordan/i)).toBeInTheDocument();
  });

  it('surfaces an unanswered inbox send as an action link', () => {
    renderCard({ inboxCount: 1 });
    expect(screen.getByText(/1 waiting for you to answer/i)).toBeInTheDocument();
  });

  it('self-hides when there is nothing and the person cannot create', () => {
    const { container } = render(
      <MemoryRouter>
        <QuestionnairesCard
          sentOverview={{}}
          inboxCount={0}
          people={[]}
          subjectPersonId="me"
          canCreate={false}
          canViewResults={false}
        />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
