# Visual Stockfish – Architecture

## Overview

Visual Stockfish is a **chess web app** that detects a physical board via camera (TensorFlow.js + LeYOLO models) and feeds the position to the **Stockfish** engine. Built with **SvelteKit**.

## Tech Stack

| Technology | Purpose |
|------------|---------|
| **SvelteKit** | App framework, routing |
| **Svelte 5** | UI (runes: `$state`, `$effect`) |
| **TensorFlow.js** | LeYOLO pieces + xcorners models |
| **Stockfish** | UCI engine (WASM, Web Worker) |
| **chess.js** | FEN validation, UCI→SAN conversion |
| **vectorious** | Perspective transform math |
| **delaunator** | Triangulation for corner quads |

## Project Structure

```
VisualStockFish/
├── src/
│   ├── routes/
│   │   ├── +layout.svelte
│   │   └── +page.svelte          # Main UI (camera, FEN, Stockfish)
│   ├── lib/
│   │   ├── chess.ts              # FEN validation, UCI→SAN, move helpers
│   │   ├── stockfish.ts          # Original engine (Worker wrapper)
│   │   ├── stockfish-v2.ts       # Current engine (used by UI)
│   │   └── cameraChess/
│   │       ├── index.ts          # Public API
│   │       ├── constants.ts      # Model dims, labels, URLs
│   │       ├── loadModels.ts     # Load TFJS pieces + xcorners
│   │       ├── findCorners.ts    # Detect board corners
│   │       ├── findFen.ts        # Detect position from video
│   │       ├── detect.ts         # Video input, boxes/scores
│   │       ├── warp.ts           # Perspective transforms
│   │       └── math.ts           # Utilities
├── static/
│   ├── stockfish-18-lite-single.js
│   ├── stockfish-18-lite-single.wasm
│   ├── 480M_pieces_float16/      # LeYOLO pieces model
│   └── 480L_xcorners_float16/    # LeYOLO xcorners model
├── scripts/
│   └── download-stockfish.js     # Fetch engine into static/
├── vite.config.ts
└── svelte.config.js
```

## Data Flow

### Camera → FEN

1. **Start camera** – `navigator.mediaDevices.getUserMedia`
2. **Load models** – `loadModels()` caches pieces + xcorners TFJS models
3. **Find corners** – `findCorners()` detects 4 board corners (h1, a1, a8, h8)
4. **Get FEN** – `findFen()` warps frame, runs pieces model, maps detections to squares, outputs FEN

**Live FEN**: When Live is on, detection runs on new video frames (via `requestVideoFrameCallback` when available, else a 2.2s interval). First read runs immediately when turning Live on. A 15s timeout prevents `findFen` from blocking indefinitely. Rejected camera FENs are shown in a “Last rejected guess” board; the app can find a minimal move path between current and rejected position (see Reconciliation).

### FEN → Stockfish

- **Manual flow**: User pastes/edits FEN → Apply → Load Stockfish → Get best move
- **Auto flow**: `fenInput` is debounced (600ms); when valid, `fen` updates → `$effect` triggers `getBestMove()`
- Engine runs analysis for **both** sides (White and Black) and shows best moves + scores

### Two Engine Modules

- **`stockfish.ts`** – Original UCI wrapper (`StockfishEngine`)
- **`stockfish-v2.ts`** – Simplified implementation (`StockfishV2`), **currently used** by `+page.svelte`

Both load the engine from `static/` (same-origin Worker + WASM, no CDN).

## Key Concepts

- **Model space**: 480×288 (TensorFlow input). Corners and detections are in this space.
- **Corner order**: h1, a1, a8, h8 (white’s view).
- **Side to move**: User selects White/Black when detecting from camera; inferred from FEN when applying manually.
- **Move history**: Single-move changes from camera or FEN are logged via `getMoveBetween()` (chess.js legal moves). Camera FEN is only applied when it is the same position or exactly one legal move from the previous position, so noisy readings (e.g. hand movement) are ignored and history stays accurate. Live updates never show an error when a reading is rejected.
- **Reconciliation**: When the camera returns a FEN that is rejected (not same position, not one legal move), the UI shows that “Last rejected guess” and a second board. `findMinimalPath()` (in `chess.ts`) finds the shortest sequence of legal moves (BFS, up to 5 moves) from current position to camera position or vice versa. The user can “Apply to sync to camera” (play those moves) or “Revert to camera position” to align the app with what the camera sees when a move was missed.

## Vite / Svelte Config

- **Vite**: SvelteKit plugin + middleware to fix `chess.js` 404 (rewrites `/node_modules/src/chess.ts` → `/src/lib/chess.ts`)
- **Adapter**: `adapter-auto` (cloud/serverless)
