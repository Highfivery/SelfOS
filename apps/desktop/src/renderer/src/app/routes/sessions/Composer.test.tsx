import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PendingAttachment } from './downscaleImage';

// Mock the canvas-based downscale so the composer's add path is deterministic in jsdom.
let counter = 0;
const downscaleMock = vi.fn(
  (blob: Blob): Promise<PendingAttachment> =>
    Promise.resolve({
      id: `pending-${(counter += 1)}`,
      base64: 'AAAA',
      mime: blob.type || 'image/png',
      width: 10,
      height: 10,
      bytes: 3,
      previewUrl: `data:${blob.type};base64,AAAA`,
    }),
);
vi.mock('./downscaleImage', async (orig) => {
  const actual = await orig<typeof import('./downscaleImage')>();
  return { ...actual, downscaleImage: (blob: Blob) => downscaleMock(blob) };
});

import { Composer } from './Composer';

function pngFile(name = 'shot.png', type = 'image/png'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

function fileInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

beforeEach(() => {
  counter = 0;
  downscaleMock.mockClear();
});

describe('Composer attachments (45)', () => {
  it('text-only mode has no attach controls and Send needs text', () => {
    const onSend = vi.fn();
    render(<Composer disabled={false} onSend={onSend} />);
    expect(screen.queryByRole('button', { name: 'Attach image' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('adds a pending thumbnail via the file-picker and enables Send', async () => {
    const onSend = vi.fn();
    render(<Composer disabled={false} allowAttachments onSend={onSend} />);
    await userEvent.upload(fileInput(), pngFile());
    expect(await screen.findByRole('img', { name: 'Attached image 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled(); // image-only is sendable
  });

  it('adds an image via paste and via drop', async () => {
    render(<Composer disabled={false} allowAttachments onSend={vi.fn()} />);
    const file = pngFile();
    fireEvent.paste(screen.getByRole('textbox', { name: 'Message' }), {
      clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] },
    });
    expect(await screen.findByRole('img', { name: 'Attached image 1' })).toBeInTheDocument();

    fireEvent.drop(screen.getByLabelText('Attachments').parentElement as HTMLElement, {
      dataTransfer: { files: [pngFile('two.png')] },
    });
    expect(await screen.findByRole('img', { name: 'Attached image 2' })).toBeInTheDocument();
  });

  it('removes a pending thumbnail', async () => {
    render(<Composer disabled={false} allowAttachments onSend={vi.fn()} />);
    await userEvent.upload(fileInput(), pngFile());
    await screen.findByRole('img', { name: 'Attached image 1' });
    await userEvent.click(screen.getByRole('button', { name: 'Remove attachment 1' }));
    expect(screen.queryByRole('img', { name: 'Attached image 1' })).toBeNull();
  });

  it('rejects an unsupported type dropped in, with a calm error', async () => {
    render(<Composer disabled={false} allowAttachments onSend={vi.fn()} />);
    // Drop bypasses the file-picker `accept` filter, so the composer's own mime check is exercised.
    fireEvent.drop(
      screen.getByRole('textbox', { name: 'Message' }).closest('div')!.parentElement!,
      {
        dataTransfer: { files: [pngFile('clip.heic', 'image/heic')] },
      },
    );
    expect(await screen.findByText(/isn’t a supported image/)).toBeInTheDocument();
    expect(downscaleMock).not.toHaveBeenCalled();
  });

  it('caps at 5 images per message', async () => {
    render(<Composer disabled={false} allowAttachments onSend={vi.fn()} />);
    const files = Array.from({ length: 6 }, (_, i) => pngFile(`s${i}.png`));
    await userEvent.upload(fileInput(), files);
    expect(await screen.findByText(/Max 5 images/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(5));
  });

  it('keeps the pending attachment when onSend reports failure (false)', async () => {
    const onSend = vi.fn().mockResolvedValue(false);
    render(<Composer disabled={false} allowAttachments onSend={onSend} />);
    await userEvent.upload(fileInput(), pngFile());
    await screen.findByRole('img', { name: 'Attached image 1' });
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledOnce();
    // The store failed → the thumbnail is retained so the user can retry.
    expect(screen.getByRole('img', { name: 'Attached image 1' })).toBeInTheDocument();
  });

  it('passes text + pending attachments up on Send, then clears', async () => {
    const onSend = vi.fn();
    render(<Composer disabled={false} allowAttachments onSend={onSend} />);
    await userEvent.upload(fileInput(), pngFile());
    await screen.findByRole('img', { name: 'Attached image 1' });
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'what is this');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('what is this', [
      expect.objectContaining({ id: 'pending-1', mime: 'image/png' }),
    ]);
    expect(screen.queryByRole('img', { name: 'Attached image 1' })).toBeNull();
  });

  it('clears the field the INSTANT you hit Send — before the turn resolves (05 §3)', async () => {
    // A turn stays "in flight" for the whole reply, so onSend hasn't resolved yet. The field must already be
    // empty (the message lives in the thread) — not lingering in a disabled textarea (the reported confusion).
    let resolveSend: () => void = () => {};
    const onSend = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
    );
    render(<Composer disabled={false} onSend={onSend} />);
    const box = screen.getByRole('textbox', { name: 'Message' });
    await userEvent.type(box, 'I feel distant');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('I feel distant', []);
    expect(box).toHaveValue(''); // cleared immediately, while the turn is still running
    resolveSend();
    await waitFor(() => expect(box).toHaveValue(''));
  });

  it('restores the typed text if the send can’t even start (false)', async () => {
    const onSend = vi.fn().mockResolvedValue(false);
    render(<Composer disabled={false} onSend={onSend} />);
    const box = screen.getByRole('textbox', { name: 'Message' });
    await userEvent.type(box, 'keep me');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    // The store aborted before sending (e.g. a total attachment failure) → nothing is lost.
    await waitFor(() => expect(box).toHaveValue('keep me'));
  });
});
