// The usage text of pnpm piece-remove and why a Piece cannot be removed now.

import { type Piece, pieceNames } from "./pieces-names.ts";
import { pieceRemovals } from "./pieces-removals.ts";
import { pieceSettingsRead } from "./pieces-settings.ts";
import { gitRun } from "./process-run.ts";

export const pieceUsage = `Usage: pnpm piece-remove <${pieceNames.join("|")}>

  -h, --help  this help`;

// Why the Piece cannot be removed from this Project now, or undefined when it can.
export const pieceRemoveRefusal = (
	directory: string,
	piece: Piece,
): string | undefined => {
	const status = gitRun(directory, ["status", "--porcelain"]);
	try {
		pieceSettingsRead(directory);
	} catch (error) {
		return (error as Error).message;
	}
	if (status !== "") {
		return "Commit or stash your changes first, so the removal is a commit of its own that git revert can take back.";
	}
	return pieceRemovals[piece].refusal?.(directory);
};
