import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type {
  BookManifest,
  BookOutline,
  ChapterMarkup,
  StoryBookBundle,
  StoryBookTypeView,
  StoryMarkInput,
  StoryRevisionResult,
  StructuralProposal,
} from '@shared/schemas';
import { Story, buildAnchor, countApplicable } from './Story';
import { useStoryStore } from '../../../stores/storyStore';
import { useSessionStore } from '../../../stores/sessionStore';
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
  it('shows the empty state with a Start your story action', async () => {
    installMockBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([]),
    });
    renderStory();
    expect(await screen.findByRole('button', { name: 'Start your story' })).toBeInTheDocument();
  });

  it('setup drafts the whole book end-to-end and lands on the overview (no outline-review gate)', async () => {
    installMockBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([]),
      storyCreate: () => Promise.resolve(manifest()),
      storyGet: () => Promise.resolve(writtenBundle()),
      storyGenerateFullDraft: () => Promise.resolve({ ok: true, bundle: writtenBundle() }),
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: 'Start your story' }));
    expect(await screen.findByLabelText('Title')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Create .* draft the outline/ }));
    // No outline-review gate — it drafts straight through to the finished, editable book.
    expect(await screen.findByRole('button', { name: /The Garage/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Review your outline' })).not.toBeInTheDocument();
  });

  it('shows the live writing progress screen while a draft runs (phase, chapter count, progress bar)', async () => {
    installMockBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([]),
    });
    renderStory();
    await screen.findByRole('button', { name: 'Start your story' });
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
    installMockBridge({
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
    await userEvent.click(await screen.findByRole('button', { name: 'Start your story' }));
    // A new style register is offered in the Style dropdown.
    expect(await screen.findByRole('option', { name: 'Cinematic' })).toBeInTheDocument();
    // The Create button is enabled with NO title typed — blank means the AI names it.
    const create = screen.getByRole('button', { name: /Create .* draft the outline/ });
    expect(create).toBeEnabled();
    await userEvent.click(create);
    await waitFor(() => expect(createdWith).not.toBeNull());
    expect(createdWith!.title).toBe(''); // left blank → the biographer proposes one
    expect(createdWith!.config.length).toBe('full'); // Full is the default for a biography
  });

  it('renames the book from the overview (title editable in place, no outline gate)', async () => {
    let updatedWith: { bookId: string; title?: string } | null = null;
    installMockBridge({
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
    installMockBridge({
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
    installMockBridge({
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
    installMockBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([]),
      storyCreate: () => Promise.resolve(manifest()),
      storyGet: () => Promise.resolve(noOutline),
      storyGenerateFullDraft: () =>
        Promise.resolve({ ok: false, reason: 'AI_OFF', message: 'Turn on AI in Settings.' }),
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: 'Start your story' }));
    await userEvent.click(
      await screen.findByRole('button', { name: /Create .* draft the outline/ }),
    );
    expect(await screen.findByText('Turn on AI in Settings.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('writes the chapters, then opens one to read the prose with its sources', async () => {
    installMockBridge({
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
    installMockBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyRegenerateChapter: () => Promise.resolve({ ok: true, generated: 1, bundle: rewritten }),
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Rewrite this chapter' }));
    expect(await screen.findByText(/richer, rewritten scene/)).toBeInTheDocument();
  });

  it('surfaces an error when a rewrite fails (no silent dead-end)', async () => {
    installMockBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () => Promise.resolve(writtenBundle('new')),
      storyRegenerateChapter: () =>
        Promise.resolve({ ok: false, reason: 'BUDGET', message: 'AI budget reached.' }),
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: /The Garage/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Rewrite this chapter' }));
    expect(await screen.findByText('AI budget reached.')).toBeInTheDocument();
  });

  it('surfaces an error when writing every chapter fails (no silent dead-end)', async () => {
    installMockBridge({
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
    installMockBridge({
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
    installMockBridge({
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

  it('marks a paragraph for deletion — the suggestion strip + apply bar appear', async () => {
    const storyMark = vi.fn(
      (input: StoryMarkInput): Promise<ChapterMarkup> =>
        Promise.resolve({ schemaVersion: 1, chapterId: input.chapterId, marks: [input.mark] }),
    );
    installMockBridge({
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
    // …and the suggestion strip + apply bar reflect it.
    expect(await screen.findByText(/1 change ready to apply/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review & apply' })).toBeInTheDocument();
  });

  it('a Fix-this comment can also flag the source insight in Memory', async () => {
    const storyMark = vi.fn(
      (input: StoryMarkInput): Promise<ChapterMarkup> =>
        Promise.resolve({ schemaVersion: 1, chapterId: input.chapterId, marks: [input.mark] }),
    );
    const insightsFlag = vi.fn(() => Promise.resolve(null));
    installMockBridge({
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
    installMockBridge({
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
    installMockBridge({
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
    installMockBridge({
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
    // The pending delete surfaces the apply bar on load.
    await userEvent.click(await screen.findByRole('button', { name: 'Review & apply' }));
    expect(storyApplyMarkup).toHaveBeenCalledWith({ bookId: 'b1', chapterId: 'c1' });
  });

  it('undoes a pending mark from its strip', async () => {
    const storyRemoveMark = vi.fn(
      (): Promise<ChapterMarkup> =>
        Promise.resolve({ schemaVersion: 1, chapterId: 'c1', marks: [] }),
    );
    installMockBridge({
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
    installMockBridge({
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
    installMockBridge({
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
    // The comment shows in the strip, but it's not an "apply" change → no bar.
    expect(await screen.findByText(/why frame it this way/)).toBeInTheDocument();
    expect(screen.queryByText(/ready to apply/)).not.toBeInTheDocument();
  });

  it('makes an instant inline edit', async () => {
    const storyEditPassage = vi.fn(() => Promise.resolve(writtenBundle('new')));
    installMockBridge({
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
    installMockBridge({
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
    installMockBridge({
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

  it('an ask to-do counts toward the apply bar', async () => {
    installMockBridge({
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
    expect(await screen.findByText(/1 change ready to apply/)).toBeInTheDocument();
  });

  it('auto-refreshes the open book on mount (the living-book cadence)', async () => {
    const storyRefreshCheck = vi.fn(() =>
      Promise.resolve({ staled: 0, rewritten: 0, bundle: writtenBundle('new') }),
    );
    installMockBridge({
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
    installMockBridge({
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
    installMockBridge({
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
    installMockBridge({
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
    installMockBridge({
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
    installMockBridge({
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
    installMockBridge({
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

  it('the interview cadence fires storyInterviewCheck({auto:true}) on mount', async () => {
    const storyInterviewCheck = vi.fn(() => Promise.resolve({ outcome: 'throttled' as const }));
    installMockBridge({
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
    installMockBridge({
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
    installMockBridge({
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
    installMockBridge({
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
    installMockBridge({
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
    installMockBridge({
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
    // Begin reading → chapter 1 prose + an "Edit this chapter" affordance (owner only).
    await userEvent.click(screen.getByRole('button', { name: /Begin reading/ }));
    expect(await screen.findByText('The garage smelled of cut pine.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Edit this chapter/ })).toBeInTheDocument();
    // Next → chapter 2 (the last chapter carries the honesty note); Previous returns to chapter 1.
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(await screen.findByText('He learned to speak.')).toBeInTheDocument();
    expect(screen.getByText(/never invented/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Previous/ }));
    expect(await screen.findByText('The garage smelled of cut pine.')).toBeInTheDocument();
    // Edit this chapter → the chapter editor (the markup surface, still §3.3) opens.
    await userEvent.click(screen.getByRole('button', { name: /Edit this chapter/ }));
    expect(await screen.findByRole('button', { name: 'Rewrite this chapter' })).toBeInTheDocument();
  });

  it('“Read your story” from the Studio opens the immersive reader (§13.5)', async () => {
    installMockBridge({
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
    installMockBridge({
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

  it('exports the published book as Markdown, noting it leaves the vault (§3.9)', async () => {
    const storyExportMarkdown = vi.fn(() => Promise.resolve('/exports/The-Story-of-Ben.md'));
    installMockBridge({
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
    await userEvent.click(await screen.findByRole('button', { name: 'Export as Markdown' }));
    expect(storyExportMarkdown).toHaveBeenCalledWith({ bookId: 'b1' });
    expect(
      await screen.findByText(/Saved to .* — this file leaves your encrypted vault/),
    ).toBeInTheDocument();
  });

  it('exports the published book as PDF, noting it leaves the vault (§3.9)', async () => {
    const storyExportPdf = vi.fn(() => Promise.resolve('/exports/The-Story-of-Ben.pdf'));
    installMockBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: 'ready' })]),
      storyGet: () =>
        Promise.resolve({
          ...writtenBundle('new'),
          manifest: manifest({ status: 'ready', publishedAt: '2026-07-16T00:00:00.000Z' }),
        }),
      storyExportPdf,
    });
    renderStory();
    await openTab('Sharing');
    await userEvent.click(await screen.findByRole('button', { name: 'Export as PDF' }));
    expect(storyExportPdf).toHaveBeenCalledWith({ bookId: 'b1' });
    expect(
      await screen.findByText(/Saved to .* — this file leaves your encrypted vault/),
    ).toBeInTheDocument();
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
    installMockBridge({
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
    installMockBridge({
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
    installMockBridge({
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
    installMockBridge({
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
    installMockBridge({
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
    installMockBridge({
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
    installMockBridge({
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
    installMockBridge({
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
    installMockBridge({
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
    installMockBridge({
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
    installMockBridge({
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

  it('opens a book with an outline straight into the overview (no approval gate)', async () => {
    installMockBridge({
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
