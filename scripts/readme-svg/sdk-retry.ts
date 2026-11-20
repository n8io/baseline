// The sdk README's diagram: a GET gets a 503 with Retry-After, waits, is sent again and gets its
// 200; a POST that gets the same 503 is sent once and resolves it.
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
const period = 9;
const boxWidth = 170;
const callerLeft = 30;
const apiLeft = 680;
const from = callerLeft + boxWidth;
const to = apiLeft;
const rows = [
	{ caption: "GET /api/v1/foos/1", top: 52 },
	{ caption: "POST /api/v1/foos", top: 200 },
] as const;
const lineY = (top: number): number => top + 32;

// One dot crossing between the boxes from `start` to `end` seconds; hidden the rest of the loop.
const leg = ({
	colour,
	end,
	rightward,
	start,
	y,
}: {
	colour: string;
	end: number;
	rightward: boolean;
	start: number;
	y: number;
}): string => {
	const path = rightward ? `M${from} ${y} H${to}` : `M${to} ${y} H${from}`;
	const times = `0;${(start / period).toFixed(3)};${(end / period).toFixed(3)};1`;
	return `<circle class="moving" r="7" fill="${colour}" opacity="0"><animate attributeName="opacity" dur="${period}s" repeatCount="indefinite" calcMode="discrete" values="0;1;0" keyTimes="0;${(start / period).toFixed(3)};${(end / period).toFixed(3)}"/><animateMotion dur="${period}s" repeatCount="indefinite" path="${path}" keyPoints="0;0;1;1" keyTimes="${times}" calcMode="linear"/></circle>`;
};

// Each label is shown at rest; with motion it appears at its moment and stays until the loop ends.
const labels = [
	{ at: 1.6, className: "mono fail", row: 0, text: "503  Retry-After: 1" },
	{
		at: 2.6,
		className: "mono dim",
		row: 0,
		text: "waits 1 s, then sends it again",
	},
	{
		at: 5.6,
		className: "mono ok",
		row: 0,
		text: "200  resolves { status, data }",
	},
	{
		at: 1.6,
		className: "mono fail",
		row: 1,
		text: "503  resolves it: sent once",
	},
] as const;

const appear = labels
	.map(
		({ at }, index) =>
			`@keyframes appear${index}{0%,${keyframePercent(at - 0.05, period)}{opacity:0}${keyframePercent(at, period)},${keyframePercent(period - 0.6, period)}{opacity:1}100%{opacity:0}}.appear${index}{animation:appear${index} ${period}s linear infinite}`,
	)
	.join("\n");

export default svgDocument({
	body: [
		svgGrid({ height, theme, width }),
		...rows.flatMap(({ caption, top }, row) => [
			svgText({
				className: "mono accent",
				fontSize: 13,
				text: caption,
				x: 30,
				y: top - 14,
			}),
			`<path d="M${from} ${lineY(top)} H${to}" fill="none" stroke="${theme.line}" stroke-width="1.5" stroke-dasharray="4 5"/>`,
			svgBox({
				height: 64,
				label: "sdkFetch",
				sublabel: "the SDK's call",
				theme,
				width: boxWidth,
				x: callerLeft,
				y: top,
			}),
			svgBox({
				height: 64,
				label: "the API",
				sublabel: row === 0 ? "busy, then not" : "busy",
				theme,
				width: boxWidth,
				x: apiLeft,
				y: top,
			}),
		]),
		leg({
			colour: theme.accent,
			end: 1.5,
			rightward: true,
			start: 0.5,
			y: lineY(rows[0].top),
		}),
		leg({
			colour: theme.fail,
			end: 2.5,
			rightward: false,
			start: 1.5,
			y: lineY(rows[0].top),
		}),
		leg({
			colour: theme.accent,
			end: 4.6,
			rightward: true,
			start: 3.6,
			y: lineY(rows[0].top),
		}),
		leg({
			colour: theme.ok,
			end: 5.6,
			rightward: false,
			start: 4.6,
			y: lineY(rows[0].top),
		}),
		leg({
			colour: theme.accent,
			end: 1.5,
			rightward: true,
			start: 0.5,
			y: lineY(rows[1].top),
		}),
		leg({
			colour: theme.fail,
			end: 2.5,
			rightward: false,
			start: 1.5,
			y: lineY(rows[1].top),
		}),
		...labels.map(
			({ className, row, text }, index) =>
				`<g class="appear${index}">${svgText({
					anchor: "middle",
					className,
					fontSize: 12,
					text,
					x: (from + to) / 2,
					y:
						lineY(rows[row].top) +
						22 +
						(index === 1 ? 16 : 0) +
						(index === 2 ? 32 : 0),
				})}</g>`,
		),
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "GET, HEAD and DELETE retry on a network failure, a timeout, or 408, 429, 500, 502, 503, 504.",
			x: 30,
			y: height - 20,
		}),
	].join("\n"),
	height,
	motionCss: appear,
	theme,
	title:
		"sdkFetch retries: a GET gets a 503 with Retry-After: 1, waits one second, is sent again and resolves its 200; a POST that gets a 503 is sent once and resolves the 503",
	width,
});
