<script lang="ts">
	import '@tensorflow/tfjs-backend-webgl';
	import { onDestroy, onMount } from 'svelte';
	import {
		loadModels,
		findCorners,
		findFen,
		invalidVideo,
		MODEL_WIDTH,
		MODEL_HEIGHT
	} from '$lib/cameraChess';
	import type { LoadedModels } from '$lib/cameraChess';
	import { Chess } from 'chess.js';
	import { validateFen, getSanFromUci, STARTING_FEN, setFenSideToMove, getMoveBetween, normalizeFenForCompare } from '$lib/chess';
	import { StockfishV2 } from '$lib/stockfish-v2';

	const PIECE_SYMBOLS: Record<string, string> = {
		K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙',
		k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟'
	};

	function boardFromFen(fenStr: string): (string | null)[][] {
		try {
			const chess = new Chess(fenStr);
			return chess.board().map((rank) =>
				rank.map((sq) => {
					if (!sq) return null;
					const c = sq.color === 'w' ? sq.type.toUpperCase() : sq.type;
					return PIECE_SYMBOLS[c] ?? c;
				})
			);
		} catch {
			return Array.from({ length: 8 }, () => Array(8).fill(null));
		}
	}

	let videoEl: HTMLVideoElement;
	let canvasEl = $state<HTMLCanvasElement | undefined>(undefined);
	let stream: MediaStream | null = null;
	let rafId = 0;
	let status = $state<
		| 'idle'
		| 'loading-camera'
		| 'camera-on'
		| 'loading-models'
		| 'finding-corners'
		| 'getting-fen'
	>('idle');
	let error = $state('');
	let models = $state<LoadedModels | null>(null);
	let keypoints = $state<number[][] | null>(null);
	let sideToMove = $state<'w' | 'b'>('w');
	let previousFen = $state<string | null>(null);
	let liveFen = $state(false);
	let liveIntervalId = 0;
	let findFenInProgress = false;
	const LIVE_FEN_INTERVAL_MS = 2200;
	let overlaySvgEl = $state<SVGSVGElement | null>(null);
	let draggingCorner = $state<number | null>(null);
	let videoDevices = $state<{ deviceId: string; label: string }[]>([]);
	let selectedDeviceId = $state<string>('');

	// Stockfish (single engine)
	let engine = $state<StockfishV2 | null>(null);
	let engineStatus = $state<'idle' | 'loading' | 'ready'>('idle');
	let engineError = $state('');
	let fen = $state(STARTING_FEN);
	let fenInput = $state(STARTING_FEN);
	let bestMove = $state('');
	let score = $state('');
	let engineLoading = $state(false);
	let analysisPhase = $state<'idle' | 'white' | 'black'>('idle');
	let analysisFenWhite = $state('');
	let analysisFenBlack = $state('');
	let bestMoveWhite = $state('');
	let scoreWhite = $state('');
	let bestMoveBlack = $state('');
	let scoreBlack = $state('');

	type MoveLogEntry = { moveNumber: number; side: 'w' | 'b'; san: string; fen: string };
	let moveHistory = $state<MoveLogEntry[]>([]);

	const CORNERS_STORAGE_KEY = 'visualstockfish-corners';

	function loadSavedCorners(): number[][] | null {
		if (typeof localStorage === 'undefined') return null;
		try {
			const raw = localStorage.getItem(CORNERS_STORAGE_KEY);
			if (!raw) return null;
			const parsed = JSON.parse(raw) as unknown;
			if (!Array.isArray(parsed) || parsed.length !== 4) return null;
			const keypoints = parsed.map((p) => {
				if (!Array.isArray(p) || p.length !== 2) return null;
				const x = Number(p[0]);
				const y = Number(p[1]);
				if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
				return [Math.max(0, Math.min(MODEL_WIDTH, x)), Math.max(0, Math.min(MODEL_HEIGHT, y))];
			});
			if (keypoints.some((p) => p === null)) return null;
			return keypoints as number[][];
		} catch {
			return null;
		}
	}

	function saveCorners(kp: number[][]) {
		if (typeof localStorage === 'undefined' || !kp || kp.length !== 4) return;
		try {
			localStorage.setItem(CORNERS_STORAGE_KEY, JSON.stringify(kp));
		} catch {
			// ignore storage errors
		}
	}

	async function loadVideoDevices() {
		try {
			const devices = await navigator.mediaDevices.enumerateDevices();
			const inputs = devices
				.filter((d) => d.kind === 'videoinput')
				.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
			videoDevices = inputs;
		} catch {
			videoDevices = [];
		}
	}

	function canvasToModel(xCanvas: number, yCanvas: number): [number, number] {
		const cw = canvasEl?.width ?? MODEL_WIDTH;
		const ch = canvasEl?.height ?? MODEL_HEIGHT;
		const mx = Math.round(Math.max(0, Math.min(MODEL_WIDTH, (xCanvas / cw) * MODEL_WIDTH)));
		const my = Math.round(Math.max(0, Math.min(MODEL_HEIGHT, (yCanvas / ch) * MODEL_HEIGHT)));
		return [mx, my];
	}

	function handleCornerPointerDown(i: number, e: PointerEvent) {
		e.preventDefault();
		draggingCorner = i;
		(e.target as Element).setPointerCapture(e.pointerId);
	}

	function handleCornerPointerMove(e: PointerEvent, i: number) {
		if (draggingCorner !== i || !overlaySvgEl || !keypoints || !canvasEl) return;
		const rect = overlaySvgEl.getBoundingClientRect();
		const xCanvas = ((e.clientX - rect.left) / rect.width) * canvasEl.width;
		const yCanvas = ((e.clientY - rect.top) / rect.height) * canvasEl.height;
		const [mx, my] = canvasToModel(xCanvas, yCanvas);
		keypoints = keypoints.map((kp, j) => (j === i ? [mx, my] : kp));
	}

	function handleCornerPointerUp(e: PointerEvent, i: number) {
		(e.target as Element).releasePointerCapture(e.pointerId);
		if (draggingCorner === i) draggingCorner = null;
	}

	/** Infer who moved by diffing prev and new FEN; return side to move next. */
	function inferSideToMoveFromDiff(prevFen: string, newFen: string): 'w' | 'b' {
		try {
			const prev = new Chess(prevFen);
			const next = new Chess(newFen);
			const prevBoard = prev.board();
			const nextBoard = next.board();
			let whiteMoved = false;
			let blackMoved = false;
			for (let r = 0; r < 8; r++) {
				for (let f = 0; f < 8; f++) {
					const prevPiece = prevBoard[r][f];
					const nextPiece = nextBoard[r][f];
					if (prevPiece && (!nextPiece || nextPiece.color !== prevPiece.color || nextPiece.type !== prevPiece.type)) {
						if (prevPiece.color === 'w') whiteMoved = true;
						else blackMoved = true;
					}
				}
			}
			if (whiteMoved && !blackMoved) return 'b';
			if (blackMoved && !whiteMoved) return 'w';
			// Both changed (e.g. capture): side that lost a piece was captured, so the other side moved
			if (whiteMoved && blackMoved) {
				const prevWhite = prevBoard.flat().filter((p) => p?.color === 'w').length;
				const nextWhite = nextBoard.flat().filter((p) => p?.color === 'w').length;
				const prevBlack = prevBoard.flat().filter((p) => p?.color === 'b').length;
				const nextBlack = nextBoard.flat().filter((p) => p?.color === 'b').length;
				if (nextWhite < prevWhite) return 'w';
				if (nextBlack < prevBlack) return 'b';
			}
			return sideToMove;
		} catch {
			return sideToMove;
		}
	}

	function appendMoveToHistoryIfSingle(prevFen: string, newFen: string) {
		const sideToMovePrev = (prevFen.trim().split(/\s+/)[1] === 'b' ? 'b' : 'w') as 'w' | 'b';
		if (normalizeFenForCompare(newFen) === normalizeFenForCompare(STARTING_FEN)) {
			moveHistory = [];
			return;
		}
		const move = getMoveBetween(prevFen, newFen);
		if (!move) return;
		const moveNumber = Math.floor(moveHistory.length / 2) + 1;
		moveHistory = [...moveHistory, { moveNumber, side: sideToMovePrev, san: move.san, fen: newFen }];
	}

	function applyDetectedFen(newFen: string) {
		if (previousFen !== null) {
			sideToMove = inferSideToMoveFromDiff(previousFen, newFen);
			appendMoveToHistoryIfSingle(previousFen, newFen);
		}
		previousFen = newFen;
		fen = newFen;
		fenInput = newFen;
		error = '';
	}

	async function startCamera() {
		error = '';
		status = 'loading-camera';
		try {
			const videoConstraints: MediaTrackConstraints = {
				width: { ideal: 640 },
				height: { ideal: 480 }
			};
			if (selectedDeviceId) {
				videoConstraints.deviceId = { exact: selectedDeviceId };
			} else {
				videoConstraints.facingMode = 'environment';
			}
			stream = await navigator.mediaDevices.getUserMedia({
				video: videoConstraints
			});
			videoEl.srcObject = stream;
			await videoEl.play();
			status = 'camera-on';
			drawLoop();
			// Refresh device list so labels are populated after permission (e.g. "Integrated Camera", "USB Camera")
			await loadVideoDevices();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Camera access failed';
			status = 'idle';
		}
	}

	function drawLoop() {
		const canvas = canvasEl;
		if (!videoEl || !canvas || videoEl.readyState < 2) {
			rafId = requestAnimationFrame(drawLoop);
			return;
		}
		canvas.width = videoEl.videoWidth;
		canvas.height = videoEl.videoHeight;
		const ctx = canvas.getContext('2d');
		if (ctx) ctx.drawImage(videoEl, 0, 0);
		rafId = requestAnimationFrame(drawLoop);
	}

	function stopCamera() {
		setLiveFen(false);
		if (rafId) cancelAnimationFrame(rafId);
		rafId = 0;
		if (stream) {
			stream.getTracks().forEach((t) => t.stop());
			stream = null;
		}
		if (videoEl) videoEl.srcObject = null;
		status = 'idle';
		keypoints = null;
		previousFen = null;
	}

	function setLiveFen(on: boolean) {
		liveFen = on;
		if (liveIntervalId) {
			clearInterval(liveIntervalId);
			liveIntervalId = 0;
		}
		if (on && models && keypoints && videoEl) {
			liveIntervalId = window.setInterval(() => {
				if (!videoEl || !keypoints || !models || invalidVideo({ current: videoEl })) return;
				if (findFenInProgress || engineLoading) return;
				findFenInProgress = true;
				findFen({ current: videoEl }, models.pieces, keypoints, sideToMove)
					.then((result) => {
						if (result.fen && validateFen(result.fen)) {
							applyDetectedFen(result.fen);
						}
					})
					.catch(() => {})
					.finally(() => {
						findFenInProgress = false;
					});
			}, LIVE_FEN_INTERVAL_MS);
		}
	}

	async function ensureModels(suppressError = false) {
		if (models) return;
		if (!suppressError) error = '';
		status = 'loading-models';
		try {
			models = await loadModels();
			status = 'idle';
		} catch (e) {
			error =
				e instanceof Error
					? e.message
					: 'Failed to load models. Add TFJS models to static/ (see README).';
			status = 'idle';
		}
	}

	async function loadModelsClick() {
		await ensureModels(false);
	}

	// Persist corner positions (manual or detected) so they survive reloads
	$effect(() => {
		const kp = keypoints;
		if (kp && kp.length === 4) saveCorners(kp);
	});

	onMount(() => {
		const saved = loadSavedCorners();
		if (saved) keypoints = saved;
		ensureModels(true);
		loadVideoDevices();
		startCamera();
	});

	async function findCornersClick() {
		if (!models || !videoEl) return;
		error = '';
		status = 'finding-corners';
		try {
			const result = await findCorners({ current: videoEl }, models);
			if (result.keypoints) {
				keypoints = result.keypoints;
				error = '';
				if (liveFen) setLiveFen(true);
			} else {
				error = result.message;
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Find corners failed';
		}
		status = 'camera-on';
	}

	/** Use full frame as board (when automatic detection fails). Order: h1, a1, a8, h8. */
	function useFullFrameAsBoard() {
		keypoints = [
			[MODEL_WIDTH, MODEL_HEIGHT],
			[0, MODEL_HEIGHT],
			[0, 0],
			[MODEL_WIDTH, 0]
		];
		error = '';
	}

	async function getFenFromCamera() {
		if (!models || !keypoints || !videoEl) return;
		if (invalidVideo({ current: videoEl })) {
			error = 'Video not ready';
			return;
		}
		error = '';
		status = 'getting-fen';
		try {
			const result = await findFen({ current: videoEl }, models.pieces, keypoints, sideToMove);
			if (result.error) {
				error = result.error;
			}
			if (result.fen && validateFen(result.fen)) {
				applyDetectedFen(result.fen);
			} else if (result.fen) {
				fenInput = result.fen;
				error = result.error || 'Invalid FEN from detection';
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Get FEN failed';
		}
		status = 'camera-on';
	}

	function applyFen() {
		const raw = fenInput.trim();
		if (validateFen(raw)) {
			if (previousFen !== null) appendMoveToHistoryIfSingle(previousFen, raw);
			else if (raw === STARTING_FEN) moveHistory = [];
			fen = raw;
			fenInput = raw;
			previousFen = raw;
			error = '';
		} else {
			error = 'Invalid FEN';
		}
	}

	async function loadEngine() {
		if (engine) return;
		engineError = '';
		engineStatus = 'loading';
		const e = new StockfishV2();
		try {
			await e.start({
				onLine(m) {
					if (m.kind === 'bestmove') {
						if (analysisPhase === 'white') {
							bestMoveWhite = m.move;
							scoreWhite = score || '';
							analysisPhase = 'black';
							e.setPosition(analysisFenBlack).then(() => e.goDepth(12));
						} else if (analysisPhase === 'black') {
							bestMoveBlack = m.move;
							scoreBlack = score || '';
							analysisPhase = 'idle';
							engineLoading = false;
						}
					}
					if (m.kind === 'info') {
						if (m.scoreMate != null) score = 'Mate ' + m.scoreMate;
						else if (m.scoreCp != null) score = (m.scoreCp > 0 ? '+' : '') + (m.scoreCp / 100).toFixed(1);
					}
				},
				onReady() {
					engineStatus = 'ready';
				}
			});
			engine = e;
		} catch (err) {
			engineError = err instanceof Error ? err.message : 'Engine failed';
			engineStatus = 'idle';
		}
	}

	const FEN_DEBOUNCE_MS = 600;
	let fenDebounceId = 0;

	// Auto-apply FEN when user stops typing (debounce); then re-evaluate via effect
	$effect(() => {
		const raw = fenInput.trim();
		if (fenDebounceId) clearTimeout(fenDebounceId);
		fenDebounceId = window.setTimeout(() => {
			fenDebounceId = 0;
			if (validateFen(raw)) {
				fen = raw;
				engineError = '';
			}
		}, FEN_DEBOUNCE_MS);
		return () => {
			if (fenDebounceId) clearTimeout(fenDebounceId);
		};
	});

	async function getBestMove() {
		if (!engine?.isReady()) return;
		engineLoading = true;
		score = 'Thinking…';
		bestMove = '';
		bestMoveWhite = '';
		scoreWhite = '';
		bestMoveBlack = '';
		scoreBlack = '';
		analysisFenWhite = setFenSideToMove(fen, 'w');
		analysisFenBlack = setFenSideToMove(fen, 'b');
		analysisPhase = 'white';
		try {
			await engine.setPosition(analysisFenWhite);
			engine.goDepth(12);
		} catch {
			engineLoading = false;
			analysisPhase = 'idle';
			score = '';
		}
	}

	let lastEvaluatedFen = $state('');
	$effect(() => {
		const f = fen;
		const loading = engineLoading;
		if (!engine?.isReady() || f === lastEvaluatedFen || loading) return;
		lastEvaluatedFen = f;
		getBestMove();
	});

	/** Keypoints in model space → canvas polygon for overlay */
	function keypointsToCanvasPoints(): { x: number; y: number }[] | null {
		if (!keypoints || keypoints.length < 4 || !canvasEl) return null;
		const cw = canvasEl.width;
		const ch = canvasEl.height;
		return keypoints.map(([x, y]) => ({
			x: (x / MODEL_WIDTH) * cw,
			y: (y / MODEL_HEIGHT) * ch
		}));
	}

	onDestroy(() => {
		if (fenDebounceId) clearTimeout(fenDebounceId);
		setLiveFen(false);
		stopCamera();
		engine?.terminate();
	});
</script>

<svelte:head>
	<title>Visual Stockfish – Camera to engine</title>
</svelte:head>

<div class="app">
	<header class="app-header">
		<h1>Visual Stockfish</h1>
	</header>

	{#if error}
		<div class="banner error" role="alert">{error}</div>
	{/if}

	<main class="main">
		<!-- Camera & detection -->
		<section class="card camera-section">
			<h2 class="card-title">Camera & board</h2>
			<div class="video-wrap">
				<video bind:this={videoEl} class="video" playsinline muted autoplay></video>
				<canvas bind:this={canvasEl} class="canvas-overlay" aria-hidden="true"></canvas>
				{#if keypointsToCanvasPoints() && canvasEl}
					{@const pts = keypointsToCanvasPoints()}
					{@const labels = ['h1', 'a1', 'a8', 'h8']}
					<svg
						bind:this={overlaySvgEl}
						class="overlay-svg overlay-svg-draggable"
						viewBox="0 0 {canvasEl.width} {canvasEl.height}"
						preserveAspectRatio="none"
					>
						<polygon
							points="{pts!.map((p) => `${p.x},${p.y}`).join(' ')}"
							fill="none"
							stroke="var(--accent)"
							stroke-width="2"
							pointer-events="none"
						/>
						{#each pts as pt, i}
							<circle
								cx={pt.x}
								cy={pt.y}
								r="18"
								class="corner-handle"
								class:dragging={draggingCorner === i}
								role="button"
								tabindex="-1"
								onpointerdown={(e) => handleCornerPointerDown(i, e)}
								onpointermove={(e) => handleCornerPointerMove(e, i)}
								onpointerup={(e) => handleCornerPointerUp(e, i)}
								onpointercancel={(e) => handleCornerPointerUp(e, i)}
								aria-label="Drag to adjust {labels[i]} corner"
							/>
							<text
								x={pt.x}
								y={pt.y}
								class="corner-label"
								text-anchor="middle"
								dominant-baseline="middle"
								pointer-events="none"
							>{labels[i]}</text>
						{/each}
					</svg>
				{/if}
			</div>
			<div class="video-controls">
				{#if status === 'loading-camera'}
					<button class="btn" disabled>Starting camera…</button>
				{:else if status === 'loading-models'}
					<button class="btn" disabled>Loading models…</button>
				{:else}
					<div class="control-row">
						{#if videoDevices.length > 0}
							<label class="camera-select-wrap">
								<span class="camera-select-label">Camera</span>
								<select
									class="camera-select"
									bind:value={selectedDeviceId}
									disabled={status === 'camera-on' || status === 'finding-corners' || status === 'getting-fen'}
									aria-label="Choose camera"
								>
									<option value="">Default</option>
									{#each videoDevices as dev}
										<option value={dev.deviceId}>{dev.label}</option>
									{/each}
								</select>
							</label>
						{/if}
						{#if status === 'camera-on' || status === 'finding-corners' || status === 'getting-fen'}
							<button class="btn" onclick={stopCamera}>Stop camera</button>
						{:else}
							<button class="btn btn-primary" onclick={startCamera}>Start camera</button>
						{/if}
						{#if !models}
							<button class="btn btn-primary" onclick={loadModelsClick}>Load AI models</button>
						{/if}
					</div>
					{#if models}
						<div class="control-row">
							<button
								class="btn btn-primary"
								onclick={findCornersClick}
								disabled={status === 'finding-corners' || (status !== 'camera-on' && status !== 'getting-fen')}
								title="Detect board corners in frame"
							>
								{status === 'finding-corners' ? 'Finding…' : 'Find corners'}
							</button>
							<button
								class="btn btn-primary"
								onclick={getFenFromCamera}
								disabled={status !== 'camera-on' && status !== 'getting-fen' || !keypoints || status === 'getting-fen'}
								title="Detect position from camera"
							>
								{status === 'getting-fen' ? 'Detecting…' : 'Get FEN'}
							</button>
							<button class="btn btn-secondary" onclick={useFullFrameAsBoard} title="Use full frame as board">
								Full frame
							</button>
							{#if keypoints}
								<button
									class="btn"
									class:btn-primary={liveFen}
									onclick={() => setLiveFen(!liveFen)}
									disabled={status !== 'camera-on' && status !== 'getting-fen'}
									title="Update position from camera every ~2s"
								>
									{liveFen ? 'Live on' : 'Live'}
								</button>
							{/if}
						</div>
					{/if}
				{/if}
			</div>
			{#if keypoints}
				<div class="orientation-bar">
					<span class="orientation-label">Side to move</span>
					<button class="btn btn-small" onclick={() => (sideToMove = sideToMove === 'w' ? 'b' : 'w')}>{sideToMove === 'w' ? 'White' : 'Black'}</button>
				</div>
			{/if}
		</section>

		<!-- Position & Stockfish -->
		<section class="card position-engine-section">
			<h2 class="card-title">Position & Stockfish</h2>
			{#if engineError}
				<div class="banner error" role="alert">{engineError}</div>
			{/if}
			<div class="fen-section">
				<label class="fen-label" for="fen-input">FEN</label>
				<div class="fen-row">
					<input
						id="fen-input"
						type="text"
						class="fen-input"
						bind:value={fenInput}
						placeholder="Paste FEN or use camera"
						aria-label="FEN position"
					/>
					<button class="btn btn-primary fen-apply" onclick={applyFen}>Apply</button>
				</div>
			</div>
			<div class="board-section">
				<div class="board-visual" aria-hidden="true">
					{#each boardFromFen(fen) as rank, ri}
						{#each rank as piece, ci}
							<span class="board-square" class:light={(ri + ci) % 2 === 0}>
								{piece ?? ''}
							</span>
						{/each}
					{/each}
				</div>
			</div>
			<div class="engine-block">
				{#if !engine}
					<button
						class="btn btn-primary"
						onclick={loadEngine}
						disabled={engineStatus === 'loading'}
					>
						{engineStatus === 'loading' ? 'Loading…' : 'Load Stockfish'}
					</button>
				{:else}
					<div class="engine-row">
						<span class="badge" class:badge-ready={engineStatus === 'ready'}>{engineStatus === 'ready' ? 'Ready' : 'Loading…'}</span>
						<button
							class="btn btn-primary"
							onclick={getBestMove}
							disabled={engineStatus !== 'ready' || engineLoading}
						>
							{engineLoading ? 'Thinking…' : 'Get best move'}
						</button>
					</div>
					{#if engineLoading}
						<p class="score">Thinking… {analysisPhase === 'white' ? 'White' : 'Black'}</p>
					{:else if bestMoveWhite || bestMoveBlack}
						<div class="scores">
							{#if bestMoveWhite}
								<p class="score">White: <strong>{getSanFromUci(analysisFenWhite, bestMoveWhite) || bestMoveWhite}</strong>{#if scoreWhite} — {scoreWhite}{/if}</p>
							{/if}
							{#if bestMoveBlack}
								<p class="score">Black: <strong>{getSanFromUci(analysisFenBlack, bestMoveBlack) || bestMoveBlack}</strong>{#if scoreBlack} — {scoreBlack}{/if}</p>
							{/if}
						</div>
					{/if}
				{/if}
			</div>
			<div class="move-history-section">
				<div class="move-history-header">
					<h3 class="card-title">Move history</h3>
					{#if moveHistory.length > 0}
						<button type="button" class="btn btn-small" onclick={() => (moveHistory = [])}>Clear</button>
					{/if}
				</div>
				{#if moveHistory.length === 0}
					<p class="move-history-empty">No moves yet. Apply FEN or use the camera to update the position; each single-move change is logged.</p>
				{:else}
					<ol class="move-history-list">
						{#each moveHistory as entry, i (i)}
							<li class="move-history-item">
								<span class="move-number">{entry.moveNumber}.</span>
								<span class="move-side">{entry.side === 'w' ? 'White' : 'Black'}</span>
								<strong class="move-san">{entry.san}</strong>
							</li>
						{/each}
					</ol>
				{/if}
			</div>
		</section>
	</main>
</div>

<style>
	.app {
		--accent: #2d7d46;
		--bg: #f4f4f5;
		--surface: #ffffff;
		--text: #18181b;
		--text-muted: #71717a;
		--border: #e4e4e7;
		--primary: #18181b;
		--primary-hover: #27272a;
		--error-bg: #fef2f2;
		--error-text: #b91c1c;
		--success: #166534;
		--radius: 6px;
		--radius-lg: 10px;
		--shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
		--shadow-card: 0 1px 3px rgba(0, 0, 0, 0.06);
		max-width: 880px;
		margin: 0 auto;
		padding: 2rem 1.5rem;
		font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		color: var(--text);
		background: var(--bg);
		min-height: 100vh;
		line-height: 1.5;
		-webkit-font-smoothing: antialiased;
	}

	.app-header {
		text-align: center;
		margin-bottom: 2.5rem;
		padding-bottom: 1.5rem;
		border-bottom: 1px solid var(--border);
	}
	.app-header h1 {
		font-size: 1.5rem;
		font-weight: 600;
		letter-spacing: -0.02em;
		color: var(--text);
		margin: 0;
	}

	.banner {
		padding: 0.75rem 1rem;
		border-radius: var(--radius);
		margin-bottom: 1rem;
		font-size: 0.875rem;
	}
	.banner.error {
		background: var(--error-bg);
		color: var(--error-text);
		border: 1px solid #fecaca;
	}

	.main {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.card {
		background: var(--surface);
		border-radius: var(--radius-lg);
		padding: 1.5rem;
		box-shadow: var(--shadow-card);
		border: 1px solid var(--border);
	}
	.card-title {
		font-size: 0.8125rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--text-muted);
		margin: 0 0 1rem;
	}

	.video-wrap {
		position: relative;
		width: 100%;
		aspect-ratio: 16/10;
		max-height: 480px;
		background: #0a0a0a;
		border-radius: var(--radius);
		overflow: hidden;
		border: 1px solid var(--border);
	}
	.video,
	.canvas-overlay {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	.canvas-overlay {
		pointer-events: none;
	}
	.overlay-svg {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
	}
	.overlay-svg:not(.overlay-svg-draggable) {
		pointer-events: none;
	}
	.corner-handle {
		fill: rgba(255, 255, 255, 0.25);
		stroke: var(--accent);
		stroke-width: 2;
		cursor: grab;
		pointer-events: all;
	}
	.corner-handle:hover {
		fill: rgba(255, 255, 255, 0.4);
	}
	.corner-handle.dragging {
		cursor: grabbing;
		fill: rgba(255, 255, 255, 0.5);
	}
	.corner-label {
		fill: #fff;
		font-size: 11px;
		font-weight: 600;
		font-family: inherit;
		stroke: #000;
		stroke-width: 2px;
		paint-order: stroke fill;
	}

	.video-controls {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin-top: 1rem;
	}
	.control-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.control-row + .control-row {
		margin-top: 0;
		padding-top: 0.75rem;
		border-top: 1px solid var(--border);
	}

	.camera-select-wrap {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}
	.camera-select-label {
		font-size: 0.8125rem;
		color: var(--text-muted);
	}
	.camera-select {
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		font-size: 0.875rem;
		background: var(--surface);
		color: var(--text);
		min-width: 160px;
	}
	.camera-select:focus {
		outline: none;
		border-color: var(--text-muted);
		box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.05);
	}
	.camera-select:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.btn {
		padding: 0.5rem 0.875rem;
		border-radius: var(--radius);
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s;
	}
	.btn:hover:not(:disabled) {
		background: #f4f4f5;
		border-color: #d4d4d8;
	}
	.btn-primary {
		background: var(--primary);
		color: #fff;
		border-color: var(--primary);
	}
	.btn-primary:hover:not(:disabled) {
		background: var(--primary-hover);
		border-color: var(--primary-hover);
	}
	.btn-secondary {
		background: #f4f4f5;
		border-color: var(--border);
		color: var(--text);
	}
	.btn-secondary:hover:not(:disabled) {
		background: #e4e4e7;
	}
	.btn-small {
		padding: 0.375rem 0.625rem;
		font-size: 0.8125rem;
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.orientation-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--border);
		font-size: 0.875rem;
	}
	.orientation-label {
		color: var(--text-muted);
		font-size: 0.8125rem;
	}

	/* Position & FEN — full-width so entire string is visible and never covered */
	.fen-section {
		width: 100%;
		margin-bottom: 1.25rem;
	}
	.fen-label {
		display: block;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-muted);
		margin-bottom: 0.375rem;
	}
	.fen-row {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		width: 100%;
		min-width: 0;
	}
	.fen-input {
		flex: 1 1 0;
		min-width: 0;
		width: 100%;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		font-size: 0.8125rem;
		font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace;
		background: var(--surface);
		color: var(--text);
		overflow-x: auto;
		overflow-y: hidden;
	}
	.fen-input::placeholder {
		color: var(--text-muted);
	}
	.fen-input:focus {
		outline: none;
		border-color: var(--text-muted);
		box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.05);
	}
	.fen-apply {
		flex-shrink: 0;
	}
	.board-section {
		width: 100%;
		margin-bottom: 1.25rem;
		min-height: 280px;
	}
	.board-visual {
		display: grid;
		grid-template-columns: repeat(8, 1fr);
		grid-template-rows: repeat(8, 1fr);
		width: 280px;
		height: 280px;
		min-width: 280px;
		min-height: 280px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
	}
	.board-square {
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.5rem;
		aspect-ratio: 1;
	}
	.board-square.light {
		background: #f0d9b5;
	}
	.board-square:not(.light) {
		background: #b58863;
	}

	.engine-block {
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}
	.engine-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
	}
	.badge {
		display: inline-block;
		padding: 0.25rem 0.5rem;
		background: #f4f4f5;
		color: var(--text-muted);
		border-radius: 4px;
		font-size: 0.75rem;
		font-weight: 500;
	}
	.badge-ready {
		background: #dcfce7;
		color: var(--success);
	}
	.score {
		margin: 0.75rem 0 0;
		font-size: 0.875rem;
		color: var(--text);
	}
	.score strong {
		font-weight: 600;
	}

	.move-history-section {
		margin-top: 1.25rem;
		padding-top: 1.25rem;
		border-top: 1px solid var(--border);
	}
	.move-history-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}
	.move-history-header .card-title {
		margin: 0;
	}
	.move-history-empty {
		margin: 0;
		font-size: 0.875rem;
		color: var(--text-muted);
	}
	.move-history-list {
		margin: 0;
		padding-left: 1.25rem;
		font-size: 0.875rem;
		line-height: 1.6;
	}
	.move-history-item {
		margin-bottom: 0.25rem;
	}
	.move-number {
		color: var(--text-muted);
		margin-right: 0.25rem;
	}
	.move-side {
		color: var(--text-muted);
		margin-right: 0.5rem;
	}
	.move-san {
		font-weight: 600;
	}
</style>
