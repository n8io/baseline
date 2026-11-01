import type { Foo } from "../models/foo.ts";
import type { FooReadRepository, FooRepository, FooTransaction } from "../ports.ts";

export type FooMemoryState = { foos: Map<string, Foo> };
export const fooMemoryStateCreate = (): FooMemoryState => ({ foos: new Map() });

const fooRead = (foos: () => Map<string, Foo>, guard: () => void = () => {}): FooReadRepository => ({
  async findById(id) {
    guard();
    return foos().get(id);
  },
  async findByName(name) {
    guard();
    return [...foos().values()].find((foo) => foo.name === name);
  },
});

export const fooReadRepositoryMemory = (state: FooMemoryState): FooReadRepository => fooRead(() => state.foos);

// All-or-nothing like Postgres: work runs on a copy; ok swaps it in, err or throw drops it.
// Transactions run one at a time, which is stricter than Postgres but never weaker.
export const fooTransactionMemory = (state: FooMemoryState): FooTransaction => {
  let queue: Promise<unknown> = Promise.resolve();
  return (work) => {
    const run = async () => {
      const draft = new Map(state.foos);
      const scope = { open: true };
      const guard = () => {
        if (!scope.open) throw new Error("Repository used after its transaction ended");
      };
      const fooRepository: FooRepository = {
        ...fooRead(() => draft, guard),
        async insert(foo) {
          guard();
          draft.set(foo.id, structuredClone(foo));
          return foo;
        },
      };
      try {
        const result = await work({ fooRepository });
        if (result.ok) state.foos = draft;
        return result;
      } finally {
        scope.open = false;
      }
    };
    const next = queue.then(run, run);
    queue = next.catch(() => {});
    return next;
  };
};
