// The piece-start / piece-end markers in a file's text: dropping a Piece's blocks and checking balance.
import type { Piece } from "./pieces-names.ts";

// Drops every block from a `piece-start: <name>` line through its `piece-end: <name>` line.
export const pieceBlocksRemove = (text: string, name: Piece): string =>
	text.replaceAll(
		new RegExp(
			`^[ \\t]*(//|#) piece-start: ${name}\\n[\\s\\S]*?^[ \\t]*(//|#) piece-end: ${name}\\n`,
			"gm",
		),
		"",
	);

const markerLine = /^[ \t]*(?:\/\/|#) piece-(start|end): ([a-z-]+)$/;

// What is wrong with the Piece markers in a file's text: a start without its end, an end without
// its start, a block of a Piece inside a block of the same Piece, or blocks that cross each other.
// Blocks of different Pieces may nest; they may not interleave.
export const pieceMarkersProblems = (text: string): string[] => {
	const problems: string[] = [];
	const open: { line: number; piece: string }[] = [];
	for (const [index, content] of text.split("\n").entries()) {
		const found = markerLine.exec(content);
		const edge = found?.[1];
		const piece = found?.[2];
		if (edge === undefined || piece === undefined) continue;
		const line = index + 1;
		if (edge === "start") {
			if (open.some((o) => o.piece === piece)) {
				problems.push(
					`line ${line}: piece-start: ${piece} inside another ${piece} block`,
				);
			}
			open.push({ line, piece });
			continue;
		}
		const at = open.findLastIndex((o) => o.piece === piece);
		if (at === -1) {
			problems.push(`line ${line}: piece-end: ${piece} has no piece-start`);
		} else if (at !== open.length - 1) {
			const inner = open[open.length - 1]?.piece;
			problems.push(
				`line ${line}: piece-end: ${piece} closes it while ${inner} is still open (blocks cross)`,
			);
			open.splice(at, 1);
		} else {
			open.pop();
		}
	}
	for (const o of open) {
		problems.push(`line ${o.line}: piece-start: ${o.piece} has no piece-end`);
	}
	return problems;
};
