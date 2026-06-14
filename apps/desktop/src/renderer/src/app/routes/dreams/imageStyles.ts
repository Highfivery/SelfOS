/**
 * The curated dream-image style presets (13-dream-images §15.1) — the SINGLE source of truth shared by the
 * Settings default-style select and the per-image picker on the `DreamImagePanel`, so the two never drift.
 * Each preset's `value` is both the stable key AND the short style phrase that flows into the prompt
 * (`Visual style: <value>.`); `Dream.image.style` stays a free string, so this set can grow without a
 * migration. The four original presets (`dreamlike`/`painterly`/`watercolor`/`realistic`) are retained, so
 * dreams stamped before the expansion still resolve to a label. Presets are grouped by family so a longer
 * list stays scannable (rendered as native `<optgroup>`s).
 *
 * Safety: a baseline non-photorealistic framing is added to EVERY prompt regardless of preset (§8.2 — a
 * figure may resemble a real person), so `realistic`/`cinematic` mean painterly-realistic / filmic, never a
 * photoreal likeness. See `buildImagePromptInput` / `DREAMLIKE_FRAMING` in `dreamImageService`.
 */

export interface StylePreset {
  /** Stable key + the phrase used in the prompt (`Visual style: <value>.`). */
  value: string;
  /** The human label shown in the picker. */
  label: string;
}

export interface StyleGroup {
  label: string;
  options: ReadonlyArray<StylePreset>;
}

export const IMAGE_STYLE_PRESETS: ReadonlyArray<StyleGroup> = [
  {
    label: 'Painted',
    options: [
      { value: 'painterly', label: 'Painterly (oil)' },
      { value: 'watercolor', label: 'Watercolor' },
      { value: 'gouache', label: 'Gouache' },
      { value: 'impressionist', label: 'Impressionist' },
      { value: 'pastel', label: 'Pastel' },
    ],
  },
  {
    label: 'Drawn',
    options: [
      { value: 'ink and line art', label: 'Ink & line art' },
      { value: 'charcoal sketch', label: 'Charcoal sketch' },
      { value: 'storybook illustration', label: 'Storybook illustration' },
      { value: 'comic book', label: 'Comic / graphic novel' },
      { value: 'concept art', label: 'Concept art' },
    ],
  },
  {
    label: 'Stylized',
    options: [
      { value: 'dreamlike', label: 'Dreamlike (surreal)' },
      { value: 'art nouveau', label: 'Art nouveau' },
      { value: 'ukiyo-e', label: 'Ukiyo-e' },
      { value: 'ethereal and luminous', label: 'Ethereal / luminous' },
      { value: 'gothic and dark', label: 'Gothic / dark' },
      { value: 'vaporwave neon', label: 'Vaporwave / neon' },
      { value: 'minimalist', label: 'Minimalist' },
      { value: 'collage', label: 'Collage' },
      { value: 'abstract', label: 'Abstract' },
    ],
  },
  {
    label: 'Photographic-ish',
    options: [
      { value: 'cinematic', label: 'Cinematic' },
      { value: 'realistic', label: 'Realistic' },
    ],
  },
];

/** The default preset (retained from the original four). */
export const DEFAULT_IMAGE_STYLE = 'dreamlike';

const STYLE_LABELS = new Map(
  IMAGE_STYLE_PRESETS.flatMap((group) => group.options.map((o) => [o.value, o.label] as const)),
);

/** Is this a known preset (vs. a legacy/custom stored value)? §15.4 legacy handling. */
export function isKnownStyle(value: string): boolean {
  return STYLE_LABELS.has(value);
}

/** The display label for a style value, falling back to the raw value for a legacy/custom preset. */
export function styleLabel(value: string): string {
  return STYLE_LABELS.get(value) ?? value;
}
