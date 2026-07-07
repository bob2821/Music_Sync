/**
 * ScaleSlider.tsx
 * ---------------------------------------------------------------------------
 * The right-hand control: a vertical "slide up and down" track that switches
 * the active scale between Major (top) and Minor (bottom). The right hand's
 * index fingertip position drives this every frame; App.tsx does the
 * hand-to-track mapping and hysteresis, then calls `updateHandle()` here with
 * a normalized 0 (top) .. 1 (bottom) position, or `null` when the right hand
 * isn't visible (the handle then "parks" at whichever end matches the last
 * committed scale).
 *
 * Like FingerCursor, the live handle position is written directly to the DOM
 * via an imperative ref — never React state — since it updates ~60x/sec.
 * The committed `value` prop (Major/Minor/other) only changes rarely and is
 * fine as a normal prop.
 */

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { clamp } from '../utils/math';
import type { ScaleName } from '../utils/notes';

export interface ScaleSliderHandle {
  /** t: 0 (top/Major) .. 1 (bottom/Minor), or null to park at the committed value. */
  updateHandle: (t: number | null) => void;
}

export interface ScaleTrackLayout {
  x: number;
  topY: number;
  bottomY: number;
}

interface ScaleSliderProps {
  value: ScaleName;
  onTrackLayout: (layout: ScaleTrackLayout) => void;
}

export const ScaleSlider = forwardRef<ScaleSliderHandle, ScaleSliderProps>(({ value, onTrackLayout }, ref) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const majorLabelRef = useRef<HTMLSpanElement | null>(null);
  const minorLabelRef = useRef<HTMLSpanElement | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const positionHandle = (t: number | null) => {
    const track = trackRef.current;
    const handle = handleRef.current;
    if (!track || !handle) return;
    const trackHeight = track.clientHeight;

    let posY: number;
    let majorActive: boolean;
    if (t === null) {
      const v = valueRef.current;
      if (v === 'Major') {
        posY = 0;
        majorActive = true;
      } else if (v === 'Minor') {
        posY = trackHeight;
        majorActive = false;
      } else {
        posY = trackHeight / 2;
        majorActive = false;
      }
      handle.classList.remove('scale-slider-handle--live');
    } else {
      const clamped = clamp(t, 0, 1);
      posY = clamped * trackHeight;
      majorActive = clamped < 0.5;
      handle.classList.add('scale-slider-handle--live');
    }

    handle.style.transform = `translate(-50%, ${posY}px) translateY(-50%)`;
    majorLabelRef.current?.classList.toggle('scale-slider-label--active', majorActive);
    minorLabelRef.current?.classList.toggle('scale-slider-label--active', !majorActive && (t !== null || valueRef.current === 'Minor'));
  };

  useImperativeHandle(ref, () => ({ updateHandle: positionHandle }));

  // Keep the handle in sync immediately when the committed value changes
  // (e.g. picked via the chip selector while no hand is controlling it).
  useEffect(() => {
    positionHandle(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Report the track's screen-space bounds so App can map the right hand's
  // fingertip y position onto it. Recomputed on mount/resize.
  useLayoutEffect(() => {
    function recompute() {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      onTrackLayout({ x: rect.left + rect.width / 2, topY: rect.top, bottomY: rect.bottom });
      positionHandle(null);
    }
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="scale-slider glass-panel" aria-hidden="true">
      <span ref={majorLabelRef} className="scale-slider-label scale-slider-label--major">
        Major
      </span>
      <div ref={trackRef} className="scale-slider-track">
        <div ref={handleRef} className="scale-slider-handle" />
      </div>
      <span ref={minorLabelRef} className="scale-slider-label scale-slider-label--minor">
        Minor
      </span>
    </div>
  );
});

ScaleSlider.displayName = 'ScaleSlider';
