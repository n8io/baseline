import { fooMemoryStateCreate, fooReadRepositoryMemory, fooTransactionMemory } from "../foo/spi/foo-repository.memory.ts";
import { fooTransactionContract } from "./foo-transaction.contract.ts";

await fooTransactionContract({
  label: "memory",
  setup: async () => {
    const state = fooMemoryStateCreate();
    return { fooTransaction: fooTransactionMemory(state), fooReadRepository: fooReadRepositoryMemory(state) };
  },
});

import { failureCount as fooFailureCount } from "./harness.ts";
process.exitCode = fooFailureCount() > 0 ? 1 : 0;
