// A cache read, three times over: a hit the schema accepts, an entry in an older shape the
// schema refuses, and a store that is down. Serves packages/cache/README.md.
import {
	keyframePercent,
	readmeSvgThemes,
	svgBox,
	svgDocument,
	svgGrid,
	svgText,
} from "./kit.ts";

const theme = readmeSvgThemes.blueprint;
const width = 880;
const height = 300;
const period = 12;
const rowY = 150;
const storeX = 345;
const schemaX = 565;
const endX = 690;

// Each read: its path, when it runs (seconds into the loop), its dot's colour, and how far
// along its path (in px) it reaches the store and the schema (null when it never does).
const reads = [
	{
		color: theme.ok,
		from: 0.4,
		length: 525 + Math.hypot(50, 70),
		path: `M115 ${rowY} H640 L${endX} 80`,
		schemaAt: 450,
		until: 3.2,
	},
	{
		color: theme.accent,
		from: 4.4,
		length: endX - 115,
		path: `M115 ${rowY} H${endX}`,
		schemaAt: 450,
		until: 7.2,
	},
	{
		color: theme.fail,
		from: 8.2,
		length: 230 + 70 + (endX - storeX),
		path: `M115 ${rowY} H${storeX} V220 H${endX}`,
		schemaAt: null,
		until: 11,
	},
] as const;

type Read = (typeof reads)[number];

const at = (read: Read, px: number): number =>
	read.from + (px / read.length) * (read.until - read.from);

const glowRule = ({
	moments,
	name,
}: {
	moments: readonly number[];
	name: string;
}): string => {
	const peaks = moments
		.map(
			(seconds) =>
				`${keyframePercent(seconds - 0.3, period)},${keyframePercent(seconds + 0.7, period)}{stroke:${theme.line}}${keyframePercent(seconds, period)}{stroke:${theme.accent}}`,
		)
		.join("");
	return `@keyframes ${name}{0%,100%{stroke:${theme.line}}${peaks}}.${name} rect{animation:${name} ${period}s linear infinite}`;
};

const motionCss = [
	glowRule({ moments: reads.map((read) => read.from + 0.1), name: "get" }),
	glowRule({ moments: reads.map((read) => at(read, 230)), name: "store" }),
	glowRule({
		moments: reads.flatMap((read) =>
			read.schemaAt === null ? [] : [at(read, read.schemaAt)],
		),
		name: "schema",
	}),
].join("\n");

const dot = (read: Read): string => {
	const start = read.from / period;
	const end = read.until / period;
	const hide = Math.min(end + 0.04, 0.99);
	return `<circle class="moving" r="7" fill="${read.color}"><animateMotion dur="${period}s" repeatCount="indefinite" path="${read.path}" keyPoints="0;0;1;1" keyTimes="0;${start.toFixed(3)};${end.toFixed(3)};1" calcMode="linear"/><animate attributeName="opacity" dur="${period}s" repeatCount="indefinite" values="0;0;1;1;0;0" keyTimes="0;${Math.max(start - 0.01, 0.001).toFixed(3)};${start.toFixed(3)};${end.toFixed(3)};${hide.toFixed(3)};1"/></circle>`;
};

const outcome = ({
	label,
	stroke,
	sublabel,
	y,
}: {
	label: string;
	stroke: string;
	sublabel: string;
	y: number;
}): string =>
	svgBox({
		height: 52,
		label,
		stroke,
		sublabel,
		theme,
		width: 170,
		x: 690,
		y: y - 26,
	});

export default svgDocument({
	body: [
		svgGrid({ height, theme, width }),
		svgText({
			className: "display",
			fontSize: 15,
			text: "fooCache.get(id)",
			weight: 700,
			x: 40,
			y: 40,
		}),
		...reads.map(
			(read) =>
				`<path d="${read.path}" fill="none" stroke="${theme.line}" stroke-width="1.5" stroke-dasharray="4 5"/>`,
		),
		svgBox({
			className: "get",
			height: 56,
			label: "get(id)",
			sublabel: "your code",
			theme,
			width: 170,
			x: 30,
			y: rowY - 28,
		}),
		svgBox({
			className: "store",
			height: 56,
			label: "CacheStore",
			sublabel: "key <prefix>:<id>",
			theme,
			width: 190,
			x: storeX - 95,
			y: rowY - 28,
		}),
		svgBox({
			className: "schema",
			height: 56,
			label: "schema",
			sublabel: "Standard Schema",
			theme,
			width: 150,
			x: schemaX - 75,
			y: rowY - 28,
		}),
		outcome({
			label: "value",
			stroke: theme.ok,
			sublabel: "the schema's output",
			y: 80,
		}),
		outcome({
			label: "miss",
			stroke: theme.accent,
			sublabel: "an older shape",
			y: rowY,
		}),
		outcome({
			label: "miss",
			stroke: theme.fail,
			sublabel: "store down, counted",
			y: 220,
		}),
		...reads.map(dot),
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "A store that fails or times out reads as a miss and counts on baseline.cache.store_errors.",
			x: 30,
			y: height - 18,
		}),
	].join("\n"),
	height,
	motionCss,
	theme,
	title:
		"A cache read three ways: a stored value the schema accepts comes back; one in an older shape reads as a miss; a store that is down reads as a miss and is counted",
	width,
});
