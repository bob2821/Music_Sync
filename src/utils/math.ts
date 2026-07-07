/**
 * math.ts
 * ---------------------------------------------------------------------------
 * Small, dependency-free math helpers used by the hand-tracking loop and the
 * radial note layout. Kept framework-agnostic so they can run inside a
 * requestAnimationFrame loop without pulling in React.
 */

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function distance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Convert polar coordinates (center + radius + angle) to cartesian x/y. */
export function polarToCartesian(
  cx: number,
  cy: number,
  radius: number,
  angleDeg: number,
): { x: number; y: number } {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180; // -90 so 0deg points up
  return {
    x: cx + radius * Math.cos(angleRad),
    y: cy + radius * Math.sin(angleRad),
  };
}

export function mapRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  const t = clamp((value - inMin) / (inMax - inMin), 0, 1);
  return lerp(outMin, outMax, t);
}

/**
 * Exponential smoothing helper for jittery input (e.g. fingertip position).
 * Call `.update(x, y, now)` every frame; `.x`/`.y` hold the smoothed value.
 * `smoothing` in [0..1]: higher = snappier, lower = smoother/laggier.
 */
export class SmoothedPoint2D {
  x = 0;
  y = 0;
  private initialized = false;

  constructor(private smoothing = 0.35) {}

  update(targetX: number, targetY: number): { x: number; y: number } {
    if (!this.initialized) {
      this.x = targetX;
      this.y = targetY;
      this.initialized = true;
    } else {
      this.x = lerp(this.x, targetX, this.smoothing);
      this.y = lerp(this.y, targetY, this.smoothing);
    }
    return { x: this.x, y: this.y };
  }

  reset() {
    this.initialized = false;
  }
}

/**
 * Tracks how long the fingertip has been continuously hovering a given zone
 * id, for the "minimum hover duration before activation" requirement.
 */
export class HoverStabilityTimer {
  private currentId: string | null = null;
  private since = 0;

  /** Returns the id if it has been stable for at least `minMs`, else null. */
  update(id: string | null, now: number, minMs: number): string | null {
    if (id !== this.currentId) {
      this.currentId = id;
      this.since = now;
    }
    if (id !== null && now - this.since >= minMs) {
      return id;
    }
    return null;
  }

  reset() {
    this.currentId = null;
    this.since = 0;
  }
}
