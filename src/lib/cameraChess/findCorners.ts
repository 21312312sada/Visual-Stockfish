/**
 * Find board corners from video using pieces + xcorners models (CameraChessWeb-style).
 * Returns 4 keypoints in model coords [h1, a1, a8, h8] or null.
 */

import * as tf from '@tensorflow/tfjs-core';
import type { GraphModel } from '@tensorflow/tfjs-converter';
import Delaunator from 'delaunator';
import { getPerspectiveTransform, perspectiveTransform } from './warp';
import {
	getBoxesAndScores,
	getCenters,
	getInput,
	invalidVideo,
	type VideoRef
} from './detect';
import { MODEL_WIDTH, MODEL_HEIGHT } from './constants';
import { clamp } from './math';

const IDEAL_QUAD: number[][] = [[0, 1], [1, 1], [1, 0], [0, 0]];
/** 7×7 internal grid at positions 1-7 (8 squares per side). Warped xcorners are 0-1, scale by 8 to match. */
const GRID = Array.from({ length: 7 }, (_, y) => Array.from({ length: 7 }, (_, x) => [x + 1, y + 1])).flat();

async function processBoxesAndScores(
	boxes: tf.Tensor2D,
	scores: tf.Tensor2D
): Promise<number[][]> {
	const maxScores = tf.max(scores, 1);
	const argmaxScores = tf.argMax(scores, 1);
	const nms = await tf.image.nonMaxSuppressionAsync(boxes, maxScores, 150, 0.35, 0.04);
	const resTensor = tf.tidy(() => {
		const centers = getCenters(tf.gather(boxes, nms, 0));
		const cls = tf.expandDims(tf.gather(argmaxScores, nms, 0), 1);
		return tf.concat([centers, cls], 1);
	});
	const res = resTensor.arraySync() as number[][];
	tf.dispose([nms, resTensor, boxes, scores, argmaxScores, maxScores]);
	return res;
}

async function runPiecesModel(videoRef: VideoRef, piecesModel: GraphModel): Promise<number[][]> {
	const videoWidth = videoRef.current.videoWidth;
	const videoHeight = videoRef.current.videoHeight;
	const { image4D, width, height, padding, roi } = getInput(videoRef);
	const piecesPreds = piecesModel.predict(image4D) as tf.Tensor3D;
	const { boxes, scores } = getBoxesAndScores(
		piecesPreds,
		width,
		height,
		videoWidth,
		videoHeight,
		padding,
		roi
	);
	const pieces = await processBoxesAndScores(boxes, scores);
	tf.dispose([piecesPreds, image4D]);
	return pieces;
}

async function runXcornersModel(
	videoRef: VideoRef,
	xcornersModel: GraphModel,
	pieces: number[][]
): Promise<number[][]> {
	const keypoints = pieces.map((x) => [x[0], x[1]]);
	const videoWidth = videoRef.current.videoWidth;
	const videoHeight = videoRef.current.videoHeight;
	const { image4D, width, height, padding, roi } = getInput(videoRef, keypoints, 4);
	const xcornersPreds = xcornersModel.predict(image4D) as tf.Tensor3D;
	const { boxes, scores } = getBoxesAndScores(
		xcornersPreds,
		width,
		height,
		videoWidth,
		videoHeight,
		padding,
		roi
	);
	tf.dispose([xcornersPreds, image4D]);
	let xCorners = await processBoxesAndScores(boxes, scores);
	return xCorners.map((x) => [x[0], x[1]]);
}

function getQuads(xCorners: number[][]): number[][][] {
	const intXcorners = xCorners.flat().map((x) => Math.round(x));
	const delaunay = new Delaunator(intXcorners);
	const triangles = delaunay.triangles;
	const quads: number[][][] = [];
	for (let i = 0; i < triangles.length; i += 3) {
		const t1 = triangles[i];
		const t2 = triangles[i + 1];
		const t3 = triangles[i + 2];
		const quad = [t1, t2, t3, -1];
		for (let j = 0; j < triangles.length; j += 3) {
			if (i === j) continue;
			const cond1 =
				(t1 === triangles[j] && t2 === triangles[j + 1]) ||
				(t1 === triangles[j + 1] && t2 === triangles[j]);
			const cond2 =
				(t2 === triangles[j] && t3 === triangles[j + 1]) ||
				(t2 === triangles[j + 1] && t3 === triangles[j]);
			const cond3 =
				(t3 === triangles[j] && t1 === triangles[j + 1]) ||
				(t3 === triangles[j + 1] && t1 === triangles[j]);
			if (cond1 || cond2 || cond3) {
				quad[3] = triangles[j + 2];
				break;
			}
		}
		if (quad[3] !== -1) {
			quads.push(quad.map((idx) => xCorners[idx]));
		}
	}
	return quads;
}

function cdist(a: number[][], b: number[][]): number[][] {
	return a.map((ai) => b.map((bj) => Math.hypot(ai[0] - bj[0], ai[1] - bj[1])));
}

function calculateOffsetScore(warpedXcorners: number[][], shift: number[]): number {
	const grid = GRID.map(([x, y]) => [x + shift[0], y + shift[1]]);
	const dist = cdist(grid, warpedXcorners);
	let cost = 0;
	for (let i = 0; i < dist.length; i++) cost += Math.min(...dist[i]);
	return 1 / (1 + cost);
}

	function findOffset(warpedXcorners: number[][]): number[] {
		const bestOffset = [0, 0];
		for (let i = 0; i < 2; i++) {
			let low = -1;
			let high = 2;
		const scores: Record<number, number> = {};
		while (high - low > 1) {
			const mid = (high + low) >> 1;
			for (const x of [mid, mid + 1]) {
				if (!(x in scores)) {
					const shift = [0, 0];
					shift[i] = x;
					scores[x] = calculateOffsetScore(warpedXcorners, shift);
				}
			}
			if (scores[mid] > scores[mid + 1]) high = mid;
			else low = mid;
		}
		bestOffset[i] = low + 1;
	}
	return bestOffset;
}

function quadArea(quad: number[][]): number {
	let a = 0;
	for (let i = 0; i < 4; i++) {
		const j = (i + 1) % 4;
		a += quad[i][0] * quad[j][1] - quad[j][0] * quad[i][1];
	}
	return Math.abs(a) / 2;
}

function scoreQuad(
	quad: number[][],
	xCorners: number[][]
): [number, import('vectorious').NDArray, number[]] {
	const M = getPerspectiveTransform(IDEAL_QUAD, quad);
	const warped01 = perspectiveTransform(xCorners, M);
	const warpedXcorners = warped01.map(([u, v]) => [u * 8, v * 8]);
	const offset = findOffset(warpedXcorners);
	const alignScore = calculateOffsetScore(warpedXcorners, offset);
	const area = quadArea(quad);
	const maxArea = MODEL_WIDTH * MODEL_HEIGHT * 0.95;
	const areaScore = area > 1000 ? Math.min(1, area / maxArea) : 0;
	const score = alignScore * 0.85 + areaScore * 0.15;
	return [score, M, offset];
}

/** Expand corners outward from board center to align with true board edges. */
function refineCorners(corners: number[][], expandPct = 0.05): number[][] {
	const cx = corners.reduce((s, c) => s + c[0], 0) / 4;
	const cy = corners.reduce((s, c) => s + c[1], 0) / 4;
	return corners.map((c) => {
		const dx = c[0] - cx;
		const dy = c[1] - cy;
		const len = Math.hypot(dx, dy) || 1;
		const expand = len * expandPct;
		return [
			clamp(c[0] + (dx / len) * expand, 0, MODEL_WIDTH),
			clamp(c[1] + (dy / len) * expand, 0, MODEL_HEIGHT)
		];
	});
}

function findCornersFromXcorners(xCorners: number[][]): number[][] | undefined {
	const quads = getQuads(xCorners);
	if (quads.length === 0) return undefined;
	let [bestScore, bestM, bestOffset] = scoreQuad(quads[0], xCorners);
	for (let i = 1; i < quads.length; i++) {
		const [score, M, offset] = scoreQuad(quads[i], xCorners);
		if (score > bestScore) {
			bestScore = score;
			bestM = M;
			bestOffset = offset;
		}
	}
	const invM = bestM.inv();
	const warpedCorners = [[0, 0], [0, 1], [1, 1], [1, 0]];
	let corners = perspectiveTransform(warpedCorners, invM);
	for (let i = 0; i < 4; i++) {
		corners[i][0] = clamp(corners[i][0], 0, MODEL_WIDTH);
		corners[i][1] = clamp(corners[i][1], 0, MODEL_HEIGHT);
	}
	corners = refineCorners(corners);
	return corners;
}

function getCenter(points: number[][]): number[] {
	const sum = points.reduce((a, b) => [a[0] + b[0], a[1] + b[1]], [0, 0]);
	return [sum[0] / points.length, sum[1] / points.length];
}

/**
 * Corners from findCornersFromXcorners are [a8, a1, h1, h8] (top-left, bottom-left, bottom-right, top-right).
 * We need [h1, a1, a8, h8] for getInvTransform.
 */
function cornersToKeypoints(corners: number[][]): number[][] {
	return [corners[2], corners[1], corners[0], corners[3]];
}

function calculateKeypoints(
	blackPieces: number[][],
	whitePieces: number[][],
	corners: number[][]
): number[][] {
	const blackCenter = getCenter(blackPieces);
	const whiteCenter = getCenter(whitePieces);
	const base = cornersToKeypoints(corners);
	let bestRot = 0;
	let bestScore = 0;
	for (let rot = 0; rot < 4; rot++) {
		const kw = [
			(base[rot % 4][0] + base[(rot + 1) % 4][0]) / 2,
			(base[rot % 4][1] + base[(rot + 1) % 4][1]) / 2
		];
		const kb = [
			(base[(rot + 2) % 4][0] + base[(rot + 3) % 4][0]) / 2,
			(base[(rot + 2) % 4][1] + base[(rot + 3) % 4][1]) / 2
		];
		const score =
			1 / (1 + Math.hypot(whiteCenter[0] - kw[0], whiteCenter[1] - kw[1]) + Math.hypot(blackCenter[0] - kb[0], blackCenter[1] - kb[1]));
		if (score > bestScore) {
			bestScore = score;
			bestRot = rot;
		}
	}
	return [
		base[bestRot % 4],
		base[(bestRot + 1) % 4],
		base[(bestRot + 2) % 4],
		base[(bestRot + 3) % 4]
	];
}

/**
 * Find 4 board corners (keypoints in model coords, order h1, a1, a8, h8).
 */
export async function findCorners(
	videoRef: VideoRef,
	models: { pieces: GraphModel; xcorners: GraphModel }
): Promise<{ keypoints: number[][]; message: string } | { keypoints: null; message: string }> {
	if (invalidVideo(videoRef)) {
		return { keypoints: null, message: 'Video not ready' };
	}
	const pieces = await runPiecesModel(videoRef, models.pieces);
	const blackPieces = pieces.filter((x) => x[2] <= 5);
	const whitePieces = pieces.filter((x) => x[2] > 5);
	if (pieces.length < 4) {
		return { keypoints: null, message: 'Need at least 4 pieces detected' };
	}
	const xCorners = await runXcornersModel(videoRef, models.xcorners, pieces);
	if (xCorners.length < 4) {
		return { keypoints: null, message: `Need ≥4 xCorners (detected ${xCorners.length})` };
	}
	const corners = findCornersFromXcorners(xCorners);
	if (!corners) {
		return { keypoints: null, message: 'Failed to find board corners' };
	}
	const keypoints =
		blackPieces.length > 0 && whitePieces.length > 0
			? calculateKeypoints(blackPieces, whitePieces, corners)
			: cornersToKeypoints(corners);
	return { keypoints, message: 'Corners found' };
}
