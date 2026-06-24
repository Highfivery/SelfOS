/**
 * AI usage types (06-ai-usage-and-budgets §3). Each AI call is tagged with a type so usage rolls up
 * by what the AI was used for. Features add entries here; `chat` is the first.
 */
export const USAGE_TYPE_LABELS: Record<string, string> = {
  chat: 'Coaching session',
  'session.topic': 'Session — topic',
  'session.analyze': 'Session summary',
  'guided.suggest': 'Session suggestions',
  'questionnaire.generate': 'Questionnaire — AI draft',
  'questionnaire.suggest': 'Questionnaire — suggestions',
  'questionnaire.analyze': 'Questionnaire — analysis',
  'dream.analyze': 'Dream analysis',
  'dream.patterns': 'Dream patterns',
  'dream.imagePrompt': 'Dream image — prompt',
  'dream.image': 'Dream image',
  'intake.interview': 'Onboarding — interview',
  'intake.synthesize': 'Onboarding — portrait',
  'memory.reconcile': 'Memory — refresh',
  'coaching.synthesize': 'Coaching — weekly synthesis',
};

export function usageTypeLabel(type: string): string {
  return USAGE_TYPE_LABELS[type] ?? type;
}
