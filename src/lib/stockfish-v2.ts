/**
 * Stockfish v2 – standalone implementation.
 * Uses a same-origin Worker (static JS + WASM only). No blob URLs, no CDN fallback.
 * UCI over postMessage; separate types and parsing from the original module.
 */

const ENGINE_JS = '/stockfish-18-lite-single.js';

export type V2Message =
	| { kind: 'readyok' }
	| { kind: 'uciok' }
	| { kind: 'id'; name?: string; author?: string }
	| { kind: 'info'; depth?: number; scoreCp?: number; scoreMate?: number; pv?: string[] }
	| { kind: 'bestmove'; move: string; ponder?: string }
	| { kind: 'raw'; line: string };

function parseLine(line: string): V2Message | null {
	const t = line.trim();
	if (t === 'readyok') return { kind: 'readyok' };
	if (t === 'uciok') return { kind: 'uciok' };
	if (t.startsWith('id ')) {
		const rest = t.slice(3).trim();
		const space = rest.indexOf(' ');
		if (space > 0) return { kind: 'id', [rest.slice(0, space).toLowerCase()]: rest.slice(space + 1) };
		return { kind: 'id' };
	}
	if (t.startsWith('bestmove ')) {
		const parts = t.slice(9).trim().split(/\s+/);
		return { kind: 'bestmove', move: parts[0] || '', ponder: parts[2] };
	}
	if (t.startsWith('info ')) {
		const parts = t.slice(5).split(/\s+/);
		const msg: V2Message = { kind: 'info' };
		for (let i = 0; i < parts.length; i++) {
			if (parts[i] === 'depth') msg.depth = parseInt(parts[++i], 10);
			else if (parts[i] === 'score') {
				const type = parts[i + 1];
				const val = parseInt(parts[i + 2], 10);
				if (type === 'cp') msg.scoreCp = val;
				else if (type === 'mate') msg.scoreMate = val;
				i += 2;
			} else if (parts[i] === 'pv') {
				msg.pv = parts.slice(i + 1);
				break;
			}
		}
		return msg;
	}
	return { kind: 'raw', line: t };
}

export interface StockfishV2Callbacks {
	onLine?(msg: V2Message): void;
	onReady?(): void;
}

export class StockfishV2 {
	private w: Worker | null = null;
	private ready = false;
	private cb: StockfishV2Callbacks = {};
	private readyResolve: (() => void) | null = null;
	private readyReject: ((err: Error) => void) | null = null;
	private positionResolve: (() => void) | null = null;

	async start(callbacks: StockfishV2Callbacks = {}): Promise<void> {
		this.cb = callbacks;
		if (this.w) return;

		// Direct worker: script at /stockfish-18-lite-single.js will load WASM from same path as .wasm
		const res = await fetch(ENGINE_JS, { cache: 'default' });
		if (!res.ok) throw new Error(`Engine script not found (${res.status}). Run: node scripts/download-stockfish.js`);

		// Also ensure WASM exists (same path, .wasm extension)
		const wasmPath = '/stockfish-18-lite-single.wasm';
		const wasmCheck = await fetch(wasmPath, { method: 'HEAD' }).catch(() => null);
		if (!wasmCheck?.ok) {
			throw new Error(
				'WASM file missing. From project root run: node scripts/download-stockfish.js (downloads stockfish-18-lite-single.js and stockfish-18-lite-single.wasm into static/)'
			);
		}

		this.w = new Worker(ENGINE_JS, { type: 'classic' });

		const timeoutMs = 20000;
		const timeout = setTimeout(() => {
			if (this.readyReject) {
				this.readyReject(
					new Error(
						'Engine init timeout (20s). If you just added the WASM file, refresh the page and try again.'
					)
				);
				this.readyReject = null;
			}
		}, timeoutMs);

		return new Promise<void>((resolve, reject) => {
			this.readyResolve = () => {
				clearTimeout(timeout);
				this.ready = true;
				this.readyReject = null;
				this.cb.onReady?.();
				resolve();
			};
			this.readyReject = (err) => {
				clearTimeout(timeout);
				reject(err);
			};

			this.w!.onmessage = (e: MessageEvent) => {
				const line = typeof e.data === 'string' ? e.data : (e.data?.data ?? String(e.data));
				const lines = line.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
				for (const ln of lines) {
					const msg = parseLine(ln);
					if (msg) this.cb.onLine?.(msg);
					if (ln === 'uciok') this.w!.postMessage('isready');
					if (ln === 'readyok') {
						if (this.positionResolve) {
							this.positionResolve();
							this.positionResolve = null;
						}
						if (!this.ready) this.readyResolve?.();
					}
				}
			};

			this.w!.onerror = (ev: ErrorEvent) => {
				this.readyReject?.(new Error(ev.message || 'Worker error'));
				this.readyReject = null;
			};

			this.w!.postMessage('uci');
		});
	}

	cmd(c: string): void {
		if (this.w) this.w.postMessage(c);
	}

	setPosition(fen: string): Promise<void> {
		this.cmd('ucinewgame');
		this.cmd('position fen ' + fen);
		this.cmd('isready');
		return new Promise((resolve) => {
			this.positionResolve = resolve;
		});
	}

	goDepth(depth: number): void {
		this.cmd('go depth ' + depth);
	}

	stop(): void {
		this.cmd('stop');
	}

	isReady(): boolean {
		return this.ready && !!this.w;
	}

	terminate(): void {
		if (this.w) {
			this.w.terminate();
			this.w = null;
		}
		this.ready = false;
		this.positionResolve = null;
		this.readyResolve = null;
		this.readyReject = null;
	}
}
