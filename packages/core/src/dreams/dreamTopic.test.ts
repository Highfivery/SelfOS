import { describe, expect, it } from 'vitest';
import type { Dream } from '../schemas';
import { dreamTopic } from './dreamTopic';

function dream(over: Partial<Dream>): Dream {
  return {
    id: 'd1',
    schemaVersion: 1,
    personId: 'p1',
    narrative: 'a dream',
    lucid: false,
    nightmare: false,
    tags: [],
    people: [],
    sensitivity: 'standard',
    status: 'captured',
    createdAt: 'now',
    updatedAt: 'now',
    ...over,
  };
}

describe('dreamTopic (28 §13.1)', () => {
  it('derives life-areas from tags/narrative keywords', () => {
    const topic = dreamTopic(dream({ tags: ['money', 'work'], narrative: 'I lost my job' }));
    expect(topic?.lifeAreas).toContain('Money');
    expect(topic?.lifeAreas).toContain('Work & purpose');
  });

  it('a nightmare always adds Emotions & patterns', () => {
    expect(dreamTopic(dream({ nightmare: true }))?.lifeAreas).toContain('Emotions & patterns');
  });

  it('a heavy negative waking mood adds Emotions & patterns', () => {
    expect(dreamTopic(dream({ mood: -0.8 }))?.lifeAreas).toContain('Emotions & patterns');
  });

  it('people present add Relationships', () => {
    const topic = dreamTopic(dream({ people: [{ name: 'Sam' }] }));
    expect(topic?.lifeAreas).toContain('Relationships');
  });

  it('widens by a linked person’s relationship: a partner → Intimacy + Relationships', () => {
    const topic = dreamTopic(dream({ people: [{ personId: 'p2' }] }), ['partner']);
    expect(topic?.lifeAreas).toContain('Intimacy');
    expect(topic?.lifeAreas).toContain('Relationships');
  });

  it('a parent/sibling/child → Family (+ Relationships from people-present)', () => {
    const topic = dreamTopic(dream({ people: [{ personId: 'p2' }] }), ['parent']);
    expect(topic?.lifeAreas).toContain('Family');
    expect(topic?.lifeAreas).toContain('Relationships');
    expect(topic?.lifeAreas).not.toContain('Intimacy');
  });

  it('a coworker → Work & purpose + Relationships', () => {
    const topic = dreamTopic(dream({ people: [{ personId: 'p2' }] }), ['coworker']);
    expect(topic?.lifeAreas).toContain('Work & purpose');
    expect(topic?.lifeAreas).toContain('Relationships');
  });

  it('returns undefined when there is no mappable signal (⇒ core + fill)', () => {
    expect(dreamTopic(dream({ narrative: 'a quiet field of flowers' }))).toBeUndefined();
  });
});
