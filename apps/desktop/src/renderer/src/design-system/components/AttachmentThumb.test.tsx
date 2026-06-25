import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AttachmentThumb } from './AttachmentThumb';

describe('AttachmentThumb', () => {
  it('renders an image with the given src + alt', () => {
    render(<AttachmentThumb src="data:image/png;base64,AAAA" alt="Attached image 1" />);
    const img = screen.getByRole('img', { name: 'Attached image 1' });
    expect(img).toHaveAttribute('src', 'data:image/png;base64,AAAA');
  });

  it('renders a calm placeholder when src is null', () => {
    render(<AttachmentThumb src={null} alt="Attached image" />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByLabelText('Image unavailable')).toBeInTheDocument();
  });

  it('activates via the button when onActivate is provided', async () => {
    const onActivate = vi.fn();
    render(<AttachmentThumb src="data:image/png;base64,AAAA" alt="Open" onActivate={onActivate} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('is non-interactive without onActivate', () => {
    render(<AttachmentThumb src="data:image/png;base64,AAAA" alt="Still" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
