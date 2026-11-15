import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const release = readFileSync(
	join(root, ".github/workflows/release.yml"),
	"utf8",
);

// A GITHUB_TOKEN push starts no pull_request run, so the main ruleset would see no
// required checks on the Version packages PR. The release App's token starts one.
describe("release.yml", () => {
	it("opens the Version packages PR with the release App's token", () => {
		expect(release).toMatch(
			/- id: app-token\n {8}uses: actions\/create-github-app-token@[0-9a-f]{40} # v\S+\n/,
		);
		expect(release).toContain(`client-id: \${{ vars.RELEASE_APP_CLIENT_ID }}`);
		expect(release).toContain(
			`private-key: \${{ secrets.RELEASE_APP_PRIVATE_KEY }}`,
		);
		expect(release).toMatch(
			/uses: changesets\/action@[0-9a-f]{40} # v\S+\n {8}with:\n(?: {10}.*\n)*? {10}github-token: \$\{\{ steps\.app-token\.outputs\.token \}\}\n/,
		);
	});

	it("scopes the token to this repository and the App's two permissions", () => {
		const step = release.match(/- id: app-token\n(?: {8}.*\n)*/)?.[0] ?? "";
		expect(step).not.toMatch(/\b(owner|repositories):/);
		expect(step.match(/permission-[a-z-]+: \w+/g)).toEqual([
			"permission-contents: write",
			"permission-pull-requests: write",
		]);
	});

	it("hands changesets/action the token only through its input", () => {
		const step = release.match(/- id: changesets\n(?: {8}.*\n)*/)?.[0] ?? "";
		expect(step).toContain("github-token:");
		expect(step).not.toContain("GITHUB_TOKEN:");
	});

	it("starts no CI run by dispatch and keeps GITHUB_TOKEN to the tag push and OIDC", () => {
		expect(release).not.toContain("gh workflow run");
		expect(release).toMatch(
			/\npermissions:\n {2}contents: write\n {2}id-token: write\n\njobs:/,
		);
		// ci.yml's one dispatch is main-run's, after a Dependabot merge.
		const ci = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
		expect(ci.match(/gh workflow run/g)).toHaveLength(1);
	});
});
