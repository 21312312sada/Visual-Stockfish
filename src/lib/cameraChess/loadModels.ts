/**
 * Load LeYOLO TFJS models (CameraChessWeb-style).
 * Models are in static/480M_pieces_float16/ and static/480L_xcorners_float16/
 * @see https://github.com/Pbatch/CameraChessWeb
 */

import '@tensorflow/tfjs-backend-webgl';
import * as tf from '@tensorflow/tfjs-core';
import { loadGraphModel, type GraphModel } from '@tensorflow/tfjs-converter';
import { MODEL_HEIGHT, MODEL_WIDTH, PIECES_MODEL_URL, XCORNERS_MODEL_URL } from './constants';

export interface LoadedModels {
	pieces: GraphModel;
	xcorners: GraphModel;
}

let cached: LoadedModels | null = null;

function wrapModelLoadError(url: string, err: unknown): Error {
	const msg =
		err instanceof Error ? err.message : String(err);
	const is404 = msg.includes('404') || msg.includes('status code 404');
	const hint =
		'Add the TFJS model files to the static folder (see static/480M_pieces_float16/README.md and static/480L_xcorners_float16/README.md, or the main README).';
	return new Error(
		is404
			? `Model not found at ${url}. ${hint}`
			: `Failed to load model from ${url}: ${msg}`
	);
}

export async function loadModels(): Promise<LoadedModels> {
	if (cached) return cached;
	await tf.ready();
	tf.env().set('WEBGL_EXP_CONV', true);
	tf.env().set('WEBGL_PACK', false);
	tf.env().set('ENGINE_COMPILE_ONLY', true);
	const dummyInput = tf.zeros([1, MODEL_HEIGHT, MODEL_WIDTH, 3]);
	let piecesModel;
	let xcornersModel;
	try {
		piecesModel = await loadGraphModel(PIECES_MODEL_URL);
	} catch (e) {
		throw wrapModelLoadError(PIECES_MODEL_URL, e);
	}
	const piecesOutput = piecesModel.predict(dummyInput);
	try {
		xcornersModel = await loadGraphModel(XCORNERS_MODEL_URL);
	} catch (e) {
		tf.dispose([dummyInput, piecesOutput as tf.Tensor]);
		throw wrapModelLoadError(XCORNERS_MODEL_URL, e);
	}
	const xcornersOutput = xcornersModel.predict(dummyInput);
	tf.dispose([dummyInput, piecesOutput as tf.Tensor, xcornersOutput as tf.Tensor]);
	const backend = tf.backend() as { checkCompileCompletion?: () => void; getUniformLocations?: () => void };
	if (backend.checkCompileCompletion) backend.checkCompileCompletion();
	if (backend.getUniformLocations) backend.getUniformLocations();
	tf.env().set('ENGINE_COMPILE_ONLY', false);
	cached = { pieces: piecesModel, xcorners: xcornersModel };
	return cached;
}
