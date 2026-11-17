// The root README's pieces diagram, in the marquee theme: eight pieces sit on the core, then
// `pnpm piece-remove live` types itself, the live piece lifts out, and the command's own first
// line (apps/app/scripts/piece-remove.ts) reports that `pnpm check` passes. The resting frame
// shows the piece already lifted, so it reads under reduced motion too.
import {
	keyframePercent,
	readmeSvgThemes,
	svgBox,
	svgDocument,
	svgText,
	svgTypedText,
} from "./kit.ts";

const theme = readmeSvgThemes.marquee;
const width = 880;
const height = 300;
const period = 10;
// Every piece in apps/app/scripts/piece-remove.ts pieceRemovals, in the README's order.
const pieces = [
	"ui",
	"api-reference",
	"live",
	"cache",
	"redis",
	"queue",
	"analytics",
	"error-tracking",
];
const removed = "live";
const pieceWidth = 99;
const pieceGap = 4;
const left = 30;
const rowTop = 128;
const lift = 50;
const typedFrom = 0.6;
const typedUntil = 2.2;
const liftAt = 2.8;
const reportAt = 3.8;

const motionCss = `@keyframes lift{0%,${keyframePercent(liftAt, period)}{transform:translateY(0)}${keyframePercent(liftAt + 0.8, period)},92%{transform:translateY(-${lift}px)}97%,100%{transform:translateY(0)}}
.lifted{animation:lift ${period}s ease-in-out infinite}
@keyframes report{0%,${keyframePercent(reportAt, period)}{opacity:0}${keyframePercent(reportAt + 0.3, period)},92%{opacity:1}97%,100%{opacity:0}}
.report{animation:report ${period}s linear infinite}`;

export default svgDocument({
	body: [
		svgText({
			className: "display",
			fontSize: 15,
			text: "Take out what you do not use",
			weight: 700,
			x: left,
			y: 44,
		}),
		svgText({
			anchor: "end",
			className: "mono dim",
			fontSize: 12,
			text: "8 pieces · 1 command each",
			x: width - 30,
			y: 44,
		}),
		...pieces.map((piece, index) => {
			const box = svgBox({
				fontSize: 11,
				height: 44,
				label: piece,
				stroke: piece === removed ? theme.accent : null,
				theme,
				width: pieceWidth,
				x: left + index * (pieceWidth + pieceGap),
				y: rowTop,
			});
			return piece === removed
				? `<g class="lifted" style="transform:translateY(-${lift}px)">${box}</g>`
				: box;
		}),
		svgBox({
			fill: theme.grid,
			fontSize: 13,
			height: 44,
			label:
				"the core: Domains · API · Use cases · Postgres · sign-in · telemetry · health",
			theme,
			width: pieces.length * pieceWidth + (pieces.length - 1) * pieceGap,
			x: left,
			y: rowTop + 52,
		}),
		svgTypedText({
			fontSize: 14,
			id: "pieces-command",
			period,
			prompt: "$ ",
			text: `pnpm piece-remove ${removed}`,
			typedFrom,
			typedUntil,
			x: left,
			y: 258,
		}),
		`<g class="report">${svgText({
			className: "mono ok",
			fontSize: 13,
			text: `Removed ${removed}; pnpm check passes.`,
			x: 290,
			y: 258,
		})}</g>`,
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "The pieces CI job proves each one still comes out, on every pull request that changes code.",
			x: left,
			y: height - 14,
		}),
	].join("\n"),
	height,
	motionCss,
	theme,
	title:
		"Eight pieces sit on the core; pnpm piece-remove live lifts the live piece out and pnpm check passes",
	width,
});
