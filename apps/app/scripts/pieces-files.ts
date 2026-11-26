// Deleting a Piece's files, blocks and edits from a Project or a rendered tree.
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
	dependenciesAllowedPieceRemove,
	manifestEdit,
	recordOmit,
} from "./pieces-manifest.ts";
import { pieceBlocksRemove, pieceMarkersProblems } from "./pieces-markers.ts";
import { type Piece, pieces } from "./pieces-names.ts";
import { pieceRemovals } from "./pieces-removals.ts";
import { pieceSettingsRead } from "./pieces-settings.ts";
import { trackedFiles } from "./pieces-signs.ts";

// A test file that lost every test with its blocks has nothing left to run.
const testCall = /(?<![.\w])(?:it|test)(?:\.\w+)*[(`]/;
const testsLeft = (text: string) =>
	testCall.test(text.replace(/^\s*\/\/.*$/gm, ""));

// Every file under a directory that is not a git checkout, as paths from it.
export const filesWalk = (directory: string): string[] =>
	readdirSync(directory, { recursive: true, withFileTypes: true })
		.filter((e) => e.isFile() && !e.parentPath.includes("node_modules"))
		.map((e) => relative(directory, join(e.parentPath, e.name)));

// Deletes the Piece's files and blocks and edits what carries no markers. Leaves packages alone.
// `filesList` says which files exist.
const filesRemove = ({
	directory,
	filesList,
	piece,
}: {
	directory: string;
	filesList: (directory: string) => string[];
	piece: Piece;
}) => {
	const removal = pieceRemovals[piece];
	for (const path of filesList(directory)) {
		if (path.endsWith(".md")) continue;
		const problems = pieceMarkersProblems(
			readFileSync(join(directory, path), "utf8"),
		);
		if (problems.length > 0) {
			throw new Error(
				`piece markers in ${path} do not balance: ${problems.join("; ")}`,
			);
		}
	}
	for (const path of [
		...removal.paths,
		...(pieceSettingsRead(directory).files[piece] ?? []),
	]) {
		rmSync(join(directory, path), { force: true, recursive: true });
	}
	for (const path of filesList(directory)) {
		if (removal.srcFiles?.test(path) && path.startsWith("src/")) {
			rmSync(join(directory, path));
		}
	}
	const start = `piece-start: ${piece}`;
	for (const path of filesList(directory)) {
		if (path.endsWith(".md")) continue;
		const file = join(directory, path);
		const text = readFileSync(file, "utf8");
		if (!text.includes(start)) continue;
		const edited = pieceBlocksRemove(text, piece);
		if (/\.test\.tsx?$/.test(path) && !testsLeft(edited)) {
			rmSync(file);
		} else if (edited !== text) {
			writeFileSync(file, edited);
		}
	}
	removal.edit?.(directory);
	const left = filesList(directory).filter(
		(path) =>
			!path.endsWith(".md") &&
			new RegExp(`^[ \\t]*(//|#) ${start}$`, "m").test(
				readFileSync(join(directory, path), "utf8"),
			),
	);
	if (left.length > 0) {
		throw new Error(`${start} has no matching piece-end in ${left.join(", ")}`);
	}
};

export const pieceFilesRemove = (directory: string, piece: Piece) =>
	filesRemove({ directory, filesList: trackedFiles, piece });

// A freshly rendered tree as a Project that removed those Pieces would have it: the Pieces' files,
// blocks, env lines and packages, by the same file, block, env and package steps as `pnpm piece-remove`. template-upgrade
// renders both releases this way, so a removed Piece never comes back.
export const piecesRemoveFromTree = (directory: string, removed: Piece[]) => {
	for (const piece of removed) {
		filesRemove({ directory, filesList: filesWalk, piece });
		const { packages } = pieces[piece];
		manifestEdit(directory, (manifest) => ({
			...manifest,
			dependencies: recordOmit(manifest.dependencies, packages),
			devDependencies: recordOmit(manifest.devDependencies, packages),
		}));
		dependenciesAllowedPieceRemove(directory, piece);
	}
};
