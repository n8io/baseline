import { describe, expect, it } from "vitest";
import { workspaceOverridesAdd } from "./checkout.ts";

const entries = ['  "@n8io/baseline-id": file:./id.tgz\n'];

describe("workspaceOverridesAdd", () => {
	it("appends an overrides block to a workspace without one", () => {
		expect(workspaceOverridesAdd("autoInstallPeers: false\n", entries)).toBe(
			'autoInstallPeers: false\noverrides:\n  "@n8io/baseline-id": file:./id.tgz\n',
		);
	});

	it("adds to the template's own overrides block instead of a second key", () => {
		const workspace =
			'overrides:\n  minimatch: ">=11.0.1"\nallowBuilds:\n  protobufjs: false\n';

		expect(workspaceOverridesAdd(workspace, entries)).toBe(
			'overrides:\n  "@n8io/baseline-id": file:./id.tgz\n  minimatch: ">=11.0.1"\nallowBuilds:\n  protobufjs: false\n',
		);
	});

	it("starts the block on its own line when the file has no final newline", () => {
		expect(workspaceOverridesAdd("autoInstallPeers: false", entries)).toBe(
			'autoInstallPeers: false\noverrides:\n  "@n8io/baseline-id": file:./id.tgz\n',
		);
	});

	it("keeps a comment on the overrides key", () => {
		expect(
			workspaceOverridesAdd('overrides: # why\n  minimatch: "11"\n', entries),
		).toBe(
			'overrides: # why\n  "@n8io/baseline-id": file:./id.tgz\n  minimatch: "11"\n',
		);
	});

	it("refuses an inline overrides map rather than adding a second key", () => {
		expect(() => workspaceOverridesAdd("overrides: {}\n", entries)).toThrow(
			/not a block of lines/,
		);
	});
});
