// What `.template.json` says about Pieces, read and checked.
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import { pieceIsKnown, pieceNames } from "./pieces-names.ts";

// What `.template.json` says about Pieces: `piecesKept`, the Pieces this Project keeps, and
// `pieceFiles`, the Project's own paths that go with a Piece, such as a test that exercises it.
// They live there, not in pieceRemovals, so scripts/pieces.ts stays the Template's and upgrades never conflict on them.
export type PieceSettings = { files: Record<string, string[]>; kept: string[] };

export const pieceSettingsRead = (directory: string): PieceSettings => {
	const file = join(directory, ".template.json");
	if (!existsSync(file)) return { files: {}, kept: [] };
	let template: { pieceFiles?: unknown; piecesKept?: unknown };
	try {
		template = JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		throw new Error(
			`.template.json is not valid JSON: ${(error as Error).message}`,
		);
	}
	if (typeof template !== "object" || template === null) {
		throw new Error(".template.json must hold an object");
	}
	const names = pieceNames.join(", ");
	const kept = template.piecesKept ?? [];
	if (!Array.isArray(kept) || kept.some((p) => typeof p !== "string")) {
		throw new Error(
			`piecesKept in .template.json must be a list of Piece names; Pieces are ${names}`,
		);
	}
	const keptUnknown = kept.filter((p) => !pieceIsKnown(p));
	if (keptUnknown.length > 0) {
		throw new Error(
			`piecesKept in .template.json names ${keptUnknown.join(", ")}, which is no Piece; Pieces are ${names}`,
		);
	}
	const files = template.pieceFiles ?? {};
	if (typeof files !== "object" || files === null || Array.isArray(files)) {
		throw new Error(
			'pieceFiles in .template.json must map a piece to its paths, such as { "ui": ["test/ui"] }',
		);
	}
	for (const [piece, paths] of Object.entries(files)) {
		if (!pieceIsKnown(piece)) {
			throw new Error(
				`pieceFiles in .template.json names ${piece}, which is no Piece; Pieces are ${names}`,
			);
		}
		if (!Array.isArray(paths) || paths.some((p) => typeof p !== "string")) {
			throw new Error(
				`pieceFiles.${piece} in .template.json must be a list of paths`,
			);
		}
		const outside = paths.filter(
			(p) =>
				isAbsolute(p) ||
				[".", ""].includes(normalize(p).replace(/\/$/, "")) ||
				normalize(p).split("/")[0] === "..",
		);
		if (outside.length > 0) {
			throw new Error(
				`pieceFiles.${piece} in .template.json names ${outside.join(", ")}, which is not a path inside the Project; give paths from the Project root, such as test/ui`,
			);
		}
	}
	return { files: files as Record<string, string[]>, kept };
};
