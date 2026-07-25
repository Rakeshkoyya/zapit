import { defineConfig } from "vite";

// Tauri expects a fixed dev port and takes care of opening the webview itself.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "es2022",
    outDir: "dist",
    rollupOptions: {
      // Multi-page: the hidden main window plus each job window.
      input: {
        main: "index.html",
        progress: "progress.html",
        trim: "trim.html",
        promptResize: "prompt-resize.html",
        promptSize: "prompt-size.html",
        promptRanges: "prompt-ranges.html",
        promptVideoSize: "prompt-video-size.html",
        promptFrameTime: "prompt-frame-time.html",
        promptPassword: "prompt-password.html",
        promptPasswordSet: "prompt-password-set.html",
        reorder: "reorder.html",
        metadata: "metadata.html",
        result: "result.html",
        settings: "settings.html",
      },
    },
  },
});
