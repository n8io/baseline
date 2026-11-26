// What baseline main holds against the release a new Project gets.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// The monorepo this script runs from, whose .changeset/ and apps/app version say what main holds.
export const monorepo = resolve(import.meta.dirname, "..");

// Says when a new Project will not get what baseline main holds: changesets merged since the
// newest release, or a checkout whose Template version is not that release.
export const releaseWarning = ({
	changesets,
	checkoutRelease,
	release,
}: {
	changesets: number;
	checkoutRelease: string;
	release: string;
}): string | null => {
	if (checkoutRelease !== release) {
		return `This baseline checkout is app@${checkoutRelease} and the newest release is app@${release}; this Project gets app@${release}.`;
	}
	if (changesets === 0) return null;
	return `main holds ${changesets} unreleased changeset${changesets === 1 ? "" : "s"}; this Project gets app@${release}.`;
};

export const releaseWarningRead = (release: string): string | null =>
	releaseWarning({
		changesets: readdirSync(join(monorepo, ".changeset")).filter(
			(file) => file.endsWith(".md") && file !== "README.md",
		).length,
		checkoutRelease: (
			JSON.parse(
				readFileSync(join(monorepo, "apps/app/package.json"), "utf8"),
			) as { version: string }
		).version,
		release,
	});
