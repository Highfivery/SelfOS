import { registerContextProvider } from '../questionnaires/contextProviders';
import { questionnaireTopic } from '../questionnaires/questionnaireTopic';
import { getTest } from './testCatalog';
import { latestResult } from './testService';

/**
 * 50-self-assessments §5.5 — the test-profile context provider. Registered into 08's `contextProviderRegistry`
 * so AI questionnaire generation + the gap-finder pull the author's self-assessment profiles automatically (no
 * generator changes). Test results are ALSO ordinary own Insights, so they already flow into `buildContext` via
 * `summarizeForContext` (and that path now applies the sensitive-result relevance gate, 50 §3.4). This provider
 * adds a compact, generation-friendly one-line-per-instrument summary even where the raw Insight emit is capped.
 *
 * Sensitivity boundary: a SENSITIVE profile (kink/sexuality) is only included when the questionnaire's topic is
 * intimacy (the same `Intimacy`-lifeArea gate `summarizeForContext` applies) — so a money questionnaire never
 * sees the kink profile. Registered by the app at boot via {@link registerTestContextProvider}.
 */
export function registerTestContextProvider(): void {
  registerContextProvider({
    id: 'tests',
    label: 'Self-assessments',
    gather: async (fs, key, req) => {
      if (!req.includeAuthor) return '';
      const intimacyTopic = (questionnaireTopic(req.questionnaireType)?.lifeAreas ?? []).includes(
        'Intimacy',
      );
      const lines: string[] = [];
      // Walk the catalog; for each instrument the author has taken, summarize the latest result's salient leans.
      for (const test of ['bigfive-ipip-120', 'ecr-r', 'kinsey-klein', 'kink-interests']) {
        const def = getTest(test);
        if (!def) continue;
        if ((def.sensitive ?? false) && !intimacyTopic) continue; // sensitive only for an intimacy topic
        const result = await latestResult(fs, key, req.authorPersonId, test);
        if (!result) continue;
        const subById = new Map(def.scoring.subscales.map((sub) => [sub.key, sub]));
        // The most DISTINCTIVE subscales (furthest from neutral) — bounded to keep the line compact for a long
        // instrument (the kink inventory's 14 categories). Neutral is 0 for a signed subscale, 0.5 for a unit one.
        const ranked = result.scores
          .filter((score) => score.band)
          .map((score) => {
            const out =
              subById.get(score.key)?.normalize.out ??
              (def.scoring.method === 'subscales' ? 'unit' : 'signed');
            const neutral = out === 'signed' ? 0 : 0.5;
            return { score, distance: Math.abs(score.normalized - neutral) };
          })
          .sort((a, b) => b.distance - a.distance)
          .slice(0, 6);
        const parts = ranked.map(
          ({ score }) => `${subById.get(score.key)?.label ?? score.key} ${score.band}`,
        );
        if (parts.length > 0) lines.push(`${def.title}: ${parts.join('; ')}.`);
      }
      return lines.length > 0 ? ['Their self-assessment profile:', ...lines].join('\n') : '';
    },
  });
}
