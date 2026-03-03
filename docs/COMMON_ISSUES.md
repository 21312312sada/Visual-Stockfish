# Common Issues

## App crash / freeze (GPU or CPU overload)

**Symptom**: Browser tab crashes, freezes, or becomes unresponsive, especially with camera + Live FEN + Stockfish.

**Cause**: Stockfish runs on **CPU** (WASM), while TensorFlow.js (piece/corner detection) uses **GPU** (WebGL). Running both heavily at once—Live FEN every ~2s, Stockfish depth 16 for White and Black—can overload the system.

**Fix** (addressed in the app):
- Live FEN pauses while Stockfish is analyzing.
- Camera inference is serialized (no overlapping `findFen` calls).
- Stockfish depth reduced from 16 to 12 to lower CPU load.
- Live FEN interval slightly increased to reduce load.

**Workarounds**:
- Turn off "Live" when using Stockfish; use "Get FEN" manually instead.
- Use a lighter browser tab load (fewer extensions, other tabs).

## Stockfish / Engine

### Stockfish does not load (CDN blocked, 403)

**Symptom**: "Engine script not found" or "WASM file missing".

**Fix**: Run the download script once to fetch the engine locally:

```bash
node scripts/download-stockfish.js
```

This writes `stockfish-18-lite-single.js` and `stockfish-18-lite-single.wasm` into `static/`. The app loads them same-origin.

### Engine init timeout (20s)

**Symptom**: "Engine init timeout. If you just added the WASM file, refresh and try again."

**Fix**:
1. Ensure `static/stockfish-18-lite-single.wasm` exists (run `node scripts/download-stockfish.js` if needed).
2. Hard-refresh the page or restart the dev server.

## Models (TensorFlow.js)

### Models not found / 404

**Symptom**: "Model not found" when loading pieces or xcorners.

**Fix**: Add the TFJS model files to `static/`:
- `static/480M_pieces_float16/model.json` + weight shards
- `static/480L_xcorners_float16/model.json` + weight shards

See `static/480M_pieces_float16/README.md` and `static/480L_xcorners_float16/README.md` (and the main README) for export/source links. If models are missing, you can still use the app with pasted FEN and Stockfish.

### WEBGL / backend errors

**Symptom**: TensorFlow fails with WebGL or backend errors.

**Fix**:
- Ensure WebGL is available (try another browser or device).
- Check that `@tensorflow/tfjs-backend-webgl` is imported before running inference (done in `loadModels.ts` and `+page.svelte`).

## Chess.js

### 404 for chess.ts

**Symptom**: Requests to `/node_modules/src/chess.ts` return 404.

**Fix**: There is a Vite middleware in `vite.config.ts` that rewrites this path to `/src/lib/chess.ts`. Ensure the middleware is active. The project uses a local `src/lib/chess.ts` wrapper for chess.js helpers.

## Camera / Detection

### Poor corner detection

**Symptom**: Find corners fails or returns wrong corners.

**Fix**:
- Use good lighting and a clear board.
- Ensure the board is mostly in frame with enough pieces visible.
- Try "Full frame" to use the whole video as the board.
- Manually adjust corners by dragging the green handles (h1, a1, a8, h8).

### Invalid FEN from camera

**Symptom**: "Invalid FEN from detection" or garbage position.

**Fix**:
- Re-run "Find corners" and ensure the quad aligns with the board.
- Adjust corners manually if needed.
- Toggle "Side to move" if the position looks inverted.

**Symptom**: "Position is not a legal continuation; ignored." when using "Get FEN".

**Cause**: The detected position is not exactly one legal move from the current position (e.g. misdetection, board bumped, or a different position). The app only applies camera FEN when it matches the previous position or is a single legal move from it, so move history stays correct.

**Fix**: Ensure the board state matches the last applied position, or apply the correct FEN manually. With "Live" on, invalid or non-continuation readings are ignored without showing an error. Use the "Last rejected guess" board and "Apply to sync to camera" / "Revert to camera position" when the camera missed a move and the two positions are within a few moves.

## Development

### Running the app

```bash
npm install
npm run dev
```

Then open the URL shown (e.g. http://localhost:5173).

### Build / type check

```bash
npm run build
npm run check
```
