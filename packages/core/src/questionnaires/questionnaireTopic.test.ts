import { describe, expect, it } from 'vitest';
import { questionnaireTopic } from './questionnaireTopic';

describe('questionnaireTopic (28 §13.1 / 08 §24.4-B4)', () => {
  it('maps the intimacy type to Intimacy + Relationships', () => {
    expect(questionnaireTopic('intimacy')?.lifeAreas).toEqual(['Intimacy', 'Relationships']);
  });

  it('themes the relationship/feedback types (§24.4-B4) so a non-intimacy questionnaire gets relevant facts', () => {
    expect(questionnaireTopic('role-feedback')?.lifeAreas).toEqual([
      'Relationships',
      'Work & purpose',
    ]);
    expect(questionnaireTopic('appreciation')?.lifeAreas).toContain('Relationships');
    expect(questionnaireTopic('scenario')?.lifeAreas).toContain('Intimacy');
  });

  it('returns undefined for a broad / general / custom / absent type (⇒ core + fill)', () => {
    expect(questionnaireTopic('general')).toBeUndefined();
    expect(questionnaireTopic('fill-gaps')).toBeUndefined();
    expect(questionnaireTopic('science')).toBeUndefined();
    expect(questionnaireTopic('my-custom-type')).toBeUndefined();
    expect(questionnaireTopic(undefined)).toBeUndefined();
  });
});
