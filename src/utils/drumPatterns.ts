/**
 * drumPatterns.ts
 * ---------------------------------------------------------------------------
 * Data-only definitions for the background drum/beat layer: a handful of
 * musically distinct 16-step patterns (kick / snare / hi-hat) plus a default
 * tempo and swing amount for each. Pure data — no Web Audio or React here —
 * so it's easy to read, tweak, or extend with new genres.
 *
 * hihat step values: 0 = silent, 1 = closed hat, 2 = open hat (longer decay).
 * kick/snare step values: 0 = silent, 1 = hit.
 * swing: fraction of a 16th-note step that odd-numbered steps are delayed by,
 * giving a laid-back "human" groove instead of a rigid grid (used by
 * Hip-Hop and Lo-Fi below).
 */

export type BeatPatternName = 'Off' | 'Basic Rock' | 'Hip-Hop' | 'House' | 'Lo-Fi';

export const BEAT_PATTERN_NAMES: BeatPatternName[] = ['Off', 'Basic Rock', 'Hip-Hop', 'House', 'Lo-Fi'];

export interface DrumPattern {
  bpm: number;
  swing: number;
  kick: number[];
  snare: number[];
  hihat: number[];
}

export const DRUM_PATTERNS: Record<Exclude<BeatPatternName, 'Off'>, DrumPattern> = {
  'Basic Rock': {
    bpm: 112,
    swing: 0,
    kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hihat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
  },
  'Hip-Hop': {
    bpm: 92,
    swing: 0.12,
    kick: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hihat: [1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0],
  },
  House: {
    bpm: 124,
    swing: 0,
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hihat: [0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0],
  },
  'Lo-Fi': {
    bpm: 78,
    swing: 0.15,
    kick: [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hihat: [1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0],
  },
};

export const STEPS_PER_PATTERN = 16;
