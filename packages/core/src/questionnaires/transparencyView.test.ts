import { describe, expect, it } from 'vitest';

import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';

import { deriveCoverageSkeleton } from './coverageModel';
import {
  emptyProfile,
  type CoverageTopic,
  type PersonalizationProfile,
} from './personalizationProfile';
import {
  mergeProfileCoverage,
  projectCoverageView,
  readCoverageView,
  steerTopic,
} from './transparencyView';

const key = generateMasterKey();
const now = new Date('2026-08-07T12:00:00.000Z');

const topic = (
  over: Partial<CoverageTopic> & Pick<CoverageTopic, 'topicId' | 'lifeArea'>,
): CoverageTopic => ({
  label: over.lifeArea,
  explored: false,
  depth: 0,
  askedCount: 0,
  saturated: false,
  ...over,
});

describe('projectCoverageView', () => {
  it('buckets each area by depth into explored / lightly-touched / not-yet', () => {
    const topics: CoverageTopic[] = [
      topic({ topicId: 'Work & purpose', lifeArea: 'Work & purpose', depth: 0.8, explored: true }),
      topic({ topicId: 'Health', lifeArea: 'Health', depth: 0.2, explored: true }),
      topic({ topicId: 'Money', lifeArea: 'Money', depth: 0 }),
    ];
    const view = projectCoverageView(topics, emptyProfile('p1'), now);
    const byArea = Object.fromEntries(view.areas.map((a) => [a.lifeArea, a.status]));
    expect(byArea['Work & purpose']).toBe('explored');
    expect(byArea['Health']).toBe('lightly-touched');
    expect(byArea['Money']).toBe('not-yet');
  });

  it('marks general areas steerable and Intimacy read-only', () => {
    const topics: CoverageTopic[] = [
      topic({ topicId: 'Work & purpose', lifeArea: 'Work & purpose' }),
      topic({ topicId: 'Intimacy:oral', lifeArea: 'Intimacy', label: 'Oral' }),
    ];
    const view = projectCoverageView(topics, emptyProfile('p1'), now);
    expect(view.areas.find((a) => a.lifeArea === 'Work & purpose')?.steerable).toBe(true);
    expect(view.areas.find((a) => a.lifeArea === 'Intimacy')?.steerable).toBe(false);
  });

  it('surfaces marked-off topics from the ledger, and NEVER surfaces reciprocity/partner data (spec 69 §6/§8)', () => {
    const profile: PersonalizationProfile = {
      ...emptyProfile('p1'),
      feedback: [
        {
          topicId: 'Health',
          questionPrompt: 'Health',
          kind: 'not-applicable',
          at: now.toISOString(),
        },
        { questionPrompt: 'A skipped one', kind: 'skipped', at: now.toISOString() },
      ],
      relational: {
        reciprocity: [
          {
            fromPartnerId: 'partner-2',
            note: 'partner wants rope play',
            at: now.toISOString(),
            explored: false,
          },
        ],
      },
    };
    const view = projectCoverageView([], profile, now);
    // The not-applicable decline shows; the weak `skipped` one does not.
    expect(view.markedOff.map((m) => m.label)).toEqual(['Health']);
    // Structurally the view has no reciprocity field, and nothing partner-derived leaks into markedOff.
    expect(JSON.stringify(view)).not.toContain('rope play');
    expect(JSON.stringify(view)).not.toContain('partner-2');
  });
});

describe('mergeProfileCoverage', () => {
  it('overlays AI depth on general areas, keeps Intimacy from the skeleton, and appends profile-only topics', () => {
    const skeleton = deriveCoverageSkeleton(); // all uncovered; one Intimacy topic
    const merged = mergeProfileCoverage(skeleton, [
      topic({ topicId: 'Work & purpose', lifeArea: 'Work & purpose', depth: 0.7, explored: true }),
      topic({ topicId: 'Intimacy', lifeArea: 'Intimacy', depth: 0.9, explored: true }), // must NOT override
      topic({
        topicId: 'Work & purpose:career',
        lifeArea: 'Work & purpose',
        label: 'Career',
        depth: 0.5,
      }),
    ]);
    expect(merged.find((t) => t.topicId === 'Work & purpose')?.depth).toBe(0.7);
    // Intimacy stays send-history-fresh (skeleton), not the persisted 0.9.
    expect(merged.find((t) => t.topicId === 'Intimacy')?.depth).toBe(0);
    // The emergent sub-topic is appended.
    expect(merged.some((t) => t.topicId === 'Work & purpose:career')).toBe(true);
  });

  it('overlays the steer flag (reopenedBy) onto the matching skeleton topic', () => {
    const skeleton = deriveCoverageSkeleton();
    const merged = mergeProfileCoverage(skeleton, [
      topic({ topicId: 'Health', lifeArea: 'Health', reopenedBy: 'explicit-request' }),
    ]);
    expect(merged.find((t) => t.topicId === 'Health')?.reopenedBy).toBe('explicit-request');
  });
});

describe('readCoverageView / steerTopic (round-trip)', () => {
  it('reads a full life-area skeleton even with no profile yet', async () => {
    const fs = memFileSystem();
    const view = await readCoverageView(fs, key, 'p1', now);
    expect(view.hasPlacement).toBe(false);
    expect(view.areas.some((a) => a.lifeArea === 'Intimacy')).toBe(true);
    expect(view.areas.every((a) => a.status === 'not-yet')).toBe(true);
  });

  it('leave-alone then explore-more toggle through the persisted profile', async () => {
    const fs = memFileSystem();
    let view = await steerTopic(
      fs,
      key,
      'p1',
      { topicId: 'Health', lifeArea: 'Health', label: 'Health', action: 'leave-alone' },
      now,
    );
    expect(view.markedOff.some((m) => m.topicId === 'Health')).toBe(true);

    view = await steerTopic(
      fs,
      key,
      'p1',
      { topicId: 'Health', lifeArea: 'Health', label: 'Health', action: 'explore-more' },
      now,
    );
    expect(view.markedOff.some((m) => m.topicId === 'Health')).toBe(false);
    expect(view.areas.find((a) => a.lifeArea === 'Health')?.steered).toBe(true);
  });
});
