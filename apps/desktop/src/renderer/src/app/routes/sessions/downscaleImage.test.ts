import { describe, expect, it } from 'vitest';
import { scaledDimensions, DOWNSCALE_MAX_EDGE } from './downscaleImage';

describe('scaledDimensions (45 §5.5)', () => {
  it('caps the longest edge to maxEdge, preserving aspect ratio', () => {
    expect(scaledDimensions(3000, 2000, DOWNSCALE_MAX_EDGE)).toEqual({ width: 1568, height: 1045 });
    expect(scaledDimensions(2000, 4000, 1568)).toEqual({ width: 784, height: 1568 });
  });

  it('never upscales a small image', () => {
    expect(scaledDimensions(800, 600, 1568)).toEqual({ width: 800, height: 600 });
    expect(scaledDimensions(1568, 1000, 1568)).toEqual({ width: 1568, height: 1000 });
  });

  it('handles a zero dimension without dividing by zero', () => {
    expect(scaledDimensions(0, 0, 1568)).toEqual({ width: 0, height: 0 });
  });
});
