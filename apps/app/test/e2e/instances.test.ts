import { describe, expect, it } from "vitest";
import { uiServerStart } from "../../scripts/ui-server.ts";

// Several rendered app instances run at once, one per worktree, and share nothing: each has its own
// ports and its own memory adapters. Three here, booted together.
describe("app instances", () => {
	it("run at once on their own ports and stop one by one", async () => {
		const servers = await Promise.all([
			uiServerStart(),
			uiServerStart(),
			uiServerStart(),
		]);
		const stopped: AsyncDisposable[] = [];
		try {
			const urls = servers.map(({ url }) => url);
			expect(new Set(urls).size).toBe(3);
			const statuses = await Promise.all(
				urls.map((url) =>
					fetch(`${url}/auth/sign-in`).then((res) => res.status),
				),
			);
			expect(statuses).toEqual([200, 200, 200]);
			const [first, ...rest] = servers;
			await first?.[Symbol.asyncDispose]();
			stopped.push(...(first ? [first] : []));
			const [stoppedStatus, ...restStatuses] = await Promise.all(
				[first, ...rest].map((server) =>
					fetch(`${server?.url}/auth/sign-in`).then(
						(res) => res.status,
						() => "down",
					),
				),
			);
			expect(stoppedStatus).toBe("down");
			expect(restStatuses).toEqual([200, 200]);
		} finally {
			await Promise.all(
				servers
					.filter((server) => !stopped.includes(server))
					.map((server) => server[Symbol.asyncDispose]()),
			);
		}
	}, 60_000);
});
