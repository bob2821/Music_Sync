import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Gesture Note Synth — Vite config
// `optimizeDeps.exclude` keeps the MediaPipe wasm/worker assets from being
// pre-bundled incorrectly; the package ships its own loader.
// `base` matches the GitHub Pages project-site URL (github.com/bob2821/Music_Sync
// -> bob2821.github.io/Music_Sync/) so built asset paths resolve correctly.
// Only applied for production builds — local `npm run dev` (used by
// start.bat) keeps serving from "/" so nothing changes about local dev.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/Music_Sync/' : '/',
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@mediapipe/tasks-vision'],
  },
  server: {
    host: true,
  },
}))
