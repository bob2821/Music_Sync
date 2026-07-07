/**
 * RadialNoteController.tsx
 * ---------------------------------------------------------------------------
 * The note controller: chromatic note bubbles (or a scale subset highlighted)
 * arranged along a single, gently curved line across the lower part of the
 * screen — easier to sweep a fingertip across than a full circle. Reports its
 * own screen-space bubble layout to the parent via `onLayout` whenever the
 * viewport or note list changes, so the parent's per-frame collision loop can
 * compare the fingertip position against real pixel coordinates.
 *
 * Bubble size and spacing are computed together (not fixed constants) so
 * that, at any viewport width and any note count (5-12 depending on scale),
 * bubbles are always evenly spaced with a guaranteed minimum gap and never
 * visually overlap. The reported hit-test `radius` always matches what's
 * actually drawn on screen, so hover feels precise instead of "off".
 *
 * Visual state (idle/hover/active/locked) is driven by props that the parent
 * only updates when a note's state actually *changes* — not every frame —
 * so re-renders here stay infrequent even though hand tracking runs at 60fps.
 *
 * (Component/prop names kept as "RadialNoteController"/"NoteBubbleLayout" for
 * compatibility with the rest of the app, even though the layout is now a
 * gently bowed line rather than a circle.)
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

const MAX_DIAMETER = 84;
const MIN_DIAMETER = 50;
const MIN_GAP = 16; // guaranteed empty space between adjacent bubble edges
// How much the line bows upward in the middle. 0 = perfectly straight line.
const CURVE_HEIGHT = 40;

interface LineLayout {
  baselineY: number;
  startX: number;
  totalWidth: number;
  diameter: number;
}

/** Position of the i-th of `count` bubbles along the gently curved line. */
function bubblePosition(layout: LineLayout, i: number, count: number) {
  const t = count > 1 ? i / (count - 1) : 0.5;
  const x = layout.startX + layout.totalWidth * t;
  // A shallow arc (sine bow) peaking at the center — a "little curved
  // straight line" rather than a full circle.
  const y = layout.baselineY - CURVE_HEIGHT * Math.sin(Math.PI * t);
  return { x, y };
}

/**
 * Computes a line layout (position + bubble size) that always keeps bubbles
 * evenly spaced with at least MIN_GAP between edges, regardless of viewport
 * width or how many notes are shown.
 */
function computeLayout(vw: number, vh: number, count: number): LineLayout {
  const baseTotalWidth = Math.min(vw * 0.86, 1180);
  const safeCount = Math.max(count, 1);

  // Width needed to fit `count` bubbles at the minimum readable size.
  const minRequiredWidth = safeCount > 1 ? (safeCount - 1) * (MIN_DIAMETER + MIN_GAP) : MIN_DIAMETER;
  const totalWidth = Math.min(Math.max(baseTotalWidth, minRequiredWidth), vw * 0.96);

  const spacing = safeCount > 1 ? totalWidth / (safeCount - 1) : totalWidth;
  const diameter = Math.min(MAX_DIAMETER, Math.max(MIN_DIAMETER, spacing - MIN_GAP));

  return {
    // Kept well clear of the bottom-left/bottom-right control panels so the
    // note bubbles never overlap them, even on shorter viewports.
    baselineY: vh - Math.min(vh * 0.3, 250),
    startX: (vw - totalWidth) / 2,
    totalWidth,
    diameter,
  };
}

export function RadialNoteController({ notes, visualStates, rippleSignal, onLayout }: RadialNoteControllerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<LineLayout | null>(null);

  const count = notes.length;

  // Recompute the line's position/width/bubble-size on mount, on resize, and
  // whenever the number of visible notes changes (e.g. switching scales).
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

  const scale = layout.diameter / MAX_DIAMETER;
  const nameFontSize = 0.78 + 0.32 * scale; // rem
  const sargamFontSize = 0.5 + 0.22 * scale; // rem

  return (
    <div ref={containerRef} className="radial-controller" aria-hidden="true">
      <div
        className="radial-controller-line-glow"
        style={{
          left: layout.startX - layout.diameter / 2,
          top: layout.baselineY - CURVE_HEIGHT - layout.diameter / 2,
          width: layout.totalWidth + layout.diameter,
          height: CURVE_HEIGHT * 2 + layout.diameter,
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
