/**
 * ControlsPanel.tsx
 * ---------------------------------------------------------------------------
 * Bottom-left: sound mode selector. Bottom-right: scale / root / octave /
 * interaction-mode controls. Pure, low-frequency-update UI — everything here
 * only re-renders on explicit user interaction, never on the hand-tracking
 * render loop.
 */

import type { OctaveLabel, RootNote, ScaleName, SoundMode } from '../utils/notes';
import { OCTAVE_MAP, ROOT_NOTE_INDEX, SCALE_INTERVALS, SOUND_MODES } from '../utils/notes';

export type InteractionMode = 'Single Note' | 'Multi Note Loop' | 'Gesture Expression';

const SCALE_NAMES = Object.keys(SCALE_INTERVALS) as ScaleName[];
const ROOT_NAMES = Object.keys(ROOT_NOTE_INDEX) as RootNote[];
const OCTAVE_NAMES = Object.keys(OCTAVE_MAP) as OctaveLabel[];
const INTERACTION_MODES: InteractionMode[] = ['Single Note', 'Multi Note Loop', 'Gesture Expression'];

interface ControlsPanelProps {
  soundMode: SoundMode;
  onSoundModeChange: (mode: SoundMode) => void;
  scale: ScaleName;
  onScaleChange: (scale: ScaleName) => void;
  root: RootNote;
  onRootChange: (root: RootNote) => void;
  octave: OctaveLabel;
  onOctaveChange: (octave: OctaveLabel) => void;
  interactionMode: InteractionMode;
  onInteractionModeChange: (mode: InteractionMode) => void;
  lockedCount: number;
  onClearLoops: () => void;
}

export function ControlsPanel({
  soundMode,
  onSoundModeChange,
  scale,
  onScaleChange,
  root,
  onRootChange,
  octave,
  onOctaveChange,
  interactionMode,
  onInteractionModeChange,
  lockedCount,
  onClearLoops,
}: ControlsPanelProps) {
  return (
    <>
      <div className="panel panel-bottom-left glass-panel">
        <span className="panel-label">Sound Mode</span>
        <div className="chip-row">
          {SOUND_MODES.map((mode) => (
            <button
              key={mode}
              className={`chip ${soundMode === mode ? 'chip--active' : ''}`}
              onClick={() => onSoundModeChange(mode)}
            >
              {mode}
            </button>
          ))}
        </div>

        <span className="panel-label">Interaction Mode</span>
        <div className="chip-row">
          {INTERACTION_MODES.map((mode) => (
            <button
              key={mode}
              className={`chip ${interactionMode === mode ? 'chip--active' : ''}`}
              onClick={() => onInteractionModeChange(mode)}
            >
              {mode}
            </button>
          ))}
        </div>
        {interactionMode === 'Multi Note Loop' && (
          <button className="chip chip--warning" onClick={onClearLoops}>
            Clear Loops {lockedCount > 0 ? `(${lockedCount})` : ''}
          </button>
        )}
      </div>

      <div className="panel panel-bottom-right glass-panel">
        <span className="panel-label">Scale</span>
        <div className="chip-row">
          {SCALE_NAMES.map((s) => (
            <button
              key={s}
              className={`chip ${scale === s ? 'chip--active' : ''}`}
              onClick={() => onScaleChange(s)}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="chip-row-split">
          <div>
            <span className="panel-label">Root</span>
            <div className="chip-row">
              {ROOT_NAMES.map((r) => (
                <button
                  key={r}
                  className={`chip chip--small ${root === r ? 'chip--active' : ''}`}
                  onClick={() => onRootChange(r)}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="panel-label">Octave</span>
            <div className="chip-row">
              {OCTAVE_NAMES.map((o) => (
                <button
                  key={o}
                  className={`chip chip--small ${octave === o ? 'chip--active' : ''}`}
                  onClick={() => onOctaveChange(o)}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
