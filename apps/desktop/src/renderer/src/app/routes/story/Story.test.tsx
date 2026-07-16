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
    await waitFor(() =>
      expect(screen.getByText(/chapter writing arrives in the next update/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole('heading', { name: 'The Story of Ben' })).toBeInTheDocument();
  });
});
