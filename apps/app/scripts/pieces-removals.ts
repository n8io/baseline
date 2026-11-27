// What removing each Piece does: its paths, env lines, package.json scripts and refusals. The paths,
// env lines and scripts come from piece-manifest.ts; only the Pieces whose removal runs code beyond
// those lists have a hook here.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	type Manifest,
	manifestEdit,
	recordOmit,
	textEdit,
} from "./pieces-manifest.ts";
import { type Piece, pieceNames, pieces } from "./pieces-names.ts";
import { uiEdit } from "./pieces-removals-ui.ts";
import { piecesRemovedFind, trackedFiles } from "./pieces-signs.ts";

export { pieceScheduleLines } from "./piece-manifest.ts";

type PieceRemoval = {
	// Paths from the Project root, deleted when present.
	paths: readonly string[];
	// Files under src/ deleted by name.
	srcFiles: RegExp | undefined;
	// Edits the env files, package.json scripts and the files that cannot carry markers.
	edit: (directory: string) => void;
	// Why it cannot go yet, if it cannot.
	refusal: ((directory: string) => string | undefined) | undefined;
};

type PieceHook = {
	edit?: (directory: string) => void;
	refusal?: (directory: string) => string | undefined;
};

// The `dev` script's worker line, which the queue removal takes out (structure.test.ts holds it to it).
export const pieceDevWorker =
	/\(varlock run -- sh -c 'HEALTH_PORT=\$\(\(HEALTH_PORT \+ 1\)\) exec node --watch --import \.\/src\/preload\.ts src\/worker\.ts' & ([^)]*)\)/;

// What only some Pieces' removals need beyond the manifest: a script edit, a refusal, a UI removal.
const pieceHooks: Partial<Record<Piece, PieceHook>> = {
	queue: {
		edit: (directory) =>
			manifestEdit(directory, (manifest) => ({
				...manifest,
				scripts: {
					...manifest.scripts,
					dev: manifest.scripts["dev"]?.replace(pieceDevWorker, "$1"),
				},
			})),
		refusal: (directory) =>
			trackedFiles(directory).some(
				(path) =>
					path.startsWith("src/") &&
					!/\.test\.tsx?$/.test(path) &&
					readFileSync(join(directory, path), "utf8").includes(
						"queueConsumerCreate",
					),
			)
				? "Remove your Event handlers first: they run only in the Worker."
				: undefined,
	},
	redis: {
		refusal: (directory) => {
			const removed = piecesRemovedFind(directory);
			return removed.includes("cache") && removed.includes("live")
				? undefined
				: "Remove the cache and live updates first: both run on Redis.";
		},
	},
	sdk: {
		refusal: (directory) =>
			existsSync(join(directory, "clients/cli/package.json"))
				? "Remove the cli first: it runs on the SDK."
				: undefined,
	},
	ui: { edit: uiEdit },
};

// The env lines and package.json scripts the manifest names, then the Piece's hook.
const pieceEdit = (directory: string, piece: Piece) => {
	for (const { envs, lines } of pieces[piece].envs ?? []) {
		for (const env of envs) {
			textEdit({
				directory,
				path: `.env.${env}`,
				edit: (text) =>
					lines.reduce((edited, line) => edited.replace(line, ""), text),
			});
		}
	}
	const scripts = pieces[piece].scripts ?? [];
	if (scripts.length > 0) {
		manifestEdit(directory, (manifest) => ({
			...manifest,
			scripts: recordOmit(manifest.scripts, scripts) as Manifest["scripts"],
		}));
	}
	pieceHooks[piece]?.edit?.(directory);
};

const pieceRemovalOf = (piece: Piece): PieceRemoval => ({
	edit: (directory) => pieceEdit(directory, piece),
	paths: pieces[piece].paths,
	refusal: pieceHooks[piece]?.refusal,
	srcFiles: pieces[piece].srcFiles,
});

// Object.fromEntries widens the keys to string; they are exactly pieceNames, which is Piece[].
export const pieceRemovals = Object.fromEntries(
	pieceNames.map((piece) => [piece, pieceRemovalOf(piece)]),
) as Record<Piece, PieceRemoval>;
