import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type {
  BookManifest,
  BookOutline,
  ChapterMarkup,
  ChatMessage,
  Conversation,
  Insight,
  StoryBookBundle,
  StoryBookTypeView,
  StoryMarkInput,
  StoryMemory,
  StoryMemoryDetail,
  StoryMemoryView,
  StoryRevisionResult,
  StructuralProposal,
} from '@shared/schemas';
import { Story, buildAnchor, countApplicable } from './Story';
import { useStoryStore } from '../../../stores/storyStore';
import { useStoryMemoryStore } from '../../../stores/storyMemoryStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useInsightStore } from '../../../stores/insightStore';
import { clearMockBridge, elevateToOwner, installMockBridge } from '../../../test-utils/bridge';
import { useSettingsStore } from '../../../settings/settingsStore';

const ACTIVE_PERSON = {
  id: 'me',
  schemaVersion: 2 as const,
  displayName: 'Ben',
  isSubject: true,
  tags: [],
  createdAt: 'now',
  updatedAt: 'now',
};

const BOOK_TYPES: StoryBookTypeView[] = [
  {
    id: 'biography',
    label: 'Biography',
    blurb: 'A true life story.',
    structures: [{ id: 'chronicle', label: 'Chronological', description: 'x', isDefault: true }],
    stylePresets: [
      { id: 'warm', label: 'Warm' },
      { id: 'literary', label: 'Literary' },
      { id: 'plain', label: 'Plain' },
    ],
  },
];

function manifest(over: Partial<BookManifest> = {}): BookManifest {
  return {
    id: 'b1',
    schemaVersion: 1,
    personId: 'me',
    type: 'biography',
    title: 'The Story of Ben',
    config: { voice: 'third', style: 'warm', length: 'standard', autoRefresh: true },
    essence: 'A quiet man learning to speak up.',
    status: 'outlining',
    sharedWith: [],
    createdAt: 'now',
    updatedAt: 'now',
    ...over,
  };
}

function outline(approved: boolean): BookOutline {
  return {
    schemaVersion: 1,
    approved,
    parts: [
      {
        id: 'p1',
        title: 'Roots',
        chapters: [
          {
            id: 'c1',
            title: 'The Garage',
            brief: 'He learns a machine obeys.',
            lifeAreas: [],
            order: 0,
          },
        ],
      },
    ],
  };
}

function bundle(approved: boolean): StoryBookBundle {
  return {
    manifest: manifest({ status: approved ? 'drafting' : 'outlining' }),
    outline: outline(approved),
    timeline: { schemaVersion: 1, events: [] },
    chapters: [],
  };
}

function writtenBundle(status: 'new' | 'reviewed' = 'new'): StoryBookBundle {
  return {
    manifest: manifest({ status: 'ready' }),
    outline: outline(true),
    timeline: { schemaVersion: 1, events: [] },
    chapters: [
      {
        id: 'c1',
        schemaVersion: 1,
        partId: 'p1',
        order: 0,
        title: 'The Garage',
        markdown: 'The garage smelled of cut pine.\n\nHe watched, and said nothing.',
        revision: 1,
        status,
        sourceSignature: '',
        provenance: [{ anchor: 'p0', refs: [{ kind: 'insight', id: 'i1', at: '2026-05-12' }] }],
        protectedBlocks: [],
        pinnedQuotes: [],
        imagePlacements: [],
      },
    ],
  };
}

/**
 * The Story suite's baseline is an AI-READY household (key resolved + AI on) — the begin flow now gates on
 * that (§8.2 honest states), so the default mock's `resolvedReady: false` would disable "Begin your book" /
 * "Write my book" in every setup test. Tests about the unavailable state override these explicitly.
 */
function installStoryBridge(
  overrides: Parameters<typeof installMockBridge>[0] = {},
): ReturnType<typeof installMockBridge> {
  useSettingsStore.setState((s) => ({ values: { ...s.values, 'ai.enabled': true } }));
  return installMockBridge({
    aiKeyStatus: () =>
      Promise.resolve({
        hasSharedKey: true,
        hasDeviceOverride: false,
        resolvedReady: true,
        source: 'shared' as const,
      }),
    ...overrides,
  });
}

function renderStory(): void {
  render(
    <MemoryRouter>
      <Story />
    </MemoryRouter>,
  );
}

/** The Studio's panels live in tabs (§13.2). Wait for the tab bar, then switch. */
async function openTab(name: string): Promise<void> {
  await userEvent.click(await screen.findByRole('tab', { name }));
}

/** Render under a real `story/*` route so a deep-linked tab is read from the URL (§13.2). */
function renderStoryAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="story/*" element={<Story />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  clearMockBridge();
  useStoryStore.getState().reset();
  useStoryMemoryStore.getState().reset(); // "Share a memory" (§14) — per-person chat + collection state
  useInsightStore.getState().reset(); // the Studio's crisis-quiet read loads it (§13.4)
  useSessionStore.setState({ activePerson: null, access: null });
  useSettingsStore.setState((s) => ({
    values: {
      ...s.values,
      'ai.enabled': false,
      'dreams.imageGenerationEnabled': false,
      'dreams.imageStyle': 'oil painting',
    },
  }));
});

describe('Story (64)', () => {
  it('shows the invitation empty state with a Begin your book action', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([]),
    });
    renderStory();
    expect(await screen.findByRole('button', { name: 'Begin your book' })).toBeInTheDocument();
  });

  it('setup drafts the whole book end-to-end and lands on the overview (no outline-review gate)', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([]),
      storyCreate: () => Promise.resolve(manifest()),
      storyGet: () => Promise.resolve(writtenBundle()),
      storyGenerateFullDraft: () => Promise.resolve({ ok: true, bundle: writtenBundle() }),
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: 'Begin your book' }));
    expect(await screen.findByLabelText('Title')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Write my book' }));
    // No outline-review gate — it drafts straight through to the finished, editable book.
    expect(await screen.findByRole('button', { name: /The Garage/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Review your outline' })).not.toBeInTheDocument();
  });

  it('shows the live writing progress screen while a draft runs (phase, chapter count, progress bar)', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([]),
    });
    renderStory();
    await screen.findByRole('button', { name: 'Begin your book' });
    act(() =>
      useStoryStore.setState({
        progress: {
          bookId: 'b1',
          phase: 'writing',
          chaptersDone: 2,
          chaptersTotal: 8,
          currentTitle: 'The Garage',
          startedAt: Date.now() - 5000,
          scope: 'create',
        },
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Writing your story' })).toBeInTheDocument();
    expect(screen.getByText(/chapter 3 of 8/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Writing progress' })).toBeInTheDocument();
    expect(screen.getByText(/keeps writing in the background/)).toBeInTheDocument();
  });

  it('setup: title is optional (blank lets the biographer name it), Full is the default length, and the added styles are offered', async () => {
    let createdWith: { title: string; config: { length: string } } | null = null;
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([]),
      storyCreate: (input) => {
        createdWith = input as never;
        return Promise.resolve(manifest());
      },
      storyGet: () => Promise.resolve(writtenBundle()),
      storyGenerateFullDraft: () => Promise.resolve({ ok: true, bundle: writtenBundle() }),
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: 'Begin your book' }));
    // A new style register is offered in the Style card gallery.
    expect(await screen.findByRole('radio', { name: 'Cinematic' })).toBeInTheDocument();
    // The Create button is enabled with NO title typed — blank means the AI names it.
    const create = screen.getByRole('button', { name: 'Write my book' });
    expect(create).toBeEnabled();
    await userEvent.click(create);
    await waitFor(() => expect(createdWith).not.toBeNull());
    expect(createdWith!.title).toBe(''); // left blank → the biographer proposes one
    expect(createdWith!.config.length).toBe('full'); // Full is the default for a biography
  });

  it('invitation: shows the three-step promise + a "Drawn from" chip row with real counts (§13.3)', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([]),
      storyCorpusStats: () =>
        Promise.resolve({
          reflections: 5,
          dreams: 2,
          memories: 1,
          answers: 3,
          yearFrom: 2019,
          yearTo: 2026,
        }),
    });
    renderStory();
    expect(await screen.findByRole('button', { name: 'Begin your book' })).toBeInTheDocument();
    expect(screen.getByText('It reads')).toBeInTheDocument();
    expect(screen.getByText('It keeps writing')).toBeInTheDocument();
    // The "Drawn from" chips reflect the deterministic corpus counts + the year span — and only material
    // that actually feeds generation, never a raw session count (§15.2).
    expect(await screen.findByText('5 reflections')).toBeInTheDocument();
    expect(screen.getByText('1 memory')).toBeInTheDocument();
    expect(screen.getByText('3 answered questionnaires')).toBeInTheDocument();
    expect(screen.getByText('2019–2026')).toBeInTheDocument();
    // No session chip: the type no longer carries a conversation count, and a raw transcript never feeds
    // generation. (Scoped to the chip row — the invitation copy is free to mention sessions in prose.)
    const chipRow = screen.getByText('5 reflections').parentElement;
    expect(chipRow?.textContent ?? '').not.toMatch(/session/i);
  });

  it('commission: the live preview specimen changes with the chosen style (§13.3)', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([]),
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: 'Begin your book' }));
    // The default (Warm) specimen is on screen; the preview rail is labelled "How your biographer will sound".
    expect(screen.getByText('How your biographer will sound')).toBeInTheDocument();
    expect(await screen.findByText(/porch light on/)).toBeInTheDocument();
    // Picking the Cinematic style card re-renders the specimen.
    await userEvent.click(screen.getByRole('radio', { name: 'Cinematic' }));
    expect(await screen.findByText(/Rain on the windshield/)).toBeInTheDocument();
    expect(screen.queryByText(/porch light on/)).not.toBeInTheDocument();
  });

  it('writing: the outline reveals itself as a chapter list with a "Browse SelfOS" exit (§13.3)', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([]),
    });
    renderStory();
    await screen.findByRole('button', { name: 'Begin your book' });
    act(() =>
      useStoryStore.setState({
        bundle: bundle(true),
        progress: {
          bookId: 'b1',
          phase: 'writing',
          chaptersDone: 0,
          chaptersTotal: 1,
          currentTitle: 'The Garage',
          startedAt: Date.now() - 3000,
          scope: 'create',
        },
      }),
    );
    // The outline reveal names the chapter (not an anonymous dot) and offers the background-browse exit.
    const chapters = await screen.findByRole('list', { name: 'Chapters' });
    expect(within(chapters).getByText('The Garage')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browse SelfOS ›' })).toBeInTheDocument();
  });

  it('renames the book from the overview (title editable in place, no outline gate)', async () => {
    let updatedWith: { bookId: string; title?: string } | null = null;
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle()),
      storyUpdate: (input) => {
        updatedWith = input as never;
        return Promise.resolve(manifest());
      },
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: 'Rename this book' }));
    const titleInput = await screen.findByLabelText('Book title');
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, 'The Weight of Quiet');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]!);
    await waitFor(() => expect(updatedWith).not.toBeNull());
    expect(updatedWith).toEqual({ bookId: 'b1', title: 'The Weight of Quiet' });
  });

  it('renders chapters as cover-backed cards grouped by part, with number + status (§3.1 redesign)', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('reviewed')),
      storyImages: () => Promise.resolve([]),
    });
    renderStory();
    // The part is a titled section with an eyebrow; the chapter is a clickable card carrying its number + a
    // status pill (reviewed → "Reviewed") — not a plain list row.
    expect(await screen.findByText('Part one')).toBeInTheDocument();
    const card = await screen.findByRole('button', { name: /The Garage/ });
    expect(card).toHaveTextContent('Chapter 1');
    expect(card).toHaveTextContent('Reviewed');
  });

  it('Story settings: editing the book’s tone + image style persists to its config (§3.8)', async () => {
    const configs: unknown[] = [];
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle()),
      storyUpdate: (input) => {
        const i = input as { config?: unknown };
        if (i.config) configs.push(i.config);
        return Promise.resolve(manifest());
      },
    });
    renderStory();
    // The settings live in the Settings tab (§13.4) — writing + images groups, open (no collapsible).
    await openTab('Settings');
    // Writing controls are editable (voice/tone/length) + the book's OWN image style.
    expect(await screen.findByLabelText('Narrative voice')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Tone'), 'cinematic');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Image style' }), 'ukiyo-e');
    await waitFor(() => expect(configs.length).toBeGreaterThanOrEqual(2));
    // The full config is sent each time (updateBook replaces it), carrying the changed field.
    expect(configs.some((c) => (c as { style?: string }).style === 'cinematic')).toBe(true);
    expect(configs.some((c) => (c as { imageStyle?: string }).imageStyle === 'ukiyo-e')).toBe(true);
  });

  it('a failed draft surfaces the error + a Try again path (no dead-end)', async () => {
    // The book EXISTS after storyCreate, so on failure the draft opens it (null outline) → NeedsOutline with
    // an error + Try again, never a blank overview.
    const noOutline: StoryBookBundle = {
      manifest: manifest(),
      outline: null,
      timeline: { schemaVersion: 1, events: [] },
      chapters: [],
    };
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([]),
      storyCreate: () => Promise.resolve(manifest()),
      storyGet: () => Promise.resolve(noOutline),
      storyGenerateFullDraft: () =>
        Promise.resolve({ ok: false, reason: 'AI_OFF', message: 'Turn on AI in Settings.' }),
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: 'Begin your book' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Write my book' }));
    expect(await screen.findByText('Turn on AI in Settings.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('writes the chapters, then opens one to read the prose with its sources', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'drafting' })]),
      storyGet: () => Promise.resolve(bundle(true)), // approved, no chapters yet
      storyGenerateChapters: () =>
        Promise.resolve({ ok: true, generated: 1, bundle: writtenBundle() }),
    });
    renderStory();
    // Overview offers to write the chapters.
    await userEvent.click(await screen.findByRole('button', { name: 'Write your chapters' }));
    // The chapter becomes a clickable row → open it.
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    expect(await screen.findByRole('heading', { name: 'The Garage' })).toBeInTheDocument();
    expect(screen.getByText(/cut pine/)).toBeInTheDocument();
    // Its provenance is revealed on demand.
    await userEvent.click(screen.getByRole('button', { name: /Sources/ }));
    expect(await screen.findByText(/Drawn from a coaching insight/)).toBeInTheDocument();
  });

  it('rewrites a chapter from the reader and shows the fresh prose', async () => {
    const rewritten: StoryBookBundle = {
      ...writtenBundle('new'),
      chapters: [
        {
          ...writtenBundle('new').chapters[0]!,
          markdown: 'A richer, rewritten scene.',
          revision: 2,
          status: 'updated',
        },
      ],
    };
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyRegenerateChapter: () => Promise.resolve({ ok: true, generated: 1, bundle: rewritten }),
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Rewrite this chapter' }));
    // The metered rewrite sits behind a two-step confirm (§8.2 spend legibility).
    await userEvent.click(await screen.findByRole('button', { name: 'Rewrite it' }));
    expect(await screen.findByText(/richer, rewritten scene/)).toBeInTheDocument();
  });

  it('surfaces an error when a rewrite fails (no silent dead-end)', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyRegenerateChapter: () =>
        Promise.resolve({ ok: false, reason: 'BUDGET', message: 'AI budget reached.' }),
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Rewrite this chapter' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Rewrite it' }));
    expect(await screen.findByText('AI budget reached.')).toBeInTheDocument();
  });

  it('surfaces an error when writing every chapter fails (no silent dead-end)', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'drafting' })]),
      storyGet: () => Promise.resolve(bundle(true)), // approved, no chapters yet
      storyGenerateChapters: () =>
        Promise.resolve({ ok: false, reason: 'REFUSED', message: 'Couldn’t write the chapters.' }),
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: 'Write your chapters' }));
    expect(await screen.findByText('Couldn’t write the chapters.')).toBeInTheDocument();
    // The action is still offered — not a dead-end.
    expect(screen.getByRole('button', { name: 'Write your chapters' })).toBeInTheDocument();
  });

  it('shows the rich chapter-writing progress INLINE on the overview (not a full-screen takeover)', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'drafting' })]),
      storyGet: () => Promise.resolve(bundle(true)), // approved outline, no chapters → a pending write
    });
    renderStory();
    await screen.findByRole('button', { name: 'Write your chapters' });
    act(() =>
      useStoryStore.setState({
        progress: {
          bookId: 'b1',
          phase: 'writing',
          chaptersDone: 0,
          chaptersTotal: 1,
          currentTitle: 'The Garage',
          startedAt: Date.now(),
          scope: 'chapters',
        },
      }),
    );
    // The rich progress replaces the button, in place — the overview stays visible (its title still shows).
    expect(await screen.findByRole('heading', { name: 'Writing your story' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'The Story of Ben' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Write your chapters' })).not.toBeInTheDocument();
  });

  it('marks a chapter reviewed from the reader', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyReviewChapter: () => Promise.resolve(writtenBundle('reviewed')),
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Looks good' }));
    // The button is replaced by a Reviewed marker once the chapter is reviewed.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Looks good' })).not.toBeInTheDocument(),
    );
    expect(screen.getAllByText('Reviewed').length).toBeGreaterThan(0);
  });

  it('an updated chapter leads with a Shape ribbon whose "What changed" reveals the word diff (§13.5)', async () => {
    const updated = writtenBundle('new');
    updated.chapters[0] = {
      ...updated.chapters[0]!,
      status: 'updated',
      markdown: 'The garage smelled of cedar.',
      previousMarkdown: 'The garage smelled of pine.',
    };
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(updated),
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    // The ribbon leads with the rewrite eyebrow + the review action; the diff is hidden until asked for.
    expect(await screen.findByText('Rewritten from new material')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Looks good' })).toBeInTheDocument();
    expect(screen.queryByLabelText('What changed in this rewrite')).not.toBeInTheDocument();
    // Reveal the word diff → the removed old word + the added new word both render.
    await userEvent.click(screen.getByRole('button', { name: 'What changed' }));
    const diff = await screen.findByLabelText('What changed in this rewrite');
    expect(diff.querySelector('del')?.textContent).toContain('pine.');
    expect(diff.querySelector('ins')?.textContent).toContain('cedar.');
    // Toggling again hides it.
    await userEvent.click(screen.getByRole('button', { name: 'Hide changes' }));
    expect(screen.queryByLabelText('What changed in this rewrite')).not.toBeInTheDocument();
  });

  it('a first-draft (new) chapter with no prior text offers no "What changed" toggle (§13.5)', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')), // status 'new', no previousMarkdown
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    expect(await screen.findByText('New chapter')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'What changed' })).not.toBeInTheDocument();
  });

  it('a STALE chapter still shows its status cue AND a spend-free "Looks good" review (§13.5)', async () => {
    const staleBundle = writtenBundle('new');
    staleBundle.chapters[0] = { ...staleBundle.chapters[0]!, status: 'stale' };
    const storyReviewChapter = vi.fn(() => Promise.resolve(writtenBundle('reviewed')));
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(staleBundle),
      storyReviewChapter,
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    // The stale cue is shown (not a blank ribbon) and the accept-as-is review action is present.
    expect(await screen.findByText('New material to fold in')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Looks good' }));
    expect(storyReviewChapter).toHaveBeenCalledWith({ bookId: 'b1', chapterId: 'c1' });
  });

  it('marks a paragraph for deletion — the suggestion strip + apply bar appear', async () => {
    const storyMark = vi.fn(
      (input: StoryMarkInput): Promise<ChapterMarkup> =>
        Promise.resolve({ schemaVersion: 1, chapterId: input.chapterId, marks: [input.mark] }),
    );
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyGetMarkup: (): Promise<ChapterMarkup> =>
        Promise.resolve({ schemaVersion: 1, chapterId: 'c1', marks: [] }),
      storyMark,
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    // Each paragraph offers a "Mark up" affordance; open the first paragraph's toolbar.
    await userEvent.click((await screen.findAllByRole('button', { name: 'Mark up' }))[0]!);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    // The mark was created as a delete…
    expect(storyMark).toHaveBeenCalledWith(
      expect.objectContaining({ mark: expect.objectContaining({ kind: 'delete' }) }),
    );
    // …and the margin-rail strip + the bottom-sticky pending pill reflect it (a cut).
    expect(await screen.findByRole('button', { name: /1 change ready/ })).toBeInTheDocument();
    expect(screen.getByText(/1 cut/)).toBeInTheDocument();
  });

  it('a Fix-this comment can also flag the source insight in Memory', async () => {
    const storyMark = vi.fn(
      (input: StoryMarkInput): Promise<ChapterMarkup> =>
        Promise.resolve({ schemaVersion: 1, chapterId: input.chapterId, marks: [input.mark] }),
    );
    const insightsFlag = vi.fn(() => Promise.resolve(null));
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')), // p0 provenance carries insight i1
      storyGetMarkup: (): Promise<ChapterMarkup> =>
        Promise.resolve({ schemaVersion: 1, chapterId: 'c1', marks: [] }),
      storyMark,
      insightsFlag,
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    await userEvent.click((await screen.findAllByRole('button', { name: 'Mark up' }))[0]!); // p0
    await userEvent.click(await screen.findByRole('button', { name: 'Comment' }));
    await userEvent.click(screen.getByRole('button', { name: 'Fix this' }));
    // The flag-to-Memory checkbox appears only for a Fix-this comment on an insight-backed paragraph.
    await userEvent.click(screen.getByRole('checkbox', { name: /mark the source insight/ }));
    await userEvent.type(screen.getByLabelText('Comment'), 'that isn’t right about me');
    await userEvent.click(screen.getByRole('button', { name: 'Add comment' }));
    expect(storyMark).toHaveBeenCalledWith(
      expect.objectContaining({ mark: expect.objectContaining({ flagInsightId: 'i1' }) }),
    );
    expect(insightsFlag).toHaveBeenCalledWith({ insightId: 'i1', flagged: true });
  });

  it('does not offer the flag checkbox for a non-fix comment', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyGetMarkup: (): Promise<ChapterMarkup> =>
        Promise.resolve({ schemaVersion: 1, chapterId: 'c1', marks: [] }),
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    await userEvent.click((await screen.findAllByRole('button', { name: 'Mark up' }))[0]!);
    await userEvent.click(await screen.findByRole('button', { name: 'Comment' }));
    // Default intent is "Add context" → no flag checkbox.
    expect(
      screen.queryByRole('checkbox', { name: /mark the source insight/ }),
    ).not.toBeInTheDocument();
  });

  it('adds a comment with an intent', async () => {
    const storyMark = vi.fn(
      (input: StoryMarkInput): Promise<ChapterMarkup> =>
        Promise.resolve({ schemaVersion: 1, chapterId: input.chapterId, marks: [input.mark] }),
    );
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyGetMarkup: (): Promise<ChapterMarkup> =>
        Promise.resolve({ schemaVersion: 1, chapterId: 'c1', marks: [] }),
      storyMark,
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    await userEvent.click((await screen.findAllByRole('button', { name: 'Mark up' }))[0]!);
    await userEvent.click(await screen.findByRole('button', { name: 'Comment' }));
    await userEvent.type(screen.getByLabelText('Comment'), 'the lathe was three generations old');
    await userEvent.click(screen.getByRole('button', { name: 'Add comment' }));
    expect(storyMark).toHaveBeenCalledWith(
      expect.objectContaining({
        mark: expect.objectContaining({
          kind: 'comment',
          intent: 'addContext',
          text: 'the lathe was three generations old',
        }),
      }),
    );
  });

  it('applies pending changes from the apply bar', async () => {
    const storyApplyMarkup = vi.fn(
      (): Promise<StoryRevisionResult> =>
        Promise.resolve({
          ok: true,
          bundle: writtenBundle('new'),
          markup: { schemaVersion: 1, chapterId: 'c1', marks: [] },
        }),
    );
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyGetMarkup: (): Promise<ChapterMarkup> =>
        Promise.resolve({
          schemaVersion: 1,
          chapterId: 'c1',
          marks: [
            {
              id: 'd1',
              kind: 'delete',
              anchor: { paragraphId: 'p0', quote: 'The garage smelled of cut pine.' },
              status: 'pending',
              createdAt: 'now',
            },
          ],
        }),
      storyApplyMarkup,
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    // The pending delete surfaces the pill on load → open the Review & apply sheet → apply the one revision.
    await userEvent.click(await screen.findByRole('button', { name: /1 change ready/ }));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Apply with your biographer' }),
    );
    expect(storyApplyMarkup).toHaveBeenCalledWith({ bookId: 'b1', chapterId: 'c1' });
    expect(storyApplyMarkup).toHaveBeenCalledTimes(1);
  });

  it('undoes a pending mark from its strip', async () => {
    const storyRemoveMark = vi.fn(
      (): Promise<ChapterMarkup> =>
        Promise.resolve({ schemaVersion: 1, chapterId: 'c1', marks: [] }),
    );
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyGetMarkup: (): Promise<ChapterMarkup> =>
        Promise.resolve({
          schemaVersion: 1,
          chapterId: 'c1',
          marks: [
            {
              id: 'd1',
              kind: 'delete',
              anchor: { paragraphId: 'p0', quote: 'The garage smelled of cut pine.' },
              status: 'pending',
              createdAt: 'now',
            },
          ],
        }),
      storyRemoveMark,
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo this deletion' }));
    expect(storyRemoveMark).toHaveBeenCalledWith({ bookId: 'b1', chapterId: 'c1', markId: 'd1' });
  });

  it('pins a passage in your own words', async () => {
    const storyPinQuote = vi.fn(() => Promise.resolve(writtenBundle('new')));
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyGetMarkup: (): Promise<ChapterMarkup> =>
        Promise.resolve({ schemaVersion: 1, chapterId: 'c1', marks: [] }),
      storyPinQuote,
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    await userEvent.click((await screen.findAllByRole('button', { name: 'Mark up' }))[0]!);
    await userEvent.click(await screen.findByRole('button', { name: 'Pin' }));
    expect(storyPinQuote).toHaveBeenCalledWith(
      expect.objectContaining({ bookId: 'b1', chapterId: 'c1' }),
    );
  });

  it('does not count a question comment toward the apply bar', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyGetMarkup: (): Promise<ChapterMarkup> =>
        Promise.resolve({
          schemaVersion: 1,
          chapterId: 'c1',
          marks: [
            {
              id: 'q1',
              kind: 'comment',
              anchor: { paragraphId: 'p0', quote: 'cut pine' },
              intent: 'question',
              text: 'why frame it this way?',
              status: 'open',
              createdAt: 'now',
            },
          ],
        }),
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    // The comment shows in the rail, but it's not an "apply" change → no pending pill.
    expect(await screen.findByText(/why frame it this way/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /change.*ready/ })).not.toBeInTheDocument();
  });

  it('makes an instant inline edit', async () => {
    const storyEditPassage = vi.fn(() => Promise.resolve(writtenBundle('new')));
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyGetMarkup: (): Promise<ChapterMarkup> =>
        Promise.resolve({ schemaVersion: 1, chapterId: 'c1', marks: [] }),
      storyEditPassage,
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    await userEvent.click((await screen.findAllByRole('button', { name: 'Mark up' }))[0]!);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const box = screen.getByLabelText('Your words');
    await userEvent.clear(box);
    await userEvent.type(box, 'The garage smelled of cold steel.');
    await userEvent.click(screen.getByRole('button', { name: 'Save my words' }));
    expect(storyEditPassage).toHaveBeenCalledWith(
      expect.objectContaining({ newText: 'The garage smelled of cold steel.' }),
    );
  });

  it('adds a reminder to-do from the reader', async () => {
    const storyMark = vi.fn(
      (input: StoryMarkInput): Promise<ChapterMarkup> =>
        Promise.resolve({ schemaVersion: 1, chapterId: input.chapterId, marks: [input.mark] }),
    );
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyGetMarkup: (): Promise<ChapterMarkup> =>
        Promise.resolve({ schemaVersion: 1, chapterId: 'c1', marks: [] }),
      storyMark,
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    await userEvent.click((await screen.findAllByRole('button', { name: 'Mark up' }))[0]!);
    await userEvent.click(await screen.findByRole('button', { name: 'To-do' }));
    await userEvent.type(screen.getByLabelText('To-do'), 'upload the shop photo');
    await userEvent.click(screen.getByRole('button', { name: 'Add to-do' }));
    expect(storyMark).toHaveBeenCalledWith(
      expect.objectContaining({
        mark: expect.objectContaining({
          kind: 'todo',
          todoKind: 'remind',
          text: 'upload the shop photo',
        }),
      }),
    );
  });

  it('turns a to-do into questions (mints a check-in)', async () => {
    const storyTodoToQuestions = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        markup: {
          schemaVersion: 1 as const,
          chapterId: 'c1',
          marks: [
            {
              id: 'q1',
              kind: 'todo' as const,
              text: 'the winter he got sick',
              todoKind: 'questions' as const,
              status: 'questionsSent' as const,
              assignmentId: 'a1',
              createdAt: 'now',
            },
          ],
        },
        assignmentId: 'a1',
      }),
    );
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyGetMarkup: (): Promise<ChapterMarkup> =>
        Promise.resolve({ schemaVersion: 1, chapterId: 'c1', marks: [] }),
      storyTodoToQuestions,
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    await userEvent.click((await screen.findAllByRole('button', { name: 'Mark up' }))[0]!);
    await userEvent.click(await screen.findByRole('button', { name: 'To-do' }));
    await userEvent.click(screen.getByRole('button', { name: 'Turn into questions' }));
    await userEvent.type(screen.getByLabelText('To-do'), 'the winter he got sick');
    await userEvent.click(screen.getByRole('button', { name: 'Send me questions' }));
    expect(storyTodoToQuestions).toHaveBeenCalledWith(
      expect.objectContaining({ bookId: 'b1', chapterId: 'c1', focus: 'the winter he got sick' }),
    );
    expect(await screen.findByText(/waiting in your Inbox/)).toBeInTheDocument();
  });

  it('an ask to-do counts toward the pending pill', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyGetMarkup: (): Promise<ChapterMarkup> =>
        Promise.resolve({
          schemaVersion: 1,
          chapterId: 'c1',
          marks: [
            {
              id: 't1',
              kind: 'todo',
              anchor: { paragraphId: 'p0' },
              text: 'go deeper here',
              todoKind: 'ask',
              status: 'open',
              createdAt: 'now',
            },
          ],
        }),
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    expect(await screen.findByRole('button', { name: /1 change ready/ })).toBeInTheDocument();
    expect(screen.getByText(/1 to-do/)).toBeInTheDocument();
  });

  it('renders provenance as a numbered superscript that opens the sources popover (§13.5 R3)', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')), // p0 carries one insight ref
      storyGetMarkup: (): Promise<ChapterMarkup> =>
        Promise.resolve({ schemaVersion: 1, chapterId: 'c1', marks: [] }),
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    // The Sources affordance is now a numbered footnote superscript (not an inline "Sources (N)" button).
    const sup = await screen.findByRole('button', { name: 'Sources (1)' });
    // The marker shows the footnote number, not the old inline "Sources (N)" label text.
    expect(sup).toHaveTextContent('1');
    expect(screen.queryByText('Sources (1)')).not.toBeInTheDocument();
    await userEvent.click(sup);
    expect(await screen.findByText(/Drawn from a coaching insight/)).toBeInTheDocument();
  });

  it('places a pending mark in the right-margin rail, not under the paragraph (§13.5 R3)', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyGetMarkup: (): Promise<ChapterMarkup> =>
        Promise.resolve({
          schemaVersion: 1,
          chapterId: 'c1',
          marks: [
            {
              id: 'd1',
              kind: 'delete',
              anchor: { paragraphId: 'p0', quote: 'The garage smelled of cut pine.' },
              status: 'pending',
              createdAt: 'now',
            },
          ],
        }),
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    const rail = (await screen.findAllByTestId('shape-mark-rail'))[0]!;
    expect(within(rail).getByText(/The garage smelled of cut pine/)).toBeInTheDocument();
    // The undo affordance still lives on the mark in the rail (unchanged behaviour, relocated).
    expect(within(rail).getByRole('button', { name: 'Undo this deletion' })).toBeInTheDocument();
  });

  it('the Review & apply sheet groups pending marks, removes one from the batch, and applies once (§13.5 R3)', async () => {
    let removeArgs: unknown = null;
    const storyRemoveMark = vi.fn((input: { markId: string }): Promise<ChapterMarkup> => {
      removeArgs = input;
      // Return the batch minus the removed cut so the sheet stays populated.
      return Promise.resolve({
        schemaVersion: 1,
        chapterId: 'c1',
        marks: [
          {
            id: 'c2',
            kind: 'comment',
            anchor: { paragraphId: 'p0', quote: 'cut pine' },
            intent: 'addContext',
            text: 'the lathe was three generations old',
            status: 'open',
            createdAt: 'now',
          },
          {
            id: 't3',
            kind: 'todo',
            anchor: { paragraphId: 'p1' },
            text: 'go deeper on the winter he got sick',
            todoKind: 'ask',
            status: 'open',
            createdAt: 'now',
          },
        ],
      });
    });
    const storyApplyMarkup = vi.fn(
      (): Promise<StoryRevisionResult> =>
        Promise.resolve({
          ok: true,
          bundle: writtenBundle('new'),
          markup: { schemaVersion: 1, chapterId: 'c1', marks: [] },
        }),
    );
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyGetMarkup: (): Promise<ChapterMarkup> =>
        Promise.resolve({
          schemaVersion: 1,
          chapterId: 'c1',
          marks: [
            {
              id: 'd1',
              kind: 'delete',
              anchor: { paragraphId: 'p0', quote: 'The garage smelled of cut pine.' },
              status: 'pending',
              createdAt: 'now',
            },
            {
              id: 'c2',
              kind: 'comment',
              anchor: { paragraphId: 'p0', quote: 'cut pine' },
              intent: 'addContext',
              text: 'the lathe was three generations old',
              status: 'open',
              createdAt: 'now',
            },
            {
              id: 't3',
              kind: 'todo',
              anchor: { paragraphId: 'p1' },
              text: 'go deeper on the winter he got sick',
              todoKind: 'ask',
              status: 'open',
              createdAt: 'now',
            },
            {
              // a question comment: it shows in the rail but is NOT counted and NOT in the sheet.
              id: 'q4',
              kind: 'comment',
              anchor: { paragraphId: 'p1', quote: 'nothing' },
              intent: 'question',
              text: 'why frame it this way?',
              status: 'open',
              createdAt: 'now',
            },
          ],
        }),
      storyRemoveMark,
      storyApplyMarkup,
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    // The pill counts the three applicable marks (the question comment is excluded).
    await userEvent.click(await screen.findByRole('button', { name: /3 changes ready/ }));
    const sheet = await screen.findByRole('dialog', { name: /Review and apply/ });
    expect(within(sheet).getByText('Cuts')).toBeInTheDocument();
    expect(within(sheet).getByText('Comments')).toBeInTheDocument();
    expect(within(sheet).getByText('For your biographer')).toBeInTheDocument();
    // The question comment is not offered in the applicable batch.
    expect(within(sheet).queryByText(/why frame it this way/)).not.toBeInTheDocument();
    // "Remove from this batch" is the existing mark undo.
    await userEvent.click(
      within(sheet).getAllByRole('button', { name: 'Remove from this batch' })[0]!,
    );
    expect(storyRemoveMark).toHaveBeenCalled();
    expect(removeArgs).toMatchObject({ markId: 'd1' });
    // Apply with your biographer runs the ONE metered revision (call-count invariant unchanged).
    await userEvent.click(
      within(sheet).getByRole('button', { name: 'Apply with your biographer' }),
    );
    expect(storyApplyMarkup).toHaveBeenCalledTimes(1);
    expect(storyApplyMarkup).toHaveBeenCalledWith({ bookId: 'b1', chapterId: 'c1' });
  });

  it('closes the Review & apply sheet when the last mark is removed (no empty dead-end, §13.5 R3)', async () => {
    const storyRemoveMark = vi.fn(
      (): Promise<ChapterMarkup> =>
        Promise.resolve({ schemaVersion: 1, chapterId: 'c1', marks: [] }),
    );
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyGetMarkup: (): Promise<ChapterMarkup> =>
        Promise.resolve({
          schemaVersion: 1,
          chapterId: 'c1',
          marks: [
            {
              id: 'd1',
              kind: 'delete',
              anchor: { paragraphId: 'p0', quote: 'The garage smelled of cut pine.' },
              status: 'pending',
              createdAt: 'now',
            },
          ],
        }),
      storyRemoveMark,
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    await userEvent.click(await screen.findByRole('button', { name: /1 change ready/ }));
    const sheet = await screen.findByRole('dialog', { name: /Review and apply/ });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Remove from this batch' }));
    // The batch is now empty → the sheet closes AND the pill disappears (never a lingering dead-end).
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /Review and apply/ })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: /change.*ready/ })).not.toBeInTheDocument();
  });

  it('auto-refreshes the open book on mount (the living-book cadence)', async () => {
    const storyRefreshCheck = vi.fn(() =>
      Promise.resolve({ staled: 0, rewritten: 0, bundle: writtenBundle('new') }),
    );
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')), // autoRefresh is on in the fixture
      storyRefreshCheck,
    });
    useSessionStore.setState({ activePerson: ACTIVE_PERSON }); // the cadence is per active person
    renderStory();
    await screen.findByRole('heading', { name: 'The Story of Ben' });
    // The cadence hook nudged the bridge with auto:true (the bridge owns the real daily throttle).
    await waitFor(() =>
      expect(storyRefreshCheck).toHaveBeenCalledWith(expect.objectContaining({ auto: true })),
    );
  });

  it('refreshes the book from what’s new and reports what changed', async () => {
    const storyRefreshCheck = vi.fn((input: { bookId: string; auto?: boolean }) =>
      Promise.resolve({ staled: 2, rewritten: 2, bundle: writtenBundle('new'), ...input }),
    );
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyRefreshCheck,
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh from what’s new' }));
    expect(storyRefreshCheck).toHaveBeenCalledWith(
      expect.objectContaining({ bookId: 'b1', auto: false }),
    );
    expect(await screen.findByText(/Brought 2 chapters up to date/)).toBeInTheDocument();
  });

  it('the refresh reports when the story is already up to date', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyRefreshCheck: () =>
        Promise.resolve({ staled: 0, rewritten: 0, bundle: writtenBundle('new') }),
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh from what’s new' }));
    expect(await screen.findByText('Your story is up to date.')).toBeInTheDocument();
  });

  it('shows structural proposals and approves one (restructure, no prose written)', async () => {
    const proposal: StructuralProposal = {
      id: 'pr1',
      kind: 'newChapter',
      rationale: 'A new era emerged that the current chapters don’t hold.',
      createdAt: 'now',
      status: 'pending',
      partId: 'p1',
      title: 'The Middle Years',
      brief: 'Settling in.',
      lifeAreas: [],
    };
    const storyResolveProposal = vi.fn(() =>
      Promise.resolve({ ok: true, proposals: [], bundle: writtenBundle('new') }),
    );
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyProposals: () => Promise.resolve([proposal]),
      storyResolveProposal,
    });
    renderStory();
    expect(await screen.findByText(/Add a new chapter/)).toBeInTheDocument();
    expect(screen.getByText(/A new era emerged/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(storyResolveProposal).toHaveBeenCalledWith(
      expect.objectContaining({ bookId: 'b1', proposalId: 'pr1', action: 'approve' }),
    );
  });

  it('the refresh reports newly-filed structural suggestions', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyRefreshCheck: () =>
        Promise.resolve({
          staled: 0,
          rewritten: 0,
          proposalsAdded: 1,
          bundle: writtenBundle('new'),
        }),
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh from what’s new' }));
    expect(await screen.findByText(/1 suggested change to review below/)).toBeInTheDocument();
  });

  it('shows the completeness meter as a warm stage + a bar, never a percentage (§3.6)', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyCompleteness: () =>
        Promise.resolve({ stage: 'takingShape' as const, ratio: 0.33, covered: 4, total: 12 }),
    });
    renderStory();
    expect(await screen.findByText('Taking shape')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByText(/%/)).toBeNull(); // never a bare percentage (owner decision)
  });

  it('runs a manual gap check + reports a minted check-in', async () => {
    const storyInterviewCheck = vi.fn(() =>
      Promise.resolve({
        outcome: 'minted' as const,
        assignmentId: 'a1',
        completeness: { stage: 'takingShape' as const, ratio: 0.25, covered: 3, total: 12 },
      }),
    );
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyInterviewCheck,
    });
    renderStory();
    await openTab('Interview');
    await userEvent.click(await screen.findByRole('button', { name: 'Find what’s missing' }));
    // Manual = the plain `{ bookId }` call (no `auto` flag).
    expect(storyInterviewCheck).toHaveBeenCalledWith({ bookId: 'b1' });
    expect(await screen.findByText(/sent a few questions to your Inbox/i)).toBeInTheDocument();
  });

  it('the Interview tab shows the life map, gap invitations (Ask me about this), and answered history (§13.6)', async () => {
    const storyAskGap = vi.fn<
      (input: { bookId: string; gapId: string }) => Promise<{ ok: true; assignmentId: string }>
    >(() => Promise.resolve({ ok: true as const, assignmentId: 'a-new' }));
    let asked = false;
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyGaps: () =>
        Promise.resolve({
          gaps: [
            {
              id: 'g1',
              dimension: 'lowPoint',
              label: 'A hard season',
              focus: 'Tell me about a low point.',
              priority: 9,
            },
          ],
          partCoverage: [{ partId: 'p1', score: 0.5 }],
          hasOpenCheckin: asked,
        }),
      storyAskGap: (input) => {
        asked = true;
        return storyAskGap(input);
      },
      storyAnsweredCheckIns: () =>
        Promise.resolve([
          {
            assignmentId: 'a-woven',
            title: 'The winter you left',
            answeredAt: '2026-07-11T00:00:00.000Z',
            wroteIntoChapterTitle: 'First Words',
          },
          {
            assignmentId: 'a-old',
            title: 'A few questions for your story',
            answeredAt: '2026-07-10T00:00:00.000Z',
          },
        ]),
    });
    renderStory();
    await openTab('Interview');
    // Life map: the part title + its coverage word (the §9 text equivalent, never colour alone).
    expect(await screen.findByText('Roots')).toBeInTheDocument();
    expect(screen.getByText('taking shape')).toBeInTheDocument(); // 0.5 → "taking shape"
    // A gap invitation renders with "Ask me about this".
    expect(screen.getByText('A hard season')).toBeInTheDocument();
    // The answered history block — a woven check-in names the chapter it wove into (§13.6.5); an un-woven one
    // falls back to its answered date.
    expect(screen.getByRole('heading', { name: 'Answered' })).toBeInTheDocument();
    expect(screen.getByText('wove into “First Words”')).toBeInTheDocument();
    // Ask → mints a check-in from that gap.
    await userEvent.click(screen.getByRole('button', { name: 'Ask me about this' }));
    expect(storyAskGap).toHaveBeenCalledWith({ bookId: 'b1', gapId: 'g1' });
    expect(await screen.findByText(/sent a few questions to your Inbox/i)).toBeInTheDocument();
  });

  it('the Interview tab renders each gap by its lifecycle status: answered ✓ / waiting / an Ask button (§3.7)', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyGaps: () =>
        Promise.resolve({
          gaps: [
            {
              id: 'g-open',
              dimension: 'a',
              label: 'An open thread',
              focus: 'Tell me more.',
              priority: 9,
              status: 'open',
            },
            {
              id: 'g-asked',
              dimension: 'b',
              label: 'A waiting thread',
              focus: 'Waiting on you.',
              priority: 8,
              status: 'asked',
            },
            {
              id: 'g-answered',
              dimension: 'c',
              label: 'A told thread',
              focus: 'Already told.',
              priority: 7,
              status: 'answered',
            },
          ],
          partCoverage: [{ partId: 'p1', score: 0.5 }],
          hasOpenCheckin: false,
        }),
      storyAnsweredCheckIns: () => Promise.resolve([]), // keep the "Answered" heading out of the way
    });
    renderStory();
    await openTab('Interview');
    // All three gaps render.
    expect(await screen.findByText('An open thread')).toBeInTheDocument();
    expect(screen.getByText('A waiting thread')).toBeInTheDocument();
    expect(screen.getByText('A told thread')).toBeInTheDocument();
    // The answered gap reads "Answered ✓"; the asked gap "Waiting in your Inbox"; only the OPEN gap offers the
    // Ask button (so the "Answered" gap never re-offers an identical re-ask, §3.7).
    expect(screen.getByText(/Answered/)).toBeInTheDocument();
    expect(screen.getByText('Waiting in your Inbox')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Ask me about this' })).toHaveLength(1);
  });

  // --- "Share a memory" (§14): the biographer interview chat on the Interview tab ------------------

  function memoryRecord(over: Partial<StoryMemory> = {}): StoryMemory {
    return {
      id: 'm1',
      schemaVersion: 1,
      personId: 'me',
      status: 'gathering',
      title: '',
      narrative: '',
      places: [],
      people: [],
      lifeAreas: [],
      pullQuotes: [],
      createdAt: 'now',
      updatedAt: 'now',
      ...over,
    };
  }

  function memoryDetail(memory: StoryMemory, messages: ChatMessage[]): StoryMemoryDetail {
    const conversation: Conversation = {
      id: `mem-${memory.id}`,
      schemaVersion: 1,
      personId: memory.personId,
      title: 'memory',
      createdAt: 'now',
      updatedAt: 'now',
      messages,
    };
    return { memory, conversation };
  }

  // --- §15.1/#288: the book-independent /story/memories route ---------------------------------------

  it('renders the memory collection at /story/memories with NO book (the #288 dead-end)', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([]), // the person deleted their only book
      storyMemoryList: () =>
        Promise.resolve([
          {
            id: 'm-saved',
            status: 'saved' as const,
            title: 'The Blue Bicycle',
            people: [],
            updatedAt: '2026-07-19T00:00:00.000Z',
          },
          {
            id: 'm-draft',
            status: 'gathering' as const,
            title: 'A half-told afternoon',
            people: [],
            updatedAt: '2026-07-18T00:00:00.000Z',
          },
        ]),
    });
    renderStoryAt('/story/memories');

    // Both sections render — with no book at all, so the memory is never stranded behind "Begin your book".
    expect(
      await screen.findByRole('heading', { name: 'Pick up where you left off' }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Your memories' })).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { level: 3, name: 'Memories you’ve shared' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: /Re-read the memory “The Blue Bicycle”/ }),
    ).toBeInTheDocument();
    // The Studio never rendered, so the invitation's "Begin your book" is nowhere on screen.
    expect(screen.queryByRole('button', { name: /Begin your book/ })).not.toBeInTheDocument();
    // With no book there is nothing to go back to.
    expect(screen.queryByRole('button', { name: 'Back to your book' })).not.toBeInTheDocument();
  });

  it('the /story/memories?memory=<id> deep-link opens that memory chat with no book', async () => {
    let openedWith: unknown = 'never called';
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([]),
      storyMemoryList: () =>
        Promise.resolve([
          {
            id: 'm1',
            status: 'gathering' as const,
            title: 'A half-told afternoon',
            people: [],
            updatedAt: '2026-07-18T00:00:00.000Z',
          },
        ]),
      storyMemoryOpen: (payload: unknown) => {
        openedWith = payload;
        return Promise.resolve(
          memoryDetail(memoryRecord({ id: 'm1', status: 'gathering' }), [
            { role: 'assistant', content: 'Tell me about it.', ts: '2026-07-18T00:00:00.000Z' },
          ]),
        );
      },
    });
    renderStoryAt('/story/memories?memory=m1');

    expect(await screen.findByText('Tell me about it.')).toBeInTheDocument();
    expect(openedWith).toMatchObject({ memoryId: 'm1' });
  });

  it('shows an empty state (not a blank page) at /story/memories with no memories yet', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([]),
      storyMemoryList: () => Promise.resolve([]),
    });
    renderStoryAt('/story/memories');

    expect(await screen.findByText(/haven’t shared a memory yet/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Share a memory' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { level: 3, name: 'Memories you’ve shared' }),
    ).not.toBeInTheDocument();
  });

  it('reloads the collection when the active person switches (never a blank forever) (§15.1)', async () => {
    // AppShell resets the memory store on a person switch, but the standalone route does NOT unmount (the
    // switcher doesn't navigate) — so the load must be keyed on the active person, or the new person sees a
    // blank area behind the not-yet-loaded gate.
    const byPerson: Record<string, StoryMemoryView[]> = {
      me: [
        {
          id: 'm-a',
          status: 'saved' as const,
          title: 'Ben’s bicycle',
          people: [],
          updatedAt: '2026-07-19T00:00:00.000Z',
        },
      ],
      other: [
        {
          id: 'm-b',
          status: 'saved' as const,
          title: 'Angel’s harbour',
          people: [],
          updatedAt: '2026-07-19T00:00:00.000Z',
        },
      ],
    };
    useSessionStore.setState({ activePerson: ACTIVE_PERSON });
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([]),
      storyMemoryList: () =>
        Promise.resolve(byPerson[useSessionStore.getState().activePerson?.id ?? 'me'] ?? []),
    });
    renderStoryAt('/story/memories');
    expect(
      await screen.findByRole('button', { name: /Re-read the memory “Ben’s bicycle”/ }),
    ).toBeInTheDocument();

    // The switch, exactly as AppShell drives it: reset the per-person store, then flip the active person.
    act(() => {
      useStoryMemoryStore.getState().reset();
      useSessionStore.setState({ activePerson: { ...ACTIVE_PERSON, id: 'other' } });
    });

    expect(
      await screen.findByRole('button', { name: /Re-read the memory “Angel’s harbour”/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Re-read the memory “Ben’s bicycle”/ }),
    ).not.toBeInTheDocument();
  });

  it('offers a way into your memories from the no-book invitation (§15.1)', async () => {
    // A draft memory produces no Insight, so the provenance link cannot reach it — without this entry a
    // person who deleted their book has no path to their unfinished memory chats at all.
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([]),
      storyMemoryList: () => Promise.resolve([]),
    });
    renderStoryAt('/story');
    await userEvent.click(await screen.findByRole('button', { name: 'Your memories' }));
    expect(await screen.findByRole('heading', { name: 'Your memories' })).toBeInTheDocument();
    expect(await screen.findByText(/haven’t shared a memory yet/)).toBeInTheDocument();
  });

  it('the Interview tab splits memories into "Pick up where you left off" (in-progress) and "Memories you’ve shared" (saved) (§14)', async () => {
    const memories: StoryMemoryView[] = [
      {
        id: 'm-saved',
        status: 'saved',
        title: 'The Blue Bicycle',
        approxDate: 'the summer I was seven',
        people: [{ name: 'my father' }],
        updatedAt: '2026-07-19T00:00:00.000Z',
        wroteIntoChapterTitle: 'Roots',
      },
      {
        id: 'm-draft',
        status: 'gathering',
        title: 'A half-told afternoon',
        people: [],
        updatedAt: '2026-07-18T00:00:00.000Z',
      },
    ];
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyMemoryList: () => Promise.resolve(memories),
    });
    renderStory();
    await openTab('Interview');
    // The invite card leads with a primary "Share a memory" button.
    expect(await screen.findByRole('button', { name: 'Share a memory' })).toBeInTheDocument();

    // Section 1: "Pick up where you left off" holds the still-gathering draft, with an "In progress" chip and a
    // Continue affordance — scoped to the section (via its heading's card container).
    const pickUp = (
      await screen.findByRole('heading', { name: 'Pick up where you left off' })
    ).closest('div')!;
    const draft = within(pickUp).getByRole('button', {
      name: /Continue the memory “A half-told afternoon”/,
    });
    expect(within(draft).getByText('In progress')).toBeInTheDocument();
    expect(within(pickUp).getByText('Continue →')).toBeInTheDocument();
    // The saved memory is NOT in this section.
    expect(
      within(pickUp).queryByRole('button', { name: /The Blue Bicycle/ }),
    ).not.toBeInTheDocument();

    // Section 2: "Memories you’ve shared" holds the saved memory (re-read only) with the chapter it wove into and
    // NO state chip.
    const shared = (await screen.findByRole('heading', { name: 'Memories you’ve shared' })).closest(
      'div',
    )!;
    const saved = within(shared).getByRole('button', {
      name: /Re-read the memory “The Blue Bicycle”/,
    });
    expect(saved).toHaveTextContent('wove into “Roots”');
    expect(within(shared).queryByText('In progress')).not.toBeInTheDocument();
    expect(within(shared).queryByText('Ready to save')).not.toBeInTheDocument();
  });

  it('clicking "Share a memory" opens the biographer chat panel (a new memory, storyMemoryOpen({})) (§14)', async () => {
    // Signature-less spy: vi.fn still records the real bridge args (assertion below), and a `() => …` return is
    // assignable to the bridge's `(input) => …` under exactOptionalPropertyTypes.
    const storyMemoryOpen = vi.fn(() =>
      Promise.resolve(
        memoryDetail(memoryRecord(), [
          {
            role: 'assistant',
            content: 'Take me back — where were you, and what do you picture?',
            ts: '2026-07-19T00:00:00.000Z',
          },
        ]),
      ),
    );
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyMemoryOpen,
    });
    renderStory();
    await openTab('Interview');
    await userEvent.click(await screen.findByRole('button', { name: 'Share a memory' }));
    // The panel replaces the tab body: a back affordance + the biographer's streamed opener.
    expect(
      await screen.findByRole('button', { name: 'Back to your memories' }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/Take me back/)).toBeInTheDocument();
    // A NEW memory opens with no id (an empty payload) — never a resume of some other memory.
    expect(storyMemoryOpen).toHaveBeenCalledWith({});
  });

  it('the chat → save flow: synthesize → confirm card → "Add to my story" saves the edited memory (§14)', async () => {
    const readyMemory = memoryRecord({
      status: 'ready',
      title: 'The Blue Bicycle',
      narrative: 'I was seven, and the bicycle was the blue of a summer sky.',
      approxDate: 'the summer I was seven',
      emotionalTexture: 'A first taste of freedom.',
      people: [{ name: 'my father' }],
      readyAt: '2026-07-19T00:00:00.000Z',
    });
    let saveArgs: { memoryId: string; edits?: unknown } | null = null;
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyMemoryList: () =>
        Promise.resolve([
          { id: 'm1', status: 'gathering', title: 'A memory', people: [], updatedAt: 'now' },
        ]),
      // Opening the existing memory yields a real user↔coach exchange, so "Save this memory" is offered.
      storyMemoryOpen: () =>
        Promise.resolve(
          memoryDetail(memoryRecord({ status: 'gathering' }), [
            { role: 'assistant', content: 'Tell me about it.', ts: '2026-07-19T00:00:01.000Z' },
            {
              role: 'user',
              content: 'A blue bicycle, the summer I was seven.',
              ts: '2026-07-19T00:00:02.000Z',
            },
            {
              role: 'assistant',
              content: 'That’s a whole memory.',
              ts: '2026-07-19T00:00:03.000Z',
            },
          ]),
        ),
      storyMemorySynthesize: () => Promise.resolve({ ok: true as const, memory: readyMemory }),
      storyMemorySave: (input) => {
        saveArgs = input;
        return Promise.resolve({ ok: true as const, memory: { ...readyMemory, status: 'saved' } });
      },
    });
    renderStory();
    await openTab('Interview');
    // Open the still-gathering memory from the "Pick up where you left off" list (its row is a "Continue …" button).
    await userEvent.click(
      await screen.findByRole('button', { name: /Continue the memory “A memory”/ }),
    );
    // With an exchange present, the "Save this memory" affordance is offered → synthesize.
    await userEvent.click(await screen.findByRole('button', { name: /Save this memory/ }));
    // The confirm card reads the synthesized memory back: the title lands in the editable Title field.
    expect(
      await screen.findByRole('heading', { name: 'Your memory, in your words' }),
    ).toBeInTheDocument();
    const titleField = screen.getByLabelText('Title');
    expect(titleField).toHaveValue('The Blue Bicycle');
    // Edit the title before committing, to prove the edited value is carried in the save payload.
    await userEvent.clear(titleField);
    await userEvent.type(titleField, 'The Sky-Blue Bicycle');
    await userEvent.click(screen.getByRole('button', { name: 'Add to my story' }));
    // The saved banner names the committed memory.
    expect(await screen.findByText('Woven into your story.')).toBeInTheDocument();
    await waitFor(() => expect(saveArgs).not.toBeNull());
    expect(saveArgs!.memoryId).toBe('m1');
    expect(saveArgs!.edits).toMatchObject({
      title: 'The Sky-Blue Bicycle',
      narrative: 'I was seven, and the bicycle was the blue of a summer sky.',
    });
  });

  it('a gap’s "Talk it through" opens a NEW seeded biographer chat (storyMemoryOpen({seedFocus})) (§14)', async () => {
    const storyMemoryOpen = vi.fn(() =>
      Promise.resolve(
        memoryDetail(memoryRecord(), [
          {
            role: 'assistant',
            content: 'Tell me about the hardest thing you have faced.',
            ts: '2026-07-19T00:00:00.000Z',
          },
        ]),
      ),
    );
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyGaps: () =>
        Promise.resolve({
          gaps: [
            {
              id: 'g1',
              dimension: 'challenges',
              label: 'Your central struggle',
              focus: 'Tell me about the hardest thing you have faced.',
              priority: 9,
              status: 'open',
            },
          ],
          partCoverage: [{ partId: 'p1', score: 0.5 }],
          hasOpenCheckin: false,
        }),
      storyMemoryOpen,
    });
    renderStory();
    await openTab('Interview');
    await userEvent.click(await screen.findByRole('button', { name: 'Talk it through' }));
    // The chat opens seeded from the gap's focus — a NEW memory keyed to that thread.
    expect(
      await screen.findByRole('button', { name: 'Back to your memories' }),
    ).toBeInTheDocument();
    expect(storyMemoryOpen).toHaveBeenCalledWith({
      seedFocus: 'Tell me about the hardest thing you have faced.',
    });
  });

  it('AI off: the invite still renders, but opening a memory shows the AI-unavailable state (no chat) (§14)', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: false,
          resolvedReady: false,
          source: 'none' as const,
        }),
    });
    // The Studio still renders (an existing ready book), but AI is unavailable for the chat.
    useSettingsStore.setState((s) => ({ values: { ...s.values, 'ai.enabled': false } }));
    renderStory();
    await openTab('Interview');
    // The invite card is still present.
    await userEvent.click(await screen.findByRole('button', { name: 'Share a memory' }));
    // Opening it shows the AI-off branch — the biographer heading + notice, and NO composer.
    expect(
      await screen.findByRole('heading', { name: 'Share a memory with your biographer' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();
  });

  it('deep-link: /story/interview?memory=<id> opens that specific memory (§14)', async () => {
    const storyMemoryOpen = vi.fn(() =>
      Promise.resolve(
        memoryDetail(memoryRecord({ id: 'm1' }), [
          {
            role: 'assistant',
            content: 'Welcome back to this memory.',
            ts: '2026-07-19T00:00:00.000Z',
          },
        ]),
      ),
    );
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyMemoryOpen,
    });
    renderStoryAt('/story/interview?memory=m1');
    // The deep-link opens exactly that memory (a resume, by id).
    expect(
      await screen.findByRole('button', { name: 'Back to your memories' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(storyMemoryOpen).toHaveBeenCalledWith({ memoryId: 'm1' }));
  });

  it('reopening a synthesized-but-unsaved (ready) memory lands on the confirm card WITHOUT re-synthesizing (§14)', async () => {
    const storyMemorySynthesize = vi.fn(() =>
      Promise.resolve({ ok: true as const, memory: memoryRecord({ status: 'ready' }) }),
    );
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      // The reopened memory is already 'ready' (synthesized, not saved), with a prior exchange + a draft.
      storyMemoryOpen: () =>
        Promise.resolve(
          memoryDetail(
            memoryRecord({
              status: 'ready',
              title: 'The Blue Bicycle',
              narrative: 'I was seven, and the bicycle was the blue of a summer sky.',
              readyAt: '2026-07-19T00:00:00.000Z',
            }),
            [
              { role: 'assistant', content: 'Tell me about it.', ts: '2026-07-19T00:00:01.000Z' },
              {
                role: 'user',
                content: 'A blue bicycle, the summer I was seven.',
                ts: '2026-07-19T00:00:02.000Z',
              },
            ],
          ),
        ),
      storyMemorySynthesize,
    });
    renderStoryAt('/story/interview?memory=m1');
    // It lands straight on the review card, from the draft it already wrote — the Title is pre-filled…
    expect(
      await screen.findByRole('heading', { name: 'Your memory, in your words' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('The Blue Bicycle');
    // …and NO new synthesis call was made (no fresh AI spend on reopen).
    expect(storyMemorySynthesize).not.toHaveBeenCalled();
    // "Keep talking" returns to the chat (the prior exchange is there again).
    await userEvent.click(screen.getByRole('button', { name: 'Keep talking' }));
    expect(await screen.findByText(/A blue bicycle, the summer I was seven/)).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Your memory, in your words' }),
    ).not.toBeInTheDocument();
  });

  it('the "Pick up where you left off" section resumes an in-progress draft by its working title (§14)', async () => {
    const storyMemoryOpen = vi.fn(() =>
      Promise.resolve(
        memoryDetail(memoryRecord({ id: 'm-draft', title: 'A Summer Ride' }), [
          {
            role: 'assistant',
            content: 'Take me back — where were you?',
            ts: '2026-07-19T00:00:00.000Z',
          },
          { role: 'user', content: 'On a blue bicycle.', ts: '2026-07-19T00:00:01.000Z' },
        ]),
      ),
    );
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyMemoryList: () =>
        Promise.resolve([
          {
            id: 'm-draft',
            status: 'gathering',
            title: 'A Summer Ride', // the auto working title (§14) names the resumable draft
            people: [],
            updatedAt: '2026-07-19T00:00:00.000Z',
          },
        ] as StoryMemoryView[]),
      storyMemoryOpen,
    });
    renderStory();
    await openTab('Interview');
    const section = (
      await screen.findByRole('heading', { name: 'Pick up where you left off' })
    ).closest('div')!;
    // The draft is named by its working title + carries the "In progress" chip + a Continue cue.
    const row = within(section).getByRole('button', {
      name: /Continue the memory “A Summer Ride”/,
    });
    expect(within(row).getByText('In progress')).toBeInTheDocument();
    expect(within(section).getByText('Continue →')).toBeInTheDocument();
    // Clicking the row resumes exactly that memory by id.
    await userEvent.click(row);
    await waitFor(() => expect(storyMemoryOpen).toHaveBeenCalledWith({ memoryId: 'm-draft' }));
  });

  it('answers the author from a question comment (§3.3): the Ask button calls the bridge + the answer renders', async () => {
    const questionComment = (answer?: string): ChapterMarkup => ({
      schemaVersion: 1,
      chapterId: 'c1',
      marks: [
        {
          id: 'q1',
          kind: 'comment',
          anchor: { paragraphId: 'p0', quote: 'cut pine' },
          intent: 'question',
          text: 'Where did this come from?',
          status: 'open',
          createdAt: 'now',
          ...(answer ? { answer, answeredAt: '2026-07-16' } : {}),
        },
      ],
    });
    const storyAnswerQuestion = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        answer: 'That came from a coaching session.',
        markup: questionComment('That came from a coaching session.'),
      }),
    );
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyGetMarkup: (): Promise<ChapterMarkup> => Promise.resolve(questionComment()),
      storyAnswerQuestion,
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    // A question comment offers "Ask your biographer" (no answer yet).
    await userEvent.click(await screen.findByRole('button', { name: 'Ask your biographer' }));
    expect(storyAnswerQuestion).toHaveBeenCalledWith({
      bookId: 'b1',
      chapterId: 'c1',
      markId: 'q1',
    });
    // The returned answer renders at the paragraph.
    expect(await screen.findByText('That came from a coaching session.')).toBeInTheDocument();
  });

  it('renders an existing biographer answer on a question comment (no re-ask button, §3.3)', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyGetMarkup: (): Promise<ChapterMarkup> =>
        Promise.resolve({
          schemaVersion: 1,
          chapterId: 'c1',
          marks: [
            {
              id: 'q1',
              kind: 'comment',
              anchor: { paragraphId: 'p0', quote: 'cut pine' },
              intent: 'question',
              text: 'Where did this come from?',
              status: 'open',
              createdAt: 'now',
              answer: 'From a dream you recorded.',
              answeredAt: '2026-07-16',
            },
          ],
        }),
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    expect(await screen.findByText('From a dream you recorded.')).toBeInTheDocument();
    // Already answered → no "Ask your biographer" button.
    expect(screen.queryByRole('button', { name: 'Ask your biographer' })).not.toBeInTheDocument();
  });

  it('the interview cadence fires storyInterviewCheck({auto:true}) on mount', async () => {
    const storyInterviewCheck = vi.fn(() => Promise.resolve({ outcome: 'throttled' as const }));
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyInterviewCheck,
    });
    useSessionStore.setState({ activePerson: ACTIVE_PERSON });
    renderStory();
    await waitFor(() =>
      expect(storyInterviewCheck).toHaveBeenCalledWith(expect.objectContaining({ auto: true })),
    );
  });

  it('publishes the book and reports what was shared (§3.5)', async () => {
    const storyPublish = vi.fn(() => Promise.resolve({ ok: true as const, publishedChapters: 1 }));
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyPublish,
    });
    renderStory();
    await openTab('Sharing');
    await userEvent.click(await screen.findByRole('button', { name: 'Publish & choose readers' }));
    expect(storyPublish).toHaveBeenCalledWith({ bookId: 'b1' });
    expect(await screen.findByText(/Shared 1 chapter with your readers/)).toBeInTheDocument();
  });

  it('grants a reader and shows the featured-book note (§3.5)', async () => {
    const storyGrantReader = vi.fn(() =>
      Promise.resolve([{ personId: 'r1', displayName: 'Angel' }]),
    );
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      peopleList: () =>
        Promise.resolve([
          {
            id: 'r1',
            schemaVersion: 2 as const,
            displayName: 'Angel',
            isSubject: true,
            tags: [],
            createdAt: 'now',
            updatedAt: 'now',
          },
        ]),
      storyReaders: () => Promise.resolve([]),
      storyReaderFeatured: () => Promise.resolve(true),
      storyGrantReader,
    });
    renderStory();
    await openTab('Sharing');
    const select = await screen.findByRole('combobox', { name: 'Add a reader' });
    await userEvent.selectOptions(select, 'r1');
    expect(await screen.findByText(/Angel appears in this book/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add as reader' }));
    expect(storyGrantReader).toHaveBeenCalledWith({ bookId: 'b1', readerPersonId: 'r1' });
  });

  it('saves the front/back matter (§3.6)', async () => {
    const storyUpdate = vi.fn(() => Promise.resolve(manifest({ status: 'ready' })));
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyUpdate,
    });
    renderStory();
    await openTab('Settings');
    await userEvent.type(await screen.findByLabelText('Dedication'), 'For my mother');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(storyUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        bookId: 'b1',
        matter: expect.objectContaining({ dedication: 'For my mother' }),
      }),
    );
  });

  it('shows "Shared with you" and reads a shared book’s published head (§3.5/§3.6)', async () => {
    const readerView = {
      authorPersonId: 'auth1',
      authorName: 'Ben',
      bookId: 'sb1',
      manifest: {
        schemaVersion: 1 as const,
        publishedAt: '2026-07-16T00:00:00.000Z',
        title: 'The Life of Ben',
        matter: { dedication: 'For my mother' },
        noteOnBook: 'This book was written from 3 coaching insights — never invented.',
        coverImageId: 'cov1',
        parts: [{ id: 'p1', title: 'Roots', chapterIds: ['c1'] }],
        chapterOrder: ['c1'],
        images: [{ id: 'cov1', kind: 'cover' as const, mime: 'image/png', createdAt: 'now' }],
      },
      chapters: [
        {
          id: 'c1',
          schemaVersion: 1 as const,
          partId: 'p1',
          order: 0,
          title: 'The Garage',
          markdown: 'The garage smelled of cut pine.',
          revision: 1,
          status: 'reviewed' as const,
          sourceSignature: '',
          provenance: [],
          protectedBlocks: [],
          pinnedQuotes: [],
          imagePlacements: [],
        },
      ],
    };
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([]), // no OWN book → the empty landing, where "Shared with you" shows
      storySharedBooks: () =>
        Promise.resolve([
          {
            authorPersonId: 'auth1',
            authorName: 'Ben',
            bookId: 'sb1',
            title: 'The Life of Ben',
            publishedAt: '2026-07-16T00:00:00.000Z',
            chapterCount: 1,
            newChapters: 1,
            neverOpened: true,
            updated: true,
          },
        ]),
      storyReadShared: () => Promise.resolve(readerView),
      storyReadSharedImage: () => Promise.resolve({ mime: 'image/png', dataBase64: 'AAAA' }),
    });
    renderStory();
    expect(await screen.findByText('Shared with you')).toBeInTheDocument();
    expect(screen.getByText(/By Ben · 1 chapter/)).toBeInTheDocument();
    // Open it → the immersive reader (§13.5) opens on the FRONT MATTER (title page + dedication + contents).
    await userEvent.click(screen.getByRole('button', { name: /The Life of Ben/ }));
    expect(await screen.findByRole('heading', { name: 'The Life of Ben' })).toBeInTheDocument();
    expect(screen.getByText('For my mother')).toBeInTheDocument();
    // Begin reading → the chapter page renders the prose; the last chapter carries the honesty note.
    await userEvent.click(screen.getByRole('button', { name: /Begin reading/ }));
    expect(await screen.findByText('The garage smelled of cut pine.')).toBeInTheDocument();
    expect(screen.getByText(/never invented/)).toBeInTheDocument();
    // Back (the top-bar exit) returns to the Studio surface.
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Shared with you')).toBeInTheDocument();
  });

  it('the owner reads their own book (front matter → chapter → prev/next), and Edit reaches the editor (§13.5)', async () => {
    const ownView = {
      view: {
        authorPersonId: 'me',
        authorName: 'Ben',
        bookId: 'b1',
        manifest: {
          schemaVersion: 1 as const,
          publishedAt: '2026-07-17T00:00:00.000Z',
          title: 'The Story of Ben',
          essence: 'A quiet man learning to speak up.',
          noteOnBook: 'Written from your own record — never invented.',
          parts: [{ id: 'p1', title: 'Roots', chapterIds: ['c1', 'c2'] }],
          chapterOrder: ['c1', 'c2'],
          images: [],
        },
        chapters: [
          {
            id: 'c1',
            title: 'The Garage',
            markdown: 'The garage smelled of cut pine.',
            imagePlacements: [],
            status: 'reviewed' as const,
            pinnedQuotes: [],
          },
          {
            id: 'c2',
            title: 'First Words',
            markdown: 'He learned to speak.',
            imagePlacements: [],
            status: 'new' as const,
            pinnedQuotes: [],
          },
        ],
      },
      lastChapterId: null,
    };
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyReadOwnBook: () => Promise.resolve(ownView),
    });
    // Deep-link straight into the reader's front matter (§13.2 route).
    renderStoryAt('/story/read');
    // Front matter: title page + the essence + a Contents list of both chapters.
    expect(await screen.findByRole('heading', { name: 'The Story of Ben' })).toBeInTheDocument();
    expect(screen.getByText(/quiet man learning to speak up/)).toBeInTheDocument();
    // Begin reading → chapter 1 prose + the Read⇄Shape toggle in the reader bar (owner only, §13.5).
    await userEvent.click(screen.getByRole('button', { name: /Begin reading/ }));
    expect(await screen.findByText('The garage smelled of cut pine.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Shape this chapter' })).toBeInTheDocument();
    // Next → chapter 2 (the last chapter carries the honesty note); Previous returns to chapter 1.
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(await screen.findByText('He learned to speak.')).toBeInTheDocument();
    expect(screen.getByText(/never invented/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Previous/ }));
    expect(await screen.findByText('The garage smelled of cut pine.')).toBeInTheDocument();
    // Shape → the chapter editor (the markup surface, still §3.3) opens.
    await userEvent.click(screen.getByRole('button', { name: 'Shape this chapter' }));
    expect(await screen.findByRole('button', { name: 'Rewrite this chapter' })).toBeInTheDocument();
  });

  it('“Read your story” from the Studio opens the immersive reader (§13.5)', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('reviewed')),
      storyReadOwnBook: () =>
        Promise.resolve({
          view: {
            authorPersonId: 'me',
            authorName: 'Ben',
            bookId: 'b1',
            manifest: {
              schemaVersion: 1 as const,
              publishedAt: '2026-07-17T00:00:00.000Z',
              title: 'The Story of Ben',
              parts: [{ id: 'p1', title: 'Roots', chapterIds: ['c1'] }],
              chapterOrder: ['c1'],
              images: [],
            },
            chapters: [
              {
                id: 'c1',
                title: 'The Garage',
                markdown: 'The garage smelled of cut pine.',
                imagePlacements: [],
                status: 'reviewed' as const,
                pinnedQuotes: [],
              },
            ],
          },
          lastChapterId: null,
        }),
    });
    renderStoryAt('/story');
    // The Studio hero's primary "Read your story" navigates to the reader (front matter).
    await userEvent.click(await screen.findByRole('button', { name: 'Read your story' }));
    expect(await screen.findByRole('button', { name: /Begin reading/ })).toBeInTheDocument();
  });

  it('the chapter opener uses the chapter’s OWN illustration and never duplicates it inline (§13.5)', async () => {
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const ownView = {
      view: {
        authorPersonId: 'me',
        authorName: 'Ben',
        bookId: 'b1',
        manifest: {
          schemaVersion: 1 as const,
          publishedAt: '2026-07-17T00:00:00.000Z',
          title: 'The Story of Ben',
          parts: [{ id: 'p1', title: 'Roots', chapterIds: ['c1'] }],
          chapterOrder: ['c1'],
          images: [],
        },
        chapters: [
          {
            id: 'c1',
            title: 'The Garage',
            markdown: 'The garage smelled of cut pine.',
            // Two placements after the first paragraph: the chapter's illustration (first) → the opener;
            // an uploaded photo (second) → stays inline.
            imagePlacements: [
              { imageId: 'ill1', afterAnchor: 'p0', caption: 'Opener art' },
              { imageId: 'ph1', afterAnchor: 'p0', caption: 'A kept photo' },
            ],
            status: 'reviewed' as const,
            pinnedQuotes: [],
          },
        ],
      },
      lastChapterId: null,
    };
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('reviewed')),
      storyReadOwnBook: () => Promise.resolve(ownView),
      storyGetImage: () => Promise.resolve({ mime: 'image/png', dataBase64: png }),
    });
    renderStoryAt('/story/read');
    await userEvent.click(await screen.findByRole('button', { name: /Begin reading/ }));
    expect(await screen.findByText('The garage smelled of cut pine.')).toBeInTheDocument();

    // The opener background resolves to the chapter's own illustration (its first placement), not the gradient.
    await waitFor(() => {
      const opener = screen.getByText('Chapter 1').parentElement;
      expect(opener?.style.backgroundImage).toContain('data:image/png');
    });
    // The illustration is the hero, so its inline figcaption is gone; the SECOND placement (the photo) stays.
    expect(screen.queryByText('Opener art')).not.toBeInTheDocument();
    expect(await screen.findByText('A kept photo')).toBeInTheDocument();
  });

  it('the export dialog exports the published head as Markdown, noting it leaves the vault (§13.6.1)', async () => {
    const storyExportMarkdown = vi.fn(() => Promise.resolve('/exports/The-Story-of-Ben.md'));
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () =>
        Promise.resolve({
          ...writtenBundle('new'),
          manifest: manifest({ status: 'ready', publishedAt: '2026-07-16T00:00:00.000Z' }),
        }),
      storyExportMarkdown,
    });
    renderStory();
    await openTab('Sharing');
    await userEvent.click(await screen.findByRole('button', { name: 'Export…' }));
    // A published book → the dialog defaults to the Published version; Export as Markdown (the default format).
    await userEvent.click(await screen.findByRole('button', { name: 'Export' }));
    expect(storyExportMarkdown).toHaveBeenCalledWith({ bookId: 'b1', head: 'published' });
    expect(
      await screen.findByText(/Saved to .* — this file leaves your encrypted vault/),
    ).toBeInTheDocument();
  });

  it('the export dialog exports the DRAFT head (no publish needed) as PDF (§13.6.1)', async () => {
    const storyExportPdf = vi.fn(() => Promise.resolve('/exports/The-Story-of-Ben.pdf'));
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')), // NEVER published — no publishedAt
      storyExportPdf,
    });
    renderStory();
    await openTab('Sharing');
    await userEvent.click(await screen.findByRole('button', { name: 'Export…' }));
    // Never published → the version defaults to "Working draft" and Published is unusable.
    await userEvent.click(await screen.findByRole('button', { name: 'PDF' }));
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(storyExportPdf).toHaveBeenCalledWith({ bookId: 'b1', head: 'draft' });
    expect(
      await screen.findByText(/Saved to .* — this file leaves your encrypted vault/),
    ).toBeInTheDocument();
  });

  it('the Sharing tab shows each reader’s read state, joined from their receipt (§13.6.8)', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () =>
        Promise.resolve({
          ...writtenBundle('new'),
          manifest: manifest({ status: 'ready', publishedAt: '2026-07-16T00:00:00.000Z' }),
        }),
      storyReaders: () =>
        Promise.resolve([
          { personId: 'r1', displayName: 'Angel', read: { openedAt: 'now', upToDate: true } },
          {
            personId: 'r2',
            displayName: 'Sam',
            read: { openedAt: '2026-07-10T00:00:00.000Z', upToDate: false },
          },
          { personId: 'r3', displayName: 'Kai' }, // no receipt → hasn't opened it yet
        ]),
    });
    renderStory();
    await openTab('Sharing');
    expect(await screen.findByText(/Read the latest/)).toBeInTheDocument();
    expect(screen.getByText(/older version/)).toBeInTheDocument();
    expect(screen.getByText(/Hasn’t opened it yet/)).toBeInTheDocument();
  });

  it('creates a book cover behind the shared image consent + OpenAI key (§3.8)', async () => {
    elevateToOwner(); // budgets.manage → the cost figure shows; settings.manage → the setup path is theirs
    useSettingsStore.setState((s) => ({
      values: { ...s.values, 'ai.enabled': true, 'dreams.imageGenerationEnabled': true },
    }));
    const storyGenerateImage = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        image: { id: 'img1', kind: 'cover' as const, mime: 'image/png', createdAt: 'now' },
        costUsd: 0.171,
      }),
    );
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () =>
        Promise.resolve({ ...writtenBundle('new'), manifest: manifest({ status: 'ready' }) }),
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: true,
          resolvedReady: true,
          source: 'device' as const,
        }),
      storyGenerateImage,
      storyGetImage: () => Promise.resolve({ mime: 'image/png', dataBase64: 'AAAA' }),
      storyImages: () => Promise.resolve([]),
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: 'Create a cover' }));
    // No per-image style — every image uses the single global style (Settings → Images, §3.8).
    expect(storyGenerateImage).toHaveBeenCalledWith({
      bookId: 'b1',
      target: { kind: 'cover' },
    });
    // The generated cover renders + the admin cost figure appears.
    const cover = await screen.findByAltText(/Cover for this book/);
    expect(cover).toHaveAttribute('src', 'data:image/png;base64,AAAA');
    expect(await screen.findByText(/\$0\.171/)).toBeInTheDocument();
  });

  it('shows a calm setup note when AI images are not turned on (§3.8)', async () => {
    elevateToOwner(); // an owner sees the Settings path (a member sees "ask the owner")
    // consent stays off (afterEach default) → no "Create a cover" button, just the note.
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () =>
        Promise.resolve({ ...writtenBundle('new'), manifest: manifest({ status: 'ready' }) }),
    });
    renderStory();
    expect(
      await screen.findByText(/Turn on AI image generation .* to create a cover/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create a cover' })).not.toBeInTheDocument();
  });

  it('captions an uploaded photo via vision and saves an answer to the corpus (§3.7)', async () => {
    // The mock stamps the caption onto the index entry when analyzed (mirroring the real bridge).
    let caption: string | undefined;
    const storyAnalyzePhoto = vi.fn(() => {
      caption = 'A garage in winter';
      return Promise.resolve({
        ok: true as const,
        analysis: { caption, questions: ['Who took this photo?'] },
      });
    });
    const storyAnswerPhoto = vi.fn(() => Promise.resolve());
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () =>
        Promise.resolve({ ...writtenBundle('new'), manifest: manifest({ status: 'ready' }) }),
      storyImages: () =>
        Promise.resolve([
          {
            id: 'ph1',
            kind: 'uploaded' as const,
            mime: 'image/png',
            createdAt: 'now',
            ...(caption ? { caption } : {}),
          },
        ]),
      storyGetImage: () => Promise.resolve({ mime: 'image/png', dataBase64: 'AAAA' }),
      storyPhotoAnswers: () => Promise.resolve([]),
      storyAnalyzePhoto,
      storyAnswerPhoto,
    });
    renderStory();
    // The Photos panel shows the uploaded thumbnail; analyze → caption + a question to answer.
    await openTab('Photos');
    await userEvent.click(await screen.findByRole('button', { name: /Caption & ask about this/ }));
    expect(storyAnalyzePhoto).toHaveBeenCalledWith({ bookId: 'b1', imageId: 'ph1' });
    expect(await screen.findByText('A garage in winter')).toBeInTheDocument();
    const answer = await screen.findByLabelText('Who took this photo?');
    await userEvent.type(answer, 'My father did.');
    await userEvent.click(screen.getByRole('button', { name: 'Save answer' }));
    expect(storyAnswerPhoto).toHaveBeenCalledWith({
      bookId: 'b1',
      imageId: 'ph1',
      question: 'Who took this photo?',
      answer: 'My father did.',
    });
  });

  it('renders the photo gallery — caption, the captured-memories chip, and the answered Q&A (§13.6)', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () =>
        Promise.resolve({ ...writtenBundle('new'), manifest: manifest({ status: 'ready' }) }),
      storyImages: () =>
        Promise.resolve([
          {
            id: 'ph1',
            kind: 'uploaded' as const,
            mime: 'image/png',
            createdAt: 'now',
            caption: 'Us on the pier at Lake Michigan',
          },
        ]),
      storyGetImage: () => Promise.resolve({ mime: 'image/png', dataBase64: 'AAAA' }),
      storyPhotoAnswers: () =>
        Promise.resolve([
          { imageId: 'ph1', question: 'Who took this?', answer: 'My grandfather.', at: 'now' },
        ]),
    });
    renderStory();
    await openTab('Photos');
    // The gallery shows the caption, an accessible thumbnail, the captured-memories chip and the answer.
    expect(await screen.findByText('Us on the pier at Lake Michigan')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Us on the pier at Lake Michigan' }),
    ).toBeInTheDocument();
    expect(screen.getByText('1 memory captured')).toBeInTheDocument();
    expect(screen.getByText('My grandfather.')).toBeInTheDocument();
    // A captioned photo invites more, not a first caption.
    expect(screen.getByRole('button', { name: 'Ask more' })).toBeInTheDocument();
  });

  it('places a photo in a chapter via the AI-suggested anchor (§3.8)', async () => {
    const placed: StoryBookBundle = {
      ...writtenBundle('new'),
      chapters: [
        {
          ...writtenBundle('new').chapters[0]!,
          imagePlacements: [{ imageId: 'ph1', afterAnchor: 'p0', caption: '' }],
        },
      ],
    };
    const storySuggestPlacement = vi.fn(() =>
      Promise.resolve({ ok: true as const, afterAnchor: 'p0' }),
    );
    const storySetPlacement = vi.fn(() => Promise.resolve(placed));
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyImages: () =>
        Promise.resolve([
          { id: 'ph1', kind: 'uploaded' as const, mime: 'image/png', createdAt: 'now' },
        ]),
      storyGetImage: () => Promise.resolve({ mime: 'image/png', dataBase64: 'AAAA' }),
      storySuggestPlacement,
      storySetPlacement,
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    // Add the photo → the AI suggests an anchor, then it's placed.
    await userEvent.selectOptions(
      await screen.findByLabelText('Add an image to this chapter'),
      'ph1',
    );
    expect(storySuggestPlacement).toHaveBeenCalledWith({
      bookId: 'b1',
      chapterId: 'c1',
      imageId: 'ph1',
    });
    expect(storySetPlacement).toHaveBeenCalledWith({
      bookId: 'b1',
      chapterId: 'c1',
      imageId: 'ph1',
      afterAnchor: 'p0',
    });
    // The placed image + its move control render in the prose.
    expect(await screen.findByLabelText('Move image after paragraph')).toBeInTheDocument();
  });

  it('surfaces to-dos in the Needs-you strip and marks a reminder done in the sheet (§13.4)', async () => {
    const storyUpdateMark = vi.fn(
      (): Promise<ChapterMarkup> =>
        Promise.resolve({ schemaVersion: 1, chapterId: 'c1', marks: [] }),
    );
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyTodos: () =>
        Promise.resolve({
          schemaVersion: 1,
          todos: [
            {
              id: 't1',
              chapterId: 'c1',
              kind: 'remind',
              text: 'call my sister',
              status: 'open',
              createdAt: 'now',
            },
          ],
        }),
      storyUpdateMark,
    });
    renderStory();
    // The Needs-you strip shows a "To-dos" card; opening it raises the book-level to-do sheet.
    await userEvent.click(await screen.findByRole('button', { name: 'View ›' }));
    expect(await screen.findByRole('heading', { name: 'To do' })).toBeInTheDocument();
    expect(screen.getByText(/call my sister/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    expect(storyUpdateMark).toHaveBeenCalledWith({
      bookId: 'b1',
      chapterId: 'c1',
      markId: 't1',
      patch: { status: 'done' },
    });
  });

  it('excludes a topic from the reader toolbar', async () => {
    const storyExclude = vi.fn((input: { bookId: string; value: string }) =>
      Promise.resolve({
        exclusions: [{ id: 'x1', kind: 'topic' as const, value: input.value, createdAt: 'now' }],
        bundle: writtenBundle('new'),
        staled: 1,
      }),
    );
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyGetMarkup: (): Promise<ChapterMarkup> =>
        Promise.resolve({ schemaVersion: 1, chapterId: 'c1', marks: [] }),
      storyExclude,
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    await userEvent.click((await screen.findAllByRole('button', { name: 'Mark up' }))[0]!);
    await userEvent.click(await screen.findByRole('button', { name: 'Exclude' }));
    const box = screen.getByLabelText('What to never write about');
    await userEvent.clear(box);
    await userEvent.type(box, 'the divorce');
    await userEvent.click(screen.getByRole('button', { name: 'Never write about this' }));
    expect(storyExclude).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'topic', value: 'the divorce' }),
    );
    // The person is told what happened to already-written chapters.
    expect(await screen.findByText(/marked to rewrite/)).toBeInTheDocument();
  });

  it('excludes a source from the Sources popover', async () => {
    const storyExclude = vi.fn(() =>
      Promise.resolve({
        exclusions: [{ id: 'x1', kind: 'source' as const, value: 'i1', createdAt: 'now' }],
        bundle: writtenBundle('new'),
        staled: 0,
      }),
    );
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyGetMarkup: (): Promise<ChapterMarkup> =>
        Promise.resolve({ schemaVersion: 1, chapterId: 'c1', marks: [] }),
      storyExclude,
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Sources/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Don’t draw on this again' }));
    expect(storyExclude).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'source', value: 'i1' }),
    );
  });

  it('lists exclusions on the overview and allows them again', async () => {
    const storyUnexclude = vi.fn(() => Promise.resolve([]));
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyExclusions: () =>
        Promise.resolve([
          { id: 'x1', kind: 'topic', value: 'the divorce', createdAt: 'now' },
          // a source exclusion carries a cryptic id in `value` but a friendly `note` label.
          { id: 'x2', kind: 'source', value: 'i1', note: 'a coaching insight', createdAt: 'now' },
        ]),
      storyUnexclude,
    });
    renderStory();
    // The "Never written about" panel lives in the Settings tab (§13.4).
    await openTab('Settings');
    expect(await screen.findByRole('heading', { name: 'Never written about' })).toBeInTheDocument();
    expect(screen.getByText('the divorce')).toBeInTheDocument();
    // The source exclusion shows its friendly label, never the raw ref id.
    expect(screen.getByText('a coaching insight')).toBeInTheDocument();
    expect(screen.queryByText('i1')).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: /Allow writing about the divorce again/ }),
    );
    expect(storyUnexclude).toHaveBeenCalledWith({ bookId: 'b1', itemId: 'x1' });
  });

  it('deep-links a tab from the URL and switches tabs from the tab bar (§13.2)', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
    });
    // Deep-link: /story/settings opens on the Settings tab (the danger zone shows).
    renderStoryAt('/story/settings');
    expect(
      await screen.findByRole('tab', { name: 'Settings', selected: true }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Danger zone' })).toBeInTheDocument();
    // Switching to Chapters from the tab bar shows the grid.
    await userEvent.click(screen.getByRole('tab', { name: 'Chapters' }));
    expect(await screen.findByRole('button', { name: /The Garage/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Chapters', selected: true })).toBeInTheDocument();
  });

  it('the Danger zone deletes only after typing the book’s title (§13.6.7)', async () => {
    const storyDelete = vi.fn(() => Promise.resolve());
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyDelete,
    });
    renderStory();
    await openTab('Settings');
    await userEvent.click(await screen.findByRole('button', { name: 'Delete this book…' }));
    const del = await screen.findByRole('button', { name: 'Delete forever' });
    expect(del).toBeDisabled(); // armed only by typing the exact title
    const confirm = screen.getByLabelText(/Type the book’s title/);
    await userEvent.type(confirm, 'wrong');
    expect(del).toBeDisabled();
    await userEvent.clear(confirm);
    await userEvent.type(confirm, 'The Story of Ben');
    expect(del).toBeEnabled();
    await userEvent.click(del);
    expect(storyDelete).toHaveBeenCalledWith({ bookId: 'b1' });
  });

  it('the Danger zone rewrites from scratch (resets, then re-drafts) (§13.6.6)', async () => {
    const storyRewriteFromScratch = vi.fn(() => Promise.resolve(bundle(false)));
    const storyGenerateFullDraft = vi.fn(() =>
      Promise.resolve({ ok: true as const, bundle: writtenBundle('new') }),
    );
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyRewriteFromScratch,
      storyGenerateFullDraft,
    });
    renderStory();
    await openTab('Settings');
    await userEvent.click(await screen.findByRole('button', { name: 'Rewrite from scratch…' }));
    // The confirmation dialog opens (names the keeps/discards), then confirms.
    expect(
      await screen.findByRole('heading', { name: /Rewrite .* from scratch\?/ }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Rewrite from scratch' }));
    await waitFor(() => expect(storyRewriteFromScratch).toHaveBeenCalledWith({ bookId: 'b1' }));
    // …then re-runs the standard streamed draft.
    await waitFor(() => expect(storyGenerateFullDraft).toHaveBeenCalledWith({ bookId: 'b1' }));
  });

  it('the History sheet lists an archived version, compares it, and restores behind a two-step confirm (§13.9)', async () => {
    const storyRestoreChapterVersion = vi.fn(() => Promise.resolve(writtenBundle('new')));
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyChapterHistory: () =>
        Promise.resolve({
          chapterId: 'c1',
          versions: [
            {
              revision: 1,
              savedAt: '2026-07-01T00:00:00.000Z',
              reason: 'rewrite' as const,
              words: 12,
            },
          ],
        }),
      storyChapterVersion: () =>
        Promise.resolve({
          revision: 1,
          markdown: 'The old text.',
          provenance: [],
          sourceSignature: '',
          savedAt: '2026-07-01T00:00:00.000Z',
          reason: 'rewrite' as const,
        }),
      storyRestoreChapterVersion,
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'History' }));
    const sheet = await screen.findByRole('dialog', { name: 'Chapter history' });
    // The list row carries the human reason + the at-a-glance word count (never the prose itself).
    expect(await within(sheet).findByText(/Before a rewrite/)).toBeInTheDocument();
    expect(within(sheet).getByText('12 words')).toBeInTheDocument();
    // Compare fetches the FULL version on demand and renders the word diff against the current text.
    await userEvent.click(within(sheet).getByRole('button', { name: 'Compare' }));
    expect(
      await within(sheet).findByRole('group', { name: 'What changed in this rewrite' }),
    ).toBeInTheDocument();
    // Restore is a two-step confirm; confirming calls the restore and the sheet closes on success.
    await userEvent.click(within(sheet).getByRole('button', { name: 'Restore this version' }));
    expect(storyRestoreChapterVersion).not.toHaveBeenCalled(); // arming ≠ restoring
    await userEvent.click(within(sheet).getByRole('button', { name: 'Restore' }));
    expect(storyRestoreChapterVersion).toHaveBeenCalledWith({
      bookId: 'b1',
      chapterId: 'c1',
      revision: 1,
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Chapter history' })).not.toBeInTheDocument(),
    );
  });

  it('the History sheet shows a calm empty state when nothing has been superseded yet (§13.9)', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyChapterHistory: () => Promise.resolve({ chapterId: 'c1', versions: [] }),
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'History' }));
    expect(await screen.findByText(/No earlier versions yet/)).toBeInTheDocument();
  });

  it('the two-step Rewrite confirm never spends until "Rewrite it" — Cancel closes with no call (§8.2)', async () => {
    const storyRegenerateChapter = vi.fn(() =>
      Promise.resolve({ ok: true as const, generated: 1, bundle: writtenBundle('new') }),
    );
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyRegenerateChapter,
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    // Opening the confirm does NOT spend; Cancel closes it with no call.
    await userEvent.click(await screen.findByRole('button', { name: 'Rewrite this chapter' }));
    expect(await screen.findByText(/current text is saved to History/)).toBeInTheDocument();
    expect(storyRegenerateChapter).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Rewrite it' })).not.toBeInTheDocument();
    expect(storyRegenerateChapter).not.toHaveBeenCalled();
    // Only the explicit "Rewrite it" runs the metered rewrite.
    await userEvent.click(screen.getByRole('button', { name: 'Rewrite this chapter' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Rewrite it' }));
    expect(storyRegenerateChapter).toHaveBeenCalledWith({ bookId: 'b1', chapterId: 'c1' });
  });

  it('the refresh says honestly when the BUDGET stopped the pass — never a wrong "turn on AI" (§8.2)', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyRefreshCheck: () =>
        Promise.resolve({
          staled: 2,
          rewritten: 0,
          budgetReached: true,
          bundle: writtenBundle('new'),
        }),
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh from what’s new' }));
    expect(await screen.findByText(/AI budget for this period is used up/)).toBeInTheDocument();
  });

  it('the refresh says honestly when the weekly CAP stopped the pass (§8.2)', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyRefreshCheck: () =>
        Promise.resolve({ staled: 0, rewritten: 3, capped: true, bundle: writtenBundle('new') }),
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh from what’s new' }));
    expect(await screen.findByText(/weekly allowance/)).toBeInTheDocument();
  });

  it('the interview check surfaces the role-aware AI-unavailable copy on an aiOff outcome (§8.2)', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyInterviewCheck: () => Promise.resolve({ outcome: 'aiOff' as const }),
    });
    renderStory();
    await openTab('Interview');
    await userEvent.click(await screen.findByRole('button', { name: 'Find what’s missing' }));
    // The baseline persona is NOT an owner (no settings.manage) → the member wording, never a key prompt.
    expect(
      await screen.findByText(
        'AI isn’t set up yet — ask the person who set up this household to turn it on.',
      ),
    ).toBeInTheDocument();
  });

  it('the interview check explains the weekly cap on a throttled outcome (§8.2)', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyInterviewCheck: () =>
        Promise.resolve({ outcome: 'throttled' as const, throttleReason: 'weeklyCap' as const }),
    });
    renderStory();
    await openTab('Interview');
    await userEvent.click(await screen.findByRole('button', { name: 'Find what’s missing' }));
    expect(await screen.findByText(/already taken stock twice this week/)).toBeInTheDocument();
  });

  it('the invitation disables "Begin your book" and explains when AI is unavailable (§8.2)', async () => {
    installStoryBridge({
      // Override the story baseline back to unavailable: no resolved key on this device or the household.
      aiKeyStatus: () =>
        Promise.resolve({
          hasSharedKey: false,
          hasDeviceOverride: false,
          resolvedReady: false,
          source: 'none' as const,
        }),
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([]),
    });
    renderStory();
    const begin = await screen.findByRole('button', { name: 'Begin your book' });
    await waitFor(() => expect(begin).toBeDisabled());
    // The role-aware notice explains how to enable it (the baseline persona is not an owner).
    expect(
      screen.getByText(
        'AI isn’t set up yet — ask the person who set up this household to turn it on.',
      ),
    ).toBeInTheDocument();
  });

  it('the Studio hero quiets honestly while the person’s own crisis signal is recurring (§13.4)', async () => {
    const at = new Date().toISOString();
    const crisisInsight = (id: string): Insight => ({
      id,
      schemaVersion: 1,
      source: 'session',
      subjectPersonId: 'me',
      summary: 'A heavy stretch.',
      facts: [],
      confidence: 'medium',
      categories: [],
      approved: true,
      crisisFlag: true,
      provenance: { at },
      createdAt: at,
      updatedAt: at,
    });
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      // ≥2 recent approved crisis-flagged own insights → aggregateCrisisSignal.recurring (40 §3.5).
      insightsList: () => Promise.resolve([crisisInsight('i-a'), crisisInsight('i-b')]),
    });
    useSessionStore.setState({ activePerson: ACTIVE_PERSON }); // the signal is per active person
    renderStory();
    expect(
      await screen.findByText(/Your biographer is resting while things are heavy/),
    ).toBeInTheDocument();
  });

  it('the crisis footer is always present on the story surface, invitation included (§8.2)', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([]),
    });
    renderStory();
    await screen.findByRole('button', { name: 'Begin your book' });
    expect(screen.getByRole('button', { name: 'Get help now' })).toBeInTheDocument();
  });

  it('opens a book with an outline straight into the overview (no approval gate)', async () => {
    installStoryBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'drafting' })]),
      storyGet: () => Promise.resolve(bundle(true)), // approved outline, no chapters yet
    });
    renderStory();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'The Story of Ben' })).toBeInTheDocument(),
    );
    // No approve gate — a book with an outline shows the overview + offers to write the chapters.
    expect(screen.getByRole('button', { name: 'Write your chapters' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Approve & start writing' }),
    ).not.toBeInTheDocument();
  });
});

describe('buildAnchor + countApplicable (64 §5.3)', () => {
  const paras = ['the war ended, then the war began again.', 'A quiet second paragraph.'];

  it('anchors a UNIQUE selection to that span', () => {
    expect(buildAnchor(paras, 1, 'quiet')).toMatchObject({ paragraphId: 'p1', quote: 'quiet' });
  });

  it('falls back to the whole paragraph for a REPEATED selection (never the wrong occurrence)', () => {
    // "the war" appears twice → can't tell which from the DOM string → the whole paragraph, so an instant
    // edit can't silently rewrite the first match.
    expect(buildAnchor(paras, 0, 'the war').quote).toBe(paras[0]);
  });

  it('uses the whole paragraph when nothing is selected', () => {
    expect(buildAnchor(paras, 1, null).quote).toBe(paras[1]);
  });

  it('counts deletes + addContext/fix comments + ask to-dos, never question comments', () => {
    const markup: ChapterMarkup = {
      schemaVersion: 1,
      chapterId: 'c1',
      marks: [
        {
          id: 'd',
          kind: 'delete',
          anchor: { paragraphId: 'p0', quote: 'x' },
          status: 'pending',
          createdAt: 'n',
        },
        {
          id: 'q',
          kind: 'comment',
          anchor: { paragraphId: 'p0' },
          intent: 'question',
          text: '?',
          status: 'open',
          createdAt: 'n',
        },
        { id: 'a', kind: 'todo', text: 'ask', todoKind: 'ask', status: 'open', createdAt: 'n' },
      ],
    };
    expect(countApplicable(markup)).toBe(2); // the delete + the ask to-do; the question comment is excluded
    expect(countApplicable(null)).toBe(0);
  });
});
