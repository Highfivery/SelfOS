import { useState } from 'react';
import { Field, Select, Stack, Text, TextInput } from '../design-system/components';
import { useSetting } from './useSetting';
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
 * The global dream-image style control (`dreams.imageStyle`) — used by every dream image. (Your story uses
 * its OWN image style, set in the Story settings section, §3.8.)
 */
export function ImageStyleControl(): JSX.Element {
  const [stored, setStyle] = useSetting('dreams.imageStyle');
  return (
    <Stack gap={2}>
      <ImageStylePicker value={stored ?? DEFAULT_IMAGE_STYLE} onChange={setStyle} />
      <Text size="sm" tone="secondary">
        Used for your dream images. Your story has its own image style in Your Story → Story
        settings.
      </Text>
    </Stack>
  );
}
