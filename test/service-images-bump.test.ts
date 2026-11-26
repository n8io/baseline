import { describe, expect, it } from "vitest";
import {
	serviceImagesRead,
	serviceImagesRewrite,
} from "../scripts/service-images-bump.ts";

const oldDigest = "a".repeat(64);
const newDigest = "b".repeat(64);
const workflow = `    services:
      db:
        image: postgres:18@sha256:${oldDigest}
      cache:
        image: redis:8@sha256:${oldDigest}
`;

describe("service image bump", () => {
	it("reads every pinned service image in a workflow", () => {
		expect(serviceImagesRead(workflow)).toEqual([
			{ digest: oldDigest, name: "postgres", tag: "18" },
			{ digest: oldDigest, name: "redis", tag: "8" },
		]);
	});

	it("rewrites only the digests the registry now resolves differently", () => {
		const out = serviceImagesRewrite(
			workflow,
			new Map([["postgres:18", `sha256:${newDigest}`]]),
		);
		expect(out).toContain(`image: postgres:18@sha256:${newDigest}`);
		expect(out).toContain(`image: redis:8@sha256:${oldDigest}`);
	});

	it("leaves the text alone when no digest moved", () => {
		const same = new Map([
			["postgres:18", `sha256:${oldDigest}`],
			["redis:8", `sha256:${oldDigest}`],
		]);
		expect(serviceImagesRewrite(workflow, same)).toBe(workflow);
	});

	it("keeps an image the registry was not asked about", () => {
		expect(serviceImagesRewrite(workflow, new Map())).toBe(workflow);
	});
});
