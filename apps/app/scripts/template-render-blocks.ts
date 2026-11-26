// Foo blocks: the whole statement a foo line belongs to.
import {
	fileIsCode,
	lineIsFoo,
	type Mode,
	modesRead,
} from "./template-render-scan.ts";

// Per line: bracket change, lowest point, and whether its line break sits inside a string.
const lineDepths = (
	text: string,
	modes: Mode[],
): { delta: number; low: number; open: boolean }[] => {
	const result: { delta: number; low: number; open: boolean }[] = [];
	let delta = 0;
	let low = 0;
	for (let i = 0; i <= text.length; i++) {
		const c = text[i];
		if (c === undefined || c === "\n") {
			result.push({ delta, low, open: modes[i] === "string" });
			delta = 0;
			low = 0;
			continue;
		}
		if (modes[i] !== "code") continue;
		if (c === "(" || c === "[" || c === "{") delta++;
		if (c === ")" || c === "]" || c === "}") {
			delta--;
			low = Math.min(low, delta);
		}
	}
	return result;
};

// Line ranges [start, end] (inclusive) holding foo, or the lines `lineIs` picks. In code files a
// range grows to the whole bracket-balanced statement; in .env files it takes the item's `# @`
// decorator lines.
export const fooBlocksFind = (text: string, path: string): [number, number][] =>
	linesBlocksFind({ lineIs: lineIsFoo, path, text });

export const linesBlocksFind = ({
	lineIs,
	path,
	text,
}: {
	lineIs: (line: string) => boolean;
	path: string;
	text: string;
}): [number, number][] => {
	const lines = text.split("\n");
	const blocks: [number, number][] = [];
	const code = fileIsCode(path);
	const depths = code ? lineDepths(text, modesRead(text, path)) : [];
	const balance = (start: number, end: number) => {
		let depth = 0;
		let low = 0;
		for (let k = start; k <= end; k++) {
			const line = depths[k] ?? { delta: 0, low: 0, open: false };
			low = Math.min(low, depth + line.low);
			depth += line.delta;
		}
		return { depth, low };
	};
	for (let i = 0; i < lines.length; i++) {
		if (!lineIs(lines[i] ?? "")) continue;
		let start = i;
		let end = i;
		if (code) {
			for (;;) {
				if (start < 0 || end >= lines.length) {
					throw new Error(
						`${path}:${i + 1}: cannot find the statement around this foo line`,
					);
				}
				const { depth, low } = balance(start, end);
				const before = start - 1;
				if (
					low < 0 ||
					depths[before]?.open === true ||
					// A type argument list spread over lines (`Parameters<` … `>[0][],`) counts too.
					/(=|<)\s*$/.test(lines[before] ?? "")
				) {
					start--;
				} else if (
					depth > 0 ||
					depths[end]?.open === true ||
					/(=|<)\s*$/.test(lines[end] ?? "") ||
					/^\s*>/.test(lines[end + 1] ?? "")
				) {
					end++;
				} else if (
					/[([{]\s*$/.test(lines[before] ?? "") &&
					lineIs(lines[end + 1] ?? "")
				) {
					// The next argument names foo too: it may be all the bracket holds, and then
					// the statement around it goes (app.route("/live/foo", fooLive...(...))).
					end++;
				} else if (
					/[([{]\s*$/.test(lines[before] ?? "") &&
					/^\s*[)\]}]/.test(lines[end + 1] ?? "")
				) {
					// The block is all a bracket holds: the statement around it goes too.
					start--;
					end++;
				} else break;
			}
		} else if (/(^|\/)\.env\./.test(path)) {
			while (/^# @/.test(lines[start - 1] ?? "")) start--;
		}
		blocks.push([start, end]);
		i = Math.max(i, end);
	}
	// A later line's statement can reach back over earlier blocks: join overlapping and adjacent ones.
	const joined: [number, number][] = [];
	for (const [start, end] of blocks.sort((a, b) => a[0] - b[0])) {
		const last = joined.at(-1);
		if (last !== undefined && start <= last[1] + 1) {
			last[1] = Math.max(last[1], end);
		} else {
			joined.push([start, end]);
		}
	}
	return joined;
};

export const linesRemove = (
	text: string,
	blocks: [number, number][],
): string => {
	const lines = text.split("\n");
	const drop = new Set<number>();
	for (const [start, end] of blocks) {
		for (let k = start; k <= end; k++) drop.add(k);
	}
	return lines.filter((_, k) => !drop.has(k)).join("\n");
};
