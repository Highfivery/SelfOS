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
  'questionnaire.dedup': 'Questionnaire — de-dup pass',
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
  'goal.suggest': 'Goals — AI suggestions',
  'relationship.synthesize': 'Memory — relationship insights',
  'test.narrate': 'Self-assessment — what it means',
  'challenge.suggest': 'Challenge suggestion',
  'intimacy.suggestTopics': 'Intimacy topics — AI suggestions',
  'together.chat': 'Together — couples session',
  'together.analyze': 'Together — session summary',
  'story.outline': 'Your Story — outline',
  'story.chapter': 'Your Story — chapter',
  'story.interview': 'Your Story — interview questions',
  'story.imagePrompt': 'Your Story — image prompt',
  'story.image': 'Your Story — image',
};

export function usageTypeLabel(type: string): string {
  return USAGE_TYPE_LABELS[type] ?? type;
}
