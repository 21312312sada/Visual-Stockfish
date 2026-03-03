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
