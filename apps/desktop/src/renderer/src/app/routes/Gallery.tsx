import { useState, type ReactNode } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Check,
  CheckCircle2,
  Moon,
  Plus,
  TriangleAlert,
} from 'lucide-react';
import {
  AdminOnlyBadge,
  Button,
  Card,
  Field,
  FrequencyBars,
  Heading,
  IconButton,
  Inline,
  ConfidenceChip,
  LineChart,
  Markdown,
  ProportionBar,
  SegmentedControl,
  Select,
  ShareToggle,
  RelationshipScopePicker,
  Slider,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  TitlebarControl,
  Toast,
  TrendLine,
  type SegmentOption,
} from '../../design-system/components';
import type { Notification } from '@shared/channels';
import type { RelationshipType } from '@selfos/core/schemas';
import { GuidedExerciseCard } from './sessions/GuidedExerciseCard';
import { GuidedStepper } from './sessions/GuidedStepper';
import { NotificationCenter } from '../notifications/NotificationCenter';
import styles from './Gallery.module.css';

const SAMPLE_NOTIFICATIONS: Notification[] = [
  {
    id: 'sync-conflict#2',
    kind: 'sync-conflict',
    severity: 'warning',
    title: 'Sync conflicts found',
    body: '2 sync conflict copies were found in your vault.',
    action: { type: 'reveal-vault' },
    createdAt: new Date(Date.now() - 3 * 60_000).toISOString(),
    coalesceKey: 'sync-conflict',
    signature: '2',
    read: false,
    dismissed: false,
  },
  {
    id: 'responses-arrived:q1#1',
    kind: 'responses-arrived',
    severity: 'info',
    title: 'New questionnaire responses',
    body: '“Weekly check-in” has a new response.',
    action: { type: 'navigate', to: '/questionnaires' },
    createdAt: new Date(Date.now() - 90 * 60_000).toISOString(),
    coalesceKey: 'responses-arrived:q1',
    signature: '1',
    read: true,
    dismissed: false,
  },
];

type Align = 'left' | 'center' | 'right';

// Every supported Markdown construct (34-rich-text-rendering §3.1), for live review in the gallery.
const MARKDOWN_SAMPLE = `### A heading in prose

You come across as **steady** and *thoughtful* — someone who values \`honesty\`.

A few things that stand out:

- You show up for the people you love
- You carry real responsibility at work
  - even when it is heavy

1. Name one feeling
2. Notice what helped

> A gentle reminder to be kind to yourself.

---

Links render as styled, non-navigating text: [findahelpline.com](https://findahelpline.com).`;

const ALIGN_OPTIONS: ReadonlyArray<SegmentOption<Align>> = [
  { value: 'left', label: 'Left', icon: AlignLeft },
  { value: 'center', label: 'Center', icon: AlignCenter },
  { value: 'right', label: 'Right', icon: AlignRight },
];

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className={styles.section}>
      <Heading level={3}>{title}</Heading>
      <div className={styles.demo}>{children}</div>
    </section>
  );
}

/**
 * Dev-only design-system gallery — every primitive in the current theme. Toggle the appearance in
 * the top bar to review light/dark. Reached at /gallery (only registered in dev builds).
 */
export function Gallery(): JSX.Element {
  const [toggle, setToggle] = useState(true);
  const [share, setShare] = useState(true);
  const [scope, setScope] = useState<RelationshipType[]>(['partner']);
  const [align, setAlign] = useState<Align>('center');
  const [textScale, setTextScale] = useState(100);

  return (
    <div className={styles.gallery}>
      <Heading level={1}>Design system</Heading>
      <Text tone="secondary">Every primitive, live in the current theme.</Text>

      <Stack gap={10} className={styles.body}>
        <Section title="Typography">
          <Stack gap={2}>
            <Heading level={1}>Heading level 1</Heading>
            <Heading level={2}>Heading level 2</Heading>
            <Heading level={3}>Heading level 3</Heading>
            <Text>Body text — the default UI voice.</Text>
            <Text tone="secondary">Secondary text for supporting detail.</Text>
            <Text tone="tertiary" size="sm">
              Tertiary, small — captions and meta.
            </Text>
            <Text serif size="md" tone="secondary">
              A serif passage, set in Lora for long-form reading.
            </Text>
          </Stack>
        </Section>

        <Section title="Buttons">
          <Inline gap={3} wrap>
            <Button variant="primary">
              <Check size={16} aria-hidden="true" /> Primary
            </Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="secondary" size="sm">
              Small
            </Button>
            <Button variant="secondary" disabled>
              Disabled
            </Button>
            <IconButton aria-label="Add" variant="secondary">
              <Plus size={16} aria-hidden="true" />
            </IconButton>
          </Inline>
        </Section>

        <Section title="Inputs">
          <Stack gap={5} className={styles.column}>
            <Field label="Name" help="How you'd like to be addressed.">
              {(props) => <TextInput placeholder="e.g. Ben" {...props} />}
            </Field>
            <Field label="Email" error="That doesn't look like a valid email.">
              {(props) => <TextInput type="email" defaultValue="not-an-email" {...props} />}
            </Field>
            <Field label="Reminder">
              {(props) => (
                <Select defaultValue="weekly" {...props}>
                  <option value="off">Off</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </Select>
              )}
            </Field>
            <Field label="Notes" help="Multi-line input (used for shared & private notes).">
              {(props) => <Textarea placeholder="A few words you'd like to remember…" {...props} />}
            </Field>
          </Stack>
        </Section>

        <Section title="Controls">
          <Stack gap={5}>
            <Inline gap={4}>
              <Switch checked={toggle} onChange={setToggle} aria-label="Demo toggle" />
              <Text tone="secondary">{toggle ? 'On' : 'Off'}</Text>
            </Inline>
            <Inline gap={3} align="center">
              <ShareToggle shared={share} onChange={setShare} label="Occupation" />
              <Text tone="secondary" size="sm">
                Per-item shareability — {share ? 'shared with related people' : 'kept private'}
              </Text>
            </Inline>
            <Inline gap={3} align="center">
              <RelationshipScopePicker value={scope} onChange={setScope} label="Sleep schedule" />
              <Text tone="secondary" size="sm">
                Relationship-type sharing (42) — informs their AI coaching, never shown to them
              </Text>
            </Inline>
            <Inline gap={3} align="center">
              <ConfidenceChip level="low" />
              <ConfidenceChip level="medium" rationale="seen in 2 sessions" />
              <ConfidenceChip level="high" rationale="corroborated by 4 sources" />
              <Text tone="secondary" size="sm">
                Memory confidence — text + non-colour-only dots, rationale on hover
              </Text>
            </Inline>
            <SegmentedControl
              options={ALIGN_OPTIONS}
              value={align}
              onChange={setAlign}
              aria-label="Alignment"
            />
            <Inline gap={4} className={styles.column}>
              <Slider
                min={80}
                max={130}
                step={5}
                value={textScale}
                onChange={(event) => setTextScale(Number(event.target.value))}
                aria-label="Text size"
              />
              <Text tone="secondary" size="sm">
                {textScale}%
              </Text>
            </Inline>
          </Stack>
        </Section>

        <Section title="Titlebar controls">
          <Stack gap={2}>
            <Text tone="secondary" size="sm">
              The shared titlebar primitive — every AppHeader control (sync chip, usage, appearance,
              account) renders through it, so they share one height, hit area, and hover/focus.
            </Text>
            <Inline gap={3} align="center">
              <TitlebarControl aria-label="Appearance: System">
                <Moon size={18} aria-hidden="true" />
              </TitlebarControl>
              <TitlebarControl aria-label="Vault: all synced">
                <CheckCircle2 size={16} aria-hidden="true" />
              </TitlebarControl>
              <TitlebarControl tone="warning" aria-label="2 sync conflicts">
                <TriangleAlert size={16} aria-hidden="true" />
                <Text size="xs" weight={600}>
                  2
                </Text>
              </TitlebarControl>
              <TitlebarControl aria-label="Usage: 30%">
                <Text size="xs">30%</Text>
              </TitlebarControl>
            </Inline>
          </Stack>
        </Section>

        <Section title="Surface">
          <Card>
            <Stack gap={2}>
              <Heading level={3}>Card</Heading>
              <Text tone="secondary">
                A raised surface for grouping content, on a warm-neutral background.
              </Text>
            </Stack>
          </Card>
        </Section>

        <Section title="Markers">
          <Inline gap={3} wrap>
            <AdminOnlyBadge />
            <Text tone="secondary" size="sm">
              Sits beside any heading or control that only admins can see.
            </Text>
          </Inline>
        </Section>

        <Section title="Line chart">
          <div style={{ maxWidth: 360 }}>
            <LineChart
              ariaLabel="Example trend with two series"
              series={[
                {
                  label: 'Mara',
                  points: [
                    { x: 0, y: 3 },
                    { x: 1, y: 4 },
                    { x: 2, y: 4 },
                    { x: 3, y: 5 },
                  ],
                },
                {
                  label: 'Sam',
                  points: [
                    { x: 0, y: 5 },
                    { x: 1, y: 3 },
                    { x: 2, y: 4 },
                    { x: 3, y: 2 },
                  ],
                },
              ]}
            />
          </div>
        </Section>

        <Section title="Charts">
          <Stack gap={4}>
            <div>
              <Text size="sm" weight={600} tone="secondary">
                FrequencyBars — ranked recurrence (count rendered as text)
              </Text>
              <FrequencyBars
                items={[
                  { label: 'water', value: 6 },
                  { label: 'house', value: 4 },
                  { label: 'flight', value: 2 },
                ]}
              />
            </div>
            <div>
              <Text size="sm" weight={600} tone="secondary">
                ProportionBar — a single proportion (value of total)
              </Text>
              <Stack gap={2}>
                <ProportionBar label="Lucid dreams" value={3} total={12} />
                <ProportionBar label="Nightmares" value={5} total={12} tone="warning" />
              </Stack>
            </div>
            <div>
              <Text size="sm" weight={600} tone="secondary">
                TrendLine — a value over time (scales to width)
              </Text>
              <TrendLine
                points={[
                  { date: '2026-06-01', value: -0.5 },
                  { date: '2026-06-04', value: 0.2 },
                  { date: '2026-06-07', value: 0 },
                  { date: '2026-06-10', value: 0.6 },
                ]}
                min={-1}
                max={1}
                aria-label="Example mood trend"
              />
            </div>
          </Stack>
        </Section>

        <Section title="Guided sessions (16)">
          <Stack gap={5} className={styles.column}>
            <Text size="sm" weight={600} tone="secondary">
              GuidedExerciseCard — catalog + suggestion (with personalized reason)
            </Text>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 'var(--space-3)',
              }}
            >
              <GuidedExerciseCard
                exercise={{
                  id: 'demo-chat',
                  title: 'Values Clarification',
                  framework: 'ACT',
                  blurb: 'Reconnect with what matters most to you.',
                  kind: 'chat',
                }}
                onPick={() => {}}
              />
              <GuidedExerciseCard
                exercise={{
                  id: 'demo-structured',
                  title: 'Thought Record',
                  framework: 'CBT',
                  blurb: 'Examine a difficult thought and find a more balanced perspective.',
                  kind: 'structured',
                }}
                reason="You mentioned a worry that keeps looping — this can help untangle it."
                onPick={() => {}}
              />
            </div>
            <Text size="sm" weight={600} tone="secondary">
              GuidedStepper — current step marked (not colour alone)
            </Text>
            <GuidedStepper
              steps={[
                'Situation',
                'Feelings',
                'Automatic thoughts',
                'Evidence',
                'Balanced reframe',
              ]}
              current={2}
            />
          </Stack>
        </Section>

        <Section title="Markdown (AI prose)">
          <Stack gap={3}>
            <Card>
              <Markdown>{MARKDOWN_SAMPLE}</Markdown>
            </Card>
            <Text size="sm" tone="secondary">
              Inline mode (for short facts) — emphasis + code only, no block elements:
            </Text>
            <Card>
              <Markdown inline>
                {'Feels most connected through **shared time** and `rituals`.'}
              </Markdown>
            </Card>
          </Stack>
        </Section>

        <Section title="Notifications (35)">
          <Stack gap={5}>
            <Text tone="secondary" size="sm">
              Toasts — top-right pop-ups; info/success auto-dismiss, warning is sticky:
            </Text>
            <Stack gap={2}>
              <Toast
                severity="info"
                title="Heads up"
                body="An informational toast."
                onClose={() => {}}
              />
              <Toast
                severity="success"
                title="All set"
                body="Something finished successfully."
                onClose={() => {}}
              />
              <Toast
                severity="warning"
                title="Sync conflicts found"
                body="2 sync conflict copies were found in your vault."
                actionLabel="Resolve"
                onAction={() => {}}
                onClose={() => {}}
              />
            </Stack>
            <Text tone="secondary" size="sm">
              The notification center — opened from the titlebar bell (unread row first, with a
              dot):
            </Text>
            <div style={{ position: 'relative', minHeight: 220 }}>
              <NotificationCenter
                notifications={SAMPLE_NOTIFICATIONS}
                onAction={() => {}}
                onDismiss={() => {}}
                onDismissAll={() => {}}
                onMarkAllRead={() => {}}
              />
            </div>
          </Stack>
        </Section>
      </Stack>
    </div>
  );
}
