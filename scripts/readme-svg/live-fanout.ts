// The live README's diagram. First half: a Live update leaves `liveHub.send` after a commit, fans
// out through Redis pub/sub to every instance, and each open page's stream tells it to rerun its
// loaders. Second half: Redis goes down, `send` still resolves and the pages go stale; when the
// subscriber connection returns, each stream sends `ready` and the pages catch up. The resting
// frame is the first half's end.
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
const period = 13;
const at = (seconds: number): string => keyframePercent(seconds, period);

const sendBox = { height: 56, width: 190, x: 30, y: 140 };
const redisBox = { height: 56, width: 170, x: 300, y: 140 };
const instanceLeft = 560;
const instanceWidth = 120;
const pageLeft = 740;
const pageWidth = 110;
const rowTops = [70, 148, 226] as const;
const rowHeight = 40;

const sendRight = sendBox.x + sendBox.width;
const redisMiddleY = redisBox.y + redisBox.height / 2;
const redisRight = redisBox.x + redisBox.width;

// Phase one: the update travels.
const sendFrom = 0.4;
const sendUntil = 1.3;
const fanUntil = 2.3;
const pageUntil = 3.1;
// Phase two: the outage and the catch-up.
const downAt = 5.2;
const lostFrom = 5.6;
const lostUntil = 6.3;
const upAt = 8.6;
// Each stream's `ready` leaves a little after the last, as the 1 to 5 s spread does.
const readyFrom = [9.0, 9.6, 10.2] as const;
const readyTravel = 0.7;

// A dot that moves along `path` between two moments and is shown only while it moves.
const dot = ({
	from,
	name,
	path,
	until,
}: {
	from: number;
	name: string;
	path: string;
	until: number;
}): { css: string; svg: string } => ({
	css: `@keyframes ${name}{0%,${at(from - 0.05)}{opacity:0}${at(from)},${at(until)}{opacity:1}${at(until + 0.1)},100%{opacity:0}}.${name}{animation:${name} ${period}s linear infinite}`,
	svg: `<circle class="moving ${name}" r="6" fill="${theme.accent}"><animateMotion dur="${period}s" repeatCount="indefinite" path="${path}" keyPoints="0;0;1;1" keyTimes="0;${(from / period).toFixed(3)};${(until / period).toFixed(3)};1" calcMode="linear"/></circle>`,
});

const rowMiddle = (top: number): number => top + rowHeight / 2;
const sendPath = `M${sendRight} ${redisMiddleY} H${redisBox.x}`;
const dots = [
	dot({ from: sendFrom, name: "send", path: sendPath, until: sendUntil }),
	// Redis is down: the update stops at its door.
	dot({
		from: lostFrom,
		name: "lost",
		path: `M${sendRight} ${redisMiddleY} H${redisBox.x - 8}`,
		until: lostUntil,
	}),
	...rowTops.flatMap((top, row) => [
		dot({
			from: sendUntil,
			name: `fan${row}`,
			path: `M${redisRight} ${redisMiddleY} L${instanceLeft} ${rowMiddle(top)}`,
			until: fanUntil,
		}),
		dot({
			from: fanUntil,
			name: `page${row}`,
			path: `M${instanceLeft + instanceWidth} ${rowMiddle(top)} H${pageLeft}`,
			until: pageUntil,
		}),
		dot({
			from: readyFrom[row] ?? 0,
			name: `ready${row}`,
			path: `M${instanceLeft + instanceWidth} ${rowMiddle(top)} H${pageLeft}`,
			until: (readyFrom[row] ?? 0) + readyTravel,
		}),
	]),
];

const css = [
	`.down,.stale,.caught{opacity:0}`,
	`.redis rect{stroke:${theme.line}}`,
].join("\n");

const motion = [
	...dots.map((moving) => moving.css),
	`@keyframes redis{0%,${at(downAt - 0.1)}{stroke:${theme.line}}${at(downAt)},${at(upAt)}{stroke:${theme.fail}}${at(upAt + 0.1)},100%{stroke:${theme.ok}}}.redis rect{animation:redis ${period}s linear infinite}`,
	`@keyframes down{0%,${at(downAt - 0.1)}{opacity:0}${at(downAt)},${at(upAt)}{opacity:1}${at(upAt + 0.1)},100%{opacity:0}}.down{animation:down ${period}s linear infinite}`,
	`@keyframes resolved{0%,${at(lostUntil)}{opacity:0}${at(lostUntil + 0.2)},${at(upAt)}{opacity:1}${at(upAt + 0.2)},100%{opacity:0}}.stale{animation:resolved ${period}s linear infinite}`,
	`@keyframes caught{0%,${at(upAt)}{opacity:0}${at(upAt + 0.2)},96%{opacity:1}100%{opacity:0}}.caught{animation:caught ${period}s linear infinite}`,
	...rowTops.map((_, row) => {
		const updated = pageUntil;
		const caughtUp = (readyFrom[row] ?? 0) + readyTravel;
		return `@keyframes p${row}{0%,${at(updated - 0.05)}{stroke:${theme.line};fill:${theme.panel}}${at(updated)},${at(updated + 1)}{stroke:${theme.accent};fill:${theme.panel}}${at(updated + 1.4)},${at(lostUntil)}{stroke:${theme.line};fill:${theme.panel}}${at(lostUntil + 0.2)},${at(caughtUp - 0.05)}{stroke:${theme.line};fill:${theme.background}}${at(caughtUp)},${at(caughtUp + 1)}{stroke:${theme.ok};fill:${theme.panel}}${at(caughtUp + 1.4)},100%{stroke:${theme.line};fill:${theme.panel}}}.p${row} rect{animation:p${row} ${period}s linear infinite}`;
	}),
].join("\n");

export default svgDocument({
	body: [
		svgGrid({ height, theme, width }),
		svgText({
			className: "display",
			fontSize: 15,
			text: "One change, every open page",
			weight: 700,
			x: 30,
			y: 40,
		}),
		`<path d="${sendPath}" stroke="${theme.line}" stroke-dasharray="3 5" fill="none"/>`,
		...rowTops.map(
			(top) =>
				`<path d="M${redisRight} ${redisMiddleY} L${instanceLeft} ${rowMiddle(top)} M${instanceLeft + instanceWidth} ${rowMiddle(top)} H${pageLeft}" stroke="${theme.line}" stroke-dasharray="3 5" fill="none"/>`,
		),
		svgBox({
			height: sendBox.height,
			label: "liveHub.send()",
			sublabel: "after the commit",
			theme,
			width: sendBox.width,
			x: sendBox.x,
			y: sendBox.y,
		}),
		svgBox({
			className: "redis",
			height: redisBox.height,
			label: "Redis pub/sub",
			sublabel: "every instance",
			theme,
			width: redisBox.width,
			x: redisBox.x,
			y: redisBox.y,
		}),
		svgText({
			anchor: "middle",
			className: "mono dim",
			fontSize: 12,
			text: "instance",
			x: instanceLeft + instanceWidth / 2,
			y: rowTops[0] - 12,
		}),
		svgText({
			anchor: "middle",
			className: "mono dim",
			fontSize: 12,
			text: "open page",
			x: pageLeft + pageWidth / 2,
			y: rowTops[0] - 12,
		}),
		...rowTops.flatMap((top, row) => [
			svgBox({
				fontSize: 12,
				height: rowHeight,
				label: "SSE stream",
				theme,
				width: instanceWidth,
				x: instanceLeft,
				y: top,
			}),
			svgBox({
				className: `p${row}`,
				fontSize: 12,
				height: rowHeight,
				label: "loaders rerun",
				theme,
				width: pageWidth,
				x: pageLeft,
				y: top,
			}),
		]),
		...dots.map(({ svg }) => svg),
		`<g class="down">${svgText({ anchor: "middle", className: "mono fail", fontSize: 12, text: "down", weight: 700, x: redisBox.x + redisBox.width / 2, y: redisBox.y - 10 })}</g>`,
		`<g class="stale">${svgText({ className: "mono dim", fontSize: 12, text: "send resolves within 1 s; counted and logged", x: sendBox.x, y: sendBox.y + sendBox.height + 26 })}${svgText({ className: "mono dim", fontSize: 12, text: "pages stay as they were", x: sendBox.x, y: sendBox.y + sendBox.height + 46 })}</g>`,
		`<g class="caught">${svgText({ className: "mono ok", fontSize: 12, text: "back: each stream sends ready", x: sendBox.x, y: sendBox.y + sendBox.height + 26 })}${svgText({ className: "mono ok", fontSize: 12, text: "within 1 to 5 s, every page catches up", x: sendBox.x, y: sendBox.y + sendBox.height + 46 })}</g>`,
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "An update says what changed, never the data. Losing one never fails the change.",
			x: 30,
			y: height - 18,
		}),
	].join("\n"),
	css,
	height,
	motionCss: motion,
	theme,
	title:
		"A Live update fans out from liveHub.send through Redis pub/sub to every instance and each open page reruns its loaders; while Redis is down send still resolves, and when it returns each stream sends ready so every page catches up",
	width,
});
