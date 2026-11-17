// The health README's diagram: what /livez and /readyz answer across a process's life, from
// boot through ready() to the shutdown drain, with a playhead that walks the phases.
import {
	keyframePercent,
	readmeSvgThemes,
	svgDocument,
	svgGrid,
	svgText,
} from "./kit.ts";

const theme = readmeSvgThemes.blueprint;
const width = 880;
const height = 320;
const period = 10;
const left = 150;
const rowHeight = 36;

type Answer = "ok" | "unavailable" | "none";

type Phase = { label: string; livez: Answer; readyz: Answer; width: number };

const phases: Phase[] = [
	{ label: "booting", livez: "none", readyz: "none", width: 130 },
	{ label: "listening", livez: "ok", readyz: "unavailable", width: 120 },
	{ label: "ready", livez: "ok", readyz: "ok", width: 200 },
	{ label: "draining", livez: "ok", readyz: "unavailable", width: 130 },
	{ label: "closed", livez: "none", readyz: "none", width: 110 },
];

// The moment that separates phase i from phase i + 1, under its boundary line.
const boundaries = ["port opens", "ready()", "SIGTERM", "close()"] as const;

const rows = [
	{ name: "/livez", top: 112 },
	{ name: "/readyz", top: 168 },
] as const;

const phaseLefts = phases.map((_, index) =>
	phases.slice(0, index).reduce((sum, phase) => sum + phase.width, left),
);
const right = left + phases.reduce((sum, phase) => sum + phase.width, 0);

const fills: Record<Answer, { fill: string; opacity: string; text: string }> = {
	none: { fill: theme.panel, opacity: "1", text: "no answer" },
	ok: { fill: theme.ok, opacity: "0.22", text: "200 ok" },
	unavailable: { fill: theme.fail, opacity: "0.22", text: "503" },
};

const textClass: Record<Answer, string> = {
	none: "mono dim",
	ok: "mono ok",
	unavailable: "mono fail",
};

const cell = ({
	answer,
	cellWidth,
	top,
	x,
}: {
	answer: Answer;
	cellWidth: number;
	top: number;
	x: number;
}) => {
	const look = fills[answer];
	return [
		`<rect x="${x + 2}" y="${top}" width="${cellWidth - 4}" height="${rowHeight}" rx="${theme.radius}" fill="${look.fill}" fill-opacity="${look.opacity}" stroke="${theme.line}" stroke-opacity="0.5"/>`,
		svgText({
			anchor: "middle",
			className: textClass[answer],
			fontSize: 12,
			text: look.text,
			x: x + cellWidth / 2,
			y: top + rowHeight / 2 + 4,
		}),
	].join("");
};

// The playhead walks left to right and rests at the end; each phase label lights up while it is
// over that phase.
const walkFrom = 0.5;
const walkUntil = 8.5;
const atX = (x: number) =>
	walkFrom + ((x - left) / (right - left)) * (walkUntil - walkFrom);

const phaseGlows = phases
	.map((phase, index) => {
		const from = atX(phaseLefts[index] ?? left);
		const until = atX((phaseLefts[index] ?? left) + phase.width);
		return `@keyframes phase${index}{0%,${keyframePercent(from - 0.05, period)},${keyframePercent(until + 0.05, period)},100%{fill:${theme.dim}}${keyframePercent(from + 0.1, period)},${keyframePercent(until - 0.1, period)}{fill:${theme.accent}}}.phase${index}{animation:phase${index} ${period}s linear infinite}`;
	})
	.join("\n");

const playheadTop = rows[0].top - 8;
const playheadBottom = rows[1].top + rowHeight + 8;

export default svgDocument({
	body: [
		svgGrid({ height, theme, width }),
		svgText({
			className: "display",
			fontSize: 15,
			text: "What the probes answer, from boot to exit",
			weight: 700,
			x: 40,
			y: 44,
		}),
		...phases.map((phase, index) =>
			svgText({
				anchor: "middle",
				className: `mono dim phase${index}`,
				fontSize: 12,
				text: phase.label,
				weight: 600,
				x: (phaseLefts[index] ?? left) + phase.width / 2,
				y: 96,
			}),
		),
		...rows.map((row) =>
			[
				svgText({
					className: "mono",
					fontSize: 13,
					text: row.name,
					weight: 600,
					x: 40,
					y: row.top + rowHeight / 2 + 5,
				}),
				...phases.map((phase, index) =>
					cell({
						answer: row.name === "/livez" ? phase.livez : phase.readyz,
						cellWidth: phase.width,
						top: row.top,
						x: phaseLefts[index] ?? left,
					}),
				),
			].join("\n"),
		),
		...boundaries.map((label, index) => {
			const x = phaseLefts[index + 1] ?? right;
			return [
				`<path d="M${x} ${playheadTop} V${playheadBottom + 14}" stroke="${theme.line}" stroke-width="1" stroke-dasharray="3 4"/>`,
				svgText({
					anchor: "middle",
					className: "mono accent",
					fontSize: 11,
					text: label,
					x,
					y: playheadBottom + 30,
				}),
			].join("");
		}),
		`<path class="moving" d="M${left} ${playheadTop} V${playheadBottom}" stroke="${theme.accent}" stroke-width="2"><animateTransform attributeName="transform" type="translate" dur="${period}s" repeatCount="indefinite" values="0 0;0 0;${right - left} 0;${right - left} 0" keyTimes="0;${(walkFrom / period).toFixed(3)};${(walkUntil / period).toFixed(3)};1" calcMode="linear"/></path>`,
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "Liveness asks only isAlive(). Readiness waits for ready() and turns 503 at SIGTERM,",
			x: 40,
			y: height - 40,
		}),
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "so the pod leaves the load balancer before it stops serving. On its own port, a busy app never hides it.",
			x: 40,
			y: height - 20,
		}),
	].join("\n"),
	height,
	motionCss: phaseGlows,
	theme,
	title:
		"Health probes across a process's life: nothing answers while it boots, /livez is 200 once the port opens, /readyz is 503 until ready(), 200 while ready and 503 again from SIGTERM while the server drains",
	width,
});
