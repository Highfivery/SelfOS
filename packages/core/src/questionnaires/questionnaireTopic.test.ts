import { describe, expect, it } from 'vitest';
import { questionnaireTopic } from './questionnaireTopic';

describe('questionnaireTopic (28 §13.1)', () => {
  it('maps the intimacy type to Intimacy + Relationships', () => {
    expect(questionnaireTopic('intimacy')?.lifeAreas).toEqual(['Intimacy', 'Relationships']);
  });

  it('returns undefined for an unthemed / general / custom / absent type (⇒ core + fill)', () => {
    expect(questionnaireTopic('general')).toBeUndefined();
    expect(questionnaireTopic('role-feedback')).toBeUndefined();
    expect(questionnaireTopic('my-custom-type')).toBeUndefined();
    expect(questionnaireTopic(undefined)).toBeUndefined();
  });
});
