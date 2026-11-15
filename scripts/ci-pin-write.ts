// Points the Template's calls into baseline's reusable workflows (`<workflow>.yml@v<major>`)
// at the Template's own major. `pnpm run version` runs it after `changeset version`, so a
// Template major and its `v<major>` pin always ship together. test/ci-pin.test.ts checks it.
// Only the Template's own workflow is listed: the release job pushes the Version packages
// commit with the release App's token, which has no Workflows permission, so it may not
// change a file under the repo's .github/workflows/.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const ciPinFiles = ["apps/app/.github/workflows/ci.yml"];

const pinPattern =
	/(n8io\/baseline\/\.github\/workflows\/[\w.-]+\.yml)@v(\d+)/g;

export const ciPinsRead = (text: string): number[] =>
	[...text.matchAll(pinPattern)].map((match) => Number(match[2]));

export const ciPinRewrite = (text: string, major: number): string =>
	text.replaceAll(pinPattern, `$1@v${major}`);

export const templateMajorRead = (root: string): number => {
	const { version } = JSON.parse(
		readFileSync(join(root, "apps/app/package.json"), "utf8"),
	) as { version: string };
	return Number(version.split(".")[0]);
};

export const ciPinWrite = (root: string): void => {
	const major = templateMajorRead(root);
	for (const file of ciPinFiles) {
		const path = join(root, file);
		const text = readFileSync(path, "utf8");
		if (ciPinsRead(text).length === 0) {
			throw new Error(`${file} has no baseline workflow pin to move`);
		}
		writeFileSync(path, ciPinRewrite(text, major));
	}
};

if (import.meta.main) {
	ciPinWrite(resolve(import.meta.dirname, ".."));
}
