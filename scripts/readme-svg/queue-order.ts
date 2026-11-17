// The queue README's order diagram: three Event keys feed one Consumer. Each key's Events go one
// at a time; order_2's second Event fails five times, so its key is blocked while the others
// carry on. The resting frame is the blocked state.
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
const period = 11;
const keys = [
	{ failsAt: null, name: "order_1", start: 0.3 },
	{ failsAt: 1, name: "order_2", start: 0.7 },
	{ failsAt: null, name: "order_3", start: 1.1 },
] as const;
const laneTop = 78;
const laneGap = 62;
// Event #1 waits nearest the Consumer.
const slotX = [300, 240, 180] as const;
const consumerX = 470;
// Handled Events line up right of the Consumer, #1 furthest along.
const handledX = [820, 765, 710] as const;
const moveSeconds = 0.5;
const runSeconds = 0.9;
// The failed Event turns red this long after it reaches the Consumer (its five attempts).
const failSeconds = 1.4;

const at = (seconds: number): string => keyframePercent(seconds, period);

const css: string[] = [`.chip{fill:${theme.background}}`];
const motion: string[] = [];
const body: string[] = [];
let blockedAt = 0;
let blockedTop = 0;

keys.forEach((key, lane) => {
	const top = laneTop + lane * laneGap;
	body.push(
		svgText({ text: key.name, x: 30, y: top + 20 }),
		`<line x1="120" y1="${top + 15}" x2="${consumerX - 50}" y2="${top + 15}" stroke="${theme.line}" stroke-dasharray="3 5"/>`,
	);
	let waiting = false;
	slotX.forEach((x, index) => {
		const name = `e${lane}${index}`;
		const start = key.start + index * (moveSeconds + runSeconds);
		const arrived = start + moveSeconds;
		const ran = arrived + runSeconds;
		const left = ran + moveSeconds;
		const toConsumer = consumerX - x;
		const toHandled = (handledX[index] ?? 0) - x;
		if (waiting) {
			// Waits behind the failed Event for the whole loop.
			motion.push(
				`@keyframes ${name}{0%,100%{opacity:1}50%{opacity:.45}}.${name}{animation:${name} 2s ease-in-out infinite}`,
			);
		} else if (key.failsAt === index) {
			blockedAt = arrived + failSeconds;
			blockedTop = top;
			css.push(
				`.${name}{transform:translateX(${toConsumer}px)}.${name} rect{fill:${theme.fail}}`,
			);
			motion.push(
				`@keyframes ${name}{0%{transform:translateX(0);opacity:0}2%{opacity:1}${at(start)}{transform:translateX(0)}${at(arrived)},92%{transform:translateX(${toConsumer}px);opacity:1}100%{transform:translateX(${toConsumer}px);opacity:0}}.${name}{animation:${name} ${period}s ease-in-out infinite}`,
				`@keyframes ${name}f{0%,${at(arrived + failSeconds - 0.2)}{fill:${theme.accent}}${at(arrived + failSeconds)},100%{fill:${theme.fail}}}.${name} rect{animation:${name}f ${period}s linear infinite}`,
			);
			waiting = true;
		} else {
			css.push(
				`.${name}{transform:translateX(${toHandled}px)}.${name} rect{fill:${theme.ok}}`,
			);
			motion.push(
				`@keyframes ${name}{0%{transform:translateX(0);opacity:0}2%{opacity:1}${at(start)}{transform:translateX(0)}${at(arrived)},${at(ran)}{transform:translateX(${toConsumer}px);opacity:1}${at(left)},92%{transform:translateX(${toHandled}px);opacity:1}100%{transform:translateX(${toHandled}px);opacity:0}}.${name}{animation:${name} ${period}s ease-in-out infinite}`,
				`@keyframes ${name}c{0%,${at(ran)}{fill:${theme.accent}}${at(left)},100%{fill:${theme.ok}}}.${name} rect{animation:${name}c ${period}s linear infinite}`,
			);
		}
		body.push(
			`<g class="${name}"><rect x="${x - 22}" y="${top + 2}" width="44" height="26" rx="${theme.radius}" fill="${theme.accent}"/>${svgText({ anchor: "middle", className: "mono chip", fontSize: 12, text: `#${index + 1}`, weight: 700, x, y: top + 20 })}</g>`,
		);
	});
});

motion.push(
	`@keyframes blocked{0%,${at(blockedAt)}{opacity:0}${at(blockedAt + 0.4)},92%{opacity:1}100%{opacity:0}}.blocked{animation:blocked ${period}s linear infinite}`,
);

export default svgDocument({
	body: [
		svgGrid({ height, theme, width }),
		svgText({
			className: "display",
			fontSize: 15,
			text: "Ordered per Event key",
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
		`<g class="blocked"><rect x="${consumerX + 50}" y="${blockedTop + 33}" width="330" height="22" rx="${theme.radius}" fill="${theme.panel}" stroke="${theme.fail}"/>${svgText({ className: "mono fail", fontSize: 11, text: "#2 failed 5 times: key blocked, copy in .dead", x: consumerX + 62, y: blockedTop + 48 })}</g>`,
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "Other keys carry on. Retry the Event or give it up to release its key.",
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
		"Events of one Event key reach the Consumer one at a time, in commit order; when order_2's second Event fails five times its key is blocked and the other keys carry on",
	width,
});
