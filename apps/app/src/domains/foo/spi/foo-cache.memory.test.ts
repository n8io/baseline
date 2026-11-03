import { fooCacheContract } from "./foo-cache.contract.ts";
import { fooCacheMemory } from "./foo-cache.memory.ts";

fooCacheContract(async () => fooCacheMemory());
