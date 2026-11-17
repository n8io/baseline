// The shutdown README's diagram: what happens after SIGTERM, on a 25 s timeline. The drain delay,
// then every intake closes at once, then each resource closes in order, telemetry last, and the
// process exits 0. The cutoff and the deadline sit further right, where a stuck step would end it.
import {
	keyframePercent,
	readmeSvgThemes,
	svgDocument,
	svgGrid,
	svgText,
} from "./kit.ts";

const theme = readmeSvgThemes.blueprint;
const width = 880;
const height = 410;
const period = 10;
const left = 200;
const right = 840;
const seconds = 25;
const top = 100;
const rowGap = 30;

type Step = { from: number; group: string; label: string; until: number };

// Seconds after the signal. Intakes overlap; resources follow one another.
const steps: Step[] = [
	{ from: 0, group: "drain", label: "/readyz 503, still serving", until: 5 },
	{ from: 5, group: "intakes", label: "http", until: 7.5 },
	{ from: 5, group: "intakes", label: "live", until: 6 },
	{ from: 7.5, group: "resources", label: "queue", until: 8.7 },
	{ from: 8.7, group: "resources", label: "database", until: 9.6 },
	{ from: 9.6, group: "resources", label: "health", until: 10.1 },
	{ from: 10.1, group: "resources", label: "telemetry", until: 11.1 },
];
const exitAt = 11.1;

const x = (second: number) => left + (second / seconds) * (right - left);
const rowY = (index: number) => top + index * rowGap;

// The playhead walks 0 s to the exit between 0.5 s and 7 s of the loop; each bar grows as it passes.
const walkFrom = 0.5;
const walkUntil = 7;
const at = (second: number) =>
	walkFrom + (second / exitAt) * (walkUntil - walkFrom);

const grows = steps
	.map(
		(step, index) =>
			`@keyframes grow${index}{0%,${keyframePercent(at(step.from), period)}{transform:scaleX(0)}${keyframePercent(at(step.until), period)},${keyframePercent(9.2, period)}{transform:scaleX(1)}${keyframePercent(9.7, period)},100%{transform:scaleX(0)}}.grow${index}{transform-box:fill-box;transform-origin:left;animation:grow${index} ${period}s linear infinite}`,
	)
	.join("\n");
const exitFade = `@keyframes exit{0%,${keyframePercent(walkUntil - 0.1, period)}{opacity:0}${keyframePercent(walkUntil + 0.3, period)},${keyframePercent(9.2, period)}{opacity:1}${keyframePercent(9.7, period)},100%{opacity:0}}.exit{animation:exit ${period}s linear infinite}`;

const groupColour: Record<string, string> = {
	drain: theme.dim,
	intakes: theme.line,
	resources: theme.accent,
};

const groupLabels = [
	{ index: 0, text: "1 drain" },
	{ index: 1, text: "2 intakes, together" },
	{ index: 3, text: "3 resources, in order" },
];

// Labels hang left of their line, one row apart, so the two never collide.
const marker = ({
	label,
	row,
	second,
}: {
	label: string;
	row: number;
	second: number;
}) =>
	[
		`<path d="M${x(second)} ${top - 14} V${rowY(steps.length) + 4}" stroke="${theme.fail}" stroke-width="1" stroke-dasharray="3 4"/>`,
		svgText({
			anchor: "end",
			className: "mono fail",
			fontSize: 11,
			text: label,
			x: x(second) - 6,
			y: rowY(steps.length) + 20 + row * 18,
		}),
	].join("");

const playheadTop = top - 14;
const playheadBottom = rowY(steps.length) - 6;

export default svgDocument({
	body: [
		svgGrid({ height, theme, width }),
		svgText({
			className: "display",
			fontSize: 15,
			text: "After SIGTERM: drain, close intakes together, then resources in order",
			weight: 700,
			x: 40,
			y: 44,
		}),
		...[0, 5, 10, 15, 20, 25].map((second) =>
			svgText({
				anchor: "middle",
				className: "mono dim",
				fontSize: 10,
				text: `${second} s`,
				x: x(second),
				y: 76,
			}),
		),
		...groupLabels.map(({ index, text }) =>
			svgText({
				className: "mono accent",
				fontSize: 11,
				text,
				x: 40,
				y: rowY(index) + 14,
			}),
		),
		...steps.map((step, index) =>
			[
				`<rect class="grow${index}" x="${x(step.from)}" y="${rowY(index)}" width="${x(step.until) - x(step.from)}" height="20" rx="${theme.radius}" fill="${groupColour[step.group]}" fill-opacity="0.85"/>`,
				svgText({
					className: "mono",
					fontSize: 11.5,
					text: step.label,
					x: x(step.until) + 8,
					y: rowY(index) + 14,
				}),
			].join(""),
		),
		svgText({
			className: "mono ok exit",
			fontSize: 13,
			text: "exit 0",
			weight: 700,
			x: x(exitAt) + 100,
			y: rowY(steps.length - 1) + 14,
		}),
		marker({ label: "20 s: intakes cut off", row: 0, second: 20 }),
		marker({ label: "25 s: deadline, exit 1", row: 1, second: 25 }),
		`<path class="moving" d="M${left} ${playheadTop} V${playheadBottom}" stroke="${theme.accent}" stroke-width="2"><animateTransform attributeName="transform" type="translate" dur="${period}s" repeatCount="indefinite" values="0 0;0 0;${x(exitAt) - left} 0;${x(exitAt) - left} 0" keyTimes="0;${(walkFrom / period).toFixed(3)};${(walkUntil / period).toFixed(3)};1" calcMode="linear"/></path>`,
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "Step lengths are illustrative. Defaults: drainDelayMs 5 s, deadlineMs 25 s, the last 5 s kept for the resources.",
			x: 40,
			y: height - 40,
		}),
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "A crash skips the drain and exits 1. A step that throws is logged, the rest still close.",
			x: 40,
			y: height - 20,
		}),
	].join("\n"),
	height,
	motionCss: `${grows}\n${exitFade}`,
	theme,
	title:
		"Shutdown on a 25 second timeline: a 5 second drain while /readyz answers 503, then the http and live intakes close together, then queue, database, health and telemetry close one by one, and the process exits 0, well before the 20 second cutoff and the 25 second deadline",
	width,
});
