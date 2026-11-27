// The Pieces of the stack: each one's identity once, and what removing it does. pnpm piece-remove
// (scripts/piece-remove.ts) is the command; piece-check, template-upgrade, model-create,
// context-create and structure.test.ts import from here. Not a command: importing it runs nothing.

export {
	filesWalk,
	pieceFilesRemove,
	piecesRemoveFromTree,
} from "./pieces-files.ts";
export { packagesInstalled } from "./pieces-manifest.ts";
export { pieceBlocksRemove, pieceMarkersProblems } from "./pieces-markers.ts";
export {
	type Piece,
	pieceIsKnown,
	pieceNames,
	pieceSign,
	pieces,
} from "./pieces-names.ts";
export {
	pieceDevWorker,
	pieceRemovals,
	pieceScheduleLines,
} from "./pieces-removals.ts";
export { pieceDevUi } from "./pieces-removals-ui.ts";
export {
	filesNamedIn,
	type PieceRemoveFailure,
	pieceRemove,
	pnpmRun,
} from "./pieces-run.ts";
export { type PieceSettings, pieceSettingsRead } from "./pieces-settings.ts";
export { pieceSignsFind, piecesRemovedFind } from "./pieces-signs.ts";
export { pieceRemoveRefusal, pieceUsage } from "./pieces-usage.ts";
