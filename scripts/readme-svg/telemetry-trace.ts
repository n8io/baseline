// The telemetry README's diagram: one trace as a waterfall. A request's span, its Use case span
// and its queries draw in on the Server; the Event it publishes carries the trace to the Worker,
// whose Consumer runs in the same trace. Bars grow by CSS transform, so the resting frame is the
// whole trace.
import {
	keyframePercent,
	readmeSvgThemes,
	svgDocument,
	svgGrid,
	svgText,
} from "./kit.ts";

const theme = readmeSvgThemes.blueprint;
const width = 880;
const height = 380;
const period = 10;
const barLeft = 330;
const barRight = 840;
const rowTop = 104;
const rowGap = 36;

type Row = {
	from: number;
	kind: string;
	label: string;
	process: "Server" | "Worker";
	until: number;
};

// from/until are fractions of the bar area. The Event hands the trace from publishRow to
// consumerRow.
const publishRow: Row = {
	from: 0.27,
	kind: "pg",
	label: "publish foo.created",
	process: "Server",
	until: 0.42,
};
const consumerRow: Row = {
	from: 0.62,
	kind: "use case",
	label: "the Consumer's Use case",
	process: "Worker",
	until: 1,
};
const rows: Row[] = [
	{
		from: 0,
		kind: "http",
		label: "POST /api/v1/foos",
		process: "Server",
		until: 0.56,
	},
	{
		from: 0.03,
		kind: "use case",
		label: "fooCreate",
		process: "Server",
		until: 0.52,
	},
	{
		from: 0.07,
		kind: "pg",
		label: "INSERT foo",
		process: "Server",
		until: 0.24,
	},
	publishRow,
	consumerRow,
	{
		from: 0.66,
		kind: "pg",
		label: "INSERT inbox",
		process: "Worker",
		until: 0.8,
	},
];

const rowY = (index: number) => rowTop + index * rowGap;
const barX = (fraction: number) => barLeft + fraction * (barRight - barLeft);

// Each bar grows from its left edge while a clock sweeps 0.6 s to 6.6 s, in the order it starts.
const growFrom = 0.6;
const growUntil = 6.6;
const grows = rows
	.map((row, index) => {
		const start = growFrom + row.from * (growUntil - growFrom);
		const end = growFrom + row.until * (growUntil - growFrom);
		return `@keyframes grow${index}{0%,${keyframePercent(start, period)}{transform:scaleX(0)}${keyframePercent(end, period)},${keyframePercent(9.2, period)}{transform:scaleX(1)}${keyframePercent(9.7, period)},100%{transform:scaleX(0)}}.grow${index}{transform-box:fill-box;transform-origin:left;animation:grow${index} ${period}s linear infinite}`;
	})
	.join("\n");

const handoffAt = growFrom + consumerRow.from * (growUntil - growFrom);
const handoffGlow = `@keyframes handoff{0%,${keyframePercent(handoffAt - 0.8, period)},${keyframePercent(9.2, period)},100%{opacity:0.25}${keyframePercent(handoffAt, period)},${keyframePercent(9, period)}{opacity:1}}.handoff{animation:handoff ${period}s linear infinite}`;

const bar = (row: Row, index: number) => {
	const y = rowY(index);
	const x = barX(row.from);
	const fill = row.kind === "use case" ? theme.accent : theme.line;
	return [
		svgText({
			className: "mono dim",
			fontSize: 11,
			text: row.process,
			x: 40,
			y: y + 15,
		}),
		svgText({
			className: "mono accent",
			fontSize: 11,
			text: row.kind,
			x: 110,
			y: y + 15,
		}),
		svgText({
			className: "mono",
			fontSize: 12,
			text: row.label,
			x: 180,
			y: y + 15,
		}),
		`<rect class="grow${index}" x="${x}" y="${y}" width="${barX(row.until) - x}" height="20" rx="${theme.radius}" fill="${fill}" fill-opacity="0.85"/>`,
	].join("");
};

const publish = rowY(rows.indexOf(publishRow)) + 10;
const consumer = rowY(rows.indexOf(consumerRow)) + 10;
const handoffPath = `M${barX(publishRow.until)} ${publish} H${barX(consumerRow.from) - 14} V${consumer} H${barX(consumerRow.from)}`;

export default svgDocument({
	body: [
		svgGrid({ height, theme, width }),
		svgText({
			className: "display",
			fontSize: 15,
			text: "One trace, from the request to the Consumer",
			weight: 700,
			x: 40,
			y: 44,
		}),
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "trace_id 4bf92f3577b34da6a3ce929d0e0e4736",
			x: 40,
			y: 72,
		}),
		`<path d="M${barLeft} 84 H${barRight}" stroke="${theme.line}" stroke-opacity="0.4"/>`,
		`<path d="M40 ${rowY(rows.indexOf(consumerRow)) - 8} H${barRight}" stroke="${theme.line}" stroke-opacity="0.4" stroke-dasharray="3 4"/>`,
		...rows.map(bar),
		`<path class="handoff" d="${handoffPath}" fill="none" stroke="${theme.accent}" stroke-width="1.5" stroke-dasharray="4 4"/>`,
		svgText({
			anchor: "end",
			className: "mono accent handoff",
			fontSize: 11,
			text: "the Event carries the trace",
			x: barX(consumerRow.from) - 20,
			y: rowY(rows.indexOf(consumerRow)) - 14,
		}),
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "Each log line carries the same trace id. Probes are never traced; a query outside a trace makes no span.",
			x: 40,
			y: height - 40,
		}),
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "Before export, URL query values are redacted and exception messages are dropped.",
			x: 40,
			y: height - 20,
		}),
	].join("\n"),
	height,
	motionCss: `${grows}\n${handoffGlow}`,
	theme,
	title:
		"One trace as a waterfall: on the Server, the request span, the fooCreate Use case span and its two queries; the published Event carries the trace to the Worker, where the Consumer's Use case and its query join the same trace",
	width,
});
