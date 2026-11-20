// The cli README's diagram: a command is typed, then a dot carries it from the OpenAPI document
// through the command and the SDK function to the JSON it prints.
import {
	keyframePercent,
	readmeSvgThemes,
	svgBox,
	svgDocument,
	svgGrid,
	svgText,
	svgTypedText,
} from "./kit.ts";

const theme = readmeSvgThemes.blueprint;
const width = 880;
const height = 250;
const period = 9;
const steps = [
	{ label: "openapi.json", sublabel: "fooCreate, tag foo" },
	{ label: "acme foo create", sublabel: "--name x is the body" },
	{ label: "fooCreate(body, req)", sublabel: "the generated SDK" },
	{ label: "stdout", sublabel: "the response as JSON" },
];
const boxWidth = 190;
const boxLefts = [30, 240, 450, 660] as const;
const boxTop = 96;
const centreY = boxTop + 32;
// The command types itself first; then the dot moves from the first box's centre to the last's.
const moveFrom = 2.4;
const moveUntil = 7;
const first = boxLefts[0] + boxWidth / 2;
const last = boxLefts[3] + boxWidth / 2;

// Box i lights up as the dot reaches its centre.
const glows = boxLefts
	.map((left, index) => {
		const reached =
			moveFrom +
			((left + boxWidth / 2 - first) / (last - first)) * (moveUntil - moveFrom);
		return `@keyframes glow${index}{0%,${keyframePercent(reached - 0.3, period)},${keyframePercent(reached + 0.6, period)},100%{stroke:${theme.line}}${keyframePercent(reached, period)}{stroke:${theme.accent}}}.glow${index} rect{animation:glow${index} ${period}s linear infinite}`;
	})
	.join("\n");

const path = `M${first} ${centreY} H${last}`;

export default svgDocument({
	body: [
		svgGrid({ height, theme, width }),
		svgTypedText({
			id: "cli-command",
			period,
			prompt: "$ ",
			text: "acme foo create --name x",
			typedFrom: 0.3,
			typedUntil: 2,
			x: 30,
			y: 52,
		}),
		`<path d="${path}" fill="none" stroke="${theme.line}" stroke-width="1.5" stroke-dasharray="4 5"/>`,
		// Drawn under the boxes, so the dot shows in the gaps and each box lights up as it passes.
		`<circle class="moving" r="7" fill="${theme.accent}"><animateMotion dur="${period}s" repeatCount="indefinite" path="${path}" keyPoints="0;0;1;1" keyTimes="0;${moveFrom / period};${moveUntil / period};1" calcMode="linear"/></circle>`,
		...steps.map(({ label, sublabel }, index) =>
			svgBox({
				className: `glow${index}`,
				fontSize: 13,
				height: 64,
				label,
				sublabel,
				theme,
				width: boxWidth,
				x: boxLefts[index] ?? 0,
				y: boxTop,
			}),
		),
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "A Problem prints title: code to stderr instead, and the command exits 1.",
			x: 30,
			y: height - 46,
		}),
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "One command per operation; no command code in the Project.",
			x: 30,
			y: height - 24,
		}),
	].join("\n"),
	height,
	motionCss: glows,
	theme,
	title:
		"cliCreate: the command acme foo create --name x types itself, then a dot runs from the fooCreate operation in openapi.json through the command and the SDK function fooCreate to its JSON on stdout",
	width,
});
