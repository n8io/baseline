let failures = 0;
export const check = async (name: string, fn: () => Promise<void> | void): Promise<void> => {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures++;
    console.log(`FAIL ${name}\n  ${error instanceof Error ? error.stack : String(error)}`);
  }
};
export const failureCount = () => failures;
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// Resolves for both callers once both have arrived.
export const barrierCreate = (parties: number) => {
  let arrived = 0;
  let release!: () => void;
  const all = new Promise<void>((resolve) => (release = resolve));
  return () => {
    arrived++;
    if (arrived === parties) release();
    return all;
  };
};
