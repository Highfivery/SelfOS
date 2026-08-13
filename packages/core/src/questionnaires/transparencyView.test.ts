import { describe, expect, it } from 'vitest';

import { generateMasterKey } from '../crypto';
import { memFileSystem } from '../host/memFileSystem';

import { deriveCoverageSkeleton } from './coverageModel';
import {
  emptyProfile,
  writeProfile,
  type CoverageTopic,
  type NextCandidate,
  type PersonalizationProfile,
} from './personalizationProfile';
import {
  curateCandidate,
  mergeProfileCoverage,
  projectCandidateFeed,
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
  it('buckets each area by depth into the honest never-"done" scale (spec 70 §3.3)', () => {
    const topics: CoverageTopic[] = [
      // A HIGH bar for "knows-well" — 0.8 clears it, but 0.5 (a moderately-covered area) does NOT.
      topic({ topicId: 'Work & purpose', lifeArea: 'Work & purpose', depth: 0.8, explored: true }),
      topic({ topicId: 'Relationships', lifeArea: 'Relationships', depth: 0.5, explored: true }),
      topic({ topicId: 'Health', lifeArea: 'Health', depth: 0.2, explored: true }),
      topic({ topicId: 'Money', lifeArea: 'Money', depth: 0 }),
    ];
    const view = projectCoverageView(topics, emptyProfile('p1'), now);
    const byArea = Object.fromEntries(view.areas.map((a) => [a.lifeArea, a.status]));
    expect(byArea['Work & purpose']).toBe('knows-well');
    expect(byArea['Relationships']).toBe('getting-to-know'); // 0.5 is NOT "knows well" — honest high bar
    expect(byArea['Health']).toBe('getting-to-know');
    expect(byArea['Money']).toBe('new');
  });

  it('marks general areas steerable; Intimacy is 18+-gated (steerable only once acked) (spec 70 §3.4)', () => {
    const topics: CoverageTopic[] = [
      topic({ topicId: 'Work & purpose', lifeArea: 'Work & purpose' }),
      topic({ topicId: 'Intimacy:oral', lifeArea: 'Intimacy', label: 'Oral' }),
    ];
    // Not acked: general areas steer; the Intimacy row is 18+-gated (not steerable yet) but present.
    const gated = projectCoverageView(topics, emptyProfile('p1'), now, false);
    const gatedIntimacy = gated.areas.find((a) => a.lifeArea === 'Intimacy');
    expect(gated.areas.find((a) => a.lifeArea === 'Work & purpose')?.steerable).toBe(true);
    expect(gatedIntimacy?.steerable).toBe(false);
    expect(gatedIntimacy?.adultGated).toBe(true);
    expect(gatedIntimacy?.topicId).toBe('Intimacy'); // steers at the AREA level, never one category
    expect(gated.adultAcknowledged).toBe(false);
    // Acked: the Intimacy row becomes steerable like any area.
    const acked = projectCoverageView(topics, emptyProfile('p1'), now, true);
    expect(acked.areas.find((a) => a.lifeArea === 'Intimacy')?.steerable).toBe(true);
    expect(acked.adultAcknowledged).toBe(true);
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
        partnerWishes: [],
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
    const skeleton = deriveCoverageSkeleton(); // all uncovered; one row per intimacy category
    const merged = mergeProfileCoverage(skeleton, [
      topic({ topicId: 'Work & purpose', lifeArea: 'Work & purpose', depth: 0.7, explored: true }),
      // Must NOT override: an intimacy row's numbers come from the ask ledger, never a persisted placement.
      topic({ topicId: 'Intimacy:oral', lifeArea: 'Intimacy', depth: 0.9, explored: true }),
      topic({
        topicId: 'Work & purpose:career',
        lifeArea: 'Work & purpose',
        label: 'Career',
        depth: 0.5,
      }),
    ]);
    expect(merged.find((t) => t.topicId === 'Work & purpose')?.depth).toBe(0.7);
    // The intimacy row stays at the skeleton's zero, not the persisted 0.9.
    expect(merged.find((t) => t.topicId === 'Intimacy:oral')?.depth).toBe(0);
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
    expect(view.areas.every((a) => a.status === 'new')).toBe(true);
    expect(view.candidates).toEqual([]); // no feed until the next-topics pass runs
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

const candidate = (
  over: Partial<NextCandidate> & { id: string; prompt: string },
): NextCandidate => ({
  lifeArea: 'Money',
  kind: 'new',
  curation: 'none',
  at: now.toISOString(),
  ...over,
});

describe('projectCandidateFeed', () => {
  it('shows active candidates pinned-first, excludes skipped + minted, and caps the feed', () => {
    const profile: PersonalizationProfile = {
      ...emptyProfile('p1'),
      candidates: [
        candidate({ id: 'new1', prompt: 'A new-ground question', kind: 'new' }),
        candidate({ id: 'pin', prompt: 'A pinned question', kind: 'new', curation: 'asked' }),
        candidate({ id: 'deep', prompt: 'A deeper thread', kind: 'go-deeper' }),
        candidate({ id: 'skip', prompt: 'A declined question', curation: 'skipped' }),
        candidate({ id: 'asked', prompt: 'An already-asked question', mintedAssignmentId: 'a1' }),
      ],
    };
    const feed = projectCandidateFeed(profile, true);
    expect(feed.map((c) => c.id)).toEqual(['pin', 'deep', 'new1']); // pinned → go-deeper → new
    expect(feed.some((c) => c.id === 'skip')).toBe(false); // skipped excluded
    expect(feed.some((c) => c.id === 'asked')).toBe(false); // minted excluded
    expect(feed.find((c) => c.id === 'pin')?.curation).toBe('asked');
  });

  it('withholds Intimacy candidates until the 18+ ack (spec 70 §3.4/§8)', () => {
    const profile: PersonalizationProfile = {
      ...emptyProfile('p1'),
      candidates: [
        candidate({ id: 'money', lifeArea: 'Money', prompt: 'A money question' }),
        candidate({ id: 'intimacy', lifeArea: 'Intimacy', prompt: 'An explicit question' }),
      ],
    };
    // Not acked (the fail-safe default): the intimacy candidate is withheld.
    expect(projectCandidateFeed(profile).map((c) => c.id)).toEqual(['money']);
    expect(projectCandidateFeed(profile, false).map((c) => c.id)).toEqual(['money']);
    // Acked: it surfaces.
    expect(
      projectCandidateFeed(profile, true)
        .map((c) => c.id)
        .sort(),
    ).toEqual(['intimacy', 'money']);
  });
});

describe('curateCandidate (round-trip)', () => {
  it('persists a curation tap to the OWN profile and returns the refreshed feed', async () => {
    const fs = memFileSystem();
    await writeProfile(fs, key, {
      ...emptyProfile('p1'),
      candidatesRefreshedAt: now.toISOString(),
      candidates: [
        candidate({ id: 'c1', prompt: 'Keep this one?' }),
        candidate({ id: 'c2', prompt: 'Skip this one?' }),
      ],
    });
    // "Not this" on c2 drops it from the feed; c1 stays.
    const view = await curateCandidate(
      fs,
      key,
      'p1',
      { candidateId: 'c2', action: 'not-this' },
      now,
    );
    expect(view.candidates.map((c) => c.id)).toEqual(['c1']);
    expect(view.candidatesRefreshedAt).toBe(now.toISOString());
    // "Ask me this" on c1 pins it (persisted).
    const view2 = await curateCandidate(fs, key, 'p1', { candidateId: 'c1', action: 'ask' }, now);
    expect(view2.candidates.find((c) => c.id === 'c1')?.curation).toBe('asked');
  });
});
