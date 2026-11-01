// Does `await using` (explicit resource management) run on this Node with type stripping?
// It would let an explicit-commit unit of work roll back and release on scope exit.
const log: string[] = [];
const fooUnitOfWorkStart = async () => {
  let committed = false;
  return {
    commit: async () => {
      committed = true;
      log.push("COMMIT");
    },
    [Symbol.asyncDispose]: async () => {
      if (!committed) log.push("ROLLBACK");
      log.push("release");
    },
  };
};
const run = async (fail: boolean) => {
  await using fooUnitOfWork = await fooUnitOfWorkStart();
  if (fail) return "err";
  await fooUnitOfWork.commit();
  return "ok";
};
await run(false);
await run(true);
console.log(`${process.version}: ${log.join(" ")}`);
