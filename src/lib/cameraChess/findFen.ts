/**
 * Get FEN from video frame using corners (keypoints) and pieces model (CameraChessWeb-style).
 */

import * as tf from '@tensorflow/tfjs-core';
import type { GraphModel } from '@tensorflow/tfjs-converter';
import { Chess } from 'chess.js';
import type { Color, PieceSymbol, Square } from 'chess.js';
import { getInvTransform, transformBoundary, transformCenters } from './warp';
import { getInput, getBoxesAndScores, invalidVideo, type VideoRef } from './detect';
import { PIECE_SYMBOLS, SQUARE_NAMES } from './constants';
import { zeros } from './math';

function getBoxCenters(boxes: tf.Tensor2D): tf.Tensor2D {
	return tf.tidy(() => {
		const l = tf.slice(boxes, [0, 0], [-1, 1]);
		const r = tf.slice(boxes, [0, 2], [-1, 1]);
		const b = tf.slice(boxes, [0, 3], [-1, 1]);
		const cx = tf.div(tf.add(l, r), 2);
		const cy = tf.sub(b, tf.div(tf.sub(r, l), 3));
		return tf.concat([cx, cy], 1);
	});
}

export function getSquares(
	boxes: tf.Tensor2D,
	centers3D: tf.Tensor3D,
	boundary3D: tf.Tensor3D
): number[] {
	return tf.tidy(() => {
		const boxCenters3D = tf.expandDims(getBoxCenters(boxes), 1);
		const dist = tf.sum(tf.square(tf.sub(boxCenters3D, centers3D)), 2);
		const squares = tf.argMin(dist, 1);
		const shiftedBoundary3D = tf.concat(
			[
				tf.slice(boundary3D, [0, 1, 0], [1, 3, 2]),
				tf.slice(boundary3D, [0, 0, 0], [1, 1, 2])
			],
			1
		);
		const nBoxes = boxCenters3D.shape[0];
		const a = tf.squeeze(
			tf.sub(
				tf.slice(boundary3D, [0, 0, 0], [1, 4, 1]),
				tf.slice(shiftedBoundary3D, [0, 0, 0], [1, 4, 1])
			),
			[2]
		);
		const b = tf.squeeze(
			tf.sub(
				tf.slice(boundary3D, [0, 0, 1], [1, 4, 1]),
				tf.slice(shiftedBoundary3D, [0, 0, 1], [1, 4, 1])
			),
			[2]
		);
		const c = tf.squeeze(
			tf.sub(
				tf.slice(boxCenters3D, [0, 0, 0], [nBoxes, 1, 1]),
				tf.slice(shiftedBoundary3D, [0, 0, 0], [1, 4, 1])
			),
			[2]
		);
		const d = tf.squeeze(
			tf.sub(
				tf.slice(boxCenters3D, [0, 0, 1], [nBoxes, 1, 1]),
				tf.slice(shiftedBoundary3D, [0, 0, 1], [1, 4, 1])
			),
			[2]
		);
		const det = tf.sub(tf.mul(a, d), tf.mul(b, c));
		const newSquares = tf.where(tf.any(tf.less(det, 0), 1), tf.scalar(-1), squares);
		return newSquares.arraySync() as number[];
	});
}

export function getUpdate(scoresTensor: tf.Tensor2D, squares: number[]): number[][] {
	const update = zeros(64, 12);
	const scores = scoresTensor.arraySync() as number[][];
	for (let i = 0; i < squares.length; i++) {
		const square = squares[i];
		if (square === -1) continue;
		for (let j = 0; j < 12; j++) {
			update[square][j] = Math.max(update[square][j], scores[i][j]);
		}
	}
	return update;
}

function stateToFen(state: number[][], color: Color): { fen: string; error: string | null } {
	const assignment = Array(64).fill(-1);
	let bestBlackKingScore = -1;
	let bestBlackKingIdx = -1;
	for (let i = 0; i < 64; i++) {
		if (state[i][1] > bestBlackKingScore) {
			bestBlackKingScore = state[i][1];
			bestBlackKingIdx = i;
		}
	}
	assignment[bestBlackKingIdx] = 1;
	let bestWhiteKingScore = -1;
	let bestWhiteKingIdx = -1;
	for (let i = 0; i < 64; i++) {
		if (i === bestBlackKingIdx) continue;
		if (state[i][7] > bestWhiteKingScore) {
			bestWhiteKingScore = state[i][7];
			bestWhiteKingIdx = i;
		}
	}
	assignment[bestWhiteKingIdx] = 7;
	const remainingPieceIdxs = [0, 2, 3, 4, 5, 6, 8, 9, 10, 11];
	for (let i = 0; i < 64; i++) {
		if (assignment[i] !== -1) continue;
		let bestIdx: number | null = null;
		let bestScore = 0.22;
		for (const j of remainingPieceIdxs) {
			const square = SQUARE_NAMES[i];
			const badRank = square[1] === '1' || square[1] === '8';
			const isPawn = PIECE_SYMBOLS[j % 6] === 'p';
			if (isPawn && badRank) continue;
			const score = state[i][j];
			if (score > bestScore) {
				bestIdx = j;
				bestScore = score;
			}
		}
		if (bestIdx !== null) assignment[i] = bestIdx;
	}
	const board = new Chess();
	board.clear();
	for (let i = 0; i < 64; i++) {
		if (assignment[i] === -1) continue;
		const piece = PIECE_SYMBOLS[assignment[i] % 6];
		const pieceColor: Color = assignment[i] > 5 ? 'w' : 'b';
		const square = SQUARE_NAMES[i];
		board.put({ type: piece, color: pieceColor }, square);
	}
	let fen = board.fen();
	const otherColor: Color = color === 'w' ? 'b' : 'w';
	fen = fen.replace(` ${otherColor} `, ` ${color} `);
	for (let i = 0; i < 64; i++) {
		const square = SQUARE_NAMES[i];
		const piece = board.get(square);
		if (!piece) continue;
		const isKing = piece.type === 'k';
		const isOtherColor = piece.color === otherColor;
		const isAttacked = board.isAttacked(square, color);
		if (isKing && isOtherColor && isAttacked) {
			return { fen, error: 'Side to move has opponent in check' };
		}
	}
	return { fen, error: null };
}

/**
 * Run pieces model with keypoints and return FEN for the current frame.
 */
export async function findFen(
	videoRef: VideoRef,
	piecesModel: GraphModel,
	keypoints: number[][],
	sideToMove: Color = 'w'
): Promise<{ fen: string; error: string | null }> {
	if (invalidVideo(videoRef)) {
		return { fen: '', error: 'Video not ready' };
	}
	const invTransform = getInvTransform(keypoints);
	const [, centers3D] = transformCenters(invTransform);
	const [, boundary3D] = transformBoundary(invTransform);
	const videoWidth = videoRef.current.videoWidth;
	const videoHeight = videoRef.current.videoHeight;
	const { image4D, width, height, padding, roi } = getInput(videoRef, keypoints, 8);
	const preds = piecesModel.predict(image4D) as tf.Tensor3D;
	const { boxes, scores } = getBoxesAndScores(
		preds,
		width,
		height,
		videoWidth,
		videoHeight,
		padding,
		roi
	);
	const squares = getSquares(boxes, centers3D, boundary3D);
	const update = getUpdate(scores, squares);
	tf.dispose([image4D, preds, boxes, scores, centers3D, boundary3D]);
	return stateToFen(update, sideToMove);
}
