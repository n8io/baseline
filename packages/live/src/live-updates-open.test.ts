import { describe, expect, test, vi } from "vitest";
import { liveUpdatesOpen } from "./live-updates-open.ts";

const eventSourceFake = () => {
	const listeners = new Map<string, () => void>();
	const source = {
		addEventListener: (type: string, listener: () => void) => {
			listeners.set(type, listener);
		},
		close: vi.fn(),
		emit: (type: string) => listeners.get(type)?.(),
		url: "",
	};
	const create = (url: string) => {
		source.url = url;
		return source;
	};
	return { create, source };
};

describe("liveUpdatesOpen", () => {
	test("opens /live/<channel>/<id>, encoding both", () => {
		const { create, source } = eventSourceFake();
		liveUpdatesOpen("foo", "foo_1/x", () => {}, create);

		expect(source.url).toBe("/live/foo/foo_1%2Fx");
	});

	test("calls onChange on each (re)connect and each live update", () => {
		const { create, source } = eventSourceFake();
		const onChange = vi.fn();
		liveUpdatesOpen("foo", "foo_1", onChange, create);

		source.emit("ready");
		source.emit("message");
		source.emit("ready");
		source.emit("error");

		expect(onChange).toHaveBeenCalledTimes(3);
	});

	test("returns the close", () => {
		const { create, source } = eventSourceFake();
		const close = liveUpdatesOpen("foo", "foo_1", () => {}, create);

		expect(source.close).not.toHaveBeenCalled();
		close();
		expect(source.close).toHaveBeenCalledOnce();
	});
});
