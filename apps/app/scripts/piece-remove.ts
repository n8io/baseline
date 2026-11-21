// pnpm piece-remove <piece>: removes a Piece of the stack from this Project (ui, live, cache,
// redis, queue, analytics, error-tracking, api-reference, sdk or cli). It deletes the Piece's files and its `piece-start:` to `piece-end:`
// blocks, removes its packages and the imports nothing uses any more, runs `pnpm check`, and never
// commits. When the check fails it undoes the removal and lists the files that use the Piece outside
// its markers. docs/agents/pieces.md says what each Piece is and how to take one back. Running it
// again after a template-upgrade takes out the lines the upgrade brings back.
// The Pieces and the removal itself are in scripts/pieces.ts.
import { argsParse, argsUsageFail } from "./args.ts";
import {
	pieceIsKnown,
	pieceRemove,
	pieceRemoveRefusal,
	pieceUsage,
} from "./pieces.ts";

const main = () => {
	const parsed = argsParse({
		allowPositionals: true,
		options: {},
		usage: pieceUsage,
	});
	if (parsed === undefined) return;
	const [piece] = parsed.positionals;
	if (
		piece === undefined ||
		parsed.positionals.length !== 1 ||
		!pieceIsKnown(piece)
	) {
		argsUsageFail(pieceUsage);
		return;
	}
	const directory = process.cwd();
	const refusal = pieceRemoveRefusal(directory, piece);
	if (refusal !== undefined) {
		console.error(`piece-remove: ${refusal}`);
		process.exitCode = 1;
		return;
	}
	const failed = pieceRemove(directory, piece);
	if (failed !== undefined) {
		const undone =
			failed.restored === false
				? "the removal is undone but its packages are not reinstalled (run pnpm install)"
				: "the removal is undone and the tree is as you left it";
		const lines = [
			failed.packageManager === undefined
				? `piece-remove: removing ${piece} failed, so ${undone}.`
				: `piece-remove: the package manager failed (${failed.packageManager}), not ${piece}'s code, so ${undone}. Run pnpm piece-remove ${piece} again.`,
		];
		if (failed.files.length > 0) {
			lines.push(
				`These files use ${piece} outside its piece markers, or fail for another reason:`,
				...failed.files.map((f) => `  ${f}`),
				`Wrap the code that uses ${piece} in \`// piece-start: ${piece}\` and \`// piece-end: ${piece}\` lines (docs/agents/pieces.md), then run pnpm piece-remove ${piece} again.`,
			);
		}
		lines.push("", ...failed.output.split("\n").slice(-40));
		console.error(lines.join("\n"));
		process.exitCode = 1;
		return;
	}
	console.log(
		[
			`Removed ${piece}; pnpm check passes. Next:`,
			"  pnpm test && pnpm build",
			`  git add -A && git commit -m "Remove ${piece}"`,
			"Commit it alone, so git revert can bring the Piece back.",
		].join("\n"),
	);
};

if (import.meta.main) main();
