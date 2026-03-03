/**
 * Detection helpers: getInput, getBoxesAndScores, getCenters (CameraChessWeb-style).
 */

import * as tf from '@tensorflow/tfjs-core';
import { MODEL_WIDTH, MODEL_HEIGHT } from './constants';

export interface VideoRef {
	current: HTMLVideoElement;
}

export function invalidVideo(videoRef: VideoRef): boolean {
	if (!videoRef?.current) return true;
	const v = videoRef.current;
	if (v.readyState < 2) return true;
	if (!v.videoWidth || !v.videoHeight) return true;
	return false;
}

export function getBbox(points: number[][]): { xmin: number; xmax: number; ymin: number; ymax: number; width: number; height: number } {
	const xs = points.map((p) => p[0]);
	const ys = points.map((p) => p[1]);
	const xmin = Math.min(...xs);
	const xmax = Math.max(...xs);
	const ymin = Math.min(...ys);
	const ymax = Math.max(...ys);
	return { xmin, xmax, ymin, ymax, width: xmax - xmin, height: ymax - ymin };
}

export function getInput(
	videoRef: VideoRef,
	keypoints: number[][] | null = null,
	paddingRatio = 12
): { image4D: tf.Tensor4D; width: number; height: number; padding: number[]; roi: number[] } {
	const videoWidth = videoRef.current.videoWidth;
	const videoHeight = videoRef.current.videoHeight;
	let roi: number[];
	if (keypoints !== null && keypoints.length >= 4) {
		const bbox = getBbox(keypoints);
		let paddingLeft = Math.floor(bbox.width / paddingRatio);
		let paddingRight = Math.floor(bbox.width / paddingRatio);
		let paddingTop = Math.floor(bbox.height / paddingRatio);
		const paddingBottom = Math.floor(bbox.height / paddingRatio);
		const paddedRoiWidth = bbox.width + paddingLeft + paddingRight;
		const paddedRoiHeight = bbox.height + paddingTop + paddingBottom;
		const ratio = paddedRoiHeight / paddedRoiWidth;
		const desiredRatio = MODEL_HEIGHT / MODEL_WIDTH;
		if (ratio > desiredRatio) {
			const targetWidth = paddedRoiHeight / desiredRatio;
			const dx = targetWidth - paddedRoiWidth;
			paddingLeft += Math.floor(dx / 2);
			paddingRight += dx - Math.floor(dx / 2);
		} else {
			paddingTop = Math.round(paddedRoiWidth * desiredRatio - paddedRoiHeight);
		}
		roi = [
			Math.round(Math.max((videoWidth * (bbox.xmin - paddingLeft)) / MODEL_WIDTH, 0)),
			Math.round(Math.max((videoHeight * (bbox.ymin - paddingTop)) / MODEL_HEIGHT, 0)),
			Math.round(Math.min((videoWidth * (bbox.xmax + paddingRight)) / MODEL_WIDTH, videoWidth)),
			Math.round(Math.min((videoHeight * (bbox.ymax + paddingBottom)) / MODEL_HEIGHT, videoHeight))
		];
	} else {
		roi = [0, 0, videoWidth, videoHeight];
	}
	const [image4D, width, height, padding] = tf.tidy(() => {
		let image: tf.Tensor3D = tf.browser.fromPixels(videoRef.current);
		image = tf.slice(image, [roi[1], roi[0], 0], [roi[3] - roi[1], roi[2] - roi[0], 3]);
		const h = image.shape[0];
		const w = image.shape[1];
		const ratio = h / w;
		const desiredRatio = MODEL_HEIGHT / MODEL_WIDTH;
		let resizeHeight = MODEL_HEIGHT;
		let resizeWidth = MODEL_WIDTH;
		if (ratio > desiredRatio) {
			resizeWidth = Math.round(MODEL_HEIGHT / ratio);
		} else {
			resizeHeight = Math.round(MODEL_WIDTH * ratio);
		}
		image = tf.image.resizeBilinear(image, [resizeHeight, resizeWidth]);
		const dx = MODEL_WIDTH - image.shape[1];
		const dy = MODEL_HEIGHT - image.shape[0];
		const padRight = Math.floor(dx / 2);
		const padLeft = dx - padRight;
		const padBottom = Math.floor(dy / 2);
		const padTop = dy - padBottom;
		const pad = [padLeft, padRight, padTop, padBottom];
		image = tf.pad(image, [[padTop, padBottom], [padLeft, padRight], [0, 0]], 114);
		const image4D = tf.expandDims(tf.div(image, 255.0), 0) as tf.Tensor4D;
		return [image4D, w, h, pad];
	});
	return { image4D, width, height, padding, roi };
}

export function getBoxesAndScores(
	preds: tf.Tensor3D,
	width: number,
	height: number,
	videoWidth: number,
	videoHeight: number,
	padding: number[],
	roi: number[]
): { boxes: tf.Tensor2D; scores: tf.Tensor2D } {
	return tf.tidy(() => {
		const predsT = tf.transpose(preds, [0, 2, 1]);
		const w = tf.slice(predsT, [0, 0, 2], [-1, -1, 1]);
		const h = tf.slice(predsT, [0, 0, 3], [-1, -1, 1]);
		let l = tf.sub(tf.slice(predsT, [0, 0, 0], [-1, -1, 1]), tf.div(w, 2));
		let t = tf.sub(tf.slice(predsT, [0, 0, 1], [-1, -1, 1]), tf.div(h, 2));
		let r = tf.add(l, w);
		let b = tf.add(t, h);
		l = tf.sub(l, padding[0]);
		r = tf.sub(r, padding[0]);
		t = tf.sub(t, padding[2]);
		b = tf.sub(b, padding[2]);
		l = tf.mul(l, width / (MODEL_WIDTH - padding[0] - padding[1]));
		r = tf.mul(r, width / (MODEL_WIDTH - padding[0] - padding[1]));
		t = tf.mul(t, height / (MODEL_HEIGHT - padding[2] - padding[3]));
		b = tf.mul(b, height / (MODEL_HEIGHT - padding[2] - padding[3]));
		l = tf.add(l, roi[0]);
		r = tf.add(r, roi[0]);
		t = tf.add(t, roi[1]);
		b = tf.add(b, roi[1]);
		l = tf.mul(l, MODEL_WIDTH / videoWidth);
		r = tf.mul(r, MODEL_WIDTH / videoWidth);
		t = tf.mul(t, MODEL_HEIGHT / videoHeight);
		b = tf.mul(b, MODEL_HEIGHT / videoHeight);
		const boxes = tf.squeeze(tf.concat([l, t, r, b], 2)) as tf.Tensor2D;
		const scores = tf.squeeze(tf.slice(predsT, [0, 0, 4], [-1, -1, predsT.shape[2] - 4]), [0]) as tf.Tensor2D;
		return { boxes, scores };
	});
}

export function getCenters(boxes: tf.Tensor2D): tf.Tensor2D {
	return tf.tidy(() => {
		const l = tf.slice(boxes, [0, 0], [-1, 1]);
		const t = tf.slice(boxes, [0, 1], [-1, 1]);
		const r = tf.slice(boxes, [0, 2], [-1, 1]);
		const b = tf.slice(boxes, [0, 3], [-1, 1]);
		const cx = tf.div(tf.add(l, r), 2);
		const cy = tf.div(tf.add(t, b), 2);
		return tf.concat([cx, cy], 1);
	});
}

export function getXY(markerXY: number[], height: number, width: number): number[] {
	const sx = MODEL_WIDTH / width;
	const sy = MODEL_HEIGHT / height;
	return [sx * markerXY[0], sy * (markerXY[1] + height + 50)];
}

export function getMarkerXY(xy: number[], height: number, width: number): number[] {
	const sx = width / MODEL_WIDTH;
	const sy = height / MODEL_HEIGHT;
	return [sx * xy[0], sy * xy[1] - height - 50];
}
