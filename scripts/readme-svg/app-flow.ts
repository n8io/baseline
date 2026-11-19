// The Template README's diagram: one write through a bounded context on the Server, and the
// Domain event it publishes on its way through the Worker to another context. A dot runs the top
// row, turns the corner as the transaction commits, and runs the bottom row back; each box lights
// as it passes.
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
const height = 330;
const period = 8;
// The dot waits on the first box for this share of the period, travels until `travel`, then rests
// on the last box, so no box lights at the loop's ends.
const lead = 0.06;
const travel = 0.9;
const boxWidth = 140;
const boxHeight = 56;
const boxLefts = [30, 200, 370, 540, 710] as const;
const topY = 74;
const bottomY = 222;

const serverBoxes = [
	{ label: "HTTP route", sublabel: "inbound adapter" },
	{ label: "Use case", sublabel: "calls a transition" },
	{ label: "Repository", sublabel: "a port" },
	{ label: "Postgres", sublabel: "outbound adapter" },
	{ label: "Transaction", sublabel: "the row + its Event" },
];
// Read right to left: the dot comes back along the bottom row.
const workerBoxes = [
	{ label: "Inbox", sublabel: "same transaction" },
	{ label: "Use case", sublabel: "skips a repeat" },
	{ label: "Event handler", sublabel: "another context" },
	{ label: "Worker", sublabel: "per Event key" },
	{ label: "Domain event", sublabel: "in the queue" },
];

const centres = boxLefts.map((left) => left + boxWidth / 2);
const first = centres[0] ?? 0;
const last = centres[4] ?? 0;
const topCentreY = topY + boxHeight / 2;
const bottomCentreY = bottomY + boxHeight / 2;
const path = `M${first} ${topCentreY} H${last} V${bottomCentreY} H${first}`;
const pathLength = (last - first) * 2 + (bottomCentreY - topCentreY);

// The moment (in seconds) the dot reaches a point `distance` along the path.
const reachedAt = (distance: number): number =>
	(lead + (distance / pathLength) * (travel - lead)) * period;

const glow = (name: string, seconds: number): string =>
	`@keyframes ${name}{0%,${keyframePercent(seconds - 0.4, period)},${keyframePercent(seconds + 0.55, period)},100%{stroke:${theme.line}}${keyframePercent(seconds, period)}{stroke:${theme.accent}}}.${name} rect{animation:${name} ${period}s linear infinite}`;

const topGlows = centres.map((centre, index) =>
	glow(`server${index}`, reachedAt(centre - first)),
);
const bottomGlows = centres.map((centre, index) =>
	glow(
		`worker${index}`,
		reachedAt(last - first + (bottomCentreY - topCentreY) + (last - centre)),
	),
);
// The commit banner brightens as the dot turns the corner.
const commitAt = reachedAt(last - first);
const commit = `@keyframes commit{0%,${keyframePercent(commitAt - 0.1, period)}{opacity:.3}${keyframePercent(commitAt + 0.15, period)},${keyframePercent(commitAt + 1.3, period)}{opacity:1}${keyframePercent(commitAt + 1.9, period)},100%{opacity:.3}}.commit{animation:commit ${period}s linear infinite}`;

const rowBoxes = (
	boxes: { label: string; sublabel: string }[],
	row: { className: string; y: number },
): string[] =>
	boxes.map(({ label, sublabel }, index) =>
		svgBox({
			className: `${row.className}${index}`,
			height: boxHeight,
			label,
			sublabel,
			theme,
			width: boxWidth,
			x: boxLefts[index] ?? 0,
			y: row.y,
		}),
	);

export default svgDocument({
	body: [
		svgGrid({ height, theme, width }),
		svgText({
			className: "display",
			fontSize: 15,
			text: "A write and its Event, end to end",
			weight: 700,
			x: 30,
			y: 44,
		}),
		svgText({
			anchor: "end",
			className: "mono dim",
			fontSize: 12,
			text: "Server",
			x: 850,
			y: 44,
		}),
		svgText({
			anchor: "end",
			className: "mono dim",
			fontSize: 12,
			text: "Worker",
			x: 850,
			y: height - 18,
		}),
		`<path d="${path}" fill="none" stroke="${theme.line}" stroke-width="1.5" stroke-dasharray="4 5"/>`,
		...rowBoxes(serverBoxes, { className: "server", y: topY }),
		...rowBoxes(workerBoxes, { className: "worker", y: bottomY }),
		`<g class="commit"><rect x="500" y="${topY + boxHeight + 22}" width="260" height="26" rx="${theme.radius}" fill="${theme.background}" stroke="${theme.ok}"/>`,
		svgText({
			anchor: "middle",
			className: "mono ok",
			fontSize: 12,
			text: "COMMIT: the write + its Event",
			x: 630,
			y: topY + boxHeight + 40,
		}),
		"</g>",
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "A rollback drops the Event with the write.",
			x: 30,
			y: topY + boxHeight + 40,
		}),
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "Same Event key: one at a time, in commit order.",
			x: 30,
			y: height - 18,
		}),
		`<circle class="moving" r="7" fill="${theme.accent}"><animateMotion dur="${period}s" repeatCount="indefinite" path="${path}" keyPoints="0;0;1;1" keyTimes="0;${lead};${travel};1" calcMode="linear"/></circle>`,
	].join("\n"),
	height,
	motionCss: [...topGlows, ...bottomGlows, commit].join("\n"),
	theme,
	title:
		"A write and its Domain event, end to end: a request runs through a context's HTTP route, Use case, Repository and Postgres adapter into one transaction that commits the row and its Domain event; the Worker delivers each Domain event, one at a time per Event key in commit order, to another context's Event handler, whose Use case records it in the Inbox so a repeat is skipped.",
	width,
});
