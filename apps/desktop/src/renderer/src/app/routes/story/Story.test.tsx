import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type {
  BookManifest,
  BookOutline,
  StoryBookBundle,
  StoryBookTypeView,
} from '@shared/schemas';
import { Story } from './Story';
import { useStoryStore } from '../../../stores/storyStore';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

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
