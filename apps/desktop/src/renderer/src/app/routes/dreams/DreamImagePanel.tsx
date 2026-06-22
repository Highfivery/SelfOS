import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, ImageIcon, RefreshCw, Share2, Sparkles, Trash2 } from 'lucide-react';
import type { Dream, DreamShareTarget } from '@shared/channels';
import { aiKeyResolved } from '../../aiAvailability';
import { useSessionStore } from '../../../stores/sessionStore';
import { useSetting } from '../../../settings/useSetting';
import {
  AdminOnlyBadge,
  Banner,
  Button,
  Field,
  Heading,
  Inline,
  Select,
  Stack,
  Switch,
  Text,
} from '../../../design-system/components';
import { DEFAULT_IMAGE_STYLE, IMAGE_STYLE_PRESETS, isKnownStyle, styleLabel } from './imageStyles';
import styles from './Dreams.module.css';

interface DreamImagePanelProps {
  dream: Dream;
}

type Confirm = 'sensitive' | 'regen' | 'delete' | null;
type LoadedImage = { mime: string; dataBase64: string; costUsd?: number };

/**
 * Visualize a dream as one AI image (13-dream-images §3). Rendered identically in both the dream
 * detail/composer and the analysis card, bound to the dream id. The panel is **hidden entirely** when the
 * role lacks `dreams.generateImage` (the bridge re-enforces it — the UI gate is convenience). Calm states
 * cover consent-off / AI-off / no-key / over-budget / content-policy refusal; a sensitive-tier dream shows
 * a warning before sending. The image is dreamlike, never a literal record (12 §8.1).
 */
export function DreamImagePanel({ dream }: DreamImagePanelProps): JSX.Element | null {
  const canGenerate = useSessionStore((s) => s.can('dreams.generateImage'));
  const canShare = useSessionStore((s) => s.can('dreams.shareContext'));
  const isAdmin = useSessionStore((s) => s.can('budgets.manage'));
  const [consent] = useSetting('dreams.imageGenerationEnabled');
  const [aiEnabled] = useSetting('ai.enabled');
  const [defaultStyle] = useSetting('dreams.imageStyle');
  const navigate = useNavigate();

  const [hasKey, setHasKey] = useState(false);
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  // Seeds from the Settings default (synchronously hydrated here); the user can override per image.
  const [style, setStyle] = useState<string>(defaultStyle ?? DEFAULT_IMAGE_STYLE);
  const [shareTargets, setShareTargets] = useState<DreamShareTarget[]>([]);
  const [sharedWith, setSharedWith] = useState<string[]>([]);
  const [showShare, setShowShare] = useState(false);
  const [exported, setExported] = useState(false);
  const reqId = useRef(0);
  const shareable = canShare && dream.sensitivity === 'standard';

  // Load any existing image when the dream changes; a request guard drops a stale fetch after a switch.
  useEffect(() => {
    const id = ++reqId.current;
    setLoading(true);
    setImage(null);
    setError(null);
    setConfirm(null);
    setShowShare(false);
    setExported(false);
    setSharedWith(dream.image?.shareableWith ?? []);
    void (async () => {
      const has = await aiKeyResolved('openai');
      const existing = await window.selfos?.dreamGetImage({ dreamId: dream.id });
      // The dreamer's related people (only relevant when this dream's image can be shared).
      const targets = shareable ? ((await window.selfos?.dreamShareTargets()) ?? []) : [];
      if (id !== reqId.current) return;
      setHasKey(Boolean(has));
      setImage(existing ?? null);
      setShareTargets(targets);
      setLoading(false);
    })();
  }, [dream.id, dream.image, shareable]);

  const exportImage = async (): Promise<void> => {
    const path = await window.selfos?.dreamExportImage({ dreamId: dream.id });
    if (path) setExported(true);
  };

  const toggleShare = async (targetPersonId: string, share: boolean): Promise<void> => {
    const result = await window.selfos?.dreamSetImageShare({
      dreamId: dream.id,
      targetPersonId,
      shared: share,
    });
    if (result?.ok) {
      setSharedWith((prev) =>
        share
          ? [...new Set([...prev, targetPersonId])]
          : prev.filter((id) => id !== targetPersonId),
      );
    }
  };

  // Capability absent → the panel isn't shown at all (the bridge stays the trust boundary).
  if (!canGenerate) return null;

  const generate = async (): Promise<void> => {
    setConfirm(null);
    setBusy(true);
    setError(null);
    const id = ++reqId.current;
    const result = await window.selfos?.dreamGenerateImage({ dreamId: dream.id, style });
    if (id !== reqId.current) return;
    if (!result) {
      setError('Something went wrong. Please try again.');
      setBusy(false);
      return;
    }
    if (result.ok) {
      const bytes = await window.selfos?.dreamGetImage({ dreamId: dream.id });
      // Re-read the dream so the share state reflects the new image's descriptor (a fresh image starts
      // unshared; a regenerate carries the prior shares forward — 13 §3.3).
      const fresh = await window.selfos?.dreamGet(dream.id);
      if (id !== reqId.current) return;
      setImage(
        bytes
          ? { ...bytes, ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}) }
          : null,
      );
      setSharedWith(fresh?.image?.shareableWith ?? []);
    } else if (result.reason === 'REFUSED') {
      setError(
        'OpenAI declined to generate this image (its content policy). Your dream is saved — you can edit the description and try again.',
      );
    } else if (result.reason === 'BUDGET') {
      setError('You’ve reached your AI budget for this period.');
    } else {
      setError(result.message || 'The image couldn’t be generated. Please try again.');
    }
    setBusy(false);
  };

  const onVisualize = (): void => {
    if (dream.sensitivity !== 'standard') setConfirm('sensitive');
    else void generate();
  };

  const remove = async (): Promise<void> => {
    setConfirm(null);
    setBusy(true);
    await window.selfos?.dreamDeleteImage({ dreamId: dream.id });
    setImage(null);
    setBusy(false);
  };

  const heading = (
    <Inline gap={2}>
      <ImageIcon size={18} aria-hidden="true" />
      <Heading level={3}>Dream image</Heading>
    </Inline>
  );

  const settingsNote = (body: string): JSX.Element => (
    <div className={styles.imagePanel}>
      {heading}
      <Text size="sm" tone="secondary">
        {body}
      </Text>
      <Inline>
        <Button variant="secondary" onClick={() => navigate('/settings')}>
          Open Settings
        </Button>
      </Inline>
    </div>
  );

  // Calm states (no dead controls), resolved in priority order (§3.4).
  if (!consent) {
    return settingsNote(
      'Turn on dream-image generation in Settings to visualize a dream. Generating sends the dream’s description to OpenAI (a third party).',
    );
  }
  if (!aiEnabled) {
    return settingsNote(
      'Enable AI in Settings to visualize dreams — it prepares the image prompt.',
    );
  }
  // `hasKey` resolves asynchronously — wait for the initial load so the happy path (a key IS present)
  // doesn't briefly flash the no-key state before the check returns.
  if (!loading && !hasKey) {
    return settingsNote('Add your OpenAI key in Settings to visualize dreams.');
  }

  const stylePicker = (
    <Field label="Style">
      {(p) => (
        <Select {...p} value={style} disabled={busy} onChange={(e) => setStyle(e.target.value)}>
          {/* A legacy/custom value not in the current presets still renders (§15.4). */}
          {isKnownStyle(style) ? null : <option value={style}>{styleLabel(style)}</option>}
          {IMAGE_STYLE_PRESETS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      )}
    </Field>
  );

  return (
    <div className={styles.imagePanel}>
      {heading}

      {error ? (
        <Banner tone="warning">{error}</Banner>
      ) : (
        <Text size="sm" tone="secondary">
          An AI interpretation of this dream — dreamlike, not a literal record.
        </Text>
      )}

      {confirm === 'sensitive' ? (
        <Banner tone="warning">
          This is a sensitive dream. Generating sends its description to OpenAI (a third party).
          Continue?
          <div className={styles.confirm}>
            <Button variant="secondary" onClick={() => setConfirm(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void generate()} disabled={busy}>
              Continue
            </Button>
          </div>
        </Banner>
      ) : null}

      {confirm === 'regen' ? (
        <Banner tone="warning">
          This replaces the current image
          {dream.sensitivity !== 'standard'
            ? ', and sends the dream’s description to OpenAI again'
            : ''}
          . Continue?
          <div className={styles.confirm}>
            <Button variant="secondary" onClick={() => setConfirm(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void generate()} disabled={busy}>
              Regenerate
            </Button>
          </div>
        </Banner>
      ) : null}

      {confirm === 'delete' ? (
        <Banner tone="warning">
          Delete this image?
          <div className={styles.confirm}>
            <Button variant="secondary" onClick={() => setConfirm(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="secondary" onClick={() => void remove()} disabled={busy}>
              Delete image
            </Button>
          </div>
        </Banner>
      ) : null}

      {busy ? (
        <Text tone="secondary" aria-live="polite">
          Creating your image… this can take a few seconds.
        </Text>
      ) : null}

      {loading ? null : image ? (
        <Stack gap={3}>
          <img
            className={styles.dreamImage}
            src={`data:${image.mime};base64,${image.dataBase64}`}
            alt={`AI-generated ${style} image of ${dream.title?.trim() || 'this dream'}`}
          />
          {image.costUsd !== undefined && isAdmin ? (
            <Inline gap={2}>
              <Text size="xs" tone="tertiary">
                Estimated cost: ${image.costUsd.toFixed(2)}
              </Text>
              <AdminOnlyBadge />
            </Inline>
          ) : null}
          {/* Hide the triggers while a confirm banner is open (avoids a duplicate action). */}
          {confirm ? null : (
            <>
              {stylePicker}
              <Inline gap={2} wrap>
                <Button variant="secondary" onClick={() => setConfirm('regen')} disabled={busy}>
                  <RefreshCw size={16} aria-hidden="true" />
                  Regenerate
                </Button>
                <Button variant="secondary" onClick={() => void exportImage()} disabled={busy}>
                  <Download size={16} aria-hidden="true" />
                  Save image…
                </Button>
                {shareable && shareTargets.length > 0 ? (
                  <Button
                    variant="secondary"
                    onClick={() => setShowShare((v) => !v)}
                    aria-expanded={showShare}
                    disabled={busy}
                  >
                    <Share2 size={16} aria-hidden="true" />
                    Share
                  </Button>
                ) : null}
                <Button variant="secondary" onClick={() => setConfirm('delete')} disabled={busy}>
                  <Trash2 size={16} aria-hidden="true" />
                  Delete image
                </Button>
              </Inline>
              {exported ? (
                <Text size="xs" tone="tertiary">
                  Saved. The exported file leaves the encrypted vault and is no longer protected by
                  it.
                </Text>
              ) : null}
              {canShare && dream.sensitivity !== 'standard' ? (
                <Text size="xs" tone="tertiary">
                  This dream is marked sensitive, so its image can’t be shared.
                </Text>
              ) : null}
              {showShare && shareable ? (
                <DreamImageShareControls
                  targets={shareTargets}
                  sharedWith={sharedWith}
                  onToggle={(id, next) => void toggleShare(id, next)}
                />
              ) : null}
            </>
          )}
        </Stack>
      ) : confirm ? null : (
        <Stack gap={3}>
          {stylePicker}
          <Inline>
            <Button variant="primary" onClick={onVisualize} disabled={busy}>
              <Sparkles size={16} aria-hidden="true" />
              Visualize this dream
            </Button>
          </Inline>
        </Stack>
      )}
    </div>
  );
}

/**
 * Per-image sharing (13-dream-images §3.6): pick which related people can SEE this dream's image. The
 * image still never feeds anyone's AI coaching context — sharing only makes it viewable. The bridge
 * re-gates the relationship + sensitivity at read time, so un-sharing or removing a relationship denies.
 */
function DreamImageShareControls({
  targets,
  sharedWith,
  onToggle,
}: {
  targets: DreamShareTarget[];
  sharedWith: string[];
  onToggle: (targetPersonId: string, share: boolean) => void;
}): JSX.Element {
  return (
    <div className={styles.shareSection}>
      <Heading level={3}>Share this image</Heading>
      <Text size="xs" tone="tertiary">
        The people you pick can see this image. It still never informs anyone’s coaching.
      </Text>
      <Stack gap={2}>
        {targets.map((target) => (
          <div key={target.id} className={styles.shareToggle}>
            <Switch
              checked={sharedWith.includes(target.id)}
              onChange={(next) => onToggle(target.id, next)}
              aria-label={`Share this image with ${target.displayName}`}
            />
            <Text size="sm">{target.displayName}</Text>
          </div>
        ))}
      </Stack>
    </div>
  );
}
