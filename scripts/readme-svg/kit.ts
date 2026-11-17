// The README SVG kit: two themes and the helpers every diagram in scripts/readme-svg/ builds on.
// Each other file here is one diagram that default-exports its SVG as a string;
// scripts/readme-svg-write.ts writes them. The rules are in docs/agents/readmes.md.

export type ReadmeSvgTheme = {
	accent: string;
	accentSecondary?: string;
	background: string;
	dim: string;
	display: string;
	fail: string;
	grid: string;
	line: string;
	mono: string;
	ok: string;
	panel: string;
	radius: number;
	text: string;
};

const monoFonts = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const sansFonts =
	"-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

// `marquee` is the root README's; `blueprint` is every Package README's.
export const readmeSvgThemes = {
	blueprint: {
		accent: "#F5B544",
		background: "#0C1C30",
		dim: "#86A3BE",
		display: monoFonts,
		fail: "#FF7A6B",
		grid: "#14304F",
		line: "#5FA8D3",
		mono: monoFonts,
		ok: "#6CD4A0",
		panel: "#10243D",
		radius: 2,
		text: "#DCEBF7",
	},
	marquee: {
		accent: "#FF5A36",
		accentSecondary: "#FFC24B",
		background: "#15100E",
		dim: "#B09C8E",
		display: sansFonts,
		fail: "#FF4D6D",
		grid: "#2C211C",
		line: "#55433A",
		mono: monoFonts,
		ok: "#7BDCB5",
		panel: "#221915",
		radius: 14,
		text: "#F7EEE6",
	},
} as const satisfies Record<string, ReadmeSvgTheme>;

export const svgEscape = (text: string): string =>
	text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");

// A keyframe offset for a moment `seconds` into an animation that loops every `period` seconds.
export const keyframePercent = (seconds: number, period: number): string =>
	`${Math.max(0, Math.min(100, (seconds / period) * 100)).toFixed(2)}%`;

export type SvgDocumentOptions = {
	body: string;
	css?: string | null;
	height: number;
	motionCss?: string | null;
	theme: ReadmeSvgTheme;
	title: string;
	width: number;
};

// The whole file: the title, the shared classes, the reduced-motion block and the theme's own
// background panel, so the diagram reads on GitHub light and dark and on npmjs. `css` always
// applies; `motionCss` (every @keyframes and animation rule) only when the viewer allows motion.
// Under reduced motion each element keeps its unanimated style, `.typed` text shows in full and
// `.moving` (an element SMIL moves) hides, so give each element its finished look as its style.
export const svgDocument = ({
	body,
	css,
	height,
	motionCss,
	theme,
	title,
	width,
}: SvgDocumentOptions): string =>
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${svgEscape(title)}">
<title>${svgEscape(title)}</title>
<style>
.display{font-family:${theme.display};fill:${theme.text}}
.mono{font-family:${theme.mono};fill:${theme.text}}
.dim{fill:${theme.dim}}
.accent{fill:${theme.accent}}
.ok{fill:${theme.ok}}
.fail{fill:${theme.fail}}
${css ?? ""}
@media (prefers-reduced-motion: no-preference){
${motionCss ?? ""}
}
@media (prefers-reduced-motion: reduce){.typed{clip-path:none}.moving{display:none}}
</style>
<rect width="${width}" height="${height}" rx="${theme.radius + 4}" fill="${theme.background}"/>
${body}
</svg>
`;

export type SvgGridOptions = {
	height: number;
	id?: string | null;
	step?: number | null;
	theme: ReadmeSvgTheme;
	width: number;
};

// The blueprint's faint graph-paper grid, as a tiled pattern over the rounded panel. Each tile
// draws its top and left edge at double width, half of which the tile clips.
export const svgGrid = ({
	height,
	id,
	step,
	theme,
	width,
}: SvgGridOptions): string => {
	const gap = step ?? 20;
	const patternId = id ?? "grid";
	return `<defs><pattern id="${patternId}" width="${gap}" height="${gap}" patternUnits="userSpaceOnUse"><path d="M0 0V${gap}M0 0H${gap}" fill="none" stroke="${theme.grid}" stroke-width="2"/></pattern></defs><rect width="${width}" height="${height}" rx="${theme.radius + 4}" fill="url(#${patternId})"/>`;
};

export type SvgTextOptions = {
	anchor?: "start" | "middle" | "end" | null;
	className?: string | null;
	fontSize?: number | null;
	text: string;
	weight?: number | null;
	x: number;
	y: number;
};

// One line of escaped text. `className` picks the font and colour: `display` or `mono`, plus
// `dim`, `accent`, `ok` or `fail`.
export const svgText = ({
	anchor,
	className,
	fontSize,
	text,
	weight,
	x,
	y,
}: SvgTextOptions): string =>
	`<text x="${x}" y="${y}"${anchor ? ` text-anchor="${anchor}"` : ""} class="${className ?? "mono"}" font-size="${fontSize ?? 13}"${weight ? ` font-weight="${weight}"` : ""}>${svgEscape(text)}</text>`;

export type SvgBoxOptions = {
	className?: string | null;
	fill?: string | null;
	fontSize?: number | null;
	height: number;
	label: string;
	stroke?: string | null;
	sublabel?: string | null;
	theme: ReadmeSvgTheme;
	width: number;
	x: number;
	y: number;
};

// A labelled box, with an optional dim second line. `className` goes on its group, so a
// keyframe can target `.<className> rect`.
export const svgBox = ({
	className,
	fill,
	fontSize,
	height,
	label,
	stroke,
	sublabel,
	theme,
	width,
	x,
	y,
}: SvgBoxOptions): string => {
	const middle = x + width / 2;
	const baseline = y + height / 2 + (sublabel ? -2 : 5);
	const second = sublabel
		? `<text x="${middle}" y="${baseline + 17}" text-anchor="middle" class="mono dim" font-size="11">${svgEscape(sublabel)}</text>`
		: "";
	return `<g class="${className ?? ""}"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${theme.radius}" fill="${fill ?? theme.panel}" stroke="${stroke ?? theme.line}" stroke-width="1.5"/><text x="${middle}" y="${baseline}" text-anchor="middle" class="display" font-size="${fontSize ?? 14}" font-weight="600">${svgEscape(label)}</text>${second}</g>`;
};

export type SvgTypedTextOptions = {
	className?: string | null;
	fontSize?: number | null;
	id: string;
	period: number;
	prompt?: string | null;
	text: string;
	typedFrom: number;
	typedUntil: number;
	x: number;
	y: number;
};

// A mono line typed left to right between `typedFrom` and `typedUntil` (seconds), held, then
// cleared from 92% to 97% of the period. `id` must be unique in the diagram, and `className`
// must not change the font: the width assumes a monospace character of 0.61em. The reveal is SMIL on a clipPath rect's width: CSS
// width there does not repaint in Chrome. `prompt` (such as "$ ") is drawn in the accent.
export const svgTypedText = ({
	className,
	fontSize,
	id,
	period,
	prompt,
	text,
	typedFrom,
	typedUntil,
	x,
	y,
}: SvgTypedTextOptions): string => {
	if (
		!(0 <= typedFrom && typedFrom <= typedUntil && typedUntil <= period * 0.92)
	) {
		throw new Error(
			`svgTypedText ${id}: need 0 <= typedFrom <= typedUntil <= 92% of the period`,
		);
	}
	const size = fontSize ?? 13;
	const width = Math.ceil(`${prompt ?? ""}${text}`.length * size * 0.61) + 6;
	const keyTimes = [0, typedFrom / period, typedUntil / period, 0.92, 0.97, 1]
		.map((time) => time.toFixed(3))
		.join(";");
	const promptSpan = prompt
		? `<tspan class="accent">${svgEscape(prompt)}</tspan>`
		: "";
	return `<clipPath id="${id}"><rect x="${x}" y="${y - size - 3}" width="0" height="${size + 9}"><animate attributeName="width" dur="${period}s" repeatCount="indefinite" values="0;0;${width};${width};0;0" keyTimes="${keyTimes}"/></rect></clipPath><text x="${x}" y="${y}" class="typed mono ${className ?? ""}" font-size="${size}" clip-path="url(#${id})">${promptSpan}${svgEscape(text)}</text>`;
};
