import {
	ErrorCode,
	type EvaluationContext,
	ProviderEvents,
	ProviderStatus,
} from "@openfeature/web-sdk";
import { describe, expect, it } from "vitest";
import { FakeProvider } from "./feature-flags-launch-darkly-client-test-provider.ts";

const values = () => ({
	b: true,
	n: 3,
	nothing: null,
	o: { mode: "dark" },
	s: "text",
});

describe("FakeProvider", () => {
	it("serves each type as a STATIC value, and a value of another type as a type mismatch", () => {
		const provider = new FakeProvider({ values });
		expect(provider.resolveBooleanEvaluation("b", false)).toEqual({
			reason: "STATIC",
			value: true,
		});
		expect(provider.resolveNumberEvaluation("n", 0)).toEqual({
			reason: "STATIC",
			value: 3,
		});
		expect(provider.resolveStringEvaluation("s", "")).toEqual({
			reason: "STATIC",
			value: "text",
		});
		expect(provider.resolveObjectEvaluation("o", {})).toEqual({
			reason: "STATIC",
			value: { mode: "dark" },
		});
		for (const details of [
			provider.resolveBooleanEvaluation("s", false),
			provider.resolveNumberEvaluation("b", 9),
			provider.resolveStringEvaluation("n", "fb"),
			provider.resolveObjectEvaluation("s", { fb: 1 }),
		]) {
			expect(details).toMatchObject({
				errorCode: ErrorCode.TYPE_MISMATCH,
				reason: "ERROR",
			});
		}
		expect(provider.resolveStringEvaluation("n", "fb").value).toBe("fb");
	});

	it("counts null as an object, and a missing key as not found with the fallback", () => {
		const provider = new FakeProvider({ values });
		expect(provider.resolveObjectEvaluation("nothing", {})).toEqual({
			reason: "STATIC",
			value: null,
		});
		expect(provider.resolveNumberEvaluation("gone", 7)).toEqual({
			errorCode: ErrorCode.FLAG_NOT_FOUND,
			reason: "ERROR",
			value: 7,
		});
	});

	it("starts ready, rejects when told to fail, and reports an error status when told to error", async () => {
		const ok = new FakeProvider({ values });
		await expect(ok.initialize({})).resolves.toBeUndefined();
		expect(ok.status).toBe(ProviderStatus.READY);
		const failing = new FakeProvider({ initialize: "fail", values });
		await expect(failing.initialize({})).rejects.toThrow("no connection");
		const erroring = new FakeProvider({ initialize: "error", values });
		await expect(erroring.initialize({})).resolves.toBeUndefined();
		expect(erroring.status).toBe(ProviderStatus.ERROR);
	});

	it("never finishes starting when told to hang", async () => {
		const hanging = new FakeProvider({ initialize: "hang", values });
		const outcome = await Promise.race([
			hanging.initialize({}).then(() => "started"),
			new Promise((resolve) => setTimeout(() => resolve("waiting"), 20)),
		]);
		expect(outcome).toBe("waiting");
	});

	it("serves what the context it started or changed to asks for", async () => {
		const provider = new FakeProvider({
			values: (context: EvaluationContext) => ({
				n: context.targetingKey === "b2" ? 9 : 1,
			}),
		});
		await provider.initialize({ targetingKey: "a1" });
		expect(provider.resolveNumberEvaluation("n", 0).value).toBe(1);
		await provider.onContextChange({}, { targetingKey: "b2" });
		expect(provider.resolveNumberEvaluation("n", 0).value).toBe(9);
	});

	it("starts with an empty context when none is given", async () => {
		const seen: EvaluationContext[] = [];
		const provider = new FakeProvider({
			values: (context) => {
				seen.push(context);
				return {};
			},
		});
		await provider.initialize();
		provider.resolveNumberEvaluation("n", 0);
		expect(seen).toEqual([{}]);
	});

	it("counts closes", async () => {
		const provider = new FakeProvider({ values });
		await provider.onClose();
		await provider.onClose();
		expect(provider.closed).toBe(2);
	});

	it("emits ConfigurationChanged with the changed values, and Ready with its status", () => {
		const provider = new FakeProvider({ initialize: "hang", values });
		const events: unknown[] = [];
		provider.events.addHandler(ProviderEvents.ConfigurationChanged, (details) =>
			events.push(details),
		);
		provider.events.addHandler(ProviderEvents.Ready, () =>
			events.push(provider.status),
		);
		provider.valuesSet(() => ({ n: 5 }));
		expect(events).toEqual([{ flagsChanged: [] }]);
		expect(provider.resolveNumberEvaluation("n", 0).value).toBe(5);
		provider.readyEmit();
		expect(events).toEqual([{ flagsChanged: [] }, ProviderStatus.READY]);
	});
});
