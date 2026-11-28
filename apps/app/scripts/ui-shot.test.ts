import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	uiShotDirDefault,
	uiShotEntryFileNameCreate,
	uiShotFileNameCreate,
} from "./ui-shot.ts";

// Reads and runs no file of the app

describe("uiShotFileNameCreate", () => {
	it("names a file by label, route and viewport", () => {
		expect(
			uiShotFileNameCreate({
				label: "before",
				path: "/auth/sign-in",
				viewport: "phone",
			}),
		).toBe("before-auth-sign-in-phone.png");
	});

	it("drops the query and names the home route", () => {
		expect(
			uiShotFileNameCreate({
				label: "after",
				path: "/?tab=1#top",
				viewport: "desktop",
			}),
		).toBe("after-home-desktop.png");
	});
});

describe("uiShotEntryFileNameCreate", () => {
	it("names the list and detail pages by label and viewport", () => {
		expect(
			uiShotEntryFileNameCreate({
				label: "ci",
				page: "list",
				viewport: "phone",
			}),
		).toBe("ci-list-phone.png");
		expect(
			uiShotEntryFileNameCreate({
				label: "ci",
				page: "detail",
				viewport: "desktop",
			}),
		).toBe("ci-detail-desktop.png");
	});
});

describe("uiShotDirDefault", () => {
	it("is outside the repository, named for the worktree folder", () => {
		const dir = uiShotDirDefault("/work/wt-one/apps/app");
		expect(dir.endsWith(join("ui-shots", "wt-one"))).toBe(true);
		expect(dir.startsWith("/work")).toBe(false);
	});
});
