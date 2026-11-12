import { fooCacheContract } from "./foo-cache.contract.ts";
import { fooCacheMemoryCreate } from "./foo-cache.memory.ts";

fooCacheContract(async () => fooCacheMemoryCreate());
