import { describe, expect, it } from 'vitest';

import { INTIMACY_CATEGORIES } from '../intimacy/topics';

import {
  applyCoverageAssessments,
  buildCoverageGuidance,
  deriveCoverageSkeleton,
  GENERAL_LIFE_AREAS,
} from './coverageModel';
import { emptyProfile, type PersonalizationProfile } from './personalizationProfile';
import { seedTopics } from './topicMap';

const withTopics = (
  topics: PersonalizationProfile['coverage']['topics'],
): PersonalizationProfile => ({
  ...emptyProfile('p1'),
  coverage: { topics },
});

describe('deriveCoverageSkeleton', () => {
  it('emits one unexplored topic per general life area', () => {
    const topics = deriveCoverageSkeleton();
    const general = topics.filter((t) => t.lifeArea !== 'Intimacy');
    expect(general).toHaveLength(GENERAL_LIFE_AREAS.length);
    expect(general.every((t) => !t.explored && t.depth === 0)).toBe(true);
    expect(topics.some((t) => t.lifeArea === 'Other')).toBe(false);
  });

  it('emits one row per intimacy category, matching the topic map ids the ledger fills in', () => {
    const topics = deriveCoverageSkeleton();
    const intimacy = topics.filter((t) => t.lifeArea === 'Intimacy');
    expect(intimacy).toHaveLength(INTIMACY_CATEGORIES.length);
    // Structure only — every number is layered on later from the ask ledger + topic map (spec 71 §5.2).
    expect(intimacy.every((t) => !t.explored && !t.saturated && t.askedCount === 0)).toBe(true);
    expect(intimacy.map((t) => t.topicId)).toContain('Intimacy:oral');
    // The ids + labels are exactly the seeded topic map's, so its statuses land on these rows.
    const seeded = new Map(
      seedTopics()
        .filter((t) => t.lifeArea === 'Intimacy')
        .map((t) => [t.topicId, t.label] as const),
    );
    expect(intimacy.every((t) => seeded.get(t.topicId) === t.label)).toBe(true);
  });
});

describe('applyCoverageAssessments', () => {
  it('overlays a general area’s depth/explored and mints sub-topics, leaving Intimacy untouched', () => {
    const skeleton = deriveCoverageSkeleton();
    const merged = applyCoverageAssessments(skeleton, [
      {
        lifeArea: 'Work & purpose',
        depth: 0.8,
        subTopics: [{ label: 'Career direction', depth: 0.2 }],
      },
    ]);
    const work = merged.find((t) => t.topicId === 'Work & purpose');
    expect(work).toMatchObject({ depth: 0.8, explored: true });
    expect(merged.find((t) => t.topicId === 'Work & purpose:career-direction')).toMatchObject({
      lifeArea: 'Work & purpose',
      depth: 0.2,
      explored: true,
    });
    // Intimacy topics are unchanged — the AI placement pass never touches them.
    expect(merged.filter((t) => t.lifeArea === 'Intimacy')).toEqual(
      skeleton.filter((t) => t.lifeArea === 'Intimacy'),
    );
    // An area with no assessment stays unexplored.
    expect(merged.find((t) => t.topicId === 'Money')).toMatchObject({ explored: false, depth: 0 });
  });

  it('does NOT sub-divide a lightly-touched area — coarse-first (§13 / §26.3 live tuning)', () => {
    const merged = applyCoverageAssessments(deriveCoverageSkeleton(), [
      // Barely explored (0.3) → its "strands" are noise; no sub-topics minted.
      {
        lifeArea: 'Relationships',
        depth: 0.3,
        subTopics: [
          { label: 'Marriage', depth: 0.1 },
          { label: 'Friendship', depth: 0 },
        ],
      },
      // Explored (0.6) → sub-topics ARE minted (they tell explored strands apart).
      {
        lifeArea: 'Work & purpose',
        depth: 0.6,
        subTopics: [{ label: 'Career meaning', depth: 0.2 }],
      },
    ]);
    expect(
      merged.some((t) => t.lifeArea === 'Relationships' && t.topicId !== 'Relationships'),
    ).toBe(false);
    expect(merged.find((t) => t.topicId === 'Work & purpose:career-meaning')).toBeDefined();
  });

  it('clamps out-of-range depths', () => {
    const merged = applyCoverageAssessments(deriveCoverageSkeleton(), [
      { lifeArea: 'Money', depth: 5 },
      { lifeArea: 'Health & body', depth: -1 },
    ]);
    expect(merged.find((t) => t.topicId === 'Money')?.depth).toBe(1);
    expect(merged.find((t) => t.topicId === 'Health & body')?.depth).toBe(0);
  });
});

describe('buildCoverageGuidance', () => {
  it('is empty before any placement (no topics)', () => {
    expect(buildCoverageGuidance(emptyProfile('p1'))).toBe('');
  });

  it('leads with unexplored/low-depth ground and marks explored areas deepen-only', () => {
    const guidance = buildCoverageGuidance(
      withTopics([
        {
          topicId: 'Money',
          lifeArea: 'Money',
          label: 'Money',
          explored: false,
          depth: 0,
          askedCount: 0,
          saturated: false,
        },
        {
          topicId: 'Work & purpose',
          lifeArea: 'Work & purpose',
          label: 'Work & purpose',
          explored: true,
          depth: 0.9,
          askedCount: 0,
          saturated: false,
        },
        {
          topicId: 'Faith',
          lifeArea: 'Faith',
          label: 'Faith',
          explored: true,
          depth: 0.2,
          askedCount: 0,
          saturated: false,
        },
      ]),
    );
    expect(guidance).toContain('NEW / UNEXPLORED GROUND');
    expect(guidance).toContain('- Money');
    expect(guidance).toContain('- Faith'); // explored but low depth (< 0.4) → still new-ish ground
    expect(guidance).toContain('Already explored');
    expect(guidance).toContain('- Work & purpose');
  });

  it('excludes saturated topics from the new-ground lead', () => {
    const guidance = buildCoverageGuidance(
      withTopics([
        {
          topicId: 'Intimacy:oral',
          lifeArea: 'Intimacy',
          label: 'Oral',
          explored: true,
          depth: 1,
          askedCount: 3,
          saturated: true,
        },
        {
          topicId: 'Money',
          lifeArea: 'Money',
          label: 'Money',
          explored: false,
          depth: 0,
          askedCount: 0,
          saturated: false,
        },
      ]),
    );
    expect(guidance).toContain('- Money');
    expect(guidance).not.toContain('- Oral');
  });

  it('leads an explicit-request (explore-more) area regardless of depth, and excludes it from "already explored"', () => {
    const guidance = buildCoverageGuidance(
      withTopics([
        {
          topicId: 'Work & purpose',
          lifeArea: 'Work & purpose',
          label: 'Work & purpose',
          explored: true,
          depth: 0.9, // deeply explored...
          askedCount: 0,
          saturated: false,
          reopenedBy: 'explicit-request', // ...but the person asked to explore it more
        },
      ]),
    );
    // It appears in the NEW/lead section, not the "already explored / leave these" section.
    const leadSection = guidance.slice(0, guidance.indexOf('Already explored') + 1 || undefined);
    expect(leadSection).toContain('- Work & purpose');
  });
});
