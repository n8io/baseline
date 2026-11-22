import { describe, expect, it } from "vitest";
import {
	releaseVerifyEntryRead,
	releaseVerifyPackageCheck,
	releaseVerifyTagsMissing,
} from "../scripts/release-verify.ts";

describe("release-verify", () => {
	it("lists the tags origin lacks", () => {
		const lsRemote = "abc\trefs/tags/app@16.0.0\ndef\trefs/tags/v15\n";
		expect(releaseVerifyTagsMissing({ lsRemote, version: "16.0.0" })).toEqual([
			"v16",
		]);
		expect(
			releaseVerifyTagsMissing({
				lsRemote: `${lsRemote}x\trefs/tags/v16\n`,
				version: "16.0.0",
			}),
		).toEqual([]);
	});

	it("reads provenance from a registry entry", () => {
		expect(releaseVerifyEntryRead(undefined)).toBe("absent");
		expect(releaseVerifyEntryRead({ dist: {} })).toBe("unattested");
		expect(
			releaseVerifyEntryRead({ dist: { attestations: { provenance: {} } } }),
		).toBe("provenance");
	});

	it("retries a version the registry has not shown yet", async () => {
		let calls = 0;
		const problem = await releaseVerifyPackageCheck({
			entryFetch: async () =>
				++calls < 3
					? undefined
					: { dist: { attestations: { provenance: {} } } },
			name: "@n8io/baseline-queue",
			retries: 5,
			sleep: async () => {},
			version: "9.0.0",
			wait: 0,
		});
		expect(problem).toBeUndefined();
		expect(calls).toBe(3);
	});

	it("reports a version that never shows", async () => {
		const problem = await releaseVerifyPackageCheck({
			entryFetch: async () => undefined,
			name: "@n8io/baseline-queue",
			retries: 1,
			sleep: async () => {},
			version: "9.0.0",
			wait: 0,
		});
		expect(problem).toBe("@n8io/baseline-queue@9.0.0: not on npmjs");
	});
});
