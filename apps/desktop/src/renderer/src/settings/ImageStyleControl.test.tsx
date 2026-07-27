import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ImageFeature, ImagePrefs } from '@shared/channels';
import { DreamImagePrefsControl } from './ImageStyleControl';
import { useImagePrefsStore } from '../stores/imagePrefsStore';
import { clearMockBridge, installMockBridge } from '../test-utils/bridge';

const prefs = (over: Partial<ImagePrefs['dreams']> = {}): ImagePrefs => ({
  schemaVersion: 1,
  dreams: { enabled: true, style: 'dreamlike', styleNotes: '', ...over },
  story: { enabled: false, style: 'oil painting', styleNotes: '' },
});

/** Install the bridge with the given dream prefs + a spy capturing each setPrefs patch. */
function mount(over: Partial<ImagePrefs['dreams']> = {}): ReturnType<typeof vi.fn> {
  const setSpy = vi.fn((input: { feature: ImageFeature; patch: Record<string, unknown> }) =>
    Promise.resolve(prefs({ ...over, ...input.patch })),
  );
  installMockBridge({
    imagesGetPrefs: () => Promise.resolve(prefs(over)),
    imagesSetPrefs: setSpy,
  });
  return setSpy;
}

beforeEach(() => {
  useImagePrefsStore.setState({ prefs: null, loaded: false });
});
afterEach(() => {
  clearMockBridge();
  useImagePrefsStore.setState({ prefs: null, loaded: false });
});

describe('DreamImagePrefsControl (image-settings amendment — per-person dream image prefs)', () => {
  it('hides the style picker until generation is turned on', async () => {
    mount({ enabled: false });
    render(<DreamImagePrefsControl />);
    // The toggle is present; the style picker is not, while off.
    expect(await screen.findByRole('switch', { name: 'AI image generation' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Image style' })).toBeNull();
  });

  it('turning generation on persists the per-person toggle', async () => {
    const setSpy = mount({ enabled: false });
    render(<DreamImagePrefsControl />);
    await userEvent.click(await screen.findByRole('switch', { name: 'AI image generation' }));
    expect(setSpy).toHaveBeenCalledWith({ feature: 'dreams', patch: { enabled: true } });
  });

  it('when on, offers family-grouped presets plus Custom… and persists a chosen preset', async () => {
    const setSpy = mount({ enabled: true });
    render(<DreamImagePrefsControl />);
    const select = await screen.findByRole('combobox', { name: 'Image style' });
    const groups = [...select.querySelectorAll('optgroup')].map((g) => g.label);
    expect(groups).toEqual(['Painted', 'Drawn', 'Stylized', 'Photographic-ish', 'Your own']);
    await userEvent.selectOptions(select, 'watercolor');
    expect(setSpy).toHaveBeenCalledWith({ feature: 'dreams', patch: { style: 'watercolor' } });
  });

  it('persists the style direction note', async () => {
    const setSpy = mount({ enabled: true });
    render(<DreamImagePrefsControl />);
    const notes = await screen.findByRole('textbox');
    await userEvent.type(notes, 'golden');
    // The controlled textarea persists on change (last keystroke captured).
    expect(setSpy).toHaveBeenCalledWith({
      feature: 'dreams',
      patch: expect.objectContaining({ styleNotes: expect.stringContaining('golden') }),
    });
  });
});
