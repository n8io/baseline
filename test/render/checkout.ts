// What both render tests take from this checkout: its apps/app as a release would export it, and
// its packages/* in place of the published ones.
import {
	appendFileSync,
	existsSync,
	mkdtempDisposableSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	run,
	type TemplateFile,
	templateExport,
} from "../../apps/app/scripts/template-render.ts";

const monorepo = resolve(import.meta.dirname, "../..");

// This checkout's apps/app, exported from a throwaway clone of HEAD as a release would be.
export const checkoutExport = (): TemplateFile[] => {
	using work = mkdtempDisposableSync(join(tmpdir(), "render-and-test-"));
	const clone = join(work.path, "clone");
	run({
		command: "git",
		args: ["clone", "--quiet", "--shared", monorepo, clone],
	});
	return templateExport(clone, "HEAD");
};

// Packs this checkout's packages/* into the project and points every @n8io/baseline-* dependency
// at the tarballs with pnpm overrides, so HEAD tests the package code that releases with this
// template. The tarballs travel in app.tar for app-ci's frozen installs; git ignores them, and the
// project's checks never read .tgz files.
export const checkoutPackagesUse = (directory: string) => {
	const folder = ".baseline-packages";
	run({
		command: "pnpm",
		args: [
			"-r",
			"--filter",
			"./packages/*",
			"pack",
			"--pack-destination",
			join(directory, folder),
		],
		options: { cwd: monorepo },
	});
	const overrides = readdirSync(join(monorepo, "packages")).map((name) => {
		const { name: scoped, version } = JSON.parse(
			readFileSync(join(monorepo, "packages", name, "package.json"), "utf8"),
		) as { name: string; version: string };
		const tarball = `${folder}/${scoped.slice(1).replace("/", "-")}-${version}.tgz`;
		if (!existsSync(join(directory, tarball))) {
			throw new Error(`pnpm pack wrote no ${tarball}`);
		}
		return `  "${scoped}": file:./${tarball}\n`;
	});
	appendFileSync(
		join(directory, "pnpm-workspace.yaml"),
		`overrides:\n${overrides.join("")}`,
	);
	appendFileSync(join(directory, ".git/info/exclude"), `/${folder}/\n`);
	// The image installs from the manifests before it copies the project, and again in /prod.
	const dockerfile = join(directory, "Dockerfile");
	let text = readFileSync(dockerfile, "utf8");
	for (const [from, to] of [
		[
			"pnpm-workspace.yaml ./\n",
			`pnpm-workspace.yaml ./\nCOPY ${folder} ${folder}\n`,
		],
		["cp package.json", "cp -R package.json"],
		["pnpm-workspace.yaml /prod/", `pnpm-workspace.yaml ${folder} /prod/`],
	] as const) {
		if (!text.includes(from)) throw new Error(`Dockerfile has no "${from}"`);
		text = text.replace(from, to);
	}
	writeFileSync(dockerfile, text);
};

const importerVersions = (lockfile: string): Map<string, string> => {
	const last = lockfile.split(/^(?=---\n)/m).at(-1) ?? "";
	const importer = /^ {2}\.:\n((?: {4}.*\n)+)/m.exec(last)?.[1] ?? "";
	return new Map(
		[
			...importer.matchAll(
				/^ {6}(\S+):\n {8}specifier: .*\n {8}version: (.*)$/gm,
			),
		].map((m) => [m[1] ?? "", m[2] ?? ""] as const),
	);
};

// Fails when the project's first install resolved a dependency fresh instead of taking the
// template's locked version: a fresh resolution is what minimumReleaseAge can refuse on the day a
// dependency ships. Our own packages resolve from npm (or the overrides) and are skipped.
export const lockfileTemplateRequire = (
	directory: string,
	files: TemplateFile[],
): void => {
	const template = files.find((f) => f.path === "pnpm-lock.yaml")?.text;
	if (template === undefined) throw new Error("the template has no lockfile");
	const locked = importerVersions(template);
	const project = importerVersions(
		readFileSync(join(directory, "pnpm-lock.yaml"), "utf8"),
	);
	const fresh = [...project]
		.filter(([name]) => !name.includes("@n8io/baseline-"))
		.filter(([name, version]) => locked.get(name) !== version)
		.map(
			([name, version]) => `${name} ${version} (template: ${locked.get(name)})`,
		);
	if (project.size === 0 || fresh.length > 0) {
		throw new Error(
			`the first install resolved fresh instead of the template's lockfile:\n${fresh.join("\n")}`,
		);
	}
};
