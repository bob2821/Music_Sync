/**
 * DrumPanel.tsx
 * ---------------------------------------------------------------------------
 * Compact, collapsible control for the background drum/beat layer: pick a
 * beat type (or turn it off), adjust tempo, and mix the master beat volume
 * plus each drum voice (kick/snare/hi-hat) independently. Collapsed by
 * default so it stays out of the way of the main gesture-instrument UI;
 * expands into a small glass panel on click.
 */

import { useState } from 'react';
import { BEAT_PATTERN_NAMES, type BeatPatternName } from '../utils/drumPatterns';

interface DrumPanelProps {
  pattern: BeatPatternName;
  onPatternChange: (pattern: BeatPatternName) => void;
  bpm: number;
  onBpmChange: (bpm: number) => void;
  masterVolume: number;
  onMasterVolumeChange: (value: number) => void;
  kickVolume: number;
  onKickVolumeChange: (value: number) => void;
  snareVolume: number;
  onSnareVolumeChange: (value: number) => void;
  hihatVolume: number;
  onHihatVolumeChange: (value: number) => void;
}

export function DrumPanel({
  pattern,
  onPatternChange,
  bpm,
  onBpmChange,
  masterVolume,
  onMasterVolumeChange,
  kickVolume,
  onKickVolumeChange,
  snareVolume,
  onSnareVolumeChange,
  hihatVolume,
  onHihatVolumeChange,
}: DrumPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const isOn = pattern !== 'Off';

  return (
    <div className={`drum-panel glass-panel ${expanded ? 'drum-panel--expanded' : ''}`}>
      <button className="drum-panel-toggle" onClick={() => setExpanded((v) => !v)}>
        <span className={`drum-panel-dot ${isOn ? 'drum-panel-dot--on' : ''}`} />
        Beat {isOn ? `· ${pattern}` : ''}
        <span className="drum-panel-chevron">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="drum-panel-body">
          <span className="panel-label">Beat Type</span>
          <div className="chip-row">
            {BEAT_PATTERN_NAMES.map((name) => (
              <button
                key={name}
                className={`chip chip--small ${pattern === name ? 'chip--active' : ''}`}
                onClick={() => onPatternChange(name)}
              >
                {name}
              </button>
            ))}
          </div>

          <SliderRow label="Tempo" value={bpm} min={60} max={160} step={1} suffix=" BPM" onChange={onBpmChange} />
          <SliderRow
            label="Master Volume"
            value={Math.round(masterVolume * 100)}
            min={0}
            max={100}
            step={1}
            suffix="%"
            onChange={(v) => onMasterVolumeChange(v / 100)}
          />

          <div className="drum-panel-voice-grid">
            <SliderRow
              label="Kick"
              value={Math.round(kickVolume * 100)}
              min={0}
              max={100}
              step={1}
              suffix="%"
              onChange={(v) => onKickVolumeChange(v / 100)}
            />
            <SliderRow
              label="Snare"
              value={Math.round(snareVolume * 100)}
              min={0}
              max={100}
              step={1}
              suffix="%"
              onChange={(v) => onSnareVolumeChange(v / 100)}
            />
            <SliderRow
              label="Hi-Hat"
              value={Math.round(hihatVolume * 100)}
              min={0}
              max={100}
              step={1}
              suffix="%"
              onChange={(v) => onHihatVolumeChange(v / 100)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="drum-slider-row">
      <div className="drum-slider-label">
        <span>{label}</span>
        <span className="drum-slider-value">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        className="drum-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
