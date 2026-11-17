// The queue README's order diagram: three Event keys feed one Consumer. Each key's Events go one
// at a time; order_2's second Event fails once, waits for its retry while #3 holds behind it, then
// succeeds, and #3 follows. Every Event ends handled, in order. The resting frame is that end.
import {
	keyframePercent,
	readmeSvgThemes,
	svgDocument,
	svgGrid,
	svgText,
} from "./kit.ts";

const theme = readmeSvgThemes.blueprint;
const width = 880;
const height = 300;
const period = 12;
const laneTop = 78;
const laneGap = 62;
// Event #1 waits nearest the Consumer.
const slotX = [300, 240, 180] as const;
const consumerX = 470;
// Handled Events line up right of the Consumer, #1 furthest along.
const handledX = [820, 765, 710] as const;
const moveSeconds = 0.5;
const runSeconds = 0.8;
// order_2's #2: its first attempt fails at the end of its run, then it waits this long for the retry.
const retryLane = 1;
const retryIndex = 1;
const retryWait = 1.8;
const keys = [
	{ name: "order_1", start: 0.3 },
	{ name: "order_2", start: 0.6 },
	{ name: "order_3", start: 0.9 },
];

const at = (seconds: number): string => keyframePercent(seconds, period);

const css: string[] = [
	`.chip{fill:${theme.background}}`,
	".retrying{opacity:0}",
];
const motion: string[] = [];
const body: string[] = [];
let retryFrom = 0;
let retryUntil = 0;

keys.forEach((key, lane) => {
	const top = laneTop + lane * laneGap;
	body.push(
		svgText({ text: key.name, x: 30, y: top + 20 }),
		`<line x1="120" y1="${top + 15}" x2="${consumerX - 50}" y2="${top + 15}" stroke="${theme.line}" stroke-dasharray="3 5"/>`,
	);
	// Each Event starts once the one before it has left the Consumer.
	let start = key.start;
	slotX.forEach((x, index) => {
		const name = `e${lane}${index}`;
		const arrived = start + moveSeconds;
		const retried = lane === retryLane && index === retryIndex;
		const failed = arrived + runSeconds;
		const ran = retried ? failed + retryWait + runSeconds : failed;
		const left = ran + moveSeconds;
		const toConsumer = consumerX - x;
		const toHandled = (handledX[index] ?? 0) - x;
		css.push(
			`.${name}{transform:translateX(${toHandled}px)}.${name} rect{fill:${theme.ok}}`,
		);
		motion.push(
			`@keyframes ${name}{0%{transform:translateX(0);opacity:0}2%{opacity:1}${at(start)}{transform:translateX(0)}${at(arrived)},${at(ran)}{transform:translateX(${toConsumer}px);opacity:1}${at(left)},92%{transform:translateX(${toHandled}px);opacity:1}100%{transform:translateX(${toHandled}px);opacity:0}}.${name}{animation:${name} ${period}s ease-in-out infinite}`,
		);
		if (retried) {
			retryFrom = failed;
			retryUntil = failed + retryWait;
			motion.push(
				`@keyframes ${name}c{0%,${at(failed - 0.1)}{fill:${theme.accent}}${at(failed)},${at(retryUntil - 0.1)}{fill:${theme.fail}}${at(retryUntil)},${at(ran)}{fill:${theme.accent}}${at(left)},100%{fill:${theme.ok}}}.${name} rect{animation:${name}c ${period}s linear infinite}`,
			);
		} else {
			motion.push(
				`@keyframes ${name}c{0%,${at(ran)}{fill:${theme.accent}}${at(left)},100%{fill:${theme.ok}}}.${name} rect{animation:${name}c ${period}s linear infinite}`,
			);
		}
		body.push(
			`<g class="${name}"><rect x="${x - 22}" y="${top + 2}" width="44" height="26" rx="${theme.radius}" fill="${theme.accent}"/>${svgText({ anchor: "middle", className: "mono chip", fontSize: 12, text: `#${index + 1}`, weight: 700, x, y: top + 20 })}</g>`,
		);
		start = left;
	});
});

const retryTop = laneTop + retryLane * laneGap;
motion.push(
	`@keyframes retrying{0%,${at(retryFrom)}{opacity:0}${at(retryFrom + 0.2)},${at(retryUntil)}{opacity:1}${at(retryUntil + 0.2)},100%{opacity:0}}.retrying{animation:retrying ${period}s linear infinite}`,
	`@keyframes held{0%,${at(retryFrom)}{opacity:1}${at(retryFrom + 0.4)}{opacity:.4}${at(retryFrom + 0.8)}{opacity:1}${at(retryFrom + 1.2)}{opacity:.4}${at(retryUntil)},100%{opacity:1}}.e${retryLane}${retryIndex + 1} rect{animation-name:e${retryLane}${retryIndex + 1}c,held}`,
);

export default svgDocument({
	body: [
		svgGrid({ height, theme, width }),
		svgText({
			className: "display",
			fontSize: 15,
			text: "Ordered per Event key, even through a retry",
			weight: 700,
			x: 30,
			y: 44,
		}),
		`<rect x="${consumerX - 40}" y="${laneTop - 14}" width="80" height="${laneGap * 3}" rx="${theme.radius}" fill="none" stroke="${theme.line}" stroke-width="1.5"/>`,
		svgText({
			anchor: "middle",
			className: "mono dim",
			fontSize: 12,
			text: "Consumer",
			x: consumerX,
			y: laneTop - 22,
		}),
		svgText({
			anchor: "middle",
			className: "mono dim",
			fontSize: 12,
			text: "handled",
			x: handledX[1],
			y: laneTop - 22,
		}),
		...body,
		`<g class="retrying"><rect x="${consumerX + 50}" y="${retryTop + 33}" width="300" height="22" rx="${theme.radius}" fill="${theme.panel}" stroke="${theme.fail}"/>${svgText({ className: "mono fail", fontSize: 11, text: "#2 failed: retry soon, #3 waits behind it", x: consumerX + 62, y: retryTop + 48 })}</g>`,
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "A failure delays its own key, never reorders it. Other keys carry on.",
			x: 30,
			y: height - 22,
		}),
		svgText({
			anchor: "end",
			className: "mono dim",
			fontSize: 12,
			text: "on any number of workers",
			x: width - 30,
			y: height - 22,
		}),
	].join("\n"),
	css: css.join("\n"),
	height,
	motionCss: motion.join("\n"),
	theme,
	title:
		"Events of one Event key reach the Consumer one at a time, in commit order; order_2's second Event fails once, #3 waits behind it while it retries, then both are handled and the other keys never stop",
	width,
});
