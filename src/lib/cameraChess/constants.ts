/**
 * Constants for CameraChessWeb-style detection (LeYOLO models).
 * @see https://github.com/Pbatch/CameraChessWeb
 */

import type { PieceSymbol, Square } from 'chess.js';

export const MODEL_WIDTH = 480;
export const MODEL_HEIGHT = 288;
export const MARKER_RADIUS = 25;
export const MARKER_DIAMETER = 2 * MARKER_RADIUS;

export const LABELS = ['b', 'k', 'n', 'p', 'q', 'r', 'B', 'K', 'N', 'P', 'Q', 'R'];
export const PIECE_SYMBOLS: PieceSymbol[] = ['b', 'k', 'n', 'p', 'q', 'r'];

export const SQUARE_NAMES: Square[] = [
	'a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1',
	'a2', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'h2',
	'a3', 'b3', 'c3', 'd3', 'e3', 'f3', 'g3', 'h3',
	'a4', 'b4', 'c4', 'd4', 'e4', 'f4', 'g4', 'h4',
	'a5', 'b5', 'c5', 'd5', 'e5', 'f5', 'g5', 'h5',
	'a6', 'b6', 'c6', 'd6', 'e6', 'f6', 'g6', 'h6',
	'a7', 'b7', 'c7', 'd7', 'e7', 'f7', 'g7', 'h7',
	'a8', 'b8', 'c8', 'd8', 'e8', 'f8', 'g8', 'h8'
];

export const SQUARE_SIZE = 128;
export const BOARD_SIZE = 8 * SQUARE_SIZE;

/** Corner keys in order: h1, a1, a8, h8 (white's view) */
export const CORNER_KEYS = ['h1', 'a1', 'a8', 'h8'] as const;
export type CornerKey = (typeof CORNER_KEYS)[number];

const makeLabelMap = (): Record<string, number> => {
	const d: Record<string, number> = {};
	LABELS.forEach((label, i) => { d[label] = i; });
	return d;
};
export const LABEL_MAP = makeLabelMap();

/** Models are local (static/). Pieces: 480M (only variant); Xcorners: 480L (best). */
export const PIECES_MODEL_URL = '/480M_pieces_float16/model.json';
export const XCORNERS_MODEL_URL = '/480L_xcorners_float16/model.json';
