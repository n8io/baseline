// The queue README's dead-letter diagram, for the blocked-key runbook. order_2's #2 fails all five
// attempts: a copy goes to <queueName>.dead and its key is held, so #3 waits while order_1 carries
// on. Someone gives the Event up (or 7 days pass), the key moves on and #3 is handled. The resting
// frame is that end: #2's copy in .dead, every other Event handled.
import {
	keyframePercent,
	readmeSvgThemes,
	svgDocument,
	svgGrid,
	svgText,
} from "./kit.ts";

const theme = readmeSvgThemes.blueprint;
const width = 880;
const height = 340;
const period = 16;
const laneTops = [84, 146] as const;
// Event #1 waits nearest the Event handler.
const slotX = [300, 240, 180] as const;
const consumerX = 470;
const handledX = [820, 765, 710] as const;
const deadX = consumerX;
const deadTop = 232;
const moveSeconds = 0.5;
const runSeconds = 0.8;
const attempts = 5;
const attemptSeconds = 0.9;

const at = (seconds: number): string => keyframePercent(seconds, period);

// order_2: #1 is handled, #2 fails five times and goes to .dead, #3 waits until the key is released.
const failArrived = 0.3 + moveSeconds + runSeconds + moveSeconds + moveSeconds;
const failedForGood = failArrived + attempts * attemptSeconds;
const deadAt = failedForGood + 0.6;
const releasedAt = deadAt + 2.4;
const lastStart = releasedAt + 0.4;
// order_1 carries on while order_2 is held: one Event every 2.5 s from 3 s.
const otherStarts = [3, 5.5, 8];

type Plan = { arrived: number; left: number; start: number };

const css: string[] = [`.chip{fill:${theme.background}}`, ".label{opacity:0}"];
const motion: string[] = [];
const body: string[] = [];

type ChipOptions = { index: number; name: string; top: number; x: number };

const chip = ({ index, name, top, x }: ChipOptions) =>
	`<g class="${name}"><rect x="${x - 22}" y="${top + 2}" width="44" height="26" rx="${theme.radius}" fill="${theme.accent}"/>${svgText({ anchor: "middle", className: "mono chip", fontSize: 12, text: `#${index + 1}`, weight: 700, x, y: top + 20 })}</g>`;

// An Event that is handled: it moves to the Event handler, runs, then joins the handled line.
type HandledOptions = { index: number; name: string; plan: Plan; x: number };

const handled = ({ index, name, plan, x }: HandledOptions) => {
	const toConsumer = consumerX - x;
	const toHandled = (handledX[index] ?? 0) - x;
	css.push(
		`.${name}{transform:translateX(${toHandled}px)}.${name} rect{fill:${theme.ok}}`,
	);
	motion.push(
		`@keyframes ${name}{0%{transform:translateX(0);opacity:0}2%{opacity:1}${at(plan.start)}{transform:translateX(0)}${at(plan.arrived)},${at(plan.left - moveSeconds)}{transform:translateX(${toConsumer}px);opacity:1}${at(plan.left)},92%{transform:translateX(${toHandled}px);opacity:1}100%{transform:translateX(${toHandled}px);opacity:0}}.${name}{animation:${name} ${period}s ease-in-out infinite}`,
		`@keyframes ${name}c{0%,${at(plan.left - moveSeconds)}{fill:${theme.accent}}${at(plan.left)},100%{fill:${theme.ok}}}.${name} rect{animation:${name}c ${period}s linear infinite}`,
	);
};

const plan = (start: number, run: number): Plan => ({
	arrived: start + moveSeconds,
	left: start + moveSeconds + run + moveSeconds,
	start,
});

["order_1", "order_2"].forEach((key, lane) => {
	const top = laneTops[lane] ?? 0;
	body.push(
		svgText({ text: key, x: 30, y: top + 20 }),
		`<line x1="120" y1="${top + 15}" x2="${consumerX - 50}" y2="${top + 15}" stroke="${theme.line}" stroke-dasharray="3 5"/>`,
	);
	slotX.forEach((x, index) => {
		const name = `d${lane}${index}`;
		if (lane === 0) {
			handled({
				index,
				name,
				plan: plan(otherStarts[index] ?? 0, runSeconds),
				x,
			});
		} else if (index === 0) {
			handled({ index, name, plan: plan(0.3, runSeconds), x });
		} else if (index === 2) {
			handled({ index, name, plan: plan(lastStart, runSeconds), x });
			motion.push(
				`@keyframes held{0%,${at(failArrived)}{opacity:1}${[0, 1, 2, 3, 4, 5, 6, 7].map((step) => `${at(failArrived + 0.5 + step * 0.9)}{opacity:.4}${at(failArrived + 0.95 + step * 0.9)}{opacity:1}`).join("")}${at(lastStart)},100%{opacity:1}}.${name} rect{animation-name:${name}c,held}`,
			);
		} else {
			// #2: reaches the Event handler and flashes red at each failed attempt. It stays there, failed,
			// holding its key until it is given up; a copy drops into .dead when it fails for good.
			const toConsumer = consumerX - x;
			const start = failArrived - moveSeconds;
			css.push(`.${name}{opacity:0}.${name} rect{fill:${theme.fail}}`);
			motion.push(
				`@keyframes ${name}{0%{transform:translateX(0);opacity:0}2%{opacity:1}${at(start)}{transform:translateX(0)}${at(failArrived)},${at(releasedAt - 0.3)}{transform:translateX(${toConsumer}px);opacity:1}${at(releasedAt)},100%{transform:translateX(${toConsumer}px);opacity:0}}.${name}{animation:${name} ${period}s ease-in-out infinite}`,
			);
			const flashes = Array.from({ length: attempts }, (_, attempt) => {
				const end = failArrived + (attempt + 1) * attemptSeconds;
				return `${at(end - 0.25)}{fill:${theme.accent}}${at(end - 0.1)},${at(end + (attempt === attempts - 1 ? 0 : 0.1))}{fill:${theme.fail}}`;
			}).join("");
			motion.push(
				`@keyframes ${name}c{0%{fill:${theme.accent}}${flashes}${at(failedForGood + 0.05)},100%{fill:${theme.fail}}}.${name} rect{animation:${name}c ${period}s linear infinite}`,
			);
			const copy = `${name}copy`;
			const drop = deadTop + 12 - top;
			css.push(
				`.${copy}{transform:translateY(${drop}px)}.${copy} rect{fill:${theme.fail}}`,
			);
			motion.push(
				`@keyframes ${copy}{0%,${at(failedForGood)}{transform:translateY(0);opacity:0}${at(failedForGood + 0.05)}{transform:translateY(0);opacity:1}${at(deadAt)},92%{transform:translateY(${drop}px);opacity:1}100%{transform:translateY(${drop}px);opacity:0}}.${copy}{animation:${copy} ${period}s ease-in-out infinite}`,
			);
			body.push(chip({ index, name: copy, top, x: consumerX }));
		}
		body.push(chip({ index, name, top, x }));
	});
});

// Labels under order_2, right of the Event handler: each attempt, the held key, then the release.
const labelTop = (laneTops[1] ?? 0) + 44;
const labels = [
	...Array.from({ length: attempts }, (_, attempt) => ({
		className: "fail",
		from: failArrived + (attempt + 1) * attemptSeconds - 0.1,
		text: `attempt ${attempt + 1} of ${attempts} failed`,
		until: failArrived + (attempt + 2) * attemptSeconds - 0.15,
	})),
	{
		className: "fail",
		from: failedForGood + attemptSeconds - 0.1,
		text: "failed for good: copy in .dead, key held",
		until: releasedAt,
	},
	{
		className: "ok",
		from: releasedAt,
		text: "given up: the key moves on",
		until: period * 0.92,
	},
];
labels.forEach((label, index) => {
	const resting = index === labels.length - 1 ? ' style="opacity:1"' : "";
	body.push(
		`<g class="label l${index}"${resting}>${svgText({ className: `mono ${label.className}`, fontSize: 12, text: label.text, x: consumerX + 52, y: labelTop + 16 })}</g>`,
	);
	motion.push(
		`@keyframes l${index}{0%,${at(label.from - 0.05)}{opacity:0}${at(label.from)},${at(label.until - 0.05)}{opacity:1}${at(label.until)},100%{opacity:0}}.l${index}{animation:l${index} ${period}s linear infinite}`,
	);
});

export default svgDocument({
	body: [
		svgGrid({ height, theme, width }),
		svgText({
			className: "display",
			fontSize: 15,
			text: "Five failures: a copy in .dead, and the key waits for you",
			weight: 700,
			x: 30,
			y: 44,
		}),
		`<rect x="${consumerX - 40}" y="${(laneTops[0] ?? 0) - 14}" width="80" height="${(laneTops[1] ?? 0) - (laneTops[0] ?? 0) + 58}" rx="${theme.radius}" fill="none" stroke="${theme.line}" stroke-width="1.5"/>`,
		svgText({
			anchor: "middle",
			className: "mono dim",
			fontSize: 12,
			text: "Event handler",
			x: consumerX,
			y: (laneTops[0] ?? 0) - 22,
		}),
		svgText({
			anchor: "middle",
			className: "mono dim",
			fontSize: 12,
			text: "handled",
			x: handledX[1],
			y: (laneTops[0] ?? 0) - 22,
		}),
		`<rect x="${deadX - 60}" y="${deadTop}" width="120" height="50" rx="${theme.radius}" fill="${theme.panel}" stroke="${theme.fail}" stroke-dasharray="4 3"/>`,
		svgText({
			anchor: "middle",
			className: "mono dim",
			fontSize: 11,
			text: "<queueName>.dead",
			x: deadX,
			y: deadTop + 66,
		}),
		...body,
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "Give it up or run it again to move the key on; after 7 days the queue deletes it.",
			x: 30,
			y: height - 14,
		}),
	].join("\n"),
	css: css.join("\n"),
	height,
	motionCss: motion.join("\n"),
	theme,
	title:
		"order_2's second Event fails all five attempts: a copy goes to <queueName>.dead and its key is held while order_1 carries on; once someone gives it up, the key moves on and #3 is handled",
	width,
});
