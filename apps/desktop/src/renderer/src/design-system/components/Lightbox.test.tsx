import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Lightbox, type LightboxImage } from './Lightbox';

const images: LightboxImage[] = [
  { src: 'data:image/png;base64,AAAA', alt: 'Sample 1 of 2' },
  { src: 'data:image/png;base64,BBBB', alt: 'Sample 2 of 2' },
];

describe('Lightbox', () => {
  it('renders the current image and moves focus to the close button', () => {
    render(<Lightbox images={images} index={0} onClose={() => {}} onIndexChange={() => {}} />);
    expect(screen.getByRole('img', { name: 'Sample 1 of 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<Lightbox images={images} index={0} onClose={onClose} onIndexChange={() => {}} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('restores focus to the trigger on close', async () => {
    render(
      <>
        <button type="button">opener</button>
        <div id="host" />
      </>,
    );
    const opener = screen.getByRole('button', { name: 'opener' });
    opener.focus();
    expect(opener).toHaveFocus();
    const { unmount } = render(
      <Lightbox images={images} index={0} onClose={() => {}} onIndexChange={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    unmount();
    expect(opener).toHaveFocus(); // focus returns to where it was
  });

  it('navigates with prev/next when there are several', async () => {
    const onIndexChange = vi.fn();
    render(<Lightbox images={images} index={0} onClose={() => {}} onIndexChange={onIndexChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Next image' }));
    expect(onIndexChange).toHaveBeenCalledWith(1);
  });

  it('hides prev/next for a single image', () => {
    render(
      <Lightbox images={[images[0]!]} index={0} onClose={() => {}} onIndexChange={() => {}} />,
    );
    expect(screen.queryByRole('button', { name: 'Next image' })).toBeNull();
  });

  it('shows a Save action only when onSave is provided', async () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <Lightbox images={images} index={0} onClose={() => {}} onIndexChange={() => {}} />,
    );
    expect(screen.queryByRole('button', { name: 'Save image' })).toBeNull();
    rerender(
      <Lightbox
        images={images}
        index={0}
        onClose={() => {}}
        onIndexChange={() => {}}
        onSave={onSave}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save image' }));
    expect(onSave).toHaveBeenCalledOnce();
  });
});
