// A prefixed id and the UUID it carries: the id types itself, idToUuid turns it into the
// Postgres uuid, and idFromUuid turns it back. Serves packages/id/README.md.
import {
	keyframePercent,
	readmeSvgThemes,
	svgDocument,
	svgGrid,
	svgText,
	svgTypedText,
} from "./kit.ts";

const theme = readmeSvgThemes.blueprint;
const width = 880;
const height = 300;
const period = 9;
const left = 60;
const size = 24;
const char = size * 0.61;
// A real pair: idToUuid("foo_01m7nmdcagf5brewdswqhsh1ep") returns this UUID.
const idSuffix = "01m7nmdcagf5brewdswqhsh1ep";
const uuid = "01a1eb46-b150-7957-8771-b9e5e39885d6";
const idY = 100;
const uuidY = 222;

const bracket = ({ from, to, y }: { from: number; to: number; y: number }) =>
	`<path d="M${from} ${y} v6 H${to} v-6" fill="none" stroke="${theme.dim}" stroke-width="1"/>`;

const arrow = ({ down, x }: { down: boolean; x: number }): string => {
	const [from, to] = down ? [idY + 50, uuidY - 34] : [uuidY - 34, idY + 50];
	const head = down ? to - 7 : to + 7;
	return `<path d="M${x} ${from} V${to}" stroke="${theme.accent}" stroke-width="1.5"/><path d="M${x - 5} ${head} L${x} ${to} L${x + 5} ${head}" fill="none" stroke="${theme.accent}" stroke-width="1.5"/>`;
};

const pulse = ({
	down,
	from,
	x,
}: {
	down: boolean;
	from: number;
	x: number;
}): string => {
	const [y1, y2] = down ? [idY + 50, uuidY - 34] : [uuidY - 34, idY + 50];
	const start = from / period;
	const end = (from + 0.6) / period;
	return `<circle class="moving" r="5" fill="${theme.accent}"><animateMotion dur="${period}s" repeatCount="indefinite" path="M${x} ${y1} V${y2}" keyPoints="0;0;1;1" keyTimes="0;${start.toFixed(3)};${end.toFixed(3)};1" calcMode="linear"/><animate attributeName="opacity" dur="${period}s" repeatCount="indefinite" values="0;0;1;1;0;0" keyTimes="0;${(start - 0.01).toFixed(3)};${start.toFixed(3)};${end.toFixed(3)};${(end + 0.02).toFixed(3)};1"/></circle>`;
};

export default svgDocument({
	body: [
		svgGrid({ height, theme, width }),
		svgText({
			className: "display",
			fontSize: 15,
			text: 'idCreate("foo")',
			weight: 700,
			x: 30,
			y: 40,
		}),
		svgTypedText({
			fontSize: size,
			id: "id-typed",
			period,
			prompt: "foo_",
			text: idSuffix,
			typedFrom: 0.3,
			typedUntil: 1.9,
			x: left,
			y: idY,
		}),
		'<g class="idmarks">',
		bracket({ from: left, to: left + 3 * char, y: idY + 12 }),
		svgText({
			className: "mono dim",
			fontSize: 11,
			text: "prefix",
			x: left,
			y: idY + 34,
		}),
		bracket({ from: left + 4 * char, to: left + 30 * char, y: idY + 12 }),
		svgText({
			className: "mono dim",
			fontSize: 11,
			text: "the UUID in 26 characters of base32",
			x: left + 4 * char,
			y: idY + 34,
		}),
		"</g>",
		svgText({
			className: "mono",
			fontSize: 13,
			text: 'Id<"foo">',
			x: 640,
			y: idY - 6,
		}),
		svgText({
			className: "mono dim",
			fontSize: 11,
			text: "in code: a bar id never passes",
			x: 640,
			y: idY + 12,
		}),
		arrow({ down: true, x: 200 }),
		svgText({
			className: "mono accent",
			fontSize: 12,
			text: "idToUuid(id)",
			x: 212,
			y: 170,
		}),
		arrow({ down: false, x: 470 }),
		svgText({
			className: "mono accent",
			fontSize: 12,
			text: 'idFromUuid("foo", uuid)',
			x: 482,
			y: 170,
		}),
		pulse({ down: true, from: 2.1, x: 200 }),
		svgTypedText({
			fontSize: size,
			id: "uuid-typed",
			period,
			text: uuid,
			typedFrom: 2.8,
			typedUntil: 4.8,
			x: left,
			y: uuidY,
		}),
		pulse({ down: false, from: 5.4, x: 470 }),
		'<g class="uuidmarks">',
		bracket({ from: left, to: left + 13 * char, y: uuidY + 12 }),
		svgText({
			className: "mono dim",
			fontSize: 11,
			text: "48 bits of time: ids sort by when they were made",
			x: left,
			y: uuidY + 34,
		}),
		"</g>",
		svgText({
			className: "mono",
			fontSize: 13,
			text: "uuid",
			x: 640,
			y: uuidY - 6,
		}),
		svgText({
			className: "mono dim",
			fontSize: 11,
			text: "in Postgres: 16 bytes, UUIDv7",
			x: 640,
			y: uuidY + 12,
		}),
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "A bad prefix, id or UUID throws a TypeError.",
			x: 30,
			y: height - 18,
		}),
	].join("\n"),
	height,
	motionCss: [
		{ name: "idmarks", shown: 1.9 },
		{ name: "uuidmarks", shown: 4.8 },
	]
		.map(
			({ name, shown }) =>
				`@keyframes ${name}{0%,${keyframePercent(shown, period)},97%,100%{opacity:0}${keyframePercent(shown + 0.4, period)},92%{opacity:1}}.${name}{animation:${name} ${period}s linear infinite}`,
		)
		.join("\n"),
	theme,
	title:
		"A prefixed id types itself, idToUuid turns it into the UUIDv7 a Postgres uuid column stores, and idFromUuid turns it back",
	width,
});
