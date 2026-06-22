import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Dream } from '@shared/channels';
import { DreamImagePanel } from './DreamImagePanel';
import { useSessionStore } from '../../../stores/sessionStore';
import { useSettingsStore } from '../../../settings/settingsStore';
import { clearMockBridge, elevateToOwner, installMockBridge } from '../../../test-utils/bridge';

const dream: Dream = {
  id: 'd1',
  schemaVersion: 1,
  personId: 'owner-1',
  narrative: 'rooms that rearrange',
  title: 'The shifting house',
  lucid: false,
  nightmare: false,
  tags: [],
  people: [],
  sensitivity: 'standard',
  status: 'captured',
  createdAt: 'now',
  updatedAt: 'now',
};

afterEach(() => {
  clearMockBridge();
  useSessionStore.setState({ activePerson: null, access: null });
  useSettingsStore.setState((s) => ({
    values: {
      ...s.values,
      'ai.enabled': false,
      'dreams.imageGenerationEnabled': false,
      'dreams.imageStyle': 'dreamlike',
    },
  }));
});

/** The Owner has every capability (dreams.generateImage + budgets.manage); set the gate settings. */
function enable({ consent = true, ai = true }: { consent?: boolean; ai?: boolean } = {}): void {
  elevateToOwner();
  useSettingsStore.setState((s) => ({
    values: { ...s.values, 'ai.enabled': ai, 'dreams.imageGenerationEnabled': consent },
  }));
}

function renderPanel(d: Dream = dream): void {
  render(
    <MemoryRouter>
      <DreamImagePanel dream={d} />
    </MemoryRouter>,
  );
}

describe('DreamImagePanel', () => {
  it('renders nothing without the dreams.generateImage capability', () => {
    // Default session (no active person, no access) → can() is false.
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
    });
    const { container } = render(
      <MemoryRouter>
        <DreamImagePanel dream={dream} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a calm consent state when image generation is off', async () => {
    enable({ consent: false });
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
    });
    renderPanel();
    expect(
      await screen.findByText(/turn on dream-image generation in settings/i),
    ).toBeInTheDocument();
  });

  it('shows a calm AI-off state when AI is disabled', async () => {
    enable({ ai: false });
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
    });
    renderPanel();
    expect(await screen.findByText(/enable ai in settings/i)).toBeInTheDocument();
  });

  it('shows a calm no-key state when the OpenAI key is missing', async () => {
    enable();
    installMockBridge({ secretHas: () => Promise.resolve(false) });
    renderPanel();
    expect(await screen.findByText(/add your openai key in settings/i)).toBeInTheDocument();
  });

  it('offers the expanded, family-grouped style presets in the entry picker (§15.1)', async () => {
    enable();
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
    });
    renderPanel();
    const select = await screen.findByRole('combobox', { name: 'Style' });
    // Expanded presets beyond the original four are present…
    expect(screen.getByRole('option', { name: 'Gouache' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Ukiyo-e' })).toBeInTheDocument();
    // …grouped by family as native optgroups.
    const groups = [...select.querySelectorAll('optgroup')].map((g) => g.label);
    expect(groups).toEqual(['Painted', 'Drawn', 'Stylized', 'Photographic-ish']);
  });

  it('renders a legacy/custom stored style as a selectable option (§15.4)', async () => {
    enable();
    useSettingsStore.setState((s) => ({
      values: { ...s.values, 'dreams.imageStyle': 'daguerreotype' },
    }));
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
    });
    renderPanel();
    expect(await screen.findByRole('option', { name: 'daguerreotype' })).toBeInTheDocument();
  });

  it('generates an image from the entry state and shows the admin cost', async () => {
    enable();
    const dreamGenerateImage = vi.fn(() =>
      Promise.resolve({ ok: true as const, mime: 'image/png', costUsd: 0.17 }),
    );
    let stored = false;
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
      dreamGetImage: () =>
        Promise.resolve(stored ? { mime: 'image/png', dataBase64: 'AAAA' } : null),
      dreamGenerateImage: () => {
        stored = true;
        return dreamGenerateImage();
      },
    });
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: /visualize this dream/i }));
    const img = await screen.findByRole('img');
    expect(img.getAttribute('src')).toContain('data:image/png;base64,AAAA');
    expect(screen.getByText(/estimated cost: \$0\.17/i)).toBeInTheDocument();
    expect(screen.getByText('Admin only')).toBeInTheDocument();
  });

  it('warns before generating a sensitive dream, then proceeds on Continue', async () => {
    enable();
    let stored = false;
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
      dreamGetImage: () =>
        Promise.resolve(stored ? { mime: 'image/png', dataBase64: 'AAAA' } : null),
      dreamGenerateImage: () => {
        stored = true;
        return Promise.resolve({ ok: true as const, mime: 'image/png' });
      },
    });
    renderPanel({ ...dream, sensitivity: 'explicit' });
    await userEvent.click(await screen.findByRole('button', { name: /visualize this dream/i }));
    expect(screen.getByText(/this is a sensitive dream/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('img')).toBeInTheDocument();
  });

  it('shows an existing image with Regenerate + Delete, and deletes on confirm', async () => {
    enable();
    const dreamDeleteImage = vi.fn(() => Promise.resolve());
    let present = true;
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
      dreamGetImage: () =>
        Promise.resolve(present ? { mime: 'image/png', dataBase64: 'AAAA' } : null),
      dreamDeleteImage: () => {
        present = false;
        return dreamDeleteImage();
      },
    });
    renderPanel();
    expect(await screen.findByRole('img')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete image' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete image' }));
    expect(dreamDeleteImage).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('img')).not.toBeInTheDocument());
  });

  it('exports the image and shares it with a related person', async () => {
    enable();
    const dreamExportImage = vi.fn(() => Promise.resolve('/tmp/dream-image.png'));
    const dreamSetImageShare = vi.fn(() => Promise.resolve({ ok: true as const }));
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
      dreamGetImage: () => Promise.resolve({ mime: 'image/png', dataBase64: 'AAAA' }),
      dreamShareTargets: () => Promise.resolve([{ id: 'p2', displayName: 'Partner' }]),
      dreamExportImage,
      dreamSetImageShare,
    });
    renderPanel();
    await screen.findByRole('img');

    await userEvent.click(screen.getByRole('button', { name: /save image/i }));
    expect(dreamExportImage).toHaveBeenCalledWith({ dreamId: 'd1' });
    expect(await screen.findByText(/leaves the encrypted vault/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    await userEvent.click(screen.getByRole('switch', { name: /share this image with partner/i }));
    expect(dreamSetImageShare).toHaveBeenCalledWith({
      dreamId: 'd1',
      targetPersonId: 'p2',
      shared: true,
    });
  });

  it('keeps a sensitive dream image out of sharing, with a note', async () => {
    enable();
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
      dreamGetImage: () => Promise.resolve({ mime: 'image/png', dataBase64: 'AAAA' }),
      dreamShareTargets: () => Promise.resolve([{ id: 'p2', displayName: 'Partner' }]),
    });
    renderPanel({ ...dream, sensitivity: 'explicit' });
    await screen.findByRole('img');
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
    expect(screen.getByText(/its image can.t be shared/i)).toBeInTheDocument();
  });

  it('shows a calm refusal message when OpenAI declines (content policy)', async () => {
    enable();
    installMockBridge({
      secretHas: () => Promise.resolve(true),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
      dreamGetImage: () => Promise.resolve(null),
      dreamGenerateImage: () =>
        Promise.resolve({ ok: false as const, reason: 'REFUSED' as const, message: 'policy' }),
    });
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: /visualize this dream/i }));
    expect(await screen.findByText(/openai declined to generate this image/i)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
