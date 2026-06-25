import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AttachmentRef } from '@shared/schemas';
import { MessageAttachments } from './MessageAttachments';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';
import { useConversationStore } from '../../../stores/conversationStore';

const refs: AttachmentRef[] = [
  {
    id: 'a1',
    kind: 'image',
    mime: 'image/png',
    path: 'people/owner-1/conversations/c1/attachments/a1.enc',
  },
  {
    id: 'a2',
    kind: 'image',
    mime: 'image/png',
    path: 'people/owner-1/conversations/c1/attachments/a2.enc',
  },
];

afterEach(() => {
  clearMockBridge();
  useConversationStore.getState().reset();
});

describe('MessageAttachments (45 §3.3)', () => {
  it('renders a thumbnail grid and opens/closes a lightbox', async () => {
    installMockBridge();
    useConversationStore.setState({ activeId: 'c1' });
    render(<MessageAttachments attachments={refs} />);

    const thumbs = await screen.findAllByRole('button', { name: /Attached image/ });
    expect(thumbs).toHaveLength(2);

    await userEvent.click(thumbs[0]!);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows a calm placeholder for a missing attachment', async () => {
    installMockBridge({ conversationGetAttachment: () => Promise.resolve(null) });
    useConversationStore.setState({ activeId: 'c1' });
    render(<MessageAttachments attachments={[refs[0]!]} />);
    // No src resolves → placeholder, not an interactive thumbnail.
    expect(await screen.findByLabelText('Image unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Attached image/ })).toBeNull();
  });
});
