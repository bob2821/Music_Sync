/**
 * HandTracker.tsx
 * ---------------------------------------------------------------------------
 * Wraps MediaPipe Tasks Vision's HandLandmarker in VIDEO/live-stream mode.
 * Renders nothing — it's a side-effect-only driver that runs a
 * requestAnimationFrame loop, calling `onResult` every frame with the
 * fingertip / thumb / wrist positions already corrected for the mirrored
 * camera preview.
 *
 * High-frequency data (landmark positions) is NEVER put into React state —
 * it's handed to the caller via a callback so the caller can store it in a
 * ref and avoid re-rendering React on every one of the ~60 frames/sec.
 */

import { useEffect, useRef } from 'react';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { distance } from '../utils/math';

export interface HandFrameResult {
  indexTip: { x: number; y: number }; // normalized 0..1, mirror-corrected
  thumbTip: { x: number; y: number };
  wrist: { x: number; y: number };
  pinchDistance: number; // normalized units
  isOpenPalm: boolean;
  handedness: string;
}

interface HandTrackerProps {
  video: HTMLVideoElement | null;
  active: boolean;
  numHands?: number;
  onResult: (result: HandFrameResult | null, timestampMs: number) => void;
  onModelStatus?: (status: 'loading' | 'ready' | 'error') => void;
}

// Official MediaPipe-hosted assets — no local hosting/build step required.
const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// Landmark indices (MediaPipe Hands topology).
const IDX_WRIST = 0;
const IDX_THUMB_TIP = 4;
const IDX_INDEX_TIP = 8;
const IDX_INDEX_PIP = 6;
const IDX_MIDDLE_TIP = 12;
const IDX_MIDDLE_PIP = 10;
const IDX_RING_TIP = 16;
const IDX_RING_PIP = 14;
const IDX_PINKY_TIP = 20;
const IDX_PINKY_PIP = 18;

/** Heuristic: all four fingers extended well beyond their PIP joints from the wrist. */
function detectOpenPalm(lm: { x: number; y: number }[]): boolean {
  const wrist = lm[IDX_WRIST];
  const pairs: [number, number][] = [
    [IDX_INDEX_TIP, IDX_INDEX_PIP],
    [IDX_MIDDLE_TIP, IDX_MIDDLE_PIP],
    [IDX_RING_TIP, IDX_RING_PIP],
    [IDX_PINKY_TIP, IDX_PINKY_PIP],
  ];
  let extendedCount = 0;
  for (const [tipIdx, pipIdx] of pairs) {
    const tipDist = distance(lm[tipIdx].x, lm[tipIdx].y, wrist.x, wrist.y);
    const pipDist = distance(lm[pipIdx].x, lm[pipIdx].y, wrist.x, wrist.y);
    if (tipDist > pipDist * 1.15) extendedCount++;
  }
  return extendedCount >= 3;
}

export function HandTracker({ video, active, numHands = 1, onResult, onModelStatus }: HandTrackerProps) {
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const disposedRef = useRef(false);

  // Load the model once.
  useEffect(() => {
    disposedRef.current = false;
    onModelStatus?.('loading');

    (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
        const landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands,
          minHandDetectionConfidence: 0.6,
          minHandPresenceConfidence: 0.6,
          minTrackingConfidence: 0.6,
        });
        if (disposedRef.current) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;
        onModelStatus?.('ready');
      } catch (err) {
        console.error('HandLandmarker failed to load', err);
        onModelStatus?.('error');
      }
    })();

    return () => {
      disposedRef.current = true;
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numHands]);

  // Detection loop — only runs while active, a video element exists, and the model is ready.
  useEffect(() => {
    if (!active || !video) return;

    const tick = () => {
      const landmarker = landmarkerRef.current;
      if (landmarker && video.readyState >= 2) {
        const now = performance.now();
        if (video.currentTime !== lastVideoTimeRef.current) {
          lastVideoTimeRef.current = video.currentTime;
          try {
            const result = landmarker.detectForVideo(video, now);
            if (result.landmarks && result.landmarks.length > 0) {
              const lm = result.landmarks[0];
              // Mirror-correct: the source video frame is unmirrored, but we
              // display it flipped (CSS scaleX(-1)) for a natural selfie feel.
              const mirror = (p: { x: number; y: number }) => ({ x: 1 - p.x, y: p.y });

              const indexTip = mirror(lm[IDX_INDEX_TIP]);
              const thumbTip = mirror(lm[IDX_THUMB_TIP]);
              const wrist = mirror(lm[IDX_WRIST]);
              const pinchDistance = distance(
                lm[IDX_THUMB_TIP].x,
                lm[IDX_THUMB_TIP].y,
                lm[IDX_INDEX_TIP].x,
                lm[IDX_INDEX_TIP].y,
              );
              const isOpenPalm = detectOpenPalm(lm);
              const handedness = result.handedness?.[0]?.[0]?.categoryName ?? 'Unknown';

              onResult({ indexTip, thumbTip, wrist, pinchDistance, isOpenPalm, handedness }, now);
            } else {
              onResult(null, now);
            }
          } catch (err) {
            // Landmarks can be transiently unavailable — never crash the loop.
            console.warn('detectForVideo failed', err);
            onResult(null, now);
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, video]);

  return null;
}
