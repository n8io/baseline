// What tells which Pieces a Project holds, and the files git tracks in it.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { packagesInstalled } from "./pieces-manifest.ts";
import { type Piece, pieceNames, pieceSign, pieces } from "./pieces-names.ts";
import { gitRun } from "./process-run.ts";

// The app's packages and the Piece folders the Project holds: every pieceSign it shows.
export const pieceSignsFind = (directory: string): Set<string> =>
	new Set([
		...packagesInstalled(directory),
		...Object.values(pieces).flatMap(({ folder }) =>
			folder !== undefined &&
			existsSync(join(directory, folder, "package.json"))
				? [folder]
				: [],
		),
	]);

export const trackedFiles = (directory: string): string[] =>
	gitRun(directory, ["ls-files", "-z"])
		.split("\0")
		.filter((p) => p !== "" && existsSync(join(directory, p)));

// Every Piece whose pieceSign the Project lacks, redis included: the Pieces it removed.
export const piecesRemovedFind = (directory: string): Piece[] => {
	const signs = pieceSignsFind(directory);
	return pieceNames.filter((piece) => !signs.has(pieceSign(piece)));
};
