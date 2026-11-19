import { describe } from "vitest";
import { barRepositoryContract } from "./bar-repository.contract.ts";
import { fooPortsMemoryCreate } from "./foo-ports.memory.ts";

describe("barRepositoryMemoryCreate", () => {
	barRepositoryContract(async () => fooPortsMemoryCreate().ports);
});
