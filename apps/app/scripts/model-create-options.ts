import { type Piece, pieceBlocksRemove, pieceScheduleLines } from "./pieces.ts";
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

// What each Piece of the stack (scripts/pieces.ts) owns in the Template's foo files: the files a
// new context or Model leaves out once the Piece is removed, and the env lines. A Piece's
// `piece-start:` blocks stay out of them too. A new Piece fails type-checking until it is listed.
const piecesTemplate: Record<Piece, { lines?: RegExp; paths: RegExp[] }> = {
	analytics: { paths: [/^src\/contexts\/foo\/.*-analytics\.test\.ts$/] },
	// Owns no context file; listed so its blocks stay out once it is removed.
	"api-reference": { paths: [] },
	cache: { paths: [/^src\/contexts\/foo\/.*-cache(d|\.test)?\.ts$/] },
	// Owns no context file.
	cli: { paths: [] },
	// Owns no context file; listed so its blocks stay out once it is removed.
	"error-tracking": { paths: [] },
	// Owns no context file; listed so its blocks stay out once it is removed.
	"feature-flags": { paths: [] },
	live: {
		paths: [/^src\/contexts\/foo\/.*-live(-routes)?(\.test)?\.ts$/],
	},
	queue: {
		// Env files carry no markers; this is the line pieces.ts drops from .env.schema.
		lines: pieceScheduleLines,
		paths: [
			/^src\/worker\.ts$/,
			/^src\/contexts\/foo\/adapters\/inbound\/foo-schedule(\.test)?\.ts$/,
			/^src\/contexts\/foo\/adapters\/outbound\/foo-transaction\.postgres\.test\.ts$/,
			/^src\/contexts\/foo\/.*-queue\.test\.ts$/,
		],
	},
	// Owns no context file (src/redis-open.ts is not a context's).
	redis: { paths: [] },
	// Owns no context file; modelChecksRun regenerates the SDK.
	sdk: { paths: [] },
	ui: { paths: [/^src\/ui\//] },
};

// The template as a Project that removed those pieces would have it.
export const templateWithoutPieces = (
	template: TemplateFile[],
	removed: Piece[],
): TemplateFile[] =>
	template
		.filter(
			(file) =>
				!removed.some((piece) =>
					piecesTemplate[piece].paths.some((r) => r.test(file.path)),
				),
		)
		.map((file) => ({
			path: file.path,
			text: removed.reduce((text, piece) => {
				const { lines } = piecesTemplate[piece];
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
