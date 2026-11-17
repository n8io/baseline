// The kit's sample diagram, in the blueprint theme: a grid, boxes that light up as a dot passes,
// and a typed command. Copy it to start a new diagram.
import {
	keyframePercent,
	readmeSvgThemes,
	svgBox,
	svgDocument,
	svgGrid,
	svgTypedText,
} from "./kit.ts";

const theme = readmeSvgThemes.blueprint;
const width = 880;
const height = 240;
const period = 8;
const steps = ["pnpm readme-svg", "docs/readme/*.svg", "README.md"];
const boxWidth = 220;
const boxLefts = [40, 330, 620] as const;
const boxTop = 70;
const centreY = boxTop + 28;
const travel = 0.8; // the share of the loop the dot spends moving

// Box i lights up as the dot reaches its centre.
const glows = boxLefts
	.map((left, index) => {
		const reached =
			((left - boxLefts[0]) / (boxLefts[2] - boxLefts[0])) * travel * period;
		return `@keyframes glow${index}{0%,${keyframePercent(reached - 0.3, period)},${keyframePercent(reached + 0.6, period)},100%{stroke:${theme.line}}${keyframePercent(reached, period)}{stroke:${theme.accent}}}.glow${index} rect{animation:glow${index} ${period}s linear infinite}`;
	})
	.join("\n");

const path = `M${boxLefts[0] + boxWidth / 2} ${centreY} H${boxLefts[2] + boxWidth / 2}`;

export default svgDocument({
	body: [
		svgGrid({ height, theme, width }),
		`<text x="40" y="44" class="display" font-size="15" font-weight="700">README kit sample</text>`,
		`<path d="${path}" fill="none" stroke="${theme.line}" stroke-width="1.5" stroke-dasharray="4 5"/>`,
		...steps.map((label, index) =>
			svgBox({
				className: `glow${index}`,
				height: 56,
				label,
				theme,
				width: boxWidth,
				x: boxLefts[index] ?? 0,
				y: boxTop,
			}),
		),
		`<circle class="moving" r="7" fill="${theme.accent}"><animateMotion dur="${period}s" repeatCount="indefinite" path="${path}" keyPoints="0;1;1" keyTimes="0;${travel};1" calcMode="linear"/></circle>`,
		svgTypedText({
			id: "sample-command",
			period,
			prompt: "$ ",
			text: "pnpm readme-svg",
			typedFrom: 0.3,
			typedUntil: 1.8,
			x: 40,
			y: 186,
		}),
		`<text x="40" y="${height - 18}" class="mono dim" font-size="12">One file per diagram; the test checks the committed SVG equals its generator.</text>`,
	].join("\n"),
	css: glows,
	height,
	theme,
	title:
		"README kit sample: a dot passes three boxes, each lights up, and a command types itself",
	width,
});
