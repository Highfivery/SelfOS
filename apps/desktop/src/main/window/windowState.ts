import type { WindowBounds } from '../../shared/schemas';

export interface DisplayArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Make saved window bounds safe to restore: cap the size to the largest display, and drop the
 * position if the window wouldn't be visible on any display (so the OS centers it instead).
 */
export function clampBoundsToDisplays(
  bounds: WindowBounds,
  displays: readonly DisplayArea[],
): WindowBounds {
  if (displays.length === 0) return { width: bounds.width, height: bounds.height };

  const width = Math.min(bounds.width, Math.max(...displays.map((d) => d.width)));
  const height = Math.min(bounds.height, Math.max(...displays.map((d) => d.height)));

  const { x, y } = bounds;
  if (x === undefined || y === undefined) return { width, height };

  const onScreen = displays.some(
    (d) => x < d.x + d.width && x + width > d.x && y < d.y + d.height && y + height > d.y,
  );

  return onScreen ? { width, height, x, y } : { width, height };
}
