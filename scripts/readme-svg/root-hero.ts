// The root README's hero, in the marquee theme: the wordmark and its promise beside a terminal
// that types `pnpm app-create`, then `pnpm dev`, each followed by the lines it really prints
// (scripts/app-create.ts, Vite's dev server), except the dim `#` line, which sums up the steps
// `pnpm dev` runs before the server starts. The release reads x.y.z so the file never goes stale.
import {
	keyframePercent,
	readmeSvgThemes,
	svgDocument,
	svgEscape,
	svgText,
	svgTypedText,
} from "./kit.ts";

const theme = readmeSvgThemes.marquee;
const width = 880;
const height = 380;
const period = 14;
const terminalLeft = 310;
const textLeft = 330;
const firstLine = 124;
const lineGap = 24;

type Line = {
	className?: string;
	prompt?: string;
	text: string;
	typedFrom: number;
	typedUntil: number;
};

// Output lines appear in a blink; commands type at about 25 characters a second.
const lines: Line[] = [
	{
		prompt: "$ ",
		text: 'pnpm app-create --name acme --description "Fantasy golf"',
		typedFrom: 0.6,
		typedUntil: 2.8,
	},
	{
		className: "dim",
		text: "Rendering app@x.y.z into /Users/you/code/acme",
		typedFrom: 3.2,
		typedUntil: 3.4,
	},
	{
		className: "dim",
		text: "Created the ci ruleset on you/acme",
		typedFrom: 3.7,
		typedUntil: 3.9,
	},
	{
		className: "dim",
		text: "Set up https://github.com/you/acme",
		typedFrom: 4.2,
		typedUntil: 4.4,
	},
	{
		className: "ok",
		text: "CI is running on main: https://github.com/you/acme/…",
		typedFrom: 4.7,
		typedUntil: 4.9,
	},
	{
		prompt: "$ ",
		text: "cd acme && pnpm dev",
		typedFrom: 5.6,
		typedUntil: 6.5,
	},
	{
		className: "dim",
		text: "# Postgres 18, Redis 8, migrate, seed, then the Worker",
		typedFrom: 7,
		typedUntil: 7.2,
	},
	{
		className: "ok",
		text: "➜  Local:   http://localhost:5173/",
		typedFrom: 7.6,
		typedUntil: 7.8,
	},
];

const pillsTop = firstLine + lines.length * lineGap - 6;
const pills = [
	{ color: theme.accent, label: "API and pages" },
	{ color: theme.accentSecondary, label: "Worker" },
	{ color: theme.ok, label: "CI on every pull request" },
];
let pillLeft = textLeft;
const pillMarkup = pills
	.map(({ color, label }) => {
		const pillWidth = Math.ceil(label.length * 12 * 0.61) + 26;
		const markup = `<rect x="${pillLeft}" y="${pillsTop}" width="${pillWidth}" height="26" rx="13" fill="none" stroke="${color}"/><text x="${pillLeft + 13}" y="${pillsTop + 17}" class="mono" font-size="12" style="fill:${color}">${svgEscape(label)}</text>`;
		pillLeft += pillWidth + 10;
		return markup;
	})
	.join("");

const motionCss = `@keyframes pills{0%,${keyframePercent(8.2, period)}{opacity:0;transform:translateY(6px)}${keyframePercent(8.8, period)},92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
.pills{animation:pills ${period}s ease-out infinite}`;

export default svgDocument({
	body: [
		`<text x="34" y="128" class="display" font-size="54" font-weight="800" letter-spacing="-2">baseline</text>`,
		`<rect x="36" y="146" width="64" height="6" rx="3" fill="${theme.accent}"/>`,
		svgText({
			className: "display",
			fontSize: 17,
			text: "From nothing to a running,",
			weight: 600,
			x: 34,
			y: 190,
		}),
		svgText({
			className: "display",
			fontSize: 17,
			text: "tested app in two commands.",
			weight: 600,
			x: 34,
			y: 214,
		}),
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "TypeScript · Domains · Events",
			x: 34,
			y: 250,
		}),
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "one CI for every Project",
			x: 34,
			y: 268,
		}),
		`<rect x="${terminalLeft}" y="56" width="545" height="${height - 80}" rx="${theme.radius}" fill="${theme.panel}" stroke="${theme.line}"/>`,
		[0, 1, 2]
			.map(
				(dot) =>
					`<circle cx="${textLeft + dot * 18}" cy="76" r="5" fill="${theme.line}"/>`,
			)
			.join(""),
		`<line x1="${terminalLeft}" y1="92" x2="${terminalLeft + 545}" y2="92" stroke="${theme.line}"/>`,
		...lines.map((line, index) =>
			svgTypedText({
				className: line.className ?? null,
				id: `hero-line-${index}`,
				period,
				prompt: line.prompt ?? null,
				text: line.text,
				typedFrom: line.typedFrom,
				typedUntil: line.typedUntil,
				x: textLeft,
				y: firstLine + index * lineGap,
			}),
		),
		`<g class="pills">${pillMarkup}</g>`,
	].join("\n"),
	height,
	motionCss,
	theme,
	title:
		"baseline: pnpm app-create renders a Project and sets up its GitHub repo and CI; pnpm dev starts Postgres, Redis, migrations, seed, the Worker and the dev server",
	width,
});
