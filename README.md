# Gesture Note Synth (Music_Sync)

A browser-based, gesture-controlled musical instrument. Your webcam feed fills
the screen; a glowing note controller floats on top. Move your index finger
over a note bubble and it plays a smooth, sustained tone that fades out the
moment your finger leaves — no clicks, no mouse, just hand tracking.

**Live demo:** https://bob2821.github.io/Music_Sync/ (live once GitHub Pages
is enabled — see "Deploying" below). Anyone can open that link and use it with
just a webcam and speakers/headphones — no install required.

Built with **React + Vite + TypeScript**, **MediaPipe Tasks Vision
(Hand Landmarker)**, and the **Web Audio API**.

## Features

- Live webcam feed, mirrored like a selfie camera, with a futuristic HUD overlay.
- Real-time hand tracking (MediaPipe Hand Landmarker, `VIDEO` running mode) —
  index fingertip drives a smoothed, glowing cursor.
- 12-note chromatic radial controller with Indian Sargam notation, scale
  highlighting (Chromatic / Major / Minor / Pentatonic / Indian), root-note and
  octave selection.
- Sustained, click-free notes via layered Web Audio oscillators with smooth
  attack/release envelopes — never a one-shot beep, never a re-triggered click.
- Five sound modes: Pure Tone, Ambient Pad, Soft Bell, Sci-Fi Synth, Indian Drone.
- Three interaction modes:
  - **Single Note** — one note at a time, crossfades between notes.
  - **Multi Note Loop** — hold a note (or pinch) to lock it into a looping
    layer; open your palm to clear all loops.
  - **Gesture Expression** — fingertip X/Y and pinch distance drive live pan,
    filter cutoff, and reverb/volume.
- Graceful fallbacks: camera-permission denial, model-loading state, "no hand
  detected" messaging, and a confidence fallback that fades all notes out if
  tracking is lost.
- Background drum/beat layer (collapsible "Beat" panel, top-right): five
  synthesized-from-scratch beat types (Off, Basic Rock, Hip-Hop, House, Lo-Fi),
  each with its own default tempo and swing feel. Independent sliders for
  tempo, overall beat volume, and each drum voice (Kick / Snare / Hi-Hat), so
  it mixes underneath the gesture instrument without competing with it.

## Getting started

```bash
npm install
npm run dev
```

Then open the printed local URL (typically `http://localhost:5173`) in a
Chromium-based browser (Chrome/Edge) for the best MediaPipe/WebGPU-adjacent
GPU-delegate performance. Grant camera and audio permission on the start
screen — audio requires an initial user click/tap per browser autoplay policy.

To type-check and produce a production build:

```bash
npm run build
npm run preview
```

## Project structure

```
src/
  main.tsx                       React entry point
  App.tsx                        App shell + central real-time interaction loop
  components/
    CameraFeed.tsx                Full-screen mirrored webcam <video>
    HandTracker.tsx                MediaPipe Hand Landmarker (VIDEO mode) driver
    RadialNoteController.tsx       Circular note-bubble UI + screen-space layout
    FingerCursor.tsx                Glowing fingertip cursor (imperative, no re-render)
    AudioEngine.ts                  Sustained-note synth engine (Web Audio API)
    ControlsPanel.tsx               Sound mode / scale / root / octave / mode UI
    DrumEngine.ts                   Synthesized kick/snare/hi-hat + lookahead scheduler
    DrumPanel.tsx                   Beat type / tempo / per-voice volume UI
  utils/
    notes.ts                        Note frequencies, scales, Sargam notation
    math.ts                         lerp/distance/polar helpers, smoothing, hover timers
    drumPatterns.ts                  16-step beat patterns (kick/snare/hi-hat, bpm, swing)
  styles/
    global.css                      Futuristic glassmorphism visual design
```

## How the real-time loop stays smooth

- Hand-landmark data is written into `refs`, never `useState`, so the ~30-60
  detections/sec never trigger a React re-render on their own.
- The fingertip cursor is moved by writing directly to a DOM element's
  `style.transform` (see `FingerCursor`'s imperative handle) — no re-render.
- Note-bubble visual state (idle/hover/active/locked) only calls `setState`
  when a bubble's state actually *changes*, which happens a few times a
  second at most, not every frame.
- Hover uses a hysteresis radius (easier to stay active than to enter) plus a
  ~100ms minimum stable-hover window, so a note is never re-triggered by
  natural jitter.
- `AudioEngine` reuses/tears down oscillator nodes per note id and never
  restarts an oscillator that's already sustaining — hovering the same note
  continuously produces a single continuous tone.

## How the background beat stays in time

`DrumEngine` uses the standard Web Audio "lookahead scheduler" pattern instead
of relying on `setInterval` timing directly: a lightweight timer wakes up
every 25ms and schedules any drum hits due in the next ~120ms using the audio
context's own sample-accurate clock (`osc.start(time)` / envelope automation
at precise `AudioContext` times). This keeps the beat rock-solid even though
JS timers themselves can jitter. All three voices (kick/snare/hi-hat) are
synthesized (no samples): a pitch-swept sine + noise transient for the kick, a
tone + filtered noise layer for the snare, and double-highpassed noise bursts
for the hi-hat (short for closed, long for open), all mixed through a limiter
so overlapping hits never clip.

## Notes on MediaPipe assets

The Hand Landmarker model and its WASM runtime are loaded directly from
Google's/MediaPipe's CDN at runtime (`@mediapipe/tasks-vision` CDN + the
official hosted `hand_landmarker.task` model), so no model files need to be
checked into this repo or served locally. An internet connection is required
on first load (results are cached by the browser afterward).

## Deploying (GitHub Pages)

This repo includes a GitHub Actions workflow (`.github/workflows/deploy.yml`)
that builds the app and publishes it to GitHub Pages automatically on every
push to `main`. One-time setup after your first push:

1. On GitHub, go to **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Push to `main` (or re-run the workflow from the **Actions** tab). After it
   finishes, the app is live at `https://bob2821.github.io/Music_Sync/`.

Because the site is served over HTTPS, camera/microphone permission prompts
work normally in the browser — visitors just need a webcam and
speakers/headphones, no local setup at all.

`vite.config.ts` sets `base: '/Music_Sync/'` only for production builds (so
the built asset paths resolve under the Pages subpath); local `npm run dev`
is unaffected and still serves from `/`.
