import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { TestResult } from '@shared/schemas';
import type { TestSummary } from '@selfos/core/tests';
import { YouCard } from './YouCard';
import { useTestStore } from '../../../stores/testStore';

const test = (over: Partial<TestSummary> & { id: string; title: string }): TestSummary => ({
  group: 'personality',
  instrument: over.id,
  blurb: '',
  framing: '',
  estimatedMinutes: 5,
  itemCount: 10,
  adult: false,
  sensitive: false,
  subscales: [],
  wellbeing: false,
  ...over,
});

const result = (over: Partial<TestResult> & { id: string; testId: string }): TestResult => ({
  schemaVersion: 1,
  testVersion: 1,
  subjectPersonId: 'me',
  answers: [],
  scores: [],
  takenAt: new Date().toISOString(),
  createdAt: 'now',
  updatedAt: 'now',
  ...over,
});

function renderCard(): void {
  render(
    <MemoryRouter>
      <YouCard />
    </MemoryRouter>,
  );
}

afterEach(() => useTestStore.getState().reset());

describe('YouCard (60 §3.1.4)', () => {
  it('surfaces a profile highlight from a taken assessment', () => {
    useTestStore.setState({
      catalog: [
        test({
          id: 'ecr',
          title: 'Attachment style',
          subscales: [
            { key: 'ecr.anxiety', label: 'Attachment anxiety', signed: false },
            { key: 'ecr.avoidance', label: 'Attachment avoidance', signed: false },
          ],
        }),
      ],
      resultsByTest: {
        ecr: [
          result({
            id: 'r1',
            testId: 'ecr',
            scores: [
              { key: 'ecr.anxiety', raw: 20, normalized: 0.8, band: 'High' },
              { key: 'ecr.avoidance', raw: 8, normalized: 0.2, band: 'Low' },
            ],
          }),
        ],
      },
      loaded: true,
    });
    renderCard();
    expect(screen.getByRole('heading', { name: /^you$/i })).toBeInTheDocument();
    expect(screen.getByText('Your profile')).toBeInTheDocument();
    // The most distinctive subscale (max |normalized|) shows with its label + band.
    expect(screen.getByText('Attachment anxiety')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  it('invites untaken assessments (leads with "discover your profile" when none are taken)', () => {
    useTestStore.setState({
      catalog: [
        test({ id: 'bigfive', title: 'Big Five' }),
        test({ id: 'ecr', title: 'Attachment' }),
      ],
      resultsByTest: {},
      loaded: true,
    });
    renderCard();
    // The invite eyebrow leads with this exact phrase (distinct from the fallback sentence copy).
    expect(screen.getByText('Discover your profile')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /big five/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /attachment/i })).toBeInTheDocument();
  });

  it('self-hides when there is no catalog', () => {
    useTestStore.setState({ catalog: [], resultsByTest: {}, loaded: true });
    const { container } = render(
      <MemoryRouter>
        <YouCard />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('self-hides when there is nothing to say (only an unacked 18+ test, no results)', () => {
    useTestStore.setState({
      catalog: [test({ id: 'kink', title: 'Intimacy inventory', group: 'intimacy', adult: true })],
      resultsByTest: {},
      adultAcknowledged: false,
      loaded: true,
    });
    const { container } = render(
      <MemoryRouter>
        <YouCard />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
