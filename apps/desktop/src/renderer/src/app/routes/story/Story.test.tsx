import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
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

  it('runs the setup → foundations → outline review flow', async () => {
    installMockBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([]),
      storyCreate: () => Promise.resolve(manifest()),
      storyGet: () => Promise.resolve(bundle(false)),
      storyGenerateFoundations: () => Promise.resolve({ ok: true, bundle: bundle(false) }),
    });
    renderStory();
    await userEvent.click(await screen.findByRole('button', { name: 'Start your story' }));
    // Setup screen → create.
    expect(await screen.findByLabelText('Title')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Create .* draft the outline/ }));
    // Foundations → outline review.
    expect(await screen.findByRole('heading', { name: 'Review your outline' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('The Garage')).toBeInTheDocument();
    expect(screen.getByText('A quiet man learning to speak up.')).toBeInTheDocument();
  });

  it('a failed foundations pass surfaces the error + a Try again path (no dead-end)', async () => {
    // Realistic: after storyCreate the book EXISTS, so storyGet returns a non-null bundle with a null
    // outline. The failure must land on the NeedsOutline state (error + Try again), never a blank overview.
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
      storyGenerateFoundations: () =>
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

  it('disables Approve when every chapter has been removed', async () => {
    installMockBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest()]),
      storyGet: () => Promise.resolve(bundle(false)),
    });
    renderStory();
    // Opens into outline review (one chapter). Remove it → Approve disabled.
    const approve = await screen.findByRole('button', { name: 'Approve & start writing' });
    expect(approve).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Remove chapter The Garage' }));
    expect(screen.getByRole('button', { name: 'Approve & start writing' })).toBeDisabled();
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
        parts: [{ id: 'p1', title: 'Roots', chapterIds: ['c1'] }],
        chapterOrder: ['c1'],
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
          },
        ]),
      storyReadShared: () => Promise.resolve(readerView),
    });
    renderStory();
    expect(await screen.findByText('Shared with you')).toBeInTheDocument();
    expect(screen.getByText(/By Ben · 1 chapter/)).toBeInTheDocument();
    // Open it → the reader view renders the published head (prose + front matter + the honesty page).
    await userEvent.click(screen.getByRole('button', { name: /The Life of Ben/ }));
    expect(await screen.findByText('The garage smelled of cut pine.')).toBeInTheDocument();
    expect(screen.getByText('For my mother')).toBeInTheDocument();
    expect(screen.getByText(/never invented/)).toBeInTheDocument();
    // Back returns to the surface.
    await userEvent.click(screen.getByRole('button', { name: '‹ Back' }));
    expect(await screen.findByText('Shared with you')).toBeInTheDocument();
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
    expect(storyGenerateImage).toHaveBeenCalledWith({
      bookId: 'b1',
      target: { kind: 'cover' },
      style: expect.any(String),
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

  it('lists to-dos on the overview and marks a reminder done', async () => {
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
    // The overview shows the "Never written about" panel.
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

  it('approves the outline and shows the book overview', async () => {
    let approved = false;
    installMockBridge({
      storyBookTypes: () => Promise.resolve(BOOK_TYPES),
      storyList: () => Promise.resolve([manifest({ status: approved ? 'drafting' : 'outlining' })]),
      storyGet: () => Promise.resolve(bundle(approved)),
      storyApproveOutline: () => {
        approved = true;
        return Promise.resolve(manifest({ status: 'drafting' }));
      },
    });
    renderStory();
    // Opens straight into outline review (a book exists with an unapproved outline).
    await userEvent.click(await screen.findByRole('button', { name: 'Approve & start writing' }));
    // Lands on the book overview (approved, no chapters yet → offers to write them).
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'The Story of Ben' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Write your chapters' })).toBeInTheDocument();
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
