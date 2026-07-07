/**
 * RadialNoteController.tsx
 * ---------------------------------------------------------------------------
 * The note wheel: all 12 chromatic note bubbles arranged evenly around a
 * circle anchored to the left side of the screen (the left hand plays this
 * wheel; the right hand controls the Major/Minor slider on the right — see
 * ScaleSlider.tsx). Reports its own screen-space bubble layout to the parent
 * via `onLayout` whenever the viewport or note list changes, so the parent's
 * per-frame collision loop can compare the fingertip position against real
 * pixel coordinates.
 *
 * Bubble size is computed from the ring's circumference so that, at any
 * viewport size, all 12 bubbles stay evenly spaced with a guaranteed minimum
 * gap and never visually overlap. The reported hit-test `radius` always
 * matches what's actually drawn on screen, so hover feels precise instead of
 * "off".
 *
 * Visual state (idle/hover/active/locked) is driven by props that the parent
 * only updates when a note's state actually *changes* — not every frame —
 * so re-renders here stay infrequent even though hand tracking runs at 60fps.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { polarToCartesian } from '../utils/math';
import type { NoteDefinition } from '../utils/notes';

export interface NoteBubbleLayout {
  id: string;
  name: string;
  sargam: string;
  frequency: number;
  x: number; // viewport px
  y: number; // viewport px
  radius: number; // viewport px (hit-test radius, matches the drawn bubble)
}

export type NoteVisualState = 'idle' | 'dimmed' | 'hover' | 'active' | 'locked';

interface RadialNoteControllerProps {
  notes: NoteDefinition[];
  visualStates: Record<string, NoteVisualState>;
  rippleSignal: Record<string, number>;
  onLayout: (bubbles: NoteBubbleLayout[]) => void;
}

const MAX_DIAMETER = 78;
const MIN_DIAMETER = 46;
const MIN_GAP = 14; // guaranteed empty space between adjacent bubble edges

interface CircleLayout {
  cx: number;
  cy: number;
  radius: number;
  diameter: number; // bubble diameter
}

/** Position of the i-th of `count` bubbles evenly spaced around the ring. */
function bubblePosition(layout: CircleLayout, i: number, count: number) {
  const angle = (360 / Math.max(count, 1)) * i;
  return polarToCartesian(layout.cx, layout.cy, layout.radius, angle);
}

/**
 * Computes the wheel's screen position/size, anchored to the left side of
 * the viewport, clear of the top HUD and bottom control panels. Bubble
 * diameter adapts to the ring's circumference so `count` bubbles never
 * overlap.
 */
function computeLayout(vw: number, vh: number, count: number): CircleLayout {
  const cx = Math.min(vw * 0.4, 520);
  const cy = vh * 0.52;
  const radius = Math.max(115, Math.min(vw * 0.18, vh * 0.27, 195));

  const circumference = 2 * Math.PI * radius;
  const arcSpacing = circumference / Math.max(count, 1);
  const diameter = Math.min(MAX_DIAMETER, Math.max(MIN_DIAMETER, arcSpacing - MIN_GAP));

  return { cx, cy, radius, diameter };
}

export function RadialNoteController({ notes, visualStates, rippleSignal, onLayout }: RadialNoteControllerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<CircleLayout | null>(null);

  const count = notes.length;

  // Recompute the wheel's position/size on mount, on resize, and whenever the
  // number of notes changes.
  useLayoutEffect(() => {
    function recompute() {
      setLayout(computeLayout(window.innerWidth, window.innerHeight, count));
    }
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, [count]);

  // Whenever layout or the note list changes, publish bubble screen coords upward.
  useEffect(() => {
    if (!layout) return;
    const radius = layout.diameter / 2;
    const bubbles: NoteBubbleLayout[] = notes.map((note, i) => {
      const { x, y } = bubblePosition(layout, i, count);
      return {
        id: note.id,
        name: note.name,
        sargam: note.sargam,
        frequency: note.frequency,
        x,
        y,
        radius,
      };
    });
    onLayout(bubbles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, notes]);

  if (!layout) return null;

  const scaleFactor = layout.diameter / MAX_DIAMETER;
  const nameFontSize = 0.72 + 0.32 * scaleFactor; // rem
  const sargamFontSize = 0.46 + 0.22 * scaleFactor; // rem

  return (
    <div ref={containerRef} className="radial-controller" aria-hidden="true">
      <div
        className="note-wheel-glow"
        style={{
          left: layout.cx,
          top: layout.cy,
          width: (layout.radius + layout.diameter / 2) * 2,
          height: (layout.radius + layout.diameter / 2) * 2,
        }}
      />
      <div
        className="note-wheel-ring"
        style={{
          left: layout.cx,
          top: layout.cy,
          width: layout.radius * 2,
          height: layout.radius * 2,
        }}
      />
      {notes.map((note, i) => {
        const { x, y } = bubblePosition(layout, i, count);
        const state = visualStates[note.id] ?? 'idle';
        const ripple = rippleSignal[note.id] ?? 0;
        return (
          <div
            key={note.id}
            className={`note-bubble note-bubble--${state}`}
            style={{
              left: x,
              top: y,
              width: layout.diameter,
              height: layout.diameter,
            }}
          >
            {ripple > 0 && <span key={ripple} className="note-bubble-ripple" />}
            <span className="note-bubble-name" style={{ fontSize: `${nameFontSize}rem` }}>
              {note.name}
            </span>
            <span className="note-bubble-sargam" style={{ fontSize: `${sargamFontSize}rem` }}>
              {note.sargam}
            </span>
          </div>
        );
      })}
    </div>
  );
}
