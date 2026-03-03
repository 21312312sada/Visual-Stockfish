/**
 * Stockfish UCI engine wrapper using Web Worker.
 * Same loading as stockfish-v2: same-origin JS + WASM only, direct worker (no blob, no CDN).
 */

const ENGINE_JS = '/stockfish-18-lite-single.js';
const ENGINE_WASM = '/stockfish-18-lite-single.wasm';
const INIT_TIMEOUT_MS = 20000;

export type EngineMessage =
	| { type: 'uci'; id: string }
	| { type: 'id'; name?: string; author?: string }
	| { type: 'readyok'; id: string }
	| { type: 'info'; depth?: number; seldepth?: number; score?: { value: number; type: 'cp' | 'mate' }; pv?: string[]; nodes?: number; time?: number }
	| { type: 'bestmove'; bestmove: string; ponder?: string }
	| { type: 'line'; raw: string };

function parseUciLine(line: string): EngineMessage | null {
	if (line === 'readyok') return { type: 'readyok', id: '' };
	if (line.startsWith('id ')) {
		const [, key, value] = line.split(/\s+(.*)/);
		return { type: 'id', [key]: value };
	}
	if (line === 'uciok') return { type: 'uci', id: '' };
	if (line.startsWith('info ')) {
		const parts = line.slice(5).split(/\s+/);
		const msg: EngineMessage = { type: 'info' };
		for (let i = 0; i < parts.length; i++) {
			if (parts[i] === 'depth') msg.depth = parseInt(parts[++i], 10);
			else if (parts[i] === 'score') {
				const type = parts[i + 1] as 'cp' | 'mate';
				const value = parseInt(parts[i + 2], 10);
				msg.score = { type, value };
				i += 2;
			} else if (parts[i] === 'pv') {
				msg.pv = parts.slice(i + 1);
				break;
			} else if (parts[i] === 'nodes') msg.nodes = parseInt(parts[++i], 10);
			else if (parts[i] === 'time') msg.time = parseInt(parts[++i], 10);
		}
		return msg;
	}
	if (line.startsWith('bestmove ')) {
		const [, bestmove, , ponder] = line.split(/\s+/);
		return { type: 'bestmove', bestmove, ponder };
	}
	return { type: 'line', raw: line };
}

export interface StockfishCallbacks {
	onMessage?(msg: EngineMessage): void;
	onReady?(): void;
}

export class StockfishEngine {
	private worker: Worker | null = null;
	private ready = false;
	private callbacks: StockfishCallbacks = {};
	private initPromise: Promise<void> | null = null;
	private pendingSetPositionResolve: (() => void) | null = null;

	async init(callbacks: StockfishCallbacks = {}): Promise<void> {
		this.callbacks = callbacks;
		if (this.worker) return;
		if (this.initPromise) return this.initPromise;
		this.initPromise = (async () => {
			try {
				const jsOk = await fetch(ENGINE_JS, { cache: 'default' }).then((r) => r.ok).catch(() => false);
				if (!jsOk) {
					throw new Error(`Engine script not found. Run: node scripts/download-stockfish.js`);
				}
				const wasmOk = await fetch(ENGINE_WASM, { method: 'HEAD' }).then((r) => r.ok).catch(() => null);
				if (!wasmOk) {
					throw new Error(
						'WASM file missing. From project root run: node scripts/download-stockfish.js'
					);
				}

				this.worker = new Worker(ENGINE_JS, { type: 'classic' });

				let timeoutId: ReturnType<typeof setTimeout> | null = null;
				let rejectInit: ((err: Error) => void) | null = null;
				this.worker.onmessage = (e: MessageEvent<string>) => {
					const text = typeof e.data === 'string' ? e.data : (e.data as { data?: string })?.data ?? '';
					const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
					for (const line of lines) {
						const msg = parseUciLine(line);
						if (msg) this.callbacks.onMessage?.(msg);
						if (line === 'uciok') this.send('isready');
						if (line === 'readyok') {
							this.ready = true;
							if (timeoutId) clearTimeout(timeoutId);
							this.callbacks.onReady?.();
							if (this.pendingSetPositionResolve) {
								this.pendingSetPositionResolve();
								this.pendingSetPositionResolve = null;
							}
						}
					}
				};
				this.worker.onerror = (err: ErrorEvent) => {
					if (timeoutId) clearTimeout(timeoutId);
					rejectInit?.(new Error(err.message || 'Stockfish worker failed'));
				};
				this.send('uci');

				await new Promise<void>((resolve, reject) => {
					rejectInit = reject;
					timeoutId = setTimeout(() => {
						reject(
							new Error(
								`Engine init timeout (${INIT_TIMEOUT_MS / 1000}s). If you just added the WASM file, refresh and try again.`
							)
						);
					}, INIT_TIMEOUT_MS);
					const origOnReady = this.callbacks.onReady;
					this.callbacks.onReady = () => {
						if (timeoutId) clearTimeout(timeoutId);
						origOnReady?.();
						resolve();
					};
				});
			} catch (e) {
				this.initPromise = null;
				if (this.worker) {
					this.worker.terminate();
					this.worker = null;
				}
				throw e;
			}
		})();
		return this.initPromise;
	}

	send(cmd: string): void {
		if (this.worker) this.worker.postMessage(cmd);
	}

	setPosition(fen: string): Promise<void> {
		this.send('ucinewgame');
		this.send(`position fen ${fen}`);
		this.send('isready');
		return new Promise((resolve) => {
			this.pendingSetPositionResolve = resolve;
		});
	}

	go(depth = 18): void {
		this.send(`go depth ${depth}`);
	}

	goMovetime(ms: number): void {
		this.send(`go movetime ${ms}`);
	}

	stop(): void {
		this.send('stop');
	}

	isReady(): boolean {
		return this.ready;
	}

	destroy(): void {
		if (this.worker) {
			this.worker.terminate();
			this.worker = null;
		}
		this.ready = false;
		this.initPromise = null;
	}
}
