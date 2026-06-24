import { z } from 'zod';
import {
  ClipboardList,
  Compass,
  Database,
  Info,
  Laptop,
  MessagesSquare,
  Moon,
  Palette,
  Send,
  Sparkles,
} from 'lucide-react';
import { registerSection, registerSettings } from './registry';
import { DevicesControl } from './DevicesControl';
import { defineSetting } from './types';
import {
  AboutDisclaimer,
  AboutVersion,
  ChangeVaultRow,
  CheckForUpdatesControl,
  RevealVaultRow,
  VaultLocationValue,
} from './customRows';
import {
  ApiKeyControl,
  OpenAiKeyControl,
  OpenAiTestConnectionControl,
  TestConnectionControl,
} from './aiControls';
import { RelaySettingsPanel } from './RelaySettingsPanel';
import { RelayMessagesControl } from './RelayMessagesControl';
import { IntimacyTopicsControl } from './IntimacyTopicsControl';
import { ProactivityControl } from './ProactivityControl';
import {
  DEFAULT_RELAY_MESSAGES,
  RelayMessagesSchema,
  type RelayMessages,
} from '../app/routes/questionnaires/relayMessages';
import { DEFAULT_IMAGE_STYLE, IMAGE_STYLE_PRESETS } from '../app/routes/dreams/imageStyles';

declare module './types' {
  interface SettingsTypeMap {
    'appearance.theme': 'system' | 'light' | 'dark';
    'appearance.density': 'comfortable' | 'compact';
    'appearance.textScale': number;
    'appearance.reduceMotion': boolean;
    'ai.enabled': boolean;
    'ai.shareCredentials': boolean;
    'ai.model': 'claude-sonnet-4-6' | 'claude-opus-4-8';
    'sessions.memoryEnabled': boolean;
    'sessions.autoSummarizeOnEnd': boolean;
    'memory.autoReconcile': boolean;
    'intake.inSessionDepthAsk': boolean;
    'coaching.proactivity': null; // per-person (CoachingPrefs); the custom control owns its state via IPC
    'questionnaires.autoAnalyze': boolean;
    'questionnaires.defaultMessages': RelayMessages;
    'questionnaires.intimacyTopics': null;
    'dreams.memoryEnabled': boolean;
    'dreams.imageGenerationEnabled': boolean;
    'dreams.imageModel': 'gpt-image-2' | 'gpt-image-1';
    'dreams.imageStyle': string; // a free string — an IMAGE_STYLE_PRESETS value, growable without migration
    'dreams.imageStyleNotes': string;
    'updates.autoCheck': boolean;
  }
}

const aiEnabled = (values: Readonly<Record<string, unknown>>): boolean =>
  values['ai.enabled'] === true;

/** Dream-image config (model / style / OpenAI key) only appears once the consent toggle is on. */
const dreamImagesEnabled = (values: Readonly<Record<string, unknown>>): boolean =>
  values['dreams.imageGenerationEnabled'] === true;

let registered = false;

/** Test-only: clear the idempotency guard so a `__resetRegistry()` + re-register works in isolation. */
export function __resetBuiltins(): void {
  registered = false;
}

/** Register the built-in sections and settings (idempotent). */
export function registerBuiltinSettings(): void {
  if (registered) return;
  registered = true;

  registerSection({
    id: 'appearance',
    title: 'Appearance',
    description: 'How SelfOS looks and feels.',
    icon: Palette,
    order: 1,
  });
  // AI, Sessions, Questionnaires, Dreams + Relay are household-wide settings the Owner controls —
  // owner-only sections, hidden entirely from non-`settings.manage` users (members inherit AI via the
  // shared key, 25-household-ai-credentials; they don't manage household behaviour).
  registerSection({
    id: 'ai',
    title: 'AI',
    description: 'Connect Claude to power conversations.',
    icon: Sparkles,
    order: 2,
    adminOnly: true,
  });
  registerSection({
    id: 'sessions',
    title: 'Sessions',
    description: 'How coaching sessions are remembered across the app.',
    icon: MessagesSquare,
    order: 3,
    adminOnly: true,
  });
  // Coaching is a PER-PERSON section (each persona tunes their own coach, 40 §3.6) — NOT admin-only, so every
  // member can reach it (members otherwise see only Appearance / Coaching / Vault / About).
  registerSection({
    id: 'coaching',
    title: 'Coaching',
    description: 'How present and proactive your coach is — just for you.',
    icon: Compass,
    order: 3.5,
  });
  registerSection({
    id: 'questionnaires',
    title: 'Questionnaires',
    description: 'How questionnaire responses are turned into insights.',
    icon: ClipboardList,
    order: 4,
    adminOnly: true,
  });
  registerSection({
    id: 'dreams',
    title: 'Dreams',
    description: 'Your dream journal and how it informs your coaching.',
    icon: Moon,
    order: 5,
    adminOnly: true,
  });
  registerSection({
    id: 'relay',
    title: 'Relay',
    description: 'Send questionnaires to people without SelfOS, via a private encrypted link.',
    icon: Send,
    order: 6,
    adminOnly: true,
  });
  registerSection({
    id: 'devices',
    title: 'Devices',
    description: 'The devices that have joined your household, and re-keying the vault.',
    icon: Laptop,
    order: 6.5,
    adminOnly: true,
  });
  registerSection({
    id: 'vault',
    title: 'Vault',
    description: 'Where your data is stored.',
    icon: Database,
    order: 7,
  });
  registerSection({ id: 'about', title: 'About', icon: Info, order: 8 });

  registerSettings([
    defineSetting({
      key: 'appearance.theme',
      section: 'appearance',
      label: 'Theme',
      description: 'Follow the system, or choose light or dark.',
      schema: z.enum(['system', 'light', 'dark']),
      default: 'system',
      control: {
        type: 'segmented',
        options: [
          { value: 'system', label: 'System' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ],
      },
      order: 1,
      tags: ['dark', 'light', 'appearance'],
    }),
    defineSetting({
      key: 'appearance.density',
      section: 'appearance',
      label: 'Density',
      description: 'Comfortable spacing, or a more compact layout.',
      schema: z.enum(['comfortable', 'compact']),
      default: 'comfortable',
      control: {
        type: 'segmented',
        options: [
          { value: 'comfortable', label: 'Comfortable' },
          { value: 'compact', label: 'Compact' },
        ],
      },
      order: 2,
    }),
    defineSetting({
      key: 'appearance.textScale',
      section: 'appearance',
      label: 'Text size',
      description: 'Scale all text up or down.',
      schema: z.number().min(0.9).max(1.3),
      default: 1,
      control: {
        type: 'slider',
        min: 0.9,
        max: 1.3,
        step: 0.05,
        format: (n) => `${Math.round(n * 100)}%`,
      },
      order: 3,
    }),
    defineSetting({
      key: 'appearance.reduceMotion',
      section: 'appearance',
      label: 'Reduce motion',
      description: 'Minimize animations and transitions.',
      schema: z.boolean(),
      default: false,
      control: { type: 'switch' },
      order: 4,
    }),
    defineSetting({
      key: 'ai.enabled',
      section: 'ai',
      label: 'Enable AI',
      description:
        'Turn on AI features. When on, your messages are sent to Anthropic (Claude) to generate responses. SelfOS is wellness support, not medical care.',
      schema: z.boolean(),
      default: false,
      control: { type: 'switch' },
      order: 1,
    }),
    defineSetting({
      key: 'ai.model',
      section: 'ai',
      label: 'Model',
      description: 'Sonnet is faster and cheaper; Opus is the most capable.',
      schema: z.enum(['claude-sonnet-4-6', 'claude-opus-4-8']),
      default: 'claude-sonnet-4-6',
      control: {
        type: 'select',
        options: [
          { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 — faster' },
          { value: 'claude-opus-4-8', label: 'Claude Opus 4.8 — most capable' },
        ],
      },
      order: 2,
      visibleWhen: aiEnabled,
    }),
    defineSetting({
      key: 'ai.apiKey',
      section: 'ai',
      label: 'Claude API key',
      schema: z.null(),
      default: null,
      control: { type: 'custom', render: ApiKeyControl },
      // The key is a device-local secret in the main-process secret store — never synced (00 §6.2). A
      // household-shared key is the separate, opt-in encrypted `ai.shareCredentials`, not key-syncing.
      scope: 'device',
      order: 3,
      visibleWhen: aiEnabled,
    }),
    defineSetting({
      key: 'ai.test',
      section: 'ai',
      label: 'Connection',
      schema: z.null(),
      default: null,
      control: { type: 'custom', render: TestConnectionControl },
      scope: 'device',
      order: 4,
      visibleWhen: aiEnabled,
    }),
    defineSetting({
      key: 'ai.shareCredentials',
      section: 'ai',
      label: 'Share AI with your household',
      description:
        'When on, the API key you add here is shared with everyone in your household (encrypted in your vault) so member devices can use AI without each adding a key of their own — your one account pays for everyone, and per-person budgets (Settings → Usage) cap each person’s spend. Turn off to keep your key on this device only.',
      schema: z.boolean(),
      default: true,
      control: { type: 'switch' },
      order: 5,
      scope: 'vault',
      adminOnly: true,
      visibleWhen: aiEnabled,
    }),
    defineSetting({
      key: 'sessions.memoryEnabled',
      section: 'sessions',
      label: 'Session memory',
      description:
        'When on, ending a coaching session can summarize it into a private memory that helps personalize your coaching across the app. Turn off to stop summarizing sessions and keep them out of your coaching context entirely. Existing summaries stay editable in Memory.',
      schema: z.boolean(),
      default: true,
      control: { type: 'switch' },
      scope: 'vault',
      order: 1,
    }),
    defineSetting({
      key: 'sessions.autoSummarizeOnEnd',
      section: 'sessions',
      label: 'Summarize automatically when a session is completed',
      description:
        'When on, marking a session complete summarizes it right away (using your AI allowance). Off by default, so completing a session asks before spending anything — and you can always mark something done without summarizing it.',
      schema: z.boolean(),
      default: false,
      control: { type: 'switch' },
      scope: 'vault',
      order: 2,
      visibleWhen: (values) => values['sessions.memoryEnabled'] !== false,
    }),
    defineSetting({
      key: 'memory.autoReconcile',
      section: 'sessions',
      label: 'Keep memory tidy automatically',
      description:
        'When on, SelfOS occasionally tidies your memory in the background — recalibrating confidence and proposing merges of duplicate insights for you to confirm — so it stays coherent without you remembering to tap “Refresh memory.” It only runs when enough has changed, no more than once a day, and never when AI is off or over budget. Turn off to only ever tidy memory by tapping Refresh yourself.',
      schema: z.boolean(),
      default: true,
      control: { type: 'switch' },
      scope: 'vault',
      order: 3,
      visibleWhen: (values) => values['sessions.memoryEnabled'] !== false,
    }),
    defineSetting({
      key: 'intake.inSessionDepthAsk',
      section: 'sessions',
      label: 'Invite me to go deeper during sessions',
      description:
        'When on, if a session keeps circling a part of your profile you haven’t filled in, the coach may gently invite you — once — to share more about it (e.g. “want to tell me a bit more about your family?”). It only asks when it’s clearly relevant, never pushes, and always steps back for anything serious. Turn off to only ever see calm “go deeper” cards instead. (Sensitive areas stay behind the 18+ check.)',
      schema: z.boolean(),
      default: true,
      control: { type: 'switch' },
      scope: 'vault',
      order: 3,
      visibleWhen: aiEnabled,
    }),
    defineSetting({
      key: 'coaching.proactivity',
      section: 'coaching',
      label: 'Proactive check-ins',
      description:
        'How much your coach follows up on its own — gently raising a goal you set when it’s relevant, and noticing themes across your sessions, dreams, and reflections. This is gentle reflection, never a checklist or a watcher, and it’s just for you. (Support for a hard moment is always available, whatever you choose here.)',
      // The registry value is INERT (always null) — ProactivityControl owns the real per-person state via
      // coaching:getPrefs/setPrefs (the bridge is the trust boundary). `device` keeps the inert placeholder
      // off the synced vault, so it can never be mistaken for a household-wide write.
      schema: z.null(),
      default: null,
      control: { type: 'custom', render: ProactivityControl },
      scope: 'device',
      order: 1,
    }),
    defineSetting({
      key: 'questionnaires.autoAnalyze',
      section: 'questionnaires',
      label: 'Analyze responses automatically',
      description:
        'When on, opening a questionnaire’s Results automatically analyzes any new responses into draft insights (using your AI allowance) instead of waiting for you to tap Analyze. You still review and approve each insight before it informs your coaching.',
      schema: z.boolean(),
      default: false,
      control: { type: 'switch' },
      order: 1,
      visibleWhen: aiEnabled,
    }),
    defineSetting({
      key: 'questionnaires.defaultMessages',
      section: 'questionnaires',
      label: 'External message templates',
      description:
        'Default email/text wording for sending a questionnaire to someone without SelfOS.',
      schema: RelayMessagesSchema,
      default: DEFAULT_RELAY_MESSAGES,
      control: { type: 'custom', render: RelayMessagesControl },
      scope: 'vault',
      order: 3,
    }),
    defineSetting({
      key: 'questionnaires.intimacyTopics',
      section: 'questionnaires',
      label: 'Intimacy topics (18+)',
      description:
        'Add or remove the consensual-adult topics that AI uses to draft intimacy questionnaires and the personal intake. Household-wide.',
      schema: z.null(),
      default: null,
      control: { type: 'custom', render: IntimacyTopicsControl },
      scope: 'vault',
      adminOnly: true,
      order: 4,
    }),
    defineSetting({
      key: 'dreams.memoryEnabled',
      section: 'dreams',
      label: 'Dream memory',
      description:
        'When on, dreams you analyze and approve help personalize your coaching across the app. Turn off to keep dreams out of your coaching context entirely.',
      schema: z.boolean(),
      default: true,
      control: { type: 'switch' },
      scope: 'vault',
      order: 1,
    }),
    defineSetting({
      key: 'dreams.imageGenerationEnabled',
      section: 'dreams',
      label: 'Generate dream images',
      description:
        'When on, you can create an AI image of a dream. Generating sends a description of the dream (never anyone’s name or private notes) to OpenAI, a third party, to draw the picture. Off by default.',
      schema: z.boolean(),
      default: false,
      control: { type: 'switch' },
      scope: 'vault',
      order: 2,
    }),
    defineSetting({
      key: 'dreams.imageModel',
      section: 'dreams',
      label: 'Image model',
      description: 'Which OpenAI model draws the image.',
      schema: z.enum(['gpt-image-2', 'gpt-image-1']),
      default: 'gpt-image-2',
      control: {
        type: 'select',
        options: [
          { value: 'gpt-image-2', label: 'GPT Image 2 — newest' },
          { value: 'gpt-image-1', label: 'GPT Image 1' },
        ],
      },
      scope: 'vault',
      adminOnly: true,
      order: 3,
      visibleWhen: dreamImagesEnabled,
    }),
    defineSetting({
      key: 'dreams.imageStyle',
      section: 'dreams',
      label: 'Default image style',
      description: 'The look used for new dream images. You can override it per image.',
      schema: z.string().min(1),
      default: DEFAULT_IMAGE_STYLE,
      control: { type: 'select', groups: IMAGE_STYLE_PRESETS },
      scope: 'vault',
      order: 4,
      visibleWhen: dreamImagesEnabled,
    }),
    defineSetting({
      key: 'dreams.imageStyleNotes',
      section: 'dreams',
      label: 'Style notes (optional)',
      description:
        'Describe the look in your own words — e.g. “muted earth tones, soft focus, golden-hour light.” Applies to every dream image, on top of the style above. It never adds anyone’s name or private details.',
      schema: z.string().max(300),
      default: '',
      control: {
        type: 'textarea',
        rows: 3,
        maxLength: 300,
        placeholder: 'muted earth tones, soft focus, golden-hour light…',
      },
      scope: 'vault',
      order: 5,
      visibleWhen: dreamImagesEnabled,
    }),
    defineSetting({
      key: 'dreams.imageApiKey',
      section: 'dreams',
      label: 'OpenAI API key',
      schema: z.null(),
      default: null,
      control: { type: 'custom', render: OpenAiKeyControl },
      adminOnly: true,
      // Device-local secret (00 §6.2) — never synced, like the Claude key above.
      scope: 'device',
      order: 6,
      visibleWhen: dreamImagesEnabled,
    }),
    defineSetting({
      key: 'dreams.imageTest',
      section: 'dreams',
      label: 'OpenAI connection',
      schema: z.null(),
      default: null,
      control: { type: 'custom', render: OpenAiTestConnectionControl },
      scope: 'device',
      order: 7,
      visibleWhen: dreamImagesEnabled,
    }),
    defineSetting({
      key: 'relay.connection',
      section: 'relay',
      label: 'Cloudflare relay',
      schema: z.null(),
      default: null,
      control: { type: 'custom', render: RelaySettingsPanel },
      adminOnly: true,
      order: 1,
    }),
    defineSetting({
      key: 'devices.list',
      section: 'devices',
      label: 'Your devices',
      schema: z.null(),
      default: null,
      control: { type: 'custom', render: DevicesControl },
      adminOnly: true,
      order: 1,
    }),
    defineSetting({
      key: 'vault.location',
      section: 'vault',
      label: 'Location',
      schema: z.null(),
      default: null,
      control: { type: 'custom', render: VaultLocationValue },
      order: 1,
    }),
    defineSetting({
      key: 'vault.reveal',
      section: 'vault',
      label: 'Vault folder',
      schema: z.null(),
      default: null,
      control: { type: 'custom', render: RevealVaultRow },
      order: 2,
    }),
    defineSetting({
      key: 'vault.change',
      section: 'vault',
      label: 'Change vault',
      description: 'Unlink this vault and switch to a different folder. Your data is not deleted.',
      schema: z.null(),
      default: null,
      control: { type: 'custom', render: ChangeVaultRow },
      order: 3,
    }),
    defineSetting({
      key: 'about.version',
      section: 'about',
      label: 'Version',
      schema: z.null(),
      default: null,
      control: { type: 'custom', render: AboutVersion },
      order: 1,
    }),
    defineSetting({
      key: 'about.checkForUpdates',
      section: 'about',
      label: 'Updates',
      description:
        'Check GitHub for a newer version. SelfOS never auto-installs — you download manually.',
      schema: z.null(),
      default: null,
      control: { type: 'custom', render: CheckForUpdatesControl },
      order: 2,
    }),
    defineSetting({
      key: 'updates.autoCheck',
      section: 'about',
      label: 'Check for updates automatically',
      description:
        'On launch and periodically while open. Only contacts GitHub — no personal data is sent.',
      schema: z.boolean(),
      default: true,
      control: { type: 'switch' },
      scope: 'device', // an install-level preference — never synced across the household
      order: 3,
    }),
    defineSetting({
      key: 'about.disclaimer',
      section: 'about',
      label: 'About SelfOS',
      schema: z.null(),
      default: null,
      control: { type: 'custom', render: AboutDisclaimer },
      order: 4,
    }),
  ]);
}

registerBuiltinSettings();
