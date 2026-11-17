// postgresTransactionRun: one Use case's transaction. A first run commits on `ok`; a second
// rolls back on `err` or a throw. Serves packages/postgres/README.md.
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
const period = 10;
const centreY = 148;
const branchX = 560;
const endX = 620;
const commitY = 88;
const rollbackY = 208;

// Each run: a dot leaves BEGIN, passes the work, and ends on its outcome. `from` and `until`
// are seconds into the loop; `endY` is the outcome's centre.
const runs = [
	{ endY: commitY, from: 0.6, glow: theme.ok, until: 3.8 },
	{ endY: rollbackY, from: 5.6, glow: theme.fail, until: 8.8 },
] as const;

const runPath = (endY: number): string =>
	`M110 ${centreY} H460 L${branchX} ${endY} H${endX}`;

// Where along its path (0 to 1) each box sits, by length, so a box lights as the dot reaches it.
const pathLength = (endY: number): number =>
	350 + Math.hypot(branchX - 460, endY - centreY) + (endX - branchX);
const workAt = (endY: number): number => 250 / pathLength(endY);

const glowRule = ({
	at,
	color,
	name,
}: {
	at: readonly number[];
	color: string;
	name: string;
}): string => {
	const peaks = at
		.map(
			(seconds) =>
				`${keyframePercent(seconds - 0.3, period)},${keyframePercent(seconds + 0.8, period)}{stroke:${theme.line}}${keyframePercent(seconds, period)}{stroke:${color}}`,
		)
		.join("");
	return `@keyframes ${name}{0%,100%{stroke:${theme.line}}${peaks}}.${name} rect{animation:${name} ${period}s linear infinite}`;
};

const at = (run: (typeof runs)[number], fraction: number): number =>
	run.from + fraction * (run.until - run.from);

const motionCss = [
	glowRule({
		at: runs.map((run) => run.from + 0.1),
		color: theme.accent,
		name: "begin",
	}),
	glowRule({
		at: runs.map((run) => at(run, workAt(run.endY))),
		color: theme.accent,
		name: "work",
	}),
].join("\n");

const dot = (run: (typeof runs)[number]): string => {
	const start = run.from / period;
	const end = run.until / period;
	const hide = Math.min(end + 0.06, 0.99);
	return `<circle class="moving" r="7" fill="${run.glow}"><animateMotion dur="${period}s" repeatCount="indefinite" path="${runPath(run.endY)}" keyPoints="0;0;1;1" keyTimes="0;${start.toFixed(3)};${end.toFixed(3)};1" calcMode="linear"/><animate attributeName="opacity" dur="${period}s" repeatCount="indefinite" values="0;0;1;1;0;0" keyTimes="0;${(start - 0.01).toFixed(3)};${start.toFixed(3)};${end.toFixed(3)};${hide.toFixed(3)};1"/></circle>`;
};

const dashed = (path: string): string =>
	`<path d="${path}" fill="none" stroke="${theme.line}" stroke-width="1.5" stroke-dasharray="4 5"/>`;

export default svgDocument({
	body: [
		svgGrid({ height, theme, width }),
		svgText({
			className: "display",
			fontSize: 15,
			text: "postgresTransactionRun({ pgPool, work })",
			weight: 700,
			x: 40,
			y: 40,
		}),
		dashed(runPath(commitY)),
		dashed(runPath(rollbackY)),
		svgBox({
			className: "begin",
			height: 56,
			label: "BEGIN",
			sublabel: "transaction_timeout 5 s",
			theme,
			width: 170,
			x: 30,
			y: centreY - 28,
		}),
		svgBox({
			className: "work",
			height: 56,
			label: "work(pgClient)",
			sublabel: "your queries",
			theme,
			width: 200,
			x: 260,
			y: centreY - 28,
		}),
		svgBox({
			height: 56,
			label: "COMMIT",
			stroke: theme.ok,
			sublabel: "work returned ok(…)",
			theme,
			width: 220,
			x: 620,
			y: commitY - 28,
		}),
		svgBox({
			height: 56,
			label: "ROLLBACK",
			stroke: theme.fail,
			sublabel: "err(…) or a throw",
			theme,
			width: 220,
			x: 620,
			y: rollbackY - 28,
		}),
		...runs.map(dot),
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "The client throws if anything uses it after the transaction ends.",
			x: 40,
			y: height - 18,
		}),
	].join("\n"),
	height,
	motionCss,
	theme,
	title:
		"postgresTransactionRun: a run that returns ok passes BEGIN and the work and commits; a run that returns err or throws rolls back",
	width,
});
