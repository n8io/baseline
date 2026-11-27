// Which pieces piece-check proves, and why it leaves the others out.
import { type Piece, pieceNames, pieceSign, pieces } from "./pieces.ts";

export type PieceCheckPlan = {
	// Each piece to check, with the pieces to remove before it in the same worktree.
	checks: { first: Piece[]; piece: Piece }[];
	// Why a piece is not checked.
	notes: string[];
};

// Which pieces to check: those installed, not kept, and not blocked by an Event handler.
export const pieceCheckPlanCreate = ({
	installed,
	kept,
	refusal,
	requested,
}: {
	// Every pieceSign the Project shows.
	installed: Set<string>;
	kept: string[];
	// Why a piece cannot be removed at all, as piece-remove would say.
	refusal: (piece: Piece) => string | undefined;
	requested: Piece[];
}): PieceCheckPlan => {
	const present = (piece: Piece) => installed.has(pieceSign(piece));
	const decide = (
		piece: Piece,
	): { check: { first: Piece[]; piece: Piece } } | { note: string } => {
		if (!present(piece)) return { note: `${piece}: not installed` };
		if (kept.includes(piece)) {
			return { note: `${piece}: kept (piecesKept in .template.json)` };
		}
		const first = (pieces[piece].after ?? []).filter(present);
		const keptFirst = first.find((p) => kept.includes(p));
		if (keptFirst !== undefined) {
			return { note: `${piece}: skipped, ${keptFirst} is kept and runs on it` };
		}
		// A piece that goes after others is refused only until they go, which the check does itself.
		const why = first.length === 0 ? refusal(piece) : undefined;
		return why === undefined
			? { check: { first, piece } }
			: { note: `${piece}: skipped, ${why}` };
	};
	const decisions = pieceNames
		.filter((piece) => requested.length === 0 || requested.includes(piece))
		.map(decide);
	return {
		checks: decisions.flatMap((d) => ("check" in d ? [d.check] : [])),
		notes: decisions.flatMap((d) => ("note" in d ? [d.note] : [])),
	};
};
