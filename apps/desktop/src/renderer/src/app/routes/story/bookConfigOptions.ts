import type { SegmentOption } from '../../../design-system/components';
import type { BookConfig } from '@shared/schemas';

export type Voice = BookConfig['voice'];
export type Style = BookConfig['style'];
export type Length = BookConfig['length'];
export const VOICE_OPTIONS: SegmentOption<Voice>[] = [
  { value: 'third', label: 'Third person' },
  { value: 'first', label: 'First person' },
];
// Styles have grown past what a SegmentedControl can hold at phone width (§12 — no horizontal scroll), so the
// style picker is a full-width Select with a one-line hint for the chosen register.
export const STYLE_CHOICES: { value: Style; label: string; hint: string }[] = [
  { value: 'literary', label: 'Literary', hint: 'Vivid, image-led prose with deliberate rhythm.' },
  { value: 'warm', label: 'Warm', hint: 'Plain, tender, dinner-table narration.' },
  { value: 'plain', label: 'Plain', hint: 'Direct, unadorned, concrete; short sentences.' },
  {
    value: 'journalistic',
    label: 'Journalistic',
    hint: 'Reportorial and evidence-led; clear and propulsive.',
  },
  {
    value: 'reflective',
    label: 'Reflective',
    hint: 'Essayistic and meditative; interior and thoughtful.',
  },
  {
    value: 'cinematic',
    label: 'Cinematic',
    hint: 'Scene-forward and dramatic; vivid set-pieces.',
  },
  { value: 'poetic', label: 'Poetic', hint: 'Lyrical and image-dense; heightened rhythm.' },
];
export const LENGTH_OPTIONS: SegmentOption<Length>[] = [
  { value: 'concise', label: 'Concise' },
  { value: 'standard', label: 'Standard' },
  { value: 'full', label: 'Full' },
];
// The commission (§13.3) renders length as three cards with reading-terms sublabels.
export const LENGTH_CARDS: { value: Length; label: string; sub: string }[] = [
  { value: 'concise', label: 'Concise', sub: 'A short read — a handful of focused chapters.' },
  { value: 'standard', label: 'Standard', sub: 'A full evening — a dozen or so chapters.' },
  { value: 'full', label: 'Full', sub: 'The whole story — as many chapters as it takes.' },
];
