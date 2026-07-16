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
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

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
  useSessionStore.setState({ activePerson: null });
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
