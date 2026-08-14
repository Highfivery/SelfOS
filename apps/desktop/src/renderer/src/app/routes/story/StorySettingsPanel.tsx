import {
  Card,
  Field,
  Heading,
  Inline,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
} from '../../../design-system/components';
import { ImageStylePicker } from '../../../settings/ImageStyleControl';
import { useImagePrefsStore } from '../../../stores/imagePrefsStore';
import { useStoryStore } from '../../../stores/storyStore';
import { useEffect, useState } from 'react';
import type { BookConfig } from '@shared/schemas';
import { LENGTH_OPTIONS, STYLE_CHOICES, VOICE_OPTIONS } from './bookConfigOptions';
import type { Length, Style, Voice } from './bookConfigOptions';

/**
 * Story settings (§3.8/§13.4) — the Settings tab's Writing + Images groups, where the person configures THIS
 * book: its writing (voice, tone, length, auto-refresh) and its own image look (style + direction, independent
 * of the app-wide dream-image style). All persist to `BookConfig` via `storyUpdate`; writing changes steer
 * FUTURE rewrites (existing chapters keep their text until re-drafted/refreshed). A `draft` mirror avoids a
 * stale-closure lost update across quick successive changes; the notes textarea persists on blur.
 */
export function StorySettingsPanel({
  bookId,
  config,
}: {
  bookId: string;
  config: BookConfig;
}): JSX.Element {
  const update = useStoryStore((s) => s.update);
  // The fallback when this book hasn't set its own style is the author's per-person STORY style
  // (image-settings amendment) — no longer a single global value.
  const storyPrefsStyle = useImagePrefsStore((s) => s.prefs?.story.style);
  const imagePrefsLoaded = useImagePrefsStore((s) => s.loaded);
  const loadImagePrefs = useImagePrefsStore((s) => s.load);
  useEffect(() => {
    if (!imagePrefsLoaded) void loadImagePrefs();
  }, [imagePrefsLoaded, loadImagePrefs]);
  const [draft, setDraft] = useState<BookConfig>(config);
  useEffect(() => setDraft(config), [config]);
  const [notes, setNotes] = useState(config.imageStyleNotes ?? '');
  useEffect(() => setNotes(config.imageStyleNotes ?? ''), [config.imageStyleNotes]);

  const saveField = (patch: Partial<BookConfig>): void => {
    const next = { ...draft, ...patch };
    setDraft(next);
    void update(bookId, { config: next });
  };
  const saveNotes = (): void => {
    if ((config.imageStyleNotes ?? '') === notes) return;
    const next = { ...draft, imageStyleNotes: notes };
    setDraft(next);
    void update(bookId, { config: next });
  };

  const styleHint = STYLE_CHOICES.find((s) => s.value === draft.style)?.hint ?? '';
  // Show what images will actually use: this book's own style, or your per-person story style until one is chosen.
  const effectiveImageStyle = draft.imageStyle ?? storyPrefsStyle ?? '';

  return (
    <>
      <Card>
        <Stack gap={3}>
          <Heading level={2}>Writing</Heading>
          <Text size="sm" tone="secondary">
            Steers every future rewrite — existing chapters keep their text until they’re re-drafted
            or refreshed.
          </Text>
          <Field label="Narrative voice">
            {(p) => (
              <Select
                {...p}
                value={draft.voice}
                onChange={(e) => saveField({ voice: e.target.value as Voice })}
              >
                {VOICE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Tone">
            {(p) => (
              <Select
                {...p}
                value={draft.style}
                onChange={(e) => saveField({ style: e.target.value as Style })}
              >
                {STYLE_CHOICES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {styleHint ? (
            <Text size="sm" tone="secondary">
              {styleHint}
            </Text>
          ) : null}
          <Field label="Length">
            {(p) => (
              <Select
                {...p}
                value={draft.length}
                onChange={(e) => saveField({ length: e.target.value as Length })}
              >
                {LENGTH_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Inline justify="space-between" align="start">
            <Stack gap={1}>
              <Text size="sm" weight={500}>
                Auto-refresh
              </Text>
              <Text size="sm" tone="secondary">
                Rewrite chapters that fall out of date, on a gentle weekly cadence.
              </Text>
            </Stack>
            <Switch
              checked={draft.autoRefresh}
              onChange={(v) => saveField({ autoRefresh: v })}
              aria-label="Auto-refresh stale chapters"
            />
          </Inline>
        </Stack>
      </Card>

      <Card>
        <Stack gap={3}>
          <Heading level={2}>Images</Heading>
          <Text size="sm" tone="secondary">
            The look for this book’s cover and chapter illustrations — independent of your dream
            images (which have their own style in Settings → Images).
          </Text>
          <Stack gap={1}>
            <Text size="sm" weight={500}>
              Image style
            </Text>
            <ImageStylePicker
              value={effectiveImageStyle}
              onChange={(v) => saveField({ imageStyle: v })}
            />
          </Stack>
          <Field label="Style direction (optional)">
            {(p) => (
              <Textarea
                {...p}
                rows={3}
                maxLength={300}
                value={notes}
                placeholder="muted earth tones, soft focus, golden-hour light…"
                onChange={(e) => setNotes(e.target.value)}
                onBlur={saveNotes}
              />
            )}
          </Field>
        </Stack>
      </Card>
    </>
  );
}
