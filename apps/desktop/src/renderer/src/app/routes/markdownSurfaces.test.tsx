import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AlignmentReport, Insight, IntakeSection, IntakeSession } from '@shared/schemas';
import type { IntakeSectionMeta } from '@shared/channels';
import { WrapUpCard } from './sessions/WrapUpCard';
import { AlignmentReportView } from './questionnaires/AlignmentReportView';
import { InsightCard } from './memory/InsightCard';
import { ClosingPortrait } from './onboarding/ClosingPortrait';

// Per-surface proof (34-rich-text-rendering §10): each AI-prose surface renders its strings through
// <Markdown> — real <strong>/<li>, never literal `**`. Markdown-bearing fixtures stand in for what the
// model produces (the renderer is the unit under test here).

const MD_SUMMARY = 'You are **steady**.\n\n- one\n- two';

describe('Markdown surfaces — wrap-up card', () => {
  it('renders the summary as Markdown and a fact inline', () => {
    const insight: Insight = {
      id: 'i1',
      schemaVersion: 1,
      source: 'session',
      subjectPersonId: 'p1',
      summary: MD_SUMMARY,
      facts: [{ id: 'f1', text: 'Feels **connected** through shared time.', shareable: true }],
      confidence: 'medium',
      categories: [],
      approved: true,
      provenance: { at: '2026-06-22T00:00:00.000Z' },
      createdAt: '2026-06-22T00:00:00.000Z',
      updatedAt: '2026-06-22T00:00:00.000Z',
    };
    const { container } = render(
      <MemoryRouter>
        <WrapUpCard insight={insight} onDismiss={() => {}} />
      </MemoryRouter>,
    );
    expect(container.querySelector('strong')?.textContent).toBe('steady');
    expect(container.querySelectorAll('li').length).toBeGreaterThanOrEqual(2);
    // The fact's bold renders too (inline mode), not literal `**`.
    expect(container.textContent).toContain('connected');
    expect(container.textContent).not.toContain('**');
  });
});

describe('Markdown surfaces — alignment report', () => {
  it('renders the summary + a per-item note as Markdown', () => {
    const report: AlignmentReport = {
      schemaVersion: 1,
      compatibilityGroupId: 'g1',
      questionnaireId: 'q1',
      personAName: 'Ben',
      personBName: 'Angel',
      summary: MD_SUMMARY,
      items: [
        { canonicalId: 'c1', prompt: 'Pace', agreement: 'mixed', note: 'You differ on **pace**.' },
      ],
      generatedAt: '2026-06-22T00:00:00.000Z',
    };
    const { container } = render(<AlignmentReportView report={report} />);
    expect(container.querySelector('strong')).not.toBeNull();
    expect(container.querySelectorAll('li').length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).not.toContain('**pace**');
  });
});

describe('Markdown surfaces — memory insight', () => {
  it('renders an approved insight summary + facts as Markdown', () => {
    const insight: Insight = {
      id: 'i2',
      schemaVersion: 1,
      source: 'questionnaire',
      subjectPersonId: 'p1',
      summary: MD_SUMMARY,
      facts: [{ id: 'f1', text: 'Values **honesty**.', shareable: true }],
      confidence: 'high',
      categories: [],
      approved: true,
      provenance: { at: '2026-06-22T00:00:00.000Z' },
      createdAt: '2026-06-22T00:00:00.000Z',
      updatedAt: '2026-06-22T00:00:00.000Z',
    };
    const { container } = render(
      <MemoryRouter>
        <InsightCard insight={insight} subjectName="You" isOwn />
      </MemoryRouter>,
    );
    expect(container.querySelector('strong')?.textContent).toBe('steady');
    expect(container.querySelectorAll('li').length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).not.toContain('**');
  });
});

describe('Markdown surfaces — onboarding portrait', () => {
  it('renders the portrait + a section reflection as Markdown', () => {
    const section: IntakeSection = {
      id: 'basics',
      status: 'complete',
      restricted: false,
      messages: [],
      answers: {},
      reflection: 'You spoke with **warmth**.',
    };
    const session: IntakeSession = {
      id: 's1',
      schemaVersion: 1,
      personId: 'p1',
      status: 'complete',
      sections: [section],
      portrait: MD_SUMMARY,
      startedAt: '2026-06-22T00:00:00.000Z',
      updatedAt: '2026-06-22T00:00:00.000Z',
    };
    const sections: IntakeSectionMeta[] = [
      {
        id: 'basics',
        title: 'The basics',
        blurb: '',
        restricted: false,
        adult: false,
        tier: 'core',
        mode: 'form',
        opener: '',
      },
    ];
    const { container } = render(
      <ClosingPortrait session={session} sections={sections} onRevisit={() => {}} />,
    );
    expect(container.querySelector('strong')?.textContent).toBe('steady');
    expect(container.querySelectorAll('li').length).toBeGreaterThanOrEqual(2);
    // The section reflection's bold renders too.
    expect(container.textContent).toContain('warmth');
    expect(container.textContent).not.toContain('**');
  });
});
