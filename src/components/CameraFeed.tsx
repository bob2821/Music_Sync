/**
 * CameraFeed.tsx
 * ---------------------------------------------------------------------------
 * Full-screen live webcam video element. Requests getUserMedia, plays the
 * stream, and reports readiness/errors upward. The video itself is displayed
 * mirrored (CSS transform) so it feels like a normal selfie camera; the
 * HandTracker corrects fingertip coordinates to match this mirroring.
 */

import { forwardRef, useEffect, useRef } from 'react';

interface CameraFeedProps {
  onReady: (video: HTMLVideoElement) => void;
  onError: (message: string) => void;
  active: boolean;
}

export const CameraFeed = forwardRef<HTMLVideoElement, CameraFeedProps>(
  ({ onReady, onError, active }, forwardedRef) => {
    const internalRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    useEffect(() => {
      if (!active) return;
      let cancelled = false;

      async function start() {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
          });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          streamRef.current = stream;
          const video = internalRef.current;
          if (!video) return;
          video.srcObject = stream;
          await video.play();
          onReady(video);
        } catch (err) {
          console.error('Camera error', err);
          onError(
            err instanceof DOMException && err.name === 'NotAllowedError'
              ? 'Camera permission was denied. Please allow camera access and try again.'
              : 'Could not access the camera. Please check your device and permissions.',
          );
        }
      }

      start();

      return () => {
        cancelled = true;
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active]);

    return (
      <video
        ref={(node) => {
          internalRef.current = node;
          if (typeof forwardedRef === 'function') forwardedRef(node);
          else if (forwardedRef) (forwardedRef as any).current = node;
        }}
        className="camera-feed"
        playsInline
        muted
        aria-hidden="true"
      />
    );
  },
);

CameraFeed.displayName = 'CameraFeed';
