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

type OpenMarker = { line: number; piece: string };
type MarkerScan = { open: OpenMarker[]; problems: string[] };

// One marker line applied to what is open so far: the next open stack and any problems it adds.
const markerApply = (
	{ open, problems }: MarkerScan,
	{ edge, line, piece }: { edge: string; line: number; piece: string },
): MarkerScan => {
	if (edge === "start") {
		return {
			open: [...open, { line, piece }],
			problems: open.some((o) => o.piece === piece)
				? [
						...problems,
						`line ${line}: piece-start: ${piece} inside another ${piece} block`,
					]
				: problems,
		};
	}
	const at = open.findLastIndex((o) => o.piece === piece);
	if (at === -1) {
		return {
			open,
			problems: [
				...problems,
				`line ${line}: piece-end: ${piece} has no piece-start`,
			],
		};
	}
	if (at !== open.length - 1) {
		const inner = open[open.length - 1]?.piece;
		return {
			open: open.filter((_, index) => index !== at),
			problems: [
				...problems,
				`line ${line}: piece-end: ${piece} closes it while ${inner} is still open (blocks cross)`,
			],
		};
	}
	return { open: open.slice(0, -1), problems };
};

// What is wrong with the Piece markers in a file's text: a start without its end, an end without
// its start, a block of a Piece inside a block of the same Piece, or blocks that cross each other.
// Blocks of different Pieces may nest; they may not interleave.
export const pieceMarkersProblems = (text: string): string[] => {
	const scanned = text
		.split("\n")
		.flatMap((content, index) => {
			const found = markerLine.exec(content);
			const edge = found?.[1];
			const piece = found?.[2];
			return edge === undefined || piece === undefined
				? []
				: [{ edge, line: index + 1, piece }];
		})
		.reduce(markerApply, { open: [], problems: [] });
	return [
		...scanned.problems,
		...scanned.open.map(
			(o) => `line ${o.line}: piece-start: ${o.piece} has no piece-end`,
		),
	];
};
