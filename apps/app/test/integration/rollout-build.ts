import {
	cpSync,
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const filesList = (directory: string): string[] =>
	readdirSync(directory, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => join(entry.parentPath, entry.name));

/**
 * A copy of `build/` as the next release would be: every hashed file under `build/client/assets`
 * has another name and the route manifest another version, as after a rebuild of changed pages.
 * Start it with `productionServerStart({ directory })`. `using` deletes the copy.
 */
export const rolloutBuildCreate = (): Disposable & { directory: string } => {
	if (!existsSync("build/client/assets")) {
		throw new Error("build/client/assets is missing: run pnpm build first");
	}
	const directory = mkdtempSync(join(tmpdir(), "rollout-build-"));
	cpSync("build", join(directory, "build"), { recursive: true });
	// What the server reads from its working directory: its libraries and the env files.
	const linked = readdirSync(".").filter((name) => name.startsWith(".env"));
	for (const name of ["node_modules", ...linked]) {
		symlinkSync(resolve(name), join(directory, name));
	}
	// name-<8 character hash>.ext: the copy reverses each hash.
	const renames = new Map<string, string>();
	for (const name of readdirSync(join(directory, "build/client/assets"))) {
		const hash = /-([\w-]{8})\.[\w.]+$/.exec(name)?.[1];
		const reversed = [...(hash ?? "")].reverse().join("");
		if (hash !== undefined && reversed !== hash) renames.set(hash, reversed);
	}
	if (renames.size === 0)
		throw new Error("build/client/assets has no hashed file");
	for (const file of filesList(join(directory, "build"))) {
		// latin1 keeps every byte of an image or font as it is.
		let text = readFileSync(file, "latin1");
		let name = file.slice(dirname(file).length + 1);
		for (const [hash, reversed] of renames) {
			text = text.replaceAll(hash, reversed);
			name = name.replace(hash, reversed);
		}
		writeFileSync(file, text, "latin1");
		renameSync(file, join(dirname(file), name));
	}
	return {
		directory,
		[Symbol.dispose]: () => rmSync(directory, { force: true, recursive: true }),
	};
};
