// template-upgrade's Piece and rename steps: which Pieces the Project removed and arrive again,
// and the renames the target release lists, followed in the Project's own files.
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Piece, pieceSign, pieces } from "./pieces.ts";
import {
	renameFilesPlan,
	renameStepsApply,
	renameStepsBetween,
	renameStepsParse,
} from "./template-renames.ts";
import { filesRead, type TemplateFile } from "./template-render.ts";

// A Piece whose package (or folder) the Project's own release did not have yet is new, not removed: it arrives.
export const pieceInRelease = (files: TemplateFile[]) => {
	const manifest = JSON.parse(
		files.find((f) => f.path === "package.json")?.text ?? "{}",
	) as Record<string, Record<string, string> | undefined>;
	const names = new Set([
		...Object.keys(manifest["dependencies"] ?? {}),
		...Object.keys(manifest["devDependencies"] ?? {}),
	]);
	return (piece: Piece) => {
		const { folder } = pieces[piece];
		return folder === undefined
			? names.has(pieceSign(piece))
			: files.some((f) => f.path.startsWith(`${folder}/`));
	};
};

// A Piece that must go before a removed one (the cli before the sdk) cannot arrive without it.
export const piecesRemovedWith = (removed: Piece[]): Piece[] => [
	...new Set([
		...removed,
		...removed.flatMap((piece) => pieces[piece].after ?? []),
	]),
];

// Applies the renames the target release lists, after the merge, to the Project's own files:
// moves its files, then renames the names and import paths its code uses.
export const renamesFollow = ({
	appDirectory,
	from,
	text,
	to,
}: {
	appDirectory: string;
	from: string;
	text: string;
	to: string;
}): string[] => {
	const steps = renameStepsBetween({
		from,
		to,
		steps: renameStepsParse(text),
	});
	if (steps.length === 0) return [];
	const moves = renameFilesPlan({
		has: (path) => existsSync(join(appDirectory, path)),
		steps,
	});
	for (const { from: old, to: next } of moves) {
		mkdirSync(dirname(join(appDirectory, next)), { recursive: true });
		renameSync(join(appDirectory, old), join(appDirectory, next));
	}
	const changed = renameStepsApply({
		files: filesRead(appDirectory),
		steps,
	});
	for (const file of changed)
		writeFileSync(join(appDirectory, file.path), file.text);
	return [
		...new Set([...moves.map((m) => m.to), ...changed.map((f) => f.path)]),
	].sort();
};
