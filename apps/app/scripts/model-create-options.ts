import { type Piece, pieceBlocksRemove, pieces } from "./pieces.ts";
import type { TemplateFile } from "./template-render.ts";

// Pieces and options

// Foo's own files and its pages, with their unit tests.
export const copiedPaths = [
	/^src\/contexts\/foo\//,
	/^src\/ui\/routes\/foo-(list|detail)(\.test)?\.tsx?$/,
];
// home.tsx (the / redirect) and its test come back with the first Model that has pages,
// which it redirects to.
export const homePaths = new Set([
	"src/ui/routes/home.tsx",
	"src/ui/routes/home.test.ts",
]);

// The template as a Project that removed those pieces would have it.
export const templateWithoutPieces = (
	template: TemplateFile[],
	removed: Piece[],
): TemplateFile[] =>
	template
		.filter(
			(file) =>
				!removed.some((piece) =>
					(pieces[piece].template?.paths ?? []).some((r) => r.test(file.path)),
				),
		)
		.map((file) => ({
			path: file.path,
			text: removed.reduce((text, piece) => {
				const lines = pieces[piece].template?.lines;
				return pieceBlocksRemove(
					lines === undefined ? text : text.replace(lines, ""),
					piece,
				);
			}, file.text),
		}));

// The options --bare leaves out unless named. analytics, cache and live are pieces too, so foo marks
// their lines with piece blocks; schedule and seed mark theirs with model-create-start: <option> /
// model-create-end: <option> blocks. Each option is whole files plus those blocks, plus its lines at
// the wiring markers wiringOptionOf names. `piece` is the piece an option needs installed.
export const modelOptions = [
	"analytics",
	"cache",
	"live",
	"pages",
	"schedule",
	"seed",
] as const;
export type ModelOption = (typeof modelOptions)[number];

export const optionPieces: Record<ModelOption, Piece | undefined> = {
	analytics: "analytics",
	cache: "cache",
	live: "live",
	pages: "ui",
	schedule: "queue",
	seed: undefined,
};

const optionPaths: Record<ModelOption, RegExp[]> = {
	analytics: [],
	cache: [],
	live: [],
	pages: [/^src\/ui\/routes\/(foo-(list|detail)|home)(\.test)?\.tsx?$/],
	schedule: [
		/^src\/contexts\/foo\/(adapters\/inbound\/foo-schedule|application\/foo-stale-archive)(\.test)?\.ts$/,
	],
	seed: [/^src\/contexts\/foo\/adapters\/inbound\/foo-seed(\.test)?\.ts$/],
};

// The option a wiring line belongs to, from the file and the marker below it.
export const wiringOptionOf = ({
	marker,
	path,
}: {
	marker: string;
	path: string;
}): ModelOption | undefined => {
	const name = /wiring: ([a-z-]+)/.exec(marker)?.[1];
	if (name === "schedules" || name === "schedule-definitions")
		return "schedule";
	if (name === "seeds" || (path === "src/seed.ts" && name === "scopes")) {
		return "seed";
	}
	if (path.startsWith("src/ui/")) return "pages";
	return undefined;
};

// Drops every block from a `model-create-start: <option>` line through its end line.
const optionBlocksRemove = (text: string, option: ModelOption): string =>
	text.replaceAll(
		new RegExp(
			`^[ \\t]*// model-create-start: ${option}\\n[\\s\\S]*?^[ \\t]*// model-create-end: ${option}\\n`,
			"gm",
		),
		"",
	);

// Foo's own files as a Model with only some options has them. The option markers never reach a
// Project: they are for model-create alone.
export const optionsApply = ({
	files,
	optionsLeftOut,
}: {
	files: TemplateFile[];
	optionsLeftOut: ModelOption[];
}): TemplateFile[] =>
	templateWithoutPieces(
		files.filter(
			(file) =>
				!optionsLeftOut.some((option) =>
					optionPaths[option].some((r) => r.test(file.path)),
				),
		),
		optionsLeftOut.flatMap((option) => {
			const piece = optionPieces[option];
			return piece === option ? [piece] : [];
		}),
	).map((file) => ({
		path: file.path,
		text: optionsLeftOut
			.reduce((text, option) => optionBlocksRemove(text, option), file.text)
			.replaceAll(/^[ \t]*\/\/ model-create-(start|end): [a-z-]+\n/gm, ""),
	}));
