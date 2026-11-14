import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer as netServerCreate } from "node:net";
import { describe, expect, it } from "vitest";
import { integrationPortClaimerCreate } from "./integration-port-claimer.ts";

// Ports 32700 to 32719 with their guards at 32720 to 32739: away from the real claims, which start
// at 30000.
const range = { first: 32_700, span: 20 };

// Another Project's run: a process that claims `count` ports, prints them, and holds them until
// its stdin closes.
const otherRunStart = async (count: number) => {
	const claimer = new URL("./integration-port-claimer.ts", import.meta.url)
		.href;
	const child = spawn(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`const { integrationPortClaimerCreate } = await import(${JSON.stringify(claimer)});
const claimer = integrationPortClaimerCreate(${JSON.stringify(range)});
const ports = [];
for (let i = 0; i < ${count}; i++) ports.push(await claimer.claim());
console.log(JSON.stringify(ports));
process.stdin.resume();
process.stdin.on("end", () => process.exit(0));`,
		],
		{ stdio: ["pipe", "pipe", "inherit"] },
	);
	const [line] = (await once(child.stdout, "data")) as [Buffer];
	return {
		ports: JSON.parse(String(line)) as number[],
		[Symbol.asyncDispose]: async () => {
			const exited = once(child, "exit");
			child.stdin.end();
			await exited;
		},
	};
};

describe("integrationPortClaimerCreate", () => {
	// Each probe closes before the next claim, as it does before a child binds the port: only the
	// claim stops the second run from probing the same free port.
	it("never hands two Projects' runs the same port", async () => {
		await using other = await otherRunStart(5);
		const claimer = integrationPortClaimerCreate(range);

		const ports: number[] = [];
		for (let index = 0; index < 5; index++) ports.push(await claimer.claim());

		expect(other.ports.filter((port) => ports.includes(port))).toEqual([]);
	});

	it("frees a run's ports once its process exits", async () => {
		let held: number[];
		{
			await using other = await otherRunStart(1);
			held = other.ports;
		}
		const [port] = held;

		const claimed = await integrationPortClaimerCreate({
			first: port as number,
			span: range.span,
		}).claim();

		expect(claimed).toBe(port);
	});

	it("skips a port something already listens on", async () => {
		const taken = netServerCreate().listen(range.first);
		await once(taken, "listening");
		try {
			const port = await integrationPortClaimerCreate(range).claim();

			expect(port).not.toBe(range.first);
		} finally {
			await new Promise((resolve) => taken.close(resolve));
		}
	});
});
