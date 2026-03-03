# Visual Stockfish

A **chess-based web app** that uses live camera footage to detect a physical chess board (via [CameraChessWeb](https://github.com/Pbatch/CameraChessWeb)-style LeYOLO models) and feeds the position to the **Stockfish** engine. Built with **SvelteKit**.

## Features

- **Live camera** – Capture video from your device camera
- **Board & piece detection** – Uses TensorFlow.js with LeYOLO models (pieces + xcorners) to find board corners and recognize pieces, then outputs FEN
- **FEN position** – Get FEN from the camera (“Find corners” → “Get FEN from camera”) or paste/edit a [FEN](https://en.wikipedia.org/wiki/Forsyth%E2%80%93Edwards_Notation) string
- **Stockfish integration** – Load the engine in the browser (WASM, via CDN), set the position from FEN, and get the best move and evaluation

## Setup

```bash
npm install
npm run dev
```

Then open the URL shown (e.g. http://localhost:5173). Allow camera access when prompted.

### Models (required for camera → FEN)

The app expects TensorFlow.js GraphModels in the **static** folder (served at the site root), in the same format as [CameraChessWeb](https://github.com/Pbatch/CameraChessWeb):

1. **Pieces model** – `static/480M_pieces_float16/model.json` (and weight shards)
2. **Xcorners model** – `static/480L_xcorners_float16/model.json` (and weight shards)

From the [CameraChessWeb README](https://github.com/Pbatch/CameraChessWeb):

- **Pieces**: LeYOLO ONNX model and TFJS export – see their [Colab gist](https://gist.github.com/Pbatch/dccc680ac2f852d4f258e4b6f1997a7b) and [TFJS export gist](https://gist.github.com/Pbatch/46d958df7e0363e42561bda50163a57a). Place the exported `model.json` and `*.bin` (or `group*-shard*`) inside `static/480M_pieces_float16/`.
- **Xcorners**: Similarly export the xcorners model and place under `static/480L_xcorners_float16/`. See `static/480M_pieces_float16/README.md` and `static/480L_xcorners_float16/README.md` for direct links.

If the model files are missing, “Load models” will show an error and point you to these READMEs. You can still use the app by pasting a FEN and using Stockfish.

## How it works

1. **Start camera** – Click “Start camera” to begin the video feed.
2. **Load models** – Click “Load models” to load the pieces and xcorners TFJS models (first time may take a few seconds).
3. **Find corners** – Point the camera at the board with pieces visible. Click “Find corners” so the app can detect the four board corners (green overlay).
4. **Get FEN from camera** – Click “Get FEN from camera” to run piece detection and set the current position. Choose side to move (White/Black) if needed.
5. **Set position manually** – Or paste a valid FEN and click “Apply FEN”.
6. **Load Stockfish** – Click “Load Stockfish” to start the engine (CDN).
7. **Get best move** – Click “Get best move” to run the engine on the current FEN.

## Tech stack

- **SvelteKit** – App and routing
- **TensorFlow.js** – Pieces and xcorners LeYOLO models (CameraChessWeb-style)
- **Stockfish** (CDN) – Browser WASM build for analysis
- **chess.js** – FEN validation and UCI→SAN move conversion
- **vectorious** – Perspective transform math; **delaunator** – Triangulation for corner quads

## Notes

- **Stockfish** is loaded from jsDelivr CDN. If your environment blocks cross-origin workers, copy the worker and WASM from `node_modules/stockfish` into `static/stockfish/` and point the app at `/stockfish/stockfish-18-lite-single.js` instead.
- **Detection** works best with a clear board, good lighting, and the board mostly in frame. “Find corners” needs enough pieces so black/white centers can be used to orient the corners.

## Documentation

See `docs/README.md` for architecture, common issues, and agent workflows.

## Scripts

| Command          | Description                |
|------------------|----------------------------|
| `npm run dev`    | Start dev server           |
| `npm run build`  | Production build           |
| `npm run preview`| Preview production build   |
