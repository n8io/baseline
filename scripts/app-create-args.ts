// The flags app-create reads: --name --description --owner --without --no-github --github-only.
import { parseArgs } from "node:util";
import { pieceIsKnown, pieceNames } from "../apps/app/scripts/pieces.ts";

export type AppCreateArgs = {
	description: string | null;
	// all: render, then GitHub. render: --no-github. github: --github-only.
	mode: "all" | "github" | "render";
	name: string | null;
	owner: string | null;
	// Pieces to remove at create time, in the order given, with no repeats.
	without: string[];
};

export const appCreateArgsRead = (args: string[]): AppCreateArgs => {
	const { values } = parseArgs({
		allowNegative: true,
		args,
		options: {
			description: { type: "string" },
			github: { default: true, type: "boolean" },
			"github-only": { default: false, type: "boolean" },
			name: { type: "string" },
			owner: { type: "string" },
			without: { type: "string" },
		},
	});
	const without = [
		...new Set(
			(values.without ?? "")
				.split(",")
				.map((name) => name.trim())
				.filter((name) => name !== ""),
		),
	];
	const unknown = without.filter((name) => !pieceIsKnown(name));
	if (unknown.length > 0) {
		throw new Error(
			`--without names ${unknown.join(", ")}, which is not a Piece; the Pieces are ${pieceNames.join(", ")}`,
		);
	}
	if (values["github-only"] && !values.github) {
		throw new Error("--github-only and --no-github cannot go together");
	}
	if (values.without === "") throw new Error("--without needs Piece names");
	if (values["github-only"] && values.without !== undefined) {
		throw new Error(
			"--github-only renders nothing, so --without has no effect",
		);
	}
	if (
		values["github-only"] &&
		(values.name !== undefined || values.description !== undefined)
	) {
		throw new Error(
			"--github-only reads the name and description from the render it runs in",
		);
	}
	return {
		description: values.description ?? null,
		mode: values["github-only"] ? "github" : values.github ? "all" : "render",
		name: values.name ?? null,
		owner: values.owner ?? null,
		without,
	};
};
