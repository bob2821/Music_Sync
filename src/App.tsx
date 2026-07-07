/**
 * App.tsx
 * ---------------------------------------------------------------------------
 * Top-level app shell and the central real-time loop. Ties together:
 *   CameraFeed (video) -> HandTracker (MediaPipe landmarks, up to 2 hands)
 *   -> collision detection against RadialNoteController's bubble layout
 *   -> AudioEngine (sustained note playback)
 *   -> FingerCursor + bubble visual states (DOM-direct where per-frame,
 *      React state only where changes are infrequent).
 *
 * Two-hand model: whichever detected hand is furthest LEFT on screen plays
 * the note wheel (left circle); whichever is furthest RIGHT drives the
 * Major/Minor slider. Roles are assigned by on-screen position every frame,
 * not by MediaPipe's mirror-sensitive "handedness" label, so it always
 * matches what the user sees. With only one hand visible, that hand plays
 * notes and the scale slider simply freezes at its last value.
 *
 * Design principle: the hand-tracking callback fires ~30-60x/sec. Only a
 * ref-driven rAF loop touches that data every frame. React state is only
 * set when a *discrete* event happens (note starts/stops, hand appears/
 * disappears, mode changes) — never unconditionally inside the loop.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraFeed } from './components/CameraFeed';
import { HandTracker, type HandFrameResult } from './components/HandTracker';
import { RadialNoteController, type NoteBubbleLayout, type NoteVisualState } from './components/RadialNoteController';
import { FingerCursor, type FingerCursorHandle } from './components/FingerCursor';
import { ScaleSlider, type ScaleSliderHandle, type ScaleTrackLayout } from './components/ScaleSlider';
import { ControlsPanel, type InteractionMode } from './components/ControlsPanel';
import { DrumPanel } from './components/DrumPanel';
import { AudioEngine } from './components/AudioEngine';
import { DrumEngine } from './components/DrumEngine';
import { buildNoteRing, type OctaveLabel, type RootNote, type ScaleName, type SoundMode } from './utils/notes';
import type { BeatPatternName } from './utils/drumPatterns';
import { SmoothedPoint2D, HoverStabilityTimer, distance, clamp } from './utils/math';

type AppPhase = 'onboarding' | 'camera-denied' | 'model-error' | 'active';
type ModelStatus = 'loading' | 'ready' | 'error';

const MIN_HOVER_MS = 90; // 80-120ms stability window before a note activates
const LOCK_HOLD_MS = 850; // hold duration to toggle a loop-lock in Multi mode
const PINCH_LOCK_THRESHOLD = 0.045; // normalized thumb-index distance
const ENTER_RADIUS_FACTOR = 0.9; // hysteresis: harder to enter...
const EXIT_RADIUS_FACTOR = 1.4; //            ...easier to stay once entered
const SCALE_SLIDER_HYSTERESIS = 0.06; // fraction of track height around the midpoint
const HAND_MISSING_GRACE_FRAMES = 5; // bridge brief tracking dropouts (~80ms@60fps) so one missed frame doesn't cut audio or flicker the HUD
const SCALE_HAND_CONFIRM_FRAMES = 4; // require a few consecutive frames before trusting a newly-appeared second hand (filters one-frame ghost detections)
const CURSOR_SMOOTHING = 0.4; // exponential smoothing for the note-hand cursor (lower = smoother, less jittery)
const SCALE_SLIDER_SMOOTHING = 0.3; // exponential smoothing for the scale hand's slider position

export default function App() {
  const [phase, setPhase] = useState<AppPhase>('onboarding');
  const [modelStatus, setModelStatus] = useState<ModelStatus>('loading');
  const [cameraReady, setCameraReady] = useState(false);
  const [noteHandDetected, setNoteHandDetected] = useState(false);
  const [scaleHandDetected, setScaleHandDetected] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [soundMode, setSoundMode] = useState<SoundMode>('Ambient Pad');
  const [scale, setScale] = useState<ScaleName>('Major');
  const [root, setRoot] = useState<RootNote>('C');
  const [octave, setOctave] = useState<OctaveLabel>('Middle');
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('Single Note');

  // Background drum/beat layer — independent of the gesture instrument above.
  const [beatPattern, setBeatPattern] = useState<BeatPatternName>('Off');
  const [beatBpm, setBeatBpm] = useState(112);
  const [beatMasterVolume, setBeatMasterVolume] = useState(0.7);
  const [kickVolume, setKickVolume] = useState(0.9);
  const [snareVolume, setSnareVolume] = useState(0.75);
  const [hihatVolume, setHihatVolume] = useState(0.55);

  const [visualStates, setVisualStates] = useState<Record<string, NoteVisualState>>({});
  const [rippleSignal, setRippleSignal] = useState<Record<string, number>>({});
  const [currentNoteLabel, setCurrentNoteLabel] = useState<string>('');
  const [lockedCount, setLockedCount] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cursorHandleRef = useRef<FingerCursorHandle | null>(null);
  const scaleSliderHandleRef = useRef<ScaleSliderHandle | null>(null);
  const audioEngineRef = useRef<AudioEngine>(new AudioEngine());
  const drumEngineRef = useRef<DrumEngine>(new DrumEngine());
  const fpsLabelRef = useRef<HTMLSpanElement | null>(null);

  // High-frequency data lives in refs, never in React state.
  const latestHandsRef = useRef<HandFrameResult[]>([]);
  const bubblesRef = useRef<NoteBubbleLayout[]>([]);
  const scaleTrackLayoutRef = useRef<ScaleTrackLayout | null>(null);
  const lastScaleTargetRef = useRef<'Major' | 'Minor'>('Major');
  const smoothedCursor = useRef(new SmoothedPoint2D(CURSOR_SMOOTHING));
  const smoothedScaleY = useRef(new SmoothedPoint2D(SCALE_SLIDER_SMOOTHING));
  const hoverStability = useRef(new HoverStabilityTimer());
  const lockHoldTimers = useRef<Map<string, number>>(new Map());
  const lockedNotesRef = useRef<Set<string>>(new Set());
  const singleActiveIdRef = useRef<string | null>(null);
  const prevVisualStatesRef = useRef<Record<string, NoteVisualState>>({});
  const prevNoteHandDetectedRef = useRef(false);
  const prevScaleHandDetectedRef = useRef(false);
  const wasNoteHandPresentLastFrameRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const frameCountRef = useRef(0);
  const fpsWindowStartRef = useRef(performance.now());
  const pinchWasLockedRef = useRef<Set<string>>(new Set());
  // Role-assignment stability: instead of blindly re-sorting hands by x every
  // frame (which flickers/swaps roles when hands cross or a detection jitters
  // near the midline), each role sticks to whichever detected hand is closest
  // to its own last known position. Brief tracking dropouts are bridged via
  // the last-known hand rather than instantly treated as "gone".
  const noteHandMissingStreakRef = useRef(0);
  const scaleHandMissingStreakRef = useRef(0);
  const scaleHandPresentStreakRef = useRef(0);
  const lastKnownNoteHandRef = useRef<HandFrameResult | null>(null);
  const lastKnownScaleHandRef = useRef<HandFrameResult | null>(null);
  const lastNoteHandXRef = useRef<number | null>(null);
  const lastScaleHandXRef = useRef<number | null>(null);

  // The wheel always shows all 12 chromatic notes — Major/Minor no longer
  // filters or dims the wheel, it's purely the right-hand slider's value.
  const noteRing = buildNoteRing(scale, root, octave);
  const notes = noteRing;
  const notesRef = useRef(notes);
  notesRef.current = notes;

  const interactionModeRef = useRef(interactionMode);
  interactionModeRef.current = interactionMode;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  const handleLayout = useCallback((bubbles: NoteBubbleLayout[]) => {
    bubblesRef.current = bubbles;
  }, []);

  const handleScaleTrackLayout = useCallback((layout: ScaleTrackLayout) => {
    scaleTrackLayoutRef.current = layout;
  }, []);

  const releaseSingleActive = useCallback(() => {
    const id = singleActiveIdRef.current;
    if (id) {
      audioEngineRef.current.releaseNote(id);
      singleActiveIdRef.current = null;
    }
  }, []);

  const clearAllLoops = useCallback(() => {
    for (const id of lockedNotesRef.current) {
      audioEngineRef.current.releaseNote(id);
    }
    lockedNotesRef.current.clear();
    setLockedCount(0);
  }, []);

  // ---- Onboarding actions -------------------------------------------------
  const handleStart = useCallback(async () => {
    setErrorMessage(null);
    await audioEngineRef.current.init();
    const ctx = audioEngineRef.current.audioContext;
    if (ctx) {
      await drumEngineRef.current.init(ctx);
      drumEngineRef.current.setMasterVolume(beatMasterVolume);
      drumEngineRef.current.setVoiceVolume('kick', kickVolume);
      drumEngineRef.current.setVoiceVolume('snare', snareVolume);
      drumEngineRef.current.setVoiceVolume('hihat', hihatVolume);
    }
    setAudioReady(true);
    setPhase('active');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCameraReady = useCallback((video: HTMLVideoElement) => {
    videoRef.current = video;
    setCameraReady(true);
  }, []);

  const handleCameraError = useCallback((message: string) => {
    setErrorMessage(message);
    setPhase('camera-denied');
  }, []);

  const handleModelStatus = useCallback((status: ModelStatus) => {
    setModelStatus(status);
    if (status === 'error') setPhase('model-error');
  }, []);

  // ---- Per-frame hand results (called by HandTracker, ~video framerate) ---
  const handleHandResult = useCallback((hands: HandFrameResult[]) => {
    latestHandsRef.current = hands;
  }, []);

  // ---- The core render/interaction loop (runs continuously once active) --
  useEffect(() => {
    if (phase !== 'active') return;

    const engine = audioEngineRef.current;

    const applyVisualStateDiffs = (next: Record<string, NoteVisualState>) => {
      const prev = prevVisualStatesRef.current;
      let changed = false;
      for (const id of Object.keys(next)) {
        if (prev[id] !== next[id]) {
          changed = true;
          break;
        }
      }
      if (!changed) {
        for (const id of Object.keys(prev)) {
          if (!(id in next)) {
            changed = true;
            break;
          }
        }
      }
      if (changed) {
        prevVisualStatesRef.current = next;
        setVisualStates(next);
      }
    };

    const triggerRipple = (id: string) => {
      setRippleSignal((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
    };

    const loop = () => {
      const now = performance.now();
      frameCountRef.current++;
      if (now - fpsWindowStartRef.current > 500) {
        const fps = Math.round((frameCountRef.current * 1000) / (now - fpsWindowStartRef.current));
        if (fpsLabelRef.current) fpsLabelRef.current.textContent = `${fps} FPS`;
        frameCountRef.current = 0;
        fpsWindowStartRef.current = now;
      }

      const hands = latestHandsRef.current;
      const bubbles = bubblesRef.current;
      const mode = interactionModeRef.current;

      // ---- Assign roles by on-screen position: leftmost hand plays notes,
      // rightmost drives the scale slider. One hand alone always plays notes.
      // Roles stick to their previous position rather than a blind left/right
      // re-sort every frame, so a momentary crossing or jitter near the
      // midline can't swap which hand controls what. Short dropouts (a hand
      // vanishing for a frame or two) are bridged with its last known data so
      // a single missed detection doesn't glitch the note or HUD.
      let rawNoteHand: HandFrameResult | null = null;
      let rawScaleHand: HandFrameResult | null = null;

      if (hands.length === 1) {
        rawNoteHand = hands[0];
      } else if (hands.length >= 2) {
        const sorted = [...hands].sort((a, b) => a.indexTip.x - b.indexTip.x);
        const left = sorted[0];
        const right = sorted[sorted.length - 1];
        if (lastNoteHandXRef.current !== null && lastScaleHandXRef.current !== null) {
          const leftToNote = Math.abs(left.indexTip.x - lastNoteHandXRef.current);
          const rightToNote = Math.abs(right.indexTip.x - lastNoteHandXRef.current);
          if (leftToNote <= rightToNote) {
            rawNoteHand = left;
            rawScaleHand = right;
          } else {
            rawNoteHand = right;
            rawScaleHand = left;
          }
        } else {
          rawNoteHand = left;
          rawScaleHand = right;
        }
      }

      if (rawNoteHand) {
        noteHandMissingStreakRef.current = 0;
        lastKnownNoteHandRef.current = rawNoteHand;
        lastNoteHandXRef.current = rawNoteHand.indexTip.x;
      } else {
        noteHandMissingStreakRef.current++;
      }
      const noteHand =
        rawNoteHand ??
        (noteHandMissingStreakRef.current <= HAND_MISSING_GRACE_FRAMES ? lastKnownNoteHandRef.current : null);
      if (!noteHand) {
        lastKnownNoteHandRef.current = null;
        lastNoteHandXRef.current = null;
      }

      if (rawScaleHand) {
        scaleHandPresentStreakRef.current++;
        scaleHandMissingStreakRef.current = 0;
        lastKnownScaleHandRef.current = rawScaleHand;
        lastScaleHandXRef.current = rawScaleHand.indexTip.x;
      } else {
        scaleHandPresentStreakRef.current = 0;
        scaleHandMissingStreakRef.current++;
      }
      const scaleHandConfirmed = scaleHandPresentStreakRef.current >= SCALE_HAND_CONFIRM_FRAMES;
      const scaleHand = scaleHandConfirmed
        ? rawScaleHand
        : scaleHandMissingStreakRef.current <= HAND_MISSING_GRACE_FRAMES
          ? lastKnownScaleHandRef.current
          : null;
      if (!scaleHand) {
        lastKnownScaleHandRef.current = null;
        lastScaleHandXRef.current = null;
      }

      if (!!noteHand !== prevNoteHandDetectedRef.current) {
        prevNoteHandDetectedRef.current = !!noteHand;
        setNoteHandDetected(!!noteHand);
      }
      if (!!scaleHand !== prevScaleHandDetectedRef.current) {
        prevScaleHandDetectedRef.current = !!scaleHand;
        setScaleHandDetected(!!scaleHand);
      }

      if (!noteHand) {
        // Confidence/visibility fallback: hide cursor, fade all playing notes,
        // and park the scale slider (no hands at all right now).
        if (wasNoteHandPresentLastFrameRef.current) {
          releaseSingleActive();
          hoverStability.current.reset();
          smoothedCursor.current.reset();
          const nextStates: Record<string, NoteVisualState> = {};
          for (const n of notesRef.current) {
            nextStates[n.id] = lockedNotesRef.current.has(n.id) ? 'locked' : 'idle';
          }
          applyVisualStateDiffs(nextStates);
          setCurrentNoteLabel('');
          wasNoteHandPresentLastFrameRef.current = false;
        }
        smoothedScaleY.current.reset();
        cursorHandleRef.current?.update(0, 0, false);
        scaleSliderHandleRef.current?.updateHandle(null);
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      wasNoteHandPresentLastFrameRef.current = true;

      const targetX = noteHand.indexTip.x * window.innerWidth;
      const targetY = noteHand.indexTip.y * window.innerHeight;
      const { x: cx, y: cy } = smoothedCursor.current.update(targetX, targetY);
      cursorHandleRef.current?.update(cx, cy, true);

      // Find the closest bubble using hysteresis radii.
      let closestId: string | null = null;
      let closestDist = Infinity;
      for (const b of bubbles) {
        const d = distance(cx, cy, b.x, b.y);
        const wasActive = singleActiveIdRef.current === b.id || lockedNotesRef.current.has(b.id);
        const radiusFactor = wasActive ? EXIT_RADIUS_FACTOR : ENTER_RADIUS_FACTOR;
        if (d <= b.radius * radiusFactor && d < closestDist) {
          closestDist = d;
          closestId = b.id;
        }
      }

      const stableId = hoverStability.current.update(closestId, now, MIN_HOVER_MS);

      // Build next visual-state map for all notes (always all 12, never dimmed).
      const nextStates: Record<string, NoteVisualState> = {};
      for (const n of notesRef.current) {
        if (lockedNotesRef.current.has(n.id)) nextStates[n.id] = 'locked';
        else if (n.id === closestId) nextStates[n.id] = n.id === stableId ? 'active' : 'hover';
        else nextStates[n.id] = 'idle';
      }

      // ---- Interaction-mode-specific logic (left/note hand only) ----
      if (mode === 'Single Note' || mode === 'Gesture Expression') {
        if (stableId !== singleActiveIdRef.current) {
          if (singleActiveIdRef.current) engine.releaseNote(singleActiveIdRef.current);
          if (stableId) {
            const bubble = bubbles.find((b) => b.id === stableId);
            if (bubble) {
              engine.playNote(bubble.id, bubble.frequency);
              triggerRipple(bubble.id);
              cursorHandleRef.current?.pulse();
              setCurrentNoteLabel(`${bubble.name}`);
            }
          } else {
            setCurrentNoteLabel('');
          }
          singleActiveIdRef.current = stableId;
        }

        if (mode === 'Gesture Expression') {
          // Distance from the note wheel's own center (left side of screen).
          const wheelCx = Math.min(window.innerWidth * 0.4, 520);
          const wheelCy = window.innerHeight * 0.52;
          const centerDist = distance(cx, cy, wheelCx, wheelCy);
          const maxDist = Math.min(window.innerWidth, window.innerHeight) * 0.5;
          engine.setGestureParams({
            pan: clamp(noteHand.indexTip.x * 2 - 1, -1, 1),
            filterCutoff01: clamp(1 - noteHand.indexTip.y, 0, 1),
            reverb: clamp(centerDist / maxDist, 0.05, 0.7),
            volume: clamp(1 - noteHand.pinchDistance * 6, 0.25, 1),
          });
        }
      } else if (mode === 'Multi Note Loop') {
        // Immediate preview-sustain while hovering (non-locked notes only).
        if (stableId !== singleActiveIdRef.current) {
          if (singleActiveIdRef.current && !lockedNotesRef.current.has(singleActiveIdRef.current)) {
            engine.releaseNote(singleActiveIdRef.current);
          }
          if (stableId && !lockedNotesRef.current.has(stableId)) {
            const bubble = bubbles.find((b) => b.id === stableId);
            if (bubble) {
              engine.playNote(bubble.id, bubble.frequency);
              setCurrentNoteLabel(bubble.name);
            }
          } else if (!stableId) {
            setCurrentNoteLabel(lockedNotesRef.current.size > 0 ? `${lockedNotesRef.current.size} note(s) looping` : '');
          }
          singleActiveIdRef.current = stableId;
        }

        // Hold-to-lock timer.
        if (stableId) {
          if (!lockHoldTimers.current.has(stableId)) {
            lockHoldTimers.current.set(stableId, now);
          } else {
            const heldSince = lockHoldTimers.current.get(stableId)!;
            if (now - heldSince >= LOCK_HOLD_MS) {
              toggleLock(stableId, bubbles, engine, triggerRipple);
              lockHoldTimers.current.delete(stableId);
            }
          }
        } else {
          lockHoldTimers.current.clear();
        }

        // Pinch gesture as a fast alternative lock toggle for the hovered note.
        if (stableId && noteHand.pinchDistance < PINCH_LOCK_THRESHOLD) {
          if (!pinchWasLockedRef.current.has(stableId)) {
            toggleLock(stableId, bubbles, engine, triggerRipple);
            pinchWasLockedRef.current.add(stableId);
          }
        } else if (stableId) {
          pinchWasLockedRef.current.delete(stableId);
        } else {
          pinchWasLockedRef.current.clear();
        }

        // Open palm clears all locked loops.
        if (noteHand.isOpenPalm && lockedNotesRef.current.size > 0) {
          clearAllLoops();
        }
      }

      applyVisualStateDiffs(nextStates);

      // ---- Right hand: slide up/down the track to switch Major/Minor ----
      const track = scaleTrackLayoutRef.current;
      if (scaleHand && track) {
        const rawHandY = scaleHand.indexTip.y * window.innerHeight;
        const handY = smoothedScaleY.current.update(0, rawHandY).y;
        const trackSpan = Math.max(1, track.bottomY - track.topY);
        const t = clamp((handY - track.topY) / trackSpan, 0, 1);
        scaleSliderHandleRef.current?.updateHandle(t);

        let committed = lastScaleTargetRef.current;
        if (t < 0.5 - SCALE_SLIDER_HYSTERESIS) committed = 'Major';
        else if (t > 0.5 + SCALE_SLIDER_HYSTERESIS) committed = 'Minor';
        if (committed !== lastScaleTargetRef.current) {
          lastScaleTargetRef.current = committed;
        }
        if (committed !== scaleRef.current) {
          setScale(committed);
        }
      } else {
        smoothedScaleY.current.reset();
        scaleSliderHandleRef.current?.updateHandle(null);
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    function toggleLock(
      id: string,
      bubbles: NoteBubbleLayout[],
      engine: AudioEngine,
      triggerRipple: (id: string) => void,
    ) {
      if (lockedNotesRef.current.has(id)) {
        lockedNotesRef.current.delete(id);
        engine.releaseNote(id);
      } else {
        lockedNotesRef.current.add(id);
        const bubble = bubbles.find((b) => b.id === id);
        if (bubble) {
          engine.playNote(bubble.id, bubble.frequency);
          triggerRipple(bubble.id);
        }
      }
      setLockedCount(lockedNotesRef.current.size);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, releaseSingleActive, clearAllLoops]);

  // Release everything when switching away from Multi Note Loop mode.
  useEffect(() => {
    if (interactionMode !== 'Multi Note Loop') {
      clearAllLoops();
    }
    singleActiveIdRef.current = null;
    hoverStability.current.reset();
  }, [interactionMode, clearAllLoops]);

  useEffect(() => {
    return () => {
      audioEngineRef.current.dispose();
      drumEngineRef.current.dispose();
    };
  }, []);

  useEffect(() => {
    audioEngineRef.current.setWaveMode(soundMode);
  }, [soundMode]);

  // Push the current scale into the audio engine so newly-played notes are
  // harmonized accordingly (Major = bright major-third+fifth voicing, Minor =
  // darker minor-third+fifth) — this is what makes flipping the right-hand
  // slider actually audible instead of just a silent label change.
  useEffect(() => {
    audioEngineRef.current.setScale(scale);
  }, [scale]);

  // ---- Background drum/beat layer: push state changes into the engine ----
  useEffect(() => {
    if (phase === 'active') drumEngineRef.current.setPattern(beatPattern);
  }, [phase, beatPattern]);

  useEffect(() => {
    drumEngineRef.current.setBpm(beatBpm);
  }, [beatBpm]);

  useEffect(() => {
    drumEngineRef.current.setMasterVolume(beatMasterVolume);
  }, [beatMasterVolume]);

  useEffect(() => {
    drumEngineRef.current.setVoiceVolume('kick', kickVolume);
  }, [kickVolume]);

  useEffect(() => {
    drumEngineRef.current.setVoiceVolume('snare', snareVolume);
  }, [snareVolume]);

  useEffect(() => {
    drumEngineRef.current.setVoiceVolume('hihat', hihatVolume);
  }, [hihatVolume]);

  const showOnboarding = phase === 'onboarding';
  const showCameraDenied = phase === 'camera-denied';
  const showModelError = phase === 'model-error';

  return (
    <div className="app-root">
      {phase === 'active' && (
        <>
          <CameraFeed onReady={handleCameraReady} onError={handleCameraError} active />
          {cameraReady && (
            <HandTracker
              video={videoRef.current}
              active={cameraReady}
              numHands={2}
              onResult={handleHandResult}
              onModelStatus={handleModelStatus}
            />
          )}

          <div className="vignette-overlay" />

          <header className="hud-top-left">
            <h1 className="app-title">Gesture Note Synth</h1>
            <p className="app-subtitle">
              {currentNoteLabel ? currentNoteLabel : 'Left hand plays notes · Right hand sets Major/Minor'}
            </p>
          </header>

          <div className="hud-top-right">
            <StatusDot label="Camera" ok={cameraReady} />
            <StatusDot label="Notes" ok={noteHandDetected} />
            <StatusDot label="Scale" ok={scaleHandDetected} />
            <StatusDot label="Audio" ok={audioReady} />
            {import.meta.env.DEV && <span ref={fpsLabelRef} className="fps-indicator">-- FPS</span>}
          </div>

          <DrumPanel
            pattern={beatPattern}
            onPatternChange={setBeatPattern}
            bpm={beatBpm}
            onBpmChange={setBeatBpm}
            masterVolume={beatMasterVolume}
            onMasterVolumeChange={setBeatMasterVolume}
            kickVolume={kickVolume}
            onKickVolumeChange={setKickVolume}
            snareVolume={snareVolume}
            onSnareVolumeChange={setSnareVolume}
            hihatVolume={hihatVolume}
            onHihatVolumeChange={setHihatVolume}
          />

          {modelStatus === 'loading' && (
            <div className="loading-toast">Loading hand-tracking model…</div>
          )}
          {cameraReady && modelStatus === 'ready' && !noteHandDetected && (
            <div className="loading-toast subtle">Show a hand to the camera to play</div>
          )}
          {cameraReady && modelStatus === 'ready' && noteHandDetected && !scaleHandDetected && (
            <div className="loading-toast subtle">Show your other hand to control Major/Minor</div>
          )}

          <RadialNoteController
            notes={notes}
            visualStates={visualStates}
            rippleSignal={rippleSignal}
            onLayout={handleLayout}
          />
          <ScaleSlider ref={scaleSliderHandleRef} value={scale} onTrackLayout={handleScaleTrackLayout} />
          <FingerCursor ref={cursorHandleRef} />

          <ControlsPanel
            soundMode={soundMode}
            onSoundModeChange={setSoundMode}
            scale={scale}
            onScaleChange={setScale}
            root={root}
            onRootChange={setRoot}
            octave={octave}
            onOctaveChange={setOctave}
            interactionMode={interactionMode}
            onInteractionModeChange={setInteractionMode}
            lockedCount={lockedCount}
            onClearLoops={clearAllLoops}
          />
        </>
      )}

      {showOnboarding && <OnboardingScreen onStart={handleStart} />}
      {showCameraDenied && <ErrorScreen message={errorMessage ?? 'Camera access is required.'} onRetry={() => setPhase('onboarding')} />}
      {showModelError && <ErrorScreen message="The hand-tracking model failed to load. Check your connection and reload." onRetry={() => window.location.reload()} />}
    </div>
  );
}

function StatusDot({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className={`status-dot ${ok ? 'status-dot--ok' : ''}`}>
      <span className="status-dot-indicator" />
      {label}
    </div>
  );
}

function OnboardingScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="onboarding-screen">
      <div className="onboarding-card glass-panel">
        <h1 className="app-title app-title--large">Gesture Note Synth</h1>
        <p className="onboarding-tagline">A futuristic, two-handed gesture-controlled musical instrument.</p>
        <ol className="onboarding-steps">
          <li>Allow camera access</li>
          <li>Enable audio</li>
          <li>Left hand: hover over the wheel to play notes</li>
          <li>Right hand: slide up/down to switch Major / Minor</li>
          <li>Pinch or hold a note to lock it into a loop</li>
        </ol>
        <button className="cta-button" onClick={onStart}>
          Enable Camera &amp; Audio
        </button>
      </div>
    </div>
  );
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="onboarding-screen">
      <div className="onboarding-card glass-panel">
        <h2 className="app-title">Something needs your attention</h2>
        <p className="onboarding-tagline">{message}</p>
        <button className="cta-button" onClick={onRetry}>
          Try Again
        </button>
      </div>
    </div>
  );
}
