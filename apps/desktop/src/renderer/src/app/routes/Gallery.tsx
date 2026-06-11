import { useState, type ReactNode } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Check, Plus } from 'lucide-react';
import {
  AdminOnlyBadge,
  Button,
  Card,
  Field,
  Heading,
  IconButton,
  Inline,
  LineChart,
  SegmentedControl,
  Select,
  Slider,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  type SegmentOption,
} from '../../design-system/components';
import styles from './Gallery.module.css';

type Align = 'left' | 'center' | 'right';

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
      </Stack>
    </div>
  );
}
