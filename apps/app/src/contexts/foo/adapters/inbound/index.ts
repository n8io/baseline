// biome-ignore-all assist/source/organizeImports: piece markers keep each piece's exports together
// The context's inbound adapters, for the composition roots.

export { barRoutesCreate } from "./bar-routes.ts";
// piece-start: live
export { fooLiveRoutesCreate } from "./foo-live.ts";
// piece-end: live
export { fooRoutesCreate } from "./foo-routes.ts";
// aggregate-create-start: schedule
// piece-start: queue
export { fooSchedule, fooScheduleCreate } from "./foo-schedule.ts";
// piece-end: queue
// aggregate-create-end: schedule
// aggregate-create-start: seed
export { fooSeed } from "./foo-seed.ts";
// aggregate-create-end: seed
// wiring: exports
