/**
 * notes.ts
 * ---------------------------------------------------------------------------
 * Music theory helpers: chromatic note table, frequency calculation,
 * Indian (Sargam) notation, scale definitions, and root/octave remapping.
 * Nothing in this file touches the DOM or Web Audio — pure data + math so it
 * can be unit tested / reused independently of React.
 */

export const CHROMATIC_NAMES = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
] as const;

export type ChromaticName = (typeof CHROMATIC_NAMES)[number];

// Sargam (Indian classical) equivalents for each of the 12 semitones.
// Komal (flat) swaras are marked with a small "b", tivra (sharp) Ma with "#".
export const SARGAM_NAMES = [
  'Sa', 'Re♭', 'Re', 'Ga♭', 'Ga', 'Ma', 'Ma♯', 'Pa', 'Dha♭', 'Dha', 'Ni♭', 'Ni',
] as const;

export type OctaveLabel = 'Low' | 'Middle' | 'High';

export const OCTAVE_MAP: Record<OctaveLabel, number> = {
  Low: 3,
  Middle: 4,
  High: 5,
};

export type ScaleName =
  | 'Chromatic'
  | 'Major'
  | 'Minor'
  | 'Pentatonic'
  | 'Indian';

// Semitone offsets (from the root) that belong to each scale.
export const SCALE_INTERVALS: Record<ScaleName, number[]> = {
  Chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  Major: [0, 2, 4, 5, 7, 9, 11],
  Minor: [0, 2, 3, 5, 7, 8, 10],
  Pentatonic: [0, 2, 4, 7, 9],
  // Sa Re Ga Ma Pa Dha Ni (Bilawal thaat — same intervals as Western major,
  // presented with Sargam labelling so it reads as its own musical mode).
  Indian: [0, 2, 4, 5, 7, 9, 11],
};

export type RootNote = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';

export const ROOT_NOTE_INDEX: Record<RootNote, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

export type SoundMode = 'Pure Tone' | 'Ambient Pad' | 'Soft Bell' | 'Sci-Fi Synth' | 'Indian Drone';

export const SOUND_MODES: SoundMode[] = [
  'Pure Tone',
  'Ambient Pad',
  'Soft Bell',
  'Sci-Fi Synth',
  'Indian Drone',
];

export interface NoteDefinition {
  id: string;
  chromaticIndex: number; // 0-11
  name: ChromaticName;
  sargam: string;
  frequency: number;
  octave: number;
  inScale: boolean;
}

/**
 * Frequency of a chromatic index at a given octave, referenced against
 * A4 = 440Hz (equal temperament, 12-TET).
 * chromaticIndex: 0 = C, 1 = C#, ... 11 = B
 */
export function frequencyFor(chromaticIndex: number, octave: number): number {
  const semitoneFromA4 = (chromaticIndex - 9) + (octave - 4) * 12;
  return 440 * Math.pow(2, semitoneFromA4 / 12);
}

/**
 * Builds the full 12-note chromatic ring, tagging which notes belong to the
 * currently selected scale/root so the UI can dim out-of-scale bubbles
 * instead of removing them (keeps the ring visually stable).
 */
export function buildNoteRing(
  scale: ScaleName,
  root: RootNote,
  octaveLabel: OctaveLabel,
): NoteDefinition[] {
  const octave = OCTAVE_MAP[octaveLabel];
  const rootIndex = ROOT_NOTE_INDEX[root];
  const intervals = SCALE_INTERVALS[scale];
  const scaleIndices = new Set(intervals.map((i) => (i + rootIndex) % 12));

  return CHROMATIC_NAMES.map((name, i) => ({
    id: `note-${i}`,
    chromaticIndex: i,
    name,
    sargam: SARGAM_NAMES[i],
    frequency: frequencyFor(i, octave),
    octave,
    inScale: scaleIndices.has(i),
  }));
}

/** Notes that should actually be playable/visible for the active scale. */
export function activeNotes(ring: NoteDefinition[], scale: ScaleName): NoteDefinition[] {
  if (scale === 'Chromatic') return ring;
  return ring.filter((n) => n.inScale);
}
