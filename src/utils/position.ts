import type { FloatPosition } from "../types/stock";
import { DEFAULT_POSITION } from "../types/stock";

const FLOAT_WIDTH = 300;
const FLOAT_MIN_HEIGHT = 90;
const EDGE_PAD = 8;

export function clampPosition(
  position: FloatPosition,
  size: { width: number; height: number } = {
    width: FLOAT_WIDTH,
    height: FLOAT_MIN_HEIGHT,
  }
): FloatPosition {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxRight = Math.max(EDGE_PAD, vw - size.width - EDGE_PAD);
  const maxBottom = Math.max(EDGE_PAD, vh - size.height - EDGE_PAD);

  return {
    right: clamp(position.right, EDGE_PAD, maxRight),
    bottom: clamp(position.bottom, EDGE_PAD, maxBottom),
  };
}

export function normalizePosition(raw: Partial<FloatPosition> | null | undefined): FloatPosition {
  if (!raw) return { ...DEFAULT_POSITION };
  return {
    right: Number.isFinite(raw.right) ? Number(raw.right) : DEFAULT_POSITION.right,
    bottom: Number.isFinite(raw.bottom) ? Number(raw.bottom) : DEFAULT_POSITION.bottom,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export { FLOAT_WIDTH, FLOAT_MIN_HEIGHT };
