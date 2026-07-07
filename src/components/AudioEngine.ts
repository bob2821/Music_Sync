/**
 * AudioEngine.ts
 * ---------------------------------------------------------------------------
 * A reusable, dependency-free Web Audio engine for sustained, gesture-driven
 * musical notes. Designed so the render loop can call playNote/releaseNote
 * every frame without ever creating unbounded oscillators or audible clicks.
 *
 * Signal chain per note-voice:
 *   [layered oscillators] -> voiceGain (ADSR-ish envelope) -> sharedFilter
 *   sharedFilter -> dryGain ------------------------------------\
 *   sharedFilter -> delayNode <-> feedbackGain -> delayWetGain ---> mixBus -> panner -> compressor -> masterGain -> destination
 *   sharedFilter -> convolver -> reverbWetGain ------------------/
 *
 * Only one AudioContext is ever created, and only after `init()` is called
 * from a user gesture (click/tap), per browser autoplay policy.
 */

import type { SoundMode } from '../utils/notes';

interface OscillatorLayer {
  type: OscillatorType;
  freqMultiplier: number; // relative to the note's fundamental frequency
  detuneCents: number;
  gain: number; // relative mix level for this layer
  /** If set, this layer's own gain decays after this many ms (bell strike). */
  decayMs?: number;
}

interface WaveModeConfig {
  layers: OscillatorLayer[];
  attackMs: number;
  releaseMs: number;
  lfo?: { rate: number; depth: number; target: 'filter' | 'detune' };
}

const WAVE_MODE_CONFIG: Record<SoundMode, WaveModeConfig> = {
  'Pure Tone': {
    layers: [{ type: 'sine', freqMultiplier: 1, detuneCents: 0, gain: 1 }],
    attackMs: 90,
    releaseMs: 220,
  },
  'Ambient Pad': {
    layers: [
      { type: 'sine', freqMultiplier: 1, detuneCents: 0, gain: 0.7 },
      { type: 'triangle', freqMultiplier: 1, detuneCents: 6, gain: 0.45 },
      { type: 'triangle', freqMultiplier: 1, detuneCents: -6, gain: 0.45 },
      { type: 'sawtooth', freqMultiplier: 0.5, detuneCents: 0, gain: 0.08 },
    ],
    attackMs: 150,
    releaseMs: 400,
    lfo: { rate: 0.35, depth: 220, target: 'filter' },
  },
  'Soft Bell': {
    layers: [
      { type: 'sine', freqMultiplier: 1, detuneCents: 0, gain: 0.8 },
      { type: 'sine', freqMultiplier: 2.0, detuneCents: 0, gain: 0.35, decayMs: 700 },
      { type: 'triangle', freqMultiplier: 3.0, detuneCents: 0, gain: 0.15, decayMs: 450 },
    ],
    attackMs: 15,
    releaseMs: 350,
  },
  'Sci-Fi Synth': {
    layers: [
      { type: 'sawtooth', freqMultiplier: 1, detuneCents: -8, gain: 0.4 },
      { type: 'sawtooth', freqMultiplier: 1, detuneCents: 8, gain: 0.4 },
      { type: 'square', freqMultiplier: 1, detuneCents: 0, gain: 0.15 },
      { type: 'sine', freqMultiplier: 2, detuneCents: 0, gain: 0.1 },
    ],
    attackMs: 80,
    releaseMs: 260,
    lfo: { rate: 5.5, depth: 12, target: 'detune' },
  },
  'Indian Drone': {
    layers: [
      { type: 'sine', freqMultiplier: 1, detuneCents: 0, gain: 0.65 },
      { type: 'sine', freqMultiplier: 1.5, detuneCents: 0, gain: 0.25 }, // Pa drone (fifth)
      { type: 'triangle', freqMultiplier: 2, detuneCents: 3, gain: 0.12 },
    ],
    attackMs: 260,
    releaseMs: 550,
  },
};

interface Voice {
  oscillators: OscillatorNode[];
  layerGains: GainNode[];
  voiceGain: GainNode;
  lfo?: OscillatorNode;
  lfoGain?: GainNode;
  releasing: boolean;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  mode: SoundMode;
}

const MIN_GAIN = 0.0001; // exponentialRamp can't target exactly 0

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain!: GainNode;
  private sharedFilter!: BiquadFilterNode;
  private dryGain!: GainNode;
  private delayNode!: DelayNode;
  private delayFeedback!: GainNode;
  private delayWetGain!: GainNode;
  private convolver!: ConvolverNode;
  private reverbWetGain!: GainNode;
  private mixBus!: GainNode;
  private panner!: StereoPannerNode;
  private compressor!: DynamicsCompressorNode;

  private voices = new Map<string, Voice>();
  private waveMode: SoundMode = 'Ambient Pad';
  private ready = false;

  get isReady() {
    return this.ready;
  }

  get audioContext() {
    return this.ctx;
  }

  /** Must be called from within a user-gesture handler (click/tap). */
  async init(): Promise<void> {
    if (this.ready) return;
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new AC();
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    const ctx = this.ctx;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.8;

    this.sharedFilter = ctx.createBiquadFilter();
    this.sharedFilter.type = 'lowpass';
    this.sharedFilter.frequency.value = 6000;
    this.sharedFilter.Q.value = 0.4;

    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 0.85;

    this.delayNode = ctx.createDelay(2.0);
    this.delayNode.delayTime.value = 0.32;
    this.delayFeedback = ctx.createGain();
    this.delayFeedback.gain.value = 0.28;
    this.delayWetGain = ctx.createGain();
    this.delayWetGain.gain.value = 0.18;

    this.convolver = ctx.createConvolver();
    this.convolver.buffer = this.buildImpulseResponse(2.6, 3.2);
    this.reverbWetGain = ctx.createGain();
    this.reverbWetGain.gain.value = 0.25;

    this.mixBus = ctx.createGain();
    this.panner = ctx.createStereoPanner();

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 24;
    this.compressor.ratio.value = 6;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.25;

    // Wire the effects chain.
    this.sharedFilter.connect(this.dryGain).connect(this.mixBus);

    this.sharedFilter.connect(this.delayNode);
    this.delayNode.connect(this.delayFeedback).connect(this.delayNode); // feedback loop
    this.delayNode.connect(this.delayWetGain).connect(this.mixBus);

    this.sharedFilter.connect(this.convolver).connect(this.reverbWetGain).connect(this.mixBus);

    this.mixBus.connect(this.panner);
    this.panner.connect(this.compressor);
    this.compressor.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);

    this.ready = true;
  }

  /** Generates a synthetic reverb impulse (exponentially decaying noise). */
  private buildImpulseResponse(durationSec: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const rate = ctx.sampleRate;
    const length = Math.max(1, Math.floor(rate * durationSec));
    const buffer = ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return buffer;
  }

  setWaveMode(mode: SoundMode) {
    this.waveMode = mode;
  }

  setMasterVolume(value: number) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
    this.masterGain.gain.linearRampToValueAtTime(Math.max(MIN_GAIN, value), now + 0.05);
  }

  setReverbAmount(value: number) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.reverbWetGain.gain.cancelScheduledValues(now);
    this.reverbWetGain.gain.setValueAtTime(this.reverbWetGain.gain.value, now);
    this.reverbWetGain.gain.linearRampToValueAtTime(value, now + 0.08);
  }

  setDelayAmount(value: number) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.delayWetGain.gain.cancelScheduledValues(now);
    this.delayWetGain.gain.setValueAtTime(this.delayWetGain.gain.value, now);
    this.delayWetGain.gain.linearRampToValueAtTime(value, now + 0.08);
  }

  setFilterCutoff(value01: number) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    // Map normalized 0..1 to a musically useful 200Hz..12000Hz range (log feel).
    const hz = 200 * Math.pow(60, Math.max(0, Math.min(1, value01)));
    this.sharedFilter.frequency.cancelScheduledValues(now);
    this.sharedFilter.frequency.setValueAtTime(this.sharedFilter.frequency.value, now);
    this.sharedFilter.frequency.linearRampToValueAtTime(hz, now + 0.05);
  }

  /** Pan in [-1, 1]; used by Gesture Expression Mode (fingertip X). */
  setPan(value: number) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.panner.pan.cancelScheduledValues(now);
    this.panner.pan.setValueAtTime(this.panner.pan.value, now);
    this.panner.pan.linearRampToValueAtTime(Math.max(-1, Math.min(1, value)), now + 0.05);
  }

  /** Convenience batch setter for Gesture Expression Mode. */
  setGestureParams(params: { pan?: number; filterCutoff01?: number; reverb?: number; volume?: number }) {
    if (params.pan !== undefined) this.setPan(params.pan);
    if (params.filterCutoff01 !== undefined) this.setFilterCutoff(params.filterCutoff01);
    if (params.reverb !== undefined) this.setReverbAmount(params.reverb);
    if (params.volume !== undefined) this.setMasterVolume(params.volume);
  }

  /**
   * Starts (or sustains) a note. Safe to call every frame while hovering —
   * if the voice already exists and is sustaining, this is a no-op, so the
   * oscillator is never restarted/retriggered.
   */
  playNote(noteId: string, frequency: number) {
    if (!this.ctx || !this.ready) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const existing = this.voices.get(noteId);
    if (existing && !existing.releasing) {
      return; // already sustaining — do nothing, avoids retrigger clicks
    }
    if (existing && existing.releasing) {
      // Was fading out — cancel the release and glide back up smoothly.
      if (existing.cleanupTimer) clearTimeout(existing.cleanupTimer);
      existing.releasing = false;
      const g = existing.voiceGain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(1, now + 0.12);
      return;
    }

    const config = WAVE_MODE_CONFIG[this.waveMode];
    const voiceGain = ctx.createGain();
    voiceGain.gain.setValueAtTime(0, now);
    voiceGain.gain.linearRampToValueAtTime(1, now + config.attackMs / 1000);
    voiceGain.connect(this.sharedFilter);

    const oscillators: OscillatorNode[] = [];
    const layerGains: GainNode[] = [];

    for (const layer of config.layers) {
      const osc = ctx.createOscillator();
      osc.type = layer.type;
      osc.frequency.value = frequency * layer.freqMultiplier;
      osc.detune.value = layer.detuneCents;

      const layerGain = ctx.createGain();
      layerGain.gain.setValueAtTime(layer.gain, now);
      if (layer.decayMs) {
        // Bell-style partial: decays on its own even while the note sustains.
        layerGain.gain.exponentialRampToValueAtTime(
          Math.max(MIN_GAIN, layer.gain * 0.08),
          now + layer.decayMs / 1000,
        );
      }

      osc.connect(layerGain).connect(voiceGain);
      osc.start(now);
      oscillators.push(osc);
      layerGains.push(layerGain);
    }

    let lfo: OscillatorNode | undefined;
    let lfoGain: GainNode | undefined;
    if (config.lfo) {
      lfo = ctx.createOscillator();
      lfo.frequency.value = config.lfo.rate;
      lfoGain = ctx.createGain();
      lfoGain.gain.value = config.lfo.depth;
      lfo.connect(lfoGain);
      if (config.lfo.target === 'filter') {
        lfoGain.connect(this.sharedFilter.frequency);
      } else {
        for (const osc of oscillators) lfoGain.connect(osc.detune);
      }
      lfo.start(now);
    }

    this.voices.set(noteId, {
      oscillators,
      layerGains,
      voiceGain,
      lfo,
      lfoGain,
      releasing: false,
      cleanupTimer: null,
      mode: this.waveMode,
    });
  }

  /** Smoothly fades a note out and safely tears down its nodes. */
  releaseNote(noteId: string) {
    if (!this.ctx) return;
    const voice = this.voices.get(noteId);
    if (!voice || voice.releasing) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const config = WAVE_MODE_CONFIG[voice.mode];
    const releaseSec = config.releaseMs / 1000;

    voice.releasing = true;
    const g = voice.voiceGain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(g.value, MIN_GAIN), now);
    g.exponentialRampToValueAtTime(MIN_GAIN, now + releaseSec);

    voice.cleanupTimer = setTimeout(() => {
      this.teardownVoice(noteId);
    }, config.releaseMs + 60);
  }

  private teardownVoice(noteId: string) {
    const voice = this.voices.get(noteId);
    if (!voice) return;
    try {
      for (const osc of voice.oscillators) {
        osc.stop();
        osc.disconnect();
      }
      voice.lfo?.stop();
      voice.lfo?.disconnect();
      voice.lfoGain?.disconnect();
      for (const g of voice.layerGains) g.disconnect();
      voice.voiceGain.disconnect();
    } catch {
      // Node may already be stopped/disconnected — safe to ignore.
    }
    this.voices.delete(noteId);
  }

  releaseAll() {
    for (const id of Array.from(this.voices.keys())) {
      this.releaseNote(id);
    }
  }

  /** Currently sustaining (not releasing) note ids — useful for loop-lock UI. */
  getActiveNoteIds(): string[] {
    return Array.from(this.voices.entries())
      .filter(([, v]) => !v.releasing)
      .map(([id]) => id);
  }

  dispose() {
    this.releaseAll();
    this.ctx?.close();
  }
}
