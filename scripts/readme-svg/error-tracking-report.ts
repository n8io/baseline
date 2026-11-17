// The error-tracking README's diagram (the logger README shows it too): one logger.error call with
// an error whose message holds input text. The log line and the Error report both carry its class
// name, code, constraint, frames and trace id; the message reaches neither.
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
const height = 440;
const period = 9;
const callX = 40;
const callY = 92;
const cardX = 470;
const cardWidth = 370;
const logY = 92;
const reportY = 250;

const logLines = [
	'"level":50,"msg":"DatabaseError"',
	'"err":{"type":"DatabaseError","code":"23505",',
	'"constraint":"foo_email_key","stack":"at …"}',
	'"trace_id":"4bf92f35…"',
];
const reportLines = [
	"DatabaseError   error.code 23505",
	"error.constraint foo_email_key",
	"frames  at fooCreate (…), at …",
	"trace_id 4bf92f35…  → links to its trace",
];

// Each card's lines appear one by one after the dot reaches it: the log line first, then, once
// the listener hands the error on, the report.
const lineFade = ({
	at,
	count,
	name,
}: {
	at: number;
	count: number;
	name: string;
}) =>
	Array.from({ length: count }, (_, index) => {
		const start = at + index * 0.35;
		return `@keyframes ${name}${index}{0%,${keyframePercent(start, period)}{opacity:0}${keyframePercent(start + 0.3, period)},${keyframePercent(8.4, period)}{opacity:1}${keyframePercent(8.8, period)},100%{opacity:0}}.${name}${index}{animation:${name}${index} ${period}s linear infinite}`;
	}).join("\n");

const strike = `@keyframes strike{0%,${keyframePercent(0.9, period)}{transform:scaleX(0)}${keyframePercent(1.5, period)},${keyframePercent(8.4, period)}{transform:scaleX(1)}${keyframePercent(8.8, period)},100%{transform:scaleX(0)}}.strike{transform-box:fill-box;transform-origin:left;animation:strike ${period}s linear infinite}`;

const card = ({
	label,
	lines,
	name,
	top,
}: {
	label: string;
	lines: string[];
	name: string;
	top: number;
}) =>
	[
		`<rect x="${cardX}" y="${top}" width="${cardWidth}" height="${lines.length * 20 + 34}" rx="${theme.radius}" fill="${theme.panel}" stroke="${theme.line}" stroke-width="1.5"/>`,
		svgText({
			className: "mono accent",
			fontSize: 11,
			text: label,
			x: cardX + 14,
			y: top + 20,
		}),
		...lines.map((line, index) =>
			svgText({
				className: `mono ${name}${index}`,
				fontSize: 11.5,
				text: line,
				x: cardX + 14,
				y: top + 42 + index * 20,
			}),
		),
	].join("");

// The log line goes straight right; the report goes down through the listener first.
const toLog = `M${callX + 360} ${logY + 48} H${cardX}`;
const toReport = `M${callX + 180} ${callY + 96} V${reportY + 49} H${cardX}`;

export default svgDocument({
	body: [
		svgGrid({ height, theme, width }),
		svgText({
			className: "display",
			fontSize: 15,
			text: "One error logged, one Error report, no message",
			weight: 700,
			x: 40,
			y: 44,
		}),
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "The error's message holds input text. Neither output carries it.",
			x: 40,
			y: 68,
		}),
		`<rect x="${callX}" y="${callY}" width="360" height="96" rx="${theme.radius}" fill="${theme.panel}" stroke="${theme.accent}" stroke-width="1.5"/>`,
		svgText({
			className: "mono",
			fontSize: 12,
			text: "logger.error({ err })",
			x: callX + 14,
			y: callY + 26,
		}),
		svgText({
			className: "mono dim",
			fontSize: 11,
			text: "err: DatabaseError, code 23505",
			x: callX + 14,
			y: callY + 50,
		}),
		svgText({
			className: "mono fail",
			fontSize: 11,
			text: 'message: "failed for ana@example.com"',
			x: callX + 14,
			y: callY + 74,
		}),
		`<rect class="strike" x="${callX + 14}" y="${callY + 69}" width="262" height="1.5" fill="${theme.fail}"/>`,
		`<path d="${toLog}" fill="none" stroke="${theme.line}" stroke-width="1.5" stroke-dasharray="4 5"/>`,
		`<path d="${toReport}" fill="none" stroke="${theme.line}" stroke-width="1.5" stroke-dasharray="4 5"/>`,
		svgBox({
			fontSize: 12,
			height: 32,
			label: "loggerErrorListen",
			theme,
			width: 190,
			x: callX + 85,
			y: reportY + 33,
		}),
		card({
			label: "stdout · OTLP log",
			lines: logLines,
			name: "logLine",
			top: logY,
		}),
		card({
			label: "Error report",
			lines: reportLines,
			name: "reportLine",
			top: reportY,
		}),
		`<circle class="moving" r="6" fill="${theme.accent}"><animateMotion dur="${period}s" repeatCount="indefinite" path="${toLog}" keyPoints="0;0;1;1" keyTimes="0;0.17;0.3;1" calcMode="linear"/></circle>`,
		`<circle class="moving" r="6" fill="${theme.accent}"><animateMotion dur="${period}s" repeatCount="indefinite" path="${toReport}" keyPoints="0;0;1;1" keyTimes="0;0.33;0.5;1" calcMode="linear"/></circle>`,
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "report() returns at once and never throws. A slow or failing error tracker never slows a request.",
			x: 40,
			y: height - 40,
		}),
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "Credentials in log fields are [Redacted]; an error leaves only as its class, code, constraint and frames.",
			x: 40,
			y: height - 20,
		}),
	].join("\n"),
	height,
	motionCss: `${strike}\n${lineFade({ at: 2.8, count: logLines.length, name: "logLine" })}\n${lineFade({ at: 4.6, count: reportLines.length, name: "reportLine" })}`,
	theme,
	title:
		"One logger.error call with a DatabaseError whose message holds an email address: the log line and the Error report both carry its class, code, constraint, frames and trace id, and the message is struck out of both",
	width,
});
