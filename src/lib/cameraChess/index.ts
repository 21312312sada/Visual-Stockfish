/**
 * CameraChessWeb-style pipeline: load LeYOLO models, find corners, get FEN.
 * @see https://github.com/Pbatch/CameraChessWeb
 */

export { loadModels, type LoadedModels } from './loadModels';
export { findCorners } from './findCorners';
export { findFen } from './findFen';
export { invalidVideo, type VideoRef } from './detect';
export {
	MODEL_WIDTH,
	MODEL_HEIGHT,
	PIECES_MODEL_URL,
	XCORNERS_MODEL_URL
} from './constants';
