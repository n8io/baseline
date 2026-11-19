// The queue README's outbox diagram: a publish writes the Event in the caller's transaction. On
// COMMIT it reaches the queue and the Event handler; on ROLLBACK neither the row nor the Event exists.
// The resting frame is the committed state.
import {
	readmeSvgThemes,
	svgBox,
	svgDocument,
	svgGrid,
	svgText,
} from "./kit.ts";

const theme = readmeSvgThemes.blueprint;
const width = 880;
const height = 300;
const period = 10;
const chipTop = 146;
const chipLeft = 46;
const chipWidth = 300;
// How far the Event travels from the transaction into the queue's slot.
const queueLeft = 476;
const travel = queueLeft - chipLeft;

const chip = ({
	className,
	left,
	text,
}: {
	className: string;
	left?: number | null;
	text: string;
}): string => {
	const x = left ?? chipLeft;
	return `<g class="${className}"><rect x="${x}" y="${chipTop}" width="${chipWidth}" height="30" rx="${theme.radius}" fill="${theme.accent}"/>${svgText({ className: "mono chip", fontSize: 12, text, weight: 700, x: x + 14, y: chipTop + 20 })}</g>`;
};

const css = [
	`.chip{fill:${theme.background}}`,
	`.travel{opacity:0}`,
	`.rolledback{opacity:0}`,
	`.consumer rect{stroke:${theme.ok}}`,
].join("\n");

// 0–50%: the transaction commits and the Event travels to the Event handler. 50–100%: it rolls back.
const motion = [
	`@keyframes travel{0%,12%{transform:translateX(0);opacity:0}14%{transform:translateX(0);opacity:1}26%,44%{transform:translateX(${travel}px);opacity:1}48%,100%{transform:translateX(${travel}px);opacity:0}}.travel{animation:travel ${period}s ease-in-out infinite}`,
	`@keyframes queued{0%,25%{opacity:0}26%,46%{opacity:1}48%,100%{opacity:0}}.queued{animation:queued ${period}s linear infinite}`,
	`@keyframes rows{0%,52%{opacity:1}60%,96%{opacity:.2}100%{opacity:1}}.rows{animation:rows ${period}s linear infinite}`,
	`@keyframes committed{0%,10%{opacity:0}14%,46%{opacity:1}50%,100%{opacity:0}}.committed{animation:committed ${period}s linear infinite}`,
	`@keyframes rolledback{0%,56%{opacity:0}60%,96%{opacity:1}100%{opacity:0}}.rolledback{animation:rolledback ${period}s linear infinite}`,
	`@keyframes consumer{0%,26%{stroke:${theme.line}}30%,46%{stroke:${theme.ok}}50%,100%{stroke:${theme.line}}}.consumer rect{animation:consumer ${period}s linear infinite}`,
].join("\n");

export default svgDocument({
	body: [
		svgGrid({ height, theme, width }),
		svgText({
			className: "display",
			fontSize: 15,
			text: "The Event is written in the same transaction",
			weight: 700,
			x: 30,
			y: 44,
		}),
		`<rect x="30" y="66" width="380" height="164" rx="${theme.radius}" fill="${theme.panel}" stroke="${theme.line}" stroke-width="1.5"/>`,
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "BEGIN",
			x: 46,
			y: 92,
		}),
		`<g class="rows">${svgText({ text: "INSERT INTO orders …", x: 46, y: 126 })}${chip({ className: "", text: "publish order.placed, key order_123" })}</g>`,
		`<g class="committed">${svgText({ className: "mono ok", text: "COMMIT", weight: 700, x: 46, y: 210 })}</g>`,
		`<g class="rolledback">${svgText({ className: "mono fail", text: "ROLLBACK: neither the row nor the Event exists", weight: 700, x: 46, y: 210 })}</g>`,
		`<line x1="410" y1="161" x2="${queueLeft - 6}" y2="161" stroke="${theme.line}" stroke-dasharray="3 4"/>`,
		`<rect x="${queueLeft - 16}" y="${chipTop - 30}" width="${chipWidth + 32}" height="90" rx="${theme.radius}" fill="none" stroke="${theme.line}" stroke-width="1.5" stroke-dasharray="6 4"/>`,
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "the queue, in the same Postgres",
			x: queueLeft,
			y: chipTop - 10,
		}),
		chip({
			className: "queued",
			left: queueLeft,
			text: "order.placed · order_123",
		}),
		chip({ className: "travel", text: "order.placed · order_123" }),
		`<line x1="${queueLeft + chipWidth - 60}" y1="${chipTop + 60}" x2="${queueLeft + chipWidth - 60}" y2="${chipTop + 76}" stroke="${theme.line}"/>`,
		svgBox({
			className: "consumer",
			fontSize: 13,
			height: 40,
			label: "Event handler",
			theme,
			width: 120,
			x: queueLeft + chipWidth - 120,
			y: chipTop + 76,
		}),
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "No second write to lose: an Event exists only if the write it is about committed.",
			x: 30,
			y: height - 18,
		}),
	].join("\n"),
	css,
	height,
	motionCss: motion,
	theme,
	title:
		"A publish writes the Event in the caller's transaction: on commit it reaches the queue and its Event handler; on rollback neither the row nor the Event exists",
	width,
});
