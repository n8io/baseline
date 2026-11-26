import { describe, expect, it } from "vitest";
import { liveUpdatesOpen } from "./live-updates-open.ts";

const eventSourceFake = () => {
	const listeners = new Map<string, () => void>();
	const closes: true[] = [];
	const source = {
		addEventListener: (type: string, listener: () => void) => {
			listeners.set(type, listener);
		},
		close: () => {
			closes.push(true);
		},
		closes,
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
	it("opens /live/<channel>/<id>, encoding both", () => {
		const { create, source } = eventSourceFake();
		liveUpdatesOpen({
			channel: "foo",
			eventSourceCreate: create,
			id: "foo_1/x",
			onChange: () => {},
		});

		expect(source.url).toBe("/live/foo/foo_1%2Fx");
	});

	it("opens under /live for a null pathPrefix", () => {
		const { create, source } = eventSourceFake();
		liveUpdatesOpen({
			channel: "foo",
			eventSourceCreate: create,
			id: "foo_1",
			onChange: () => {},
			pathPrefix: null,
		});

		expect(source.url).toBe("/live/foo/foo_1");
	});

	it("opens no stream for a null id, and its close does nothing", () => {
		const creates: string[] = [];
		const create = (url: string) => {
			creates.push(url);
			return eventSourceFake().source;
		};
		const close = liveUpdatesOpen({
			channel: "foo",
			eventSourceCreate: create,
			id: null,
			onChange: () => {},
		});

		expect(creates).toEqual([]);
		expect(close()).toBeUndefined();
	});

	it("opens the stream under a given path prefix", () => {
		const { create, source } = eventSourceFake();
		liveUpdatesOpen({
			channel: "invoice",
			eventSourceCreate: create,
			id: "invoice_1",
			onChange: () => {},
			pathPrefix: "/api/live",
		});

		expect(source.url).toBe("/api/live/invoice/invoice_1");
	});

	it("calls onChange on each (re)connect and each live update", () => {
		const { create, source } = eventSourceFake();
		let changes = 0;
		const onChange = () => {
			changes += 1;
		};
		liveUpdatesOpen({
			channel: "foo",
			eventSourceCreate: create,
			id: "foo_1",
			onChange,
		});

		source.emit("ready");
		source.emit("message");
		source.emit("ready");
		source.emit("error");

		expect(changes).toBe(3);
	});

	it("returns the close", () => {
		const { create, source } = eventSourceFake();
		const close = liveUpdatesOpen({
			channel: "foo",
			eventSourceCreate: create,
			id: "foo_1",
			onChange: () => {},
		});

		expect(source.closes).toHaveLength(0);
		close();
		expect(source.closes).toHaveLength(1);
	});
});
