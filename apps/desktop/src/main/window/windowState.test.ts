// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { clampBoundsToDisplays } from './windowState';

const display = { x: 0, y: 0, width: 1440, height: 900 };

describe('clampBoundsToDisplays', () => {
  it('keeps an on-screen window unchanged', () => {
    expect(clampBoundsToDisplays({ width: 800, height: 600, x: 100, y: 80 }, [display])).toEqual({
      width: 800,
      height: 600,
      x: 100,
      y: 80,
    });
  });

  it('drops the position when the window would be off-screen', () => {
    expect(clampBoundsToDisplays({ width: 800, height: 600, x: 5000, y: 5000 }, [display])).toEqual(
      {
        width: 800,
        height: 600,
      },
    );
  });

  it('caps the size to the largest display', () => {
    expect(clampBoundsToDisplays({ width: 4000, height: 3000, x: 0, y: 0 }, [display])).toEqual({
      width: 1440,
      height: 900,
      x: 0,
      y: 0,
    });
  });

  it('returns only the size when there are no displays', () => {
    expect(clampBoundsToDisplays({ width: 800, height: 600, x: 1, y: 1 }, [])).toEqual({
      width: 800,
      height: 600,
    });
  });
});
