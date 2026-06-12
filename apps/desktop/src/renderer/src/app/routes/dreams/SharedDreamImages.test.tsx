import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SharedDreamImages } from './SharedDreamImages';
import { clearMockBridge, installMockBridge } from '../../../test-utils/bridge';

afterEach(() => clearMockBridge());

describe('SharedDreamImages', () => {
  it('shows images shared with you, captioned by who shared them', async () => {
    installMockBridge({
      dreamListSharedImages: () =>
        Promise.resolve([
          { dreamerId: 'p1', dreamerName: 'Partner', dreamId: 'd1', mime: 'image/png' },
        ]),
      dreamGetSharedImage: () => Promise.resolve({ mime: 'image/png', dataBase64: 'AAAA' }),
    });
    render(<SharedDreamImages />);
    expect(await screen.findByText('Shared with you')).toBeInTheDocument();
    expect(screen.getByText(/from partner/i)).toBeInTheDocument();
    expect(screen.getByRole('img').getAttribute('src')).toContain('data:image/png;base64,AAAA');
  });

  it('renders nothing when nothing is shared with you', async () => {
    installMockBridge({ dreamListSharedImages: () => Promise.resolve([]) });
    const { container } = render(<SharedDreamImages />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
