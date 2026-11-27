import { describe, expect, it } from "vitest";
import { liveHubMemoryCreate } from "./index.ts";
import { liveHubContract } from "./live-hub.contract.ts";
import { liveLoggerTestRecord } from "./live-logger-test-record.ts";

liveHubContract(async () => liveHubMemoryCreate());

describe("liveHubMemoryCreate", () => {
	it("sends to a channel nobody listens on without a failure", async () => {
		using warn = liveLoggerTestRecord("warn");
		await using liveHub = liveHubMemoryCreate();

		await liveHub.send("foo", { id: "foo_1", type: "foo.updated" });

		expect(warn.calls).toEqual([]);
	});
});
