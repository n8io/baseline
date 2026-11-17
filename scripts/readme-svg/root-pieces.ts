// The root README's pieces diagram, in the marquee theme. It says what a piece is, then plays
// four recipes in turn: each shows its piece-remove commands, lifts those pieces off the core and
// says what the Project is left with (apps/app/docs/agents/pieces.md). The resting frame is the
// first recipe with its piece lifted, so it reads under reduced motion too.
import {
	keyframePercent,
	readmeSvgThemes,
	svgBox,
	svgDocument,
	svgText,
} from "./kit.ts";

const theme = readmeSvgThemes.marquee;
const width = 880;
const height = 428;
// Every piece in apps/app/scripts/piece-remove.ts pieceRemovals, in the README's order.
const pieces = [
	"ui",
	"api-reference",
	"live",
	"cache",
	"redis",
	"queue",
	"analytics",
	"error-tracking",
];
const recipes = [
	{
		removes: ["ui"],
		result: "The API, sign-in, live update streams and the Worker stay.",
		title: "An API with no pages",
	},
	{
		removes: ["live", "cache", "redis"],
		result: "Postgres is the only data store; every read goes to it.",
		title: "No Redis to run",
	},
	{
		removes: ["queue"],
		result: "One long-running process: no Worker, Events or Schedules.",
		title: "No Worker to run",
	},
	{
		removes: ["analytics", "error-tracking"],
		result: "No product analytics or error tracking; errors are still logged.",
		title: "No analytics or error-report vendors",
	},
];
const scene = 6;
const period = scene * recipes.length;
const pieceWidth = 99;
const pieceGap = 4;
const left = 30;
const rowTop = 214;
const lift = 46;
const commandTop = 318;

// Within a recipe's 6 s: its text fades in at 0.2 s, its pieces lift from 1.4 s to 2 s, they
// settle back from 5.2 s to 5.7 s, and its text fades out by 5.9 s.
const at = (index: number, seconds: number) =>
	keyframePercent(index * scene + seconds, period);

const liftCss = pieces
	.map((piece, pieceIndex) => {
		const lifted = recipes.flatMap((recipe, index) =>
			recipe.removes.includes(piece) ? [index] : [],
		);
		if (lifted.length === 0) return "";
		const down = "{transform:translateY(0);opacity:1}";
		const up = `{transform:translateY(-${lift}px);opacity:0.45}`;
		const frames = lifted
			.map(
				(index) =>
					`${at(index, 1.4)}${down}${at(index, 2)},${at(index, 5.2)}${up}${at(index, 5.7)}${down}`,
			)
			.join("");
		return `@keyframes lift${pieceIndex}{0%${down}${frames}100%${down}}.lift${pieceIndex}{animation:lift${pieceIndex} ${period}s ease-in-out infinite}`;
	})
	.join("\n");

const sceneCss = recipes
	.map((_, index) => {
		const hidden = "{opacity:0}";
		const shown = "{opacity:1}";
		const start = index === 0 ? `0%${shown}` : `0%,${at(index, 0)}${hidden}`;
		return `@keyframes scene${index}{${start}${at(index, 0.4)},${at(index, 5.6)}${shown}${at(index, 5.9)},100%${hidden}}.scene${index}{animation:scene${index} ${period}s linear infinite}`;
	})
	.join("\n");

const firstRemoves = recipes[0]?.removes ?? [];

const pieceRow = pieces.map((piece, pieceIndex) => {
	const box = svgBox({
		fontSize: 11,
		height: 44,
		label: piece,
		theme,
		width: pieceWidth,
		x: left + pieceIndex * (pieceWidth + pieceGap),
		y: rowTop,
	});
	const inRecipe = recipes.some((recipe) => recipe.removes.includes(piece));
	if (!inRecipe) return box;
	const resting = firstRemoves.includes(piece)
		? ` style="transform:translateY(-${lift}px);opacity:0.45"`
		: "";
	return `<g class="lift${pieceIndex}"${resting}>${box}</g>`;
});

const sceneMarkup = recipes.map((recipe, index) => {
	const commands = recipe.removes.map((piece, line) =>
		svgText({
			className: "mono",
			fontSize: 13,
			text: `$ pnpm piece-remove ${piece}`,
			x: left + 20,
			y: commandTop + 26 + line * 20,
		}),
	);
	const note =
		recipe.removes.length > 1
			? recipe.removes
					.map((_, line) =>
						svgText({
							className: "mono dim",
							fontSize: 12,
							text: "# then commit",
							x: left + 260,
							y: commandTop + 26 + line * 20,
						}),
					)
					.join("")
			: "";
	return `<g class="scene${index}"${index === 0 ? "" : ' style="opacity:0"'}>${svgText(
		{
			className: "display accent",
			fontSize: 12,
			text: `RECIPE ${index + 1} OF ${recipes.length}`,
			weight: 700,
			x: left,
			y: 116,
		},
	)}${svgText({
		className: "display",
		fontSize: 22,
		text: recipe.title,
		weight: 800,
		x: left,
		y: 144,
	})}${commands.join("")}${note}${svgText({
		anchor: "end",
		className: "display ok",
		fontSize: 14,
		text: recipe.result,
		weight: 600,
		x: width - left - 20,
		y: commandTop + 26,
	})}</g>`;
});

export default svgDocument({
	body: [
		svgText({
			className: "display",
			fontSize: 17,
			text: "Pieces: the parts of the stack you can take out",
			weight: 700,
			x: left,
			y: 44,
		}),
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "A piece is its files, code blocks, packages, env vars and services. One command removes it,",
			x: left,
			y: 68,
		}),
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "then runs pnpm check; git revert and pnpm install bring it back.",
			x: left,
			y: 86,
		}),
		...pieceRow,
		svgBox({
			fill: theme.grid,
			fontSize: 13,
			height: 44,
			label:
				"the core: Domains · API · Use cases · Postgres · sign-in · telemetry · health",
			theme,
			width: pieces.length * pieceWidth + (pieces.length - 1) * pieceGap,
			x: left,
			y: rowTop + 52,
		}),
		`<rect x="${left}" y="${commandTop}" width="${width - 2 * left}" height="84" rx="${theme.radius}" fill="${theme.panel}" stroke="${theme.line}"/>`,
		...sceneMarkup,
	].join("\n"),
	height,
	motionCss: `${liftCss}\n${sceneCss}`,
	theme,
	title:
		"Pieces are optional parts of the stack. Four recipes play in turn: remove the UI pages; remove live updates, the cache and Redis; remove the queue and Worker; remove analytics and error reports",
	width,
});
