/**
 * FingerCursor.tsx
 * ---------------------------------------------------------------------------
 * The glowing fingertip cursor overlaid on the camera feed. Position updates
 * happen ~60x/sec, so this component exposes an imperative `update()` method
 * (via useImperativeHandle) that writes directly to the DOM style — no React
 * state, no re-renders, just a transform update every frame.
 */

import { forwardRef, useImperativeHandle, useRef } from 'react';

export interface FingerCursorHandle {
  /** Move the cursor to a screen-space pixel position and show/hide it. */
  update: (x: number, y: number, visible: boolean) => void;
  /** Briefly flash the cursor brighter, e.g. on note trigger. */
  pulse: () => void;
}

export const FingerCursor = forwardRef<FingerCursorHandle>((_props, ref) => {
  const dotRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);

  useImperativeHandle(ref, () => ({
    update(x: number, y: number, visible: boolean) {
      const dot = dotRef.current;
      const ring = ringRef.current;
      if (!dot || !ring) return;
      const transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      dot.style.transform = transform;
      ring.style.transform = transform;
      const opacity = visible ? '1' : '0';
      dot.style.opacity = opacity;
      ring.style.opacity = visible ? '0.8' : '0';
    },
    pulse() {
      const ring = ringRef.current;
      if (!ring) return;
      ring.classList.remove('cursor-pulse');
      // Force reflow so the animation can be re-triggered back-to-back.
      void ring.offsetWidth;
      ring.classList.add('cursor-pulse');
    },
  }));

  return (
    <>
      <div ref={ringRef} className="finger-cursor-ring" />
      <div ref={dotRef} className="finger-cursor-dot" />
    </>
  );
});

FingerCursor.displayName = 'FingerCursor';
