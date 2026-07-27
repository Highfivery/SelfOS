import { useEffect, useState } from 'react';
import type { ImageFeature } from '@shared/channels';
import {
  Field,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
} from '../design-system/components';
import { useImagePrefsStore } from '../stores/imagePrefsStore';
import {
  DEFAULT_IMAGE_STYLE,
  IMAGE_STYLE_PRESETS,
  isKnownStyle,
} from '../app/routes/dreams/imageStyles';

const CUSTOM = '__custom__';

/**
 * Presentational image-style picker: a grouped **preset select** plus a **Custom…** free-text option. The
 * value is a free string (a preset key or the user's own words), so a custom style needs no migration.
 * Reused by the global dream-image setting (`ImageStyleControl`) AND the per-book story image style (§3.8),
 * so the two never drift. `onChange` fires with the chosen preset value or the trimmed custom text.
 */
export function ImageStylePicker({
  value,
  onChange,
  label = 'Image style',
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}): JSX.Element {
  const current = value || DEFAULT_IMAGE_STYLE;
  const startsCustom = !isKnownStyle(current);
  const [mode, setMode] = useState<'preset' | 'custom'>(startsCustom ? 'custom' : 'preset');
  const [customText, setCustomText] = useState(startsCustom ? current : '');

  const selectValue = mode === 'custom' ? CUSTOM : current;

  return (
    <Stack gap={2}>
      <Select
        value={selectValue}
        aria-label={label}
        onChange={(e) => {
          const v = e.target.value;
          if (v === CUSTOM) {
            setMode('custom');
            if (customText.trim()) onChange(customText.trim());
          } else {
            setMode('preset');
            onChange(v);
          }
        }}
      >
        {IMAGE_STYLE_PRESETS.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
        <optgroup label="Your own">
          <option value={CUSTOM}>Custom…</option>
        </optgroup>
      </Select>
      {mode === 'custom' ? (
        <Field label="Custom style">
          {(props) => (
            <TextInput
              {...props}
              value={customText}
              placeholder="e.g. soft watercolor, muted palette, storybook feel"
              onChange={(e) => {
                setCustomText(e.target.value);
                if (e.target.value.trim()) onChange(e.target.value.trim());
              }}
            />
          )}
        </Field>
      ) : null}
    </Stack>
  );
}

/**
 * The PER-PERSON image preferences control for one use-type (Dreams or Your Story) — the on/off toggle,
 * the style, and the free-text style direction (image-settings amendment). Backed by
 * `people/<personId>/imagePrefs.enc` (via the store), so each household member's choice is their own and one
 * person changing it never overwrites another's (the reported bug). The image MODEL + the OpenAI key stay
 * owner-managed settings alongside this control. `defaultStyle` seeds the picker when unset.
 */
export function ImagePrefsControl({
  feature,
  defaultStyle,
  copy,
}: {
  feature: ImageFeature;
  defaultStyle: string;
  copy: string;
}): JSX.Element {
  const prefs = useImagePrefsStore((s) => s.prefs);
  const loaded = useImagePrefsStore((s) => s.loaded);
  const load = useImagePrefsStore((s) => s.load);
  const setFeature = useImagePrefsStore((s) => s.setFeature);
  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const fp = prefs?.[feature];
  const enabled = fp?.enabled ?? false;

  return (
    <Stack gap={3}>
      <Stack gap={1}>
        <Switch
          checked={enabled}
          onChange={(v) => void setFeature(feature, { enabled: v })}
          aria-label="AI image generation"
        />
        <Text size="sm" tone="secondary">
          {copy}
        </Text>
      </Stack>
      {enabled ? (
        <Stack gap={3}>
          <Field label="Image style">
            {() => (
              <ImageStylePicker
                value={fp?.style || defaultStyle}
                onChange={(v) => void setFeature(feature, { style: v })}
              />
            )}
          </Field>
          <Field label="Style direction (optional)">
            {(props) => (
              <Textarea
                {...props}
                rows={3}
                maxLength={300}
                value={fp?.styleNotes ?? ''}
                placeholder="muted earth tones, soft focus, golden-hour light…"
                onChange={(e) => void setFeature(feature, { styleNotes: e.target.value })}
              />
            )}
          </Field>
        </Stack>
      ) : null}
    </Stack>
  );
}

/** Per-person DREAM image preferences (image-settings amendment). */
export function DreamImagePrefsControl(): JSX.Element {
  return (
    <ImagePrefsControl
      feature="dreams"
      defaultStyle="dreamlike"
      copy="When on, SelfOS can create AI images for your dreams. Generating sends a description (never anyone’s name or private notes) to OpenAI to draw the picture. This is your own setting — it doesn’t change anyone else’s."
    />
  );
}

/** Per-person YOUR STORY image preferences (image-settings amendment). */
export function StoryImagePrefsControl(): JSX.Element {
  return (
    <ImagePrefsControl
      feature="story"
      defaultStyle="oil painting"
      copy="When on, SelfOS can create your story’s cover and illustrations. Generating sends a description (never anyone’s name or private notes) to OpenAI. This is your own setting; a specific book can still override the style on its own page."
    />
  );
}
