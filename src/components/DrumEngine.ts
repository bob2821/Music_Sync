/**
 * DrumEngine.ts
 * ---------------------------------------------------------------------------
 * A self-contained, sample-free drum machine that runs *alongside* the note
 * AudioEngine (it does not touch or depend on it, beyond sharing the same
 * AudioContext). Kick/snare/hi-hat sounds are synthesized from oscillators
 * and filtered noise, precision-scheduled using the standard "lookahead
 * scheduler" technique so the beat stays rock-solid in time even though the
 * browser's setInterval/setTimeout timers are not sample-accurate.
 *
 * Every voice (kick/snare/hi-hat) has its own gain node so it can be mixed
 * independently, plus a master gain for the whole drum bus and a limiter so
 * overlapping hits (e.g. kick + hi-hat on the downbeat) never clip.
 */

import { DRUM_PATTERNS, STEPS_PER_PATTERN, type BeatPatternName, type DrumPattern } from '../utils/drumPatterns';

const SCHEDULE_INTERVAL_MS = 25; // how often the lookahead timer wakes up
const LOOKAHEAD_SEC = 0.12; // how far ahead of "now" we're allowed to schedule
const PARAM_SMOOTH_SEC = 0.015; // fader smoothing time constant (no zipper noise)

export type DrumVoice = 'kick' | 'snare' | 'hihat';

export class DrumEngine {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private drumMaster!: GainNode;
  private limiter!: DynamicsCompressorNode;
  private kickGain!: GainNode;
  private snareGain!: GainNode;
  private hihatGain!: GainNode;

  private pattern: DrumPattern | null = null;
  private bpm = 100;
  private swing = 0;

  private timerId: ReturnType<typeof setInterval> | null = null;
  private currentStep = 0;
  private nextStepTime = 0;
  private playing = false;

  get isPlaying() {
    return this.playing;
  }

  async init(ctx: AudioContext) {
    if (this.ctx) return; // already initialized (reuses the AudioEngine's context)
    this.ctx = ctx;

    this.drumMaster = ctx.createGain();
    this.drumMaster.gain.value = 0.8;

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -14;
    this.limiter.knee.value = 18;
    this.limiter.ratio.value = 8;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.18;

    this.kickGain = ctx.createGain();
    this.kickGain.gain.value = 0.9;
    this.snareGain = ctx.createGain();
    this.snareGain.gain.value = 0.75;
    this.hihatGain = ctx.createGain();
    this.hihatGain.gain.value = 0.55;

    this.kickGain.connect(this.drumMaster);
    this.snareGain.connect(this.drumMaster);
    this.hihatGain.connect(this.drumMaster);
    this.drumMaster.connect(this.limiter);
    this.limiter.connect(ctx.destination);

    this.noiseBuffer = this.buildNoiseBuffer();
  }

  private buildNoiseBuffer(): AudioBuffer {
    const ctx = this.ctx!;
    const length = ctx.sampleRate; // 1 second of white noise, reused per-hit as short grains
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  setPattern(name: BeatPatternName) {
    if (name === 'Off') {
      this.pattern = null;
      this.stop();
      return;
    }
    this.pattern = DRUM_PATTERNS[name];
    this.bpm = this.pattern.bpm;
    this.swing = this.pattern.swing;
    if (!this.playing) this.start();
  }

  setBpm(bpm: number) {
    this.bpm = Math.max(40, Math.min(220, bpm));
  }

  setMasterVolume(value01: number) {
    if (!this.ctx) return;
    this.drumMaster.gain.setTargetAtTime(value01, this.ctx.currentTime, PARAM_SMOOTH_SEC);
  }

  setVoiceVolume(voice: DrumVoice, value01: number) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const node = voice === 'kick' ? this.kickGain : voice === 'snare' ? this.snareGain : this.hihatGain;
    node.gain.setTargetAtTime(value01, now, PARAM_SMOOTH_SEC);
  }

  start() {
    if (!this.ctx || this.playing || !this.pattern) return;
    this.playing = true;
    this.currentStep = 0;
    this.nextStepTime = this.ctx.currentTime + 0.05;
    this.timerId = setInterval(() => this.scheduler(), SCHEDULE_INTERVAL_MS);
  }

  stop() {
    this.playing = false;
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private secondsPerStep() {
    // 16 steps per pattern, 4 steps per beat (16th notes).
    return 60 / this.bpm / 4;
  }

  private scheduler() {
    if (!this.ctx || !this.pattern) return;
    while (this.nextStepTime < this.ctx.currentTime + LOOKAHEAD_SEC) {
      this.scheduleStep(this.currentStep, this.nextStepTime);
      this.nextStepTime += this.secondsPerStep();
      this.currentStep = (this.currentStep + 1) % STEPS_PER_PATTERN;
    }
  }

  private scheduleStep(step: number, time: number) {
    const pattern = this.pattern!;
    const swingTime = step % 2 === 1 ? time + this.swing * this.secondsPerStep() : time;

    if (pattern.kick[step]) this.triggerKick(swingTime);
    if (pattern.snare[step]) this.triggerSnare(swingTime);
    const hat = pattern.hihat[step];
    if (hat === 1) this.triggerHiHat(swingTime, false);
    else if (hat === 2) this.triggerHiHat(swingTime, true);
  }

  // ---- Synthesized voices --------------------------------------------------

  private triggerKick(time: number) {
    const ctx = this.ctx!;

    // Pitched body: sine sweeping down from ~150Hz to ~45Hz for punch + thump.
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.14);

    const ampEnv = ctx.createGain();
    ampEnv.gain.setValueAtTime(0.0001, time);
    ampEnv.gain.exponentialRampToValueAtTime(1, time + 0.004);
    ampEnv.gain.exponentialRampToValueAtTime(0.001, time + 0.24);

    osc.connect(ampEnv).connect(this.kickGain);
    osc.start(time);
    osc.stop(time + 0.26);

    // Click transient: a tiny burst of high-passed noise for attack/definition
    // so the kick reads as crisp rather than a dull, muddy thump.
    const click = ctx.createBufferSource();
    click.buffer = this.noiseBuffer;
    const clickFilter = ctx.createBiquadFilter();
    clickFilter.type = 'highpass';
    clickFilter.frequency.value = 1500;
    const clickEnv = ctx.createGain();
    clickEnv.gain.setValueAtTime(0.28, time);
    clickEnv.gain.exponentialRampToValueAtTime(0.001, time + 0.006);

    click.connect(clickFilter).connect(clickEnv).connect(this.kickGain);
    click.start(time);
    click.stop(time + 0.01);
  }

  private triggerSnare(time: number) {
    const ctx = this.ctx!;

    // Body tone.
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 190;
    const toneEnv = ctx.createGain();
    toneEnv.gain.setValueAtTime(0.35, time);
    toneEnv.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
    osc.connect(toneEnv).connect(this.snareGain);
    osc.start(time);
    osc.stop(time + 0.13);

    // Noise snap.
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 1200;
    const noiseEnv = ctx.createGain();
    noiseEnv.gain.setValueAtTime(0.7, time);
    noiseEnv.gain.exponentialRampToValueAtTime(0.001, time + 0.16);

    noise.connect(noiseFilter).connect(noiseEnv).connect(this.snareGain);
    noise.start(time);
    noise.stop(time + 0.18);
  }

  private triggerHiHat(time: number, open: boolean) {
    const ctx = this.ctx!;
    const decay = open ? 0.32 : 0.055;

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;

    // Two chained highpass stages for a steeper slope -> a tighter, more
    // metallic/clear hat instead of a hissy, muddy one.
    const hp1 = ctx.createBiquadFilter();
    hp1.type = 'highpass';
    hp1.frequency.value = 7000;
    const hp2 = ctx.createBiquadFilter();
    hp2.type = 'highpass';
    hp2.frequency.value = 8500;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.001, time);
    env.gain.exponentialRampToValueAtTime(0.6, time + 0.002);
    env.gain.exponentialRampToValueAtTime(0.001, time + decay);

    noise.connect(hp1).connect(hp2).connect(env).connect(this.hihatGain);
    noise.start(time);
    noise.stop(time + decay + 0.02);
  }

  dispose() {
    this.stop();
  }
}
