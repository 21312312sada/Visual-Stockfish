import { Chess } from 'chess.js';

export function validateFen(fen: string): boolean {
	try {
		new Chess(fen);
		return true;
	} catch {
		return false;
	}
}

export function getSanFromUci(fen: string, uci: string): string | null {
	try {
		const chess = new Chess(fen);
		const move = chess.move({
			from: uci.slice(0, 2),
			to: uci.slice(2, 4),
			promotion: uci.length >= 5 ? (uci[4] as 'q' | 'r' | 'b' | 'n') : undefined
		});
		return move ? move.san : null;
	} catch {
		return null;
	}
}

export const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Return a FEN string with the same position but the given side to move. */
export function setFenSideToMove(fen: string, side: 'w' | 'b'): string {
	const parts = fen.trim().split(/\s+/);
	if (parts.length < 2) return fen;
	parts[1] = side;
	return parts.join(' ');
}

/** First 4 FEN fields (position, side, castling, ep) for position comparison. */
export function normalizeFenForCompare(fen: string): string {
	const parts = fen.trim().split(/\s+/);
	return parts.slice(0, 4).join(' ');
}

/**
 * If exactly one legal move from prevFen leads to the position in newFen, return that move.
 * Otherwise return null (e.g. new position is not a single-move continuation, or ambiguous).
 */
export function getMoveBetween(prevFen: string, newFen: string): { san: string; uci: string } | null {
	try {
		const prev = new Chess(prevFen);
		const targetNorm = normalizeFenForCompare(newFen);
		const moves = prev.moves({ verbose: true });
		let found: { san: string; uci: string } | null = null;
		for (const m of moves) {
			const next = new Chess(prevFen);
			next.move(m);
			if (normalizeFenForCompare(next.fen()) === targetNorm) {
				if (found) return null; // ambiguous: two moves lead to same position
				const uci = m.from + m.to + (m.promotion ? m.promotion : '');
				found = { san: m.san, uci };
			}
		}
		return found;
	} catch {
		return null;
	}
}

/**
 * Find a shortest sequence of legal moves from fromFen to the position in toFen.
 * Compares positions by normalized FEN (first 4 fields). Returns SAN moves, or null if not found within maxDepth.
 */
export function findMinimalPath(
	fromFen: string,
	toFen: string,
	maxDepth: number
): string[] | null {
	try {
		const targetNorm = normalizeFenForCompare(toFen);
		const startNorm = normalizeFenForCompare(fromFen);
		if (startNorm === targetNorm) return [];

		type Node = { fen: string; path: string[] };
		const queue: Node[] = [{ fen: fromFen, path: [] }];
		const visited = new Set<string>([startNorm]);

		while (queue.length > 0) {
			const { fen, path } = queue.shift()!;
			if (path.length >= maxDepth) continue;

			const chess = new Chess(fen);
			const moves = chess.moves({ verbose: true });

			for (const m of moves) {
				const next = new Chess(fen);
				next.move(m);
				const nextFen = next.fen();
				const nextNorm = normalizeFenForCompare(nextFen);

				if (nextNorm === targetNorm) return [...path, m.san];

				if (!visited.has(nextNorm)) {
					visited.add(nextNorm);
					queue.push({ fen: nextFen, path: [...path, m.san] });
				}
			}
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Apply a sequence of SAN moves to a FEN position; returns the resulting FEN or null if any move is illegal.
 */
export function applyMovesToFen(fen: string, moves: string[]): string | null {
	try {
		const chess = new Chess(fen);
		for (const san of moves) {
			const result = chess.move(san);
			if (!result) return null;
		}
		return chess.fen();
	} catch {
		return null;
	}
}
