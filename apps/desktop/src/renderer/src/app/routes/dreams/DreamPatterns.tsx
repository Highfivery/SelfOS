import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BookHeart, Sparkles } from 'lucide-react';
import { ANTHROPIC_API_KEY_ID } from '@shared/channels';
import type { SegmentOption } from '../../../design-system/components';
import type { DreamPatternWindow } from '@shared/schemas';
import { useDreamPatternStore } from '../../../stores/dreamPatternStore';
import { useSetting } from '../../../settings/useSetting';
import {
  Banner,
  Button,
  Card,
  FrequencyBars,
  Heading,
  ProportionBar,
  SegmentedControl,
  Stack,
  Text,
  TrendLine,
} from '../../../design-system/components';
import { CrisisFooter } from '../sessions/CrisisFooter';
import styles from './DreamPatterns.module.css';

const WINDOW_OPTIONS: ReadonlyArray<SegmentOption<DreamPatternWindow>> = [
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'all', label: 'All time' },
];

/** Map the stats' `{label,count}` rows to the `FrequencyBars` `{label,value}` shape. */
function bars(items: { label: string; count: number }[]): { label: string; value: number }[] {
  return items.map((item) => ({ label: item.label, value: item.count }));
}

/**
 * Cross-dream patterns (12-dreams §3.5): deterministic charts over a chosen window + an on-demand AI
 * narrative the dreamer can approve into context. Dreamer-only; a gentle recurring-nightmare nudge
 * surfaces here. The deterministic charts never need AI; only the narrative does.
 */
export function DreamPatterns(): JSX.Element {
  const navigate = useNavigate();
  const [aiEnabled] = useSetting('ai.enabled');
  const [memoryEnabledSetting] = useSetting('dreams.memoryEnabled');
  const [hasKey, setHasKey] = useState(false);

  const period = useDreamPatternStore((s) => s.window);
  const stats = useDreamPatternStore((s) => s.stats);
  const summary = useDreamPatternStore((s) => s.summary);
  const loaded = useDreamPatternStore((s) => s.loaded);
  const generating = useDreamPatternStore((s) => s.generating);
  const approving = useDreamPatternStore((s) => s.approving);
  const error = useDreamPatternStore((s) => s.error);
  const load = useDreamPatternStore((s) => s.load);
  const setWindow = useDreamPatternStore((s) => s.setWindow);
  const generate = useDreamPatternStore((s) => s.generate);
  const approve = useDreamPatternStore((s) => s.approve);
  const removeFromContext = useDreamPatternStore((s) => s.removeFromContext);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void (async () => {
      setHasKey(Boolean(await window.selfos?.secretHas({ id: ANTHROPIC_API_KEY_ID })));
    })();
  }, []);

  const configured = aiEnabled && hasKey;
  const memoryEnabled = memoryEnabledSetting !== false;
  const approved = Boolean(summary?.insightId);
  const empty = loaded && stats !== null && stats.dreamCount === 0;

  return (
    <div className={styles.layout}>
      <button type="button" className={styles.back} onClick={() => navigate('/dreams')}>
        <ArrowLeft size={16} aria-hidden="true" />
        Dreams
      </button>

      <div className={styles.header}>
        <Heading level={2}>Dream patterns</Heading>
        <SegmentedControl
          options={WINDOW_OPTIONS}
          value={period}
          onChange={(value) => void setWindow(value)}
          aria-label="Pattern time window"
        />
      </div>

      {stats?.nightmareNudge ? (
        <Banner tone="warning">
          You’ve noted some distressing dreams recently. Recurring nightmares can be worth talking
          through — with someone you trust, or a professional. There’s support below if you’d like
          it.
        </Banner>
      ) : null}

      {empty ? (
        <div className={styles.emptyState}>
          <Stack gap={2} align="center">
            <Heading level={3}>Patterns appear as you log more</Heading>
            <Text tone="secondary">
              Once you’ve captured a few dreams, recurring symbols, people, and emotional threads
              show up here.
            </Text>
            <Button variant="primary" onClick={() => navigate('/dreams')}>
              Log a dream
            </Button>
          </Stack>
        </div>
      ) : (
        <>
          <div className={styles.grid}>
            <Card>
              <Stack gap={3}>
                <Heading level={3}>Recurring symbols &amp; themes</Heading>
                <Text size="sm" weight={600} tone="secondary">
                  Symbols
                </Text>
                <FrequencyBars
                  items={bars(stats?.symbols ?? [])}
                  emptyLabel="No symbols tagged yet."
                />
                <Text size="sm" weight={600} tone="secondary">
                  Themes
                </Text>
                <FrequencyBars
                  items={bars(stats?.themes ?? [])}
                  emptyLabel="No themes tagged yet."
                />
              </Stack>
            </Card>

            <Card>
              <Stack gap={3}>
                <Heading level={3}>Who appears</Heading>
                <FrequencyBars
                  items={bars(stats?.people ?? [])}
                  emptyLabel="No one tagged in your dreams yet."
                />
              </Stack>
            </Card>

            <Card>
              <Stack gap={3}>
                <Heading level={3}>Emotional themes</Heading>
                <FrequencyBars
                  items={bars(stats?.emotions ?? [])}
                  emptyLabel="Emotions appear once you analyze a dream."
                />
              </Stack>
            </Card>

            <Card>
              <Stack gap={3}>
                <Heading level={3}>Sleep rhythms</Heading>
                <ProportionBar
                  label="Lucid dreams"
                  value={stats?.lucidCount ?? 0}
                  total={stats?.dreamCount ?? 0}
                />
                <ProportionBar
                  label="Nightmares"
                  value={stats?.nightmareCount ?? 0}
                  total={stats?.dreamCount ?? 0}
                  tone="warning"
                />
                <div className={styles.trend}>
                  <Text size="sm" weight={600} tone="secondary">
                    Waking mood over time
                  </Text>
                  <TrendLine
                    points={stats?.moodTrend ?? []}
                    min={-1}
                    max={1}
                    aria-label="Waking mood over time"
                    emptyLabel="Record a waking mood to see this trend."
                  />
                </div>
                <div className={styles.trend}>
                  <Text size="sm" weight={600} tone="secondary">
                    Vividness over time
                  </Text>
                  <TrendLine
                    points={stats?.vividnessTrend ?? []}
                    min={1}
                    max={5}
                    aria-label="Vividness over time"
                    emptyLabel="Record vividness to see this trend."
                  />
                </div>
              </Stack>
            </Card>
          </div>

          <Card>
            <Stack gap={3}>
              <div className={styles.narrativeHead}>
                <Heading level={3}>What I’m noticing</Heading>
                {approved ? (
                  <span className={styles.contextBadge}>
                    <BookHeart size={14} aria-hidden="true" />
                    In your coaching context
                  </span>
                ) : null}
              </div>
              <Text size="xs" tone="tertiary">
                A reflection across your recent dreams — something to wonder about, not a diagnosis.
              </Text>

              {error ? <Banner tone="warning">{error}</Banner> : null}

              {summary ? (
                <>
                  <Text className={styles.narrativeBody} tone="secondary">
                    {summary.narrative}
                  </Text>
                  <Text size="xs" tone="tertiary">
                    Reflecting on dreams from {summary.windowFrom} to {summary.windowTo}.
                  </Text>
                  <div className={styles.narrativeActions}>
                    {configured ? (
                      <Button
                        variant="secondary"
                        onClick={() => void generate()}
                        disabled={generating}
                      >
                        <Sparkles size={16} aria-hidden="true" />
                        {generating ? 'Reflecting…' : 'Regenerate'}
                      </Button>
                    ) : null}
                    {approved ? (
                      <Button variant="secondary" onClick={() => void removeFromContext()}>
                        Remove from context
                      </Button>
                    ) : (
                      <div className={styles.approveWrap}>
                        <Button
                          variant="primary"
                          onClick={() => void approve()}
                          disabled={!memoryEnabled || approving}
                        >
                          Add to my coaching context
                        </Button>
                        {!memoryEnabled ? (
                          <Text size="xs" tone="tertiary">
                            Turn on Dream memory in Settings to add this.
                          </Text>
                        ) : null}
                      </div>
                    )}
                  </div>
                </>
              ) : configured ? (
                <div className={styles.narrativeActions}>
                  <Button variant="primary" onClick={() => void generate()} disabled={generating}>
                    <Sparkles size={16} aria-hidden="true" />
                    {generating ? 'Reflecting…' : 'Generate a reflection'}
                  </Button>
                </div>
              ) : (
                <Stack gap={2} align="start">
                  <Text tone="secondary">
                    Connect Claude to reflect across your dreams. Your charts above work without it.
                  </Text>
                  <Button variant="secondary" onClick={() => navigate('/settings')}>
                    Open Settings
                  </Button>
                </Stack>
              )}
            </Stack>
          </Card>
        </>
      )}

      <CrisisFooter />
    </div>
  );
}
