// The authn README's diagram: a page signs in through the OIDC code flow and a machine client
// sends a bearer token; both end at the middleware, which hands the request one Actor.
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
const height = 340;
const period = 9;
const boxWidth = 136;
const boxHeight = 56;
const actor = { height: 96, width: 150, x: 690, y: 142 };
const actorMiddle = { x: actor.x, y: actor.y + actor.height / 2 };

type Lane = {
	boxes: { label: string; sublabel: string; x: number }[];
	from: number;
	name: string;
	note: string;
	top: number;
	until: number;
};

const lanes: Lane[] = [
	{
		boxes: [
			{ label: "Browser", sublabel: "GET /auth/sign-in", x: 40 },
			{ label: "Provider", sublabel: "sign-in + PKCE", x: 196 },
			{ label: "/auth/callback", sublabel: "sealed cookies", x: 352 },
			{ label: "Middleware", sublabel: 'source: "cookie"', x: 508 },
		],
		from: 0.4,
		name: "Pages",
		note: "/auth/refresh renews the token before it lapses",
		top: 92,
		until: 4.4,
	},
	{
		boxes: [
			{ label: "Machine client", sublabel: "client credentials", x: 40 },
			{ label: "Bearer token", sublabel: "Authorization", x: 274 },
			{ label: "Middleware", sublabel: 'source: "bearer"', x: 508 },
		],
		from: 4.6,
		name: "API",
		note: "",
		top: 222,
		until: 7.8,
	},
];

const centre = (lane: Lane) => lane.top + boxHeight / 2;
const firstX = (lane: Lane) => (lane.boxes[0]?.x ?? 0) + boxWidth / 2;
const lastX = (lane: Lane) => (lane.boxes.at(-1)?.x ?? 0) + boxWidth;

// Along the lane, then a straight run into the Actor box.
const lanePath = (lane: Lane) =>
	`M${firstX(lane)} ${centre(lane)} H${lastX(lane)} L${actorMiddle.x} ${actorMiddle.y}`;

const laneLength = (lane: Lane) =>
	lastX(lane) -
	firstX(lane) +
	Math.hypot(actorMiddle.x - lastX(lane), actorMiddle.y - centre(lane));

// The moment the lane's dot reaches the point `distance` along its path.
const reachedAt = (lane: Lane, distance: number) =>
	lane.from + (distance / laneLength(lane)) * (lane.until - lane.from);

const glow = (name: string, moment: number) =>
	`@keyframes ${name}{0%,${keyframePercent(moment - 0.3, period)},${keyframePercent(moment + 0.7, period)},100%{stroke:${theme.line}}${keyframePercent(moment, period)}{stroke:${theme.accent}}}.${name} rect{animation:${name} ${period}s linear infinite}`;

const boxGlows = lanes.flatMap((lane, laneIndex) =>
	lane.boxes.map((box, boxIndex) =>
		glow(
			`lane${laneIndex}box${boxIndex}`,
			reachedAt(lane, box.x + boxWidth / 2 - firstX(lane)),
		),
	),
);

// The Actor box lights up as each dot arrives.
const actorGlow = `@keyframes actorGlow{0%,${lanes
	.map(
		(lane) =>
			`${keyframePercent(lane.until - 0.3, period)},${keyframePercent(lane.until + 0.8, period)}`,
	)
	.join(
		",",
	)},100%{stroke:${theme.line}}${lanes.map((lane) => keyframePercent(lane.until, period)).join(",")}{stroke:${theme.accent}}}.actor rect{animation:actorGlow ${period}s linear infinite}`;

const laneDrawing = (lane: Lane, laneIndex: number) => {
	const path = lanePath(lane);
	const start = lane.from / period;
	const end = lane.until / period;
	return [
		svgText({
			className: "mono accent",
			fontSize: 12,
			text: lane.name,
			x: 40,
			y: lane.top - 12,
		}),
		`<path d="${path}" fill="none" stroke="${theme.line}" stroke-width="1.5" stroke-dasharray="4 5"/>`,
		...lane.boxes.map((box, boxIndex) =>
			svgBox({
				className: `lane${laneIndex}box${boxIndex}`,
				fontSize: 13,
				height: boxHeight,
				label: box.label,
				sublabel: box.sublabel,
				theme,
				width: boxWidth,
				x: box.x,
				y: lane.top,
			}),
		),
		lane.note
			? svgText({
					className: "mono dim",
					fontSize: 11,
					text: lane.note,
					x: 196,
					y: lane.top + boxHeight + 20,
				})
			: "",
		`<circle class="moving" r="7" fill="${theme.accent}"><animateMotion dur="${period}s" repeatCount="indefinite" path="${path}" keyPoints="0;0;1;1" keyTimes="0;${start.toFixed(3)};${end.toFixed(3)};1" calcMode="linear"/></circle>`,
	].join("\n");
};

export default svgDocument({
	body: [
		svgGrid({ height, theme, width }),
		svgText({
			className: "display",
			fontSize: 15,
			text: "Two ways in, one Actor out",
			weight: 700,
			x: 40,
			y: 44,
		}),
		...lanes.map(laneDrawing),
		svgBox({
			className: "actor",
			fontSize: 16,
			height: actor.height,
			label: "Actor",
			stroke: theme.accent,
			sublabel: "id · kind · scopes",
			theme,
			width: actor.width,
			x: actor.x,
			y: actor.y,
		}),
		svgText({
			anchor: "middle",
			className: "mono dim",
			fontSize: 11,
			text: "c.var.actor",
			x: actor.x + actor.width / 2,
			y: actor.y + actor.height + 20,
		}),
		svgText({
			className: "mono dim",
			fontSize: 12,
			text: "No token: anonymous. A bad token: 401 on the API, sign-in again on a page.",
			x: 40,
			y: height - 18,
		}),
	].join("\n"),
	height,
	motionCss: [...boxGlows, actorGlow].join("\n"),
	theme,
	title:
		"Authn: a page signs in through the provider and gets sealed cookies, a machine client sends a bearer token, and the middleware turns either into one Actor",
	width,
});
