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
 * The single global image-style control (`dreams.imageStyle`) — used by EVERY AI image across SelfOS (dream
 * images + your story's cover and illustrations), so they all share one look. You either **pick** a curated
 * preset or choose **Custom…** and **enter** your own style in plain words. The stored value is a free string
 * (a preset key or your custom text), so a custom style needs no migration. A separate "style direction" note
 * (`dreams.imageStyleNotes`) refines whichever you pick.
 */
export function ImageStyleControl(): JSX.Element {
  const [stored, setStyle] = useSetting('dreams.imageStyle');
  const current = stored ?? DEFAULT_IMAGE_STYLE;
  const startsCustom = !isKnownStyle(current);
  const [mode, setMode] = useState<'preset' | 'custom'>(startsCustom ? 'custom' : 'preset');
  const [customText, setCustomText] = useState(startsCustom ? current : '');

  const selectValue = mode === 'custom' ? CUSTOM : current;

  return (
    <Stack gap={2}>
      <Select
        value={selectValue}
        aria-label="Image style"
        onChange={(e) => {
          const v = e.target.value;
          if (v === CUSTOM) {
            setMode('custom');
            if (customText.trim()) setStyle(customText.trim());
          } else {
            setMode('preset');
            setStyle(v);
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
                if (e.target.value.trim()) setStyle(e.target.value.trim());
              }}
            />
          )}
        </Field>
      ) : null}
      <Text size="sm" tone="secondary">
        Used for every AI image across SelfOS — dream images and your story’s cover and
        illustrations — so they all share one look.
      </Text>
    </Stack>
  );
}
