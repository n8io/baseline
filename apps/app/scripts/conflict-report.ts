// What a conflicted file's Project side had that the Template's side lacks. Resolving a conflict by
// taking the Template's side loses exactly these lines, and the diff of the result does not say so.

// The lines of the Project's side (between `<<<<<<<` and `=======`) that the Template's side
// (between `=======` and `>>>>>>>`) does not have, in order; a diff3 base section is ignored.
export const conflictOwnLines = (text: string): string[] => {
	const own: string[] = [];
	let theirs: string[] = [];
	let side: "none" | "own" | "base" | "theirs" = "none";
	let block: string[] = [];
	for (const line of text.split("\n")) {
		if (line.startsWith("<<<<<<<")) {
			side = "own";
			block = [];
			theirs = [];
		} else if (line.startsWith("|||||||") && side === "own") side = "base";
		else if (line.startsWith("=======") && side !== "none") side = "theirs";
		else if (line.startsWith(">>>>>>>") && side === "theirs") {
			own.push(
				...block.filter(
					(l) => l.trim() !== "" && !theirs.some((t) => t.trim() === l.trim()),
				),
			);
			side = "none";
		} else if (side === "own") block.push(line);
		else if (side === "theirs") theirs.push(line);
	}
	return own;
};
