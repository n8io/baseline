// redisClientCreate's two rules: at startup the connect either succeeds within 3 s or throws,
// never retrying; once connected, a dropped connection reconnects for good, every
// min(retries × 100 ms, 2 s). Serves packages/redis/README.md.
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
const period = 9;

// Startup: a dot that connects, then one that finds Redis unreachable.
const connectY = 150;
const startups = [
	{
		color: theme.ok,
		from: 0.3,
		path: `M115 ${connectY} H200 L250 95`,
		until: 1.4,
	},
	{
		color: theme.fail,
		from: 6,
		path: `M115 ${connectY} H200 L250 205`,
		until: 7.1,
	},
] as const;

const dot = (run: (typeof startups)[number]): string => {
	const start = run.from / period;
	const end = run.until / period;
	return `<circle class="moving" r="7" fill="${run.color}"><animateMotion dur="${period}s" repeatCount="indefinite" path="${run.path}" keyPoints="0;0;1;1" keyTimes="0;${start.toFixed(3)};${end.toFixed(3)};1" calcMode="linear"/><animate attributeName="opacity" dur="${period}s" repeatCount="indefinite" values="0;0;1;1;0;0" keyTimes="0;${(start - 0.01).toFixed(3)};${start.toFixed(3)};${end.toFixed(3)};${(end + 0.05).toFixed(3)};1"/></circle>`;
};

// After a drop: the wait before each reconnect, one bar per retry, capped at 2 s.
const retries = 28;
const barWidth = 10;
const barGap = 4;
const barsLeft = 450;
const barsBottom = 236;
const capHeight = 130;
const barHeight = (retry: number): number =>
	(Math.min(retry * 100, 2_000) / 2_000) * capHeight;
const barShownAt = (index: number): number => 1.6 + index * 0.2;
const barsClear = 8.2;

const bars = Array.from({ length: retries }, (_, index) => {
	const h = barHeight(index + 1);
	const x = barsLeft + index * (barWidth + barGap);
	const color = index + 1 >= 20 ? theme.accent : theme.line;
	return `<rect class="bar bar${index}" x="${x}" y="${barsBottom - h}" width="${barWidth}" height="${h}" fill="${color}"/>`;
});

const barMotion = Array.from({ length: retries }, (_, index) => {
	const shown = barShownAt(index);
	return `@keyframes bar${index}{0%,${keyframePercent(shown, period)}{transform:scaleY(0)}${keyframePercent(shown + 0.25, period)},${keyframePercent(barsClear, period)}{transform:scaleY(1)}${keyframePercent(barsClear + 0.4, period)},100%{transform:scaleY(0)}}.bar${index}{animation:bar${index} ${period}s ease-out infinite}`;
}).join("\n");

const capY = barsBottom - capHeight;
const barsRight = barsLeft + retries * (barWidth + barGap) - barGap;

export default svgDocument({
	body: [
		svgGrid({ height, theme, width }),
		svgText({
			className: "display",
			fontSize: 15,
			text: "redisClientCreate({ url })",
			weight: 700,
			x: 30,
			y: 40,
		}),
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "At startup",
			x: 30,
			y: 76,
		}),
		...startups.map(
			(run) =>
				`<path d="${run.path}" fill="none" stroke="${theme.line}" stroke-width="1.5" stroke-dasharray="4 5"/>`,
		),
		svgBox({
			height: 56,
			label: "connect",
			sublabel: "handshake within 3 s",
			theme,
			width: 170,
			x: 30,
			y: connectY - 28,
		}),
		svgBox({
			height: 50,
			label: "connected",
			stroke: theme.ok,
			sublabel: "startup goes on",
			theme,
			width: 140,
			x: 250,
			y: 70,
		}),
		svgBox({
			height: 50,
			label: "throws",
			stroke: theme.fail,
			sublabel: "never retries",
			theme,
			width: 140,
			x: 250,
			y: 180,
		}),
		...startups.map(dot),
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "Once connected, a drop reconnects for good",
			x: barsLeft,
			y: 76,
		}),
		`<path d="M${barsLeft} ${capY} H${barsRight}" stroke="${theme.accent}" stroke-width="1" stroke-dasharray="3 4"/>`,
		svgText({
			className: "mono accent",
			fontSize: 11,
			text: "2 s",
			x: barsRight - 22,
			y: capY - 6,
		}),
		...bars,
		`<path d="M${barsLeft} ${barsBottom + 1} H${barsRight}" stroke="${theme.dim}" stroke-width="1"/>`,
		svgText({
			className: "mono dim",
			fontSize: 11,
			text: "wait before retry n: min(n × 100 ms, 2 s)",
			x: barsLeft,
			y: barsBottom + 20,
		}),
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "The client's error event is always listened to and logged, never with the URL.",
			x: 30,
			y: height - 18,
		}),
	].join("\n"),
	css: ".bar{transform-box:fill-box;transform-origin:bottom}",
	height,
	motionCss: barMotion,
	theme,
	title:
		"redisClientCreate: at startup the connect succeeds within 3 s or throws without retrying; once connected, a dropped connection retries forever, waiting longer each time up to 2 s",
	width,
});
