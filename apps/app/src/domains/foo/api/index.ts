// The domain's inbound adapters, for the composition roots.
// piece-start: live
export { fooLiveRoutesCreate } from "./foo-live.ts";
// piece-end: live
export { fooRoutesCreate } from "./foo-routes.ts";
// piece-start: queue
export { fooScheduleCreate } from "./foo-schedule.ts";
// piece-end: queue
export { fooSeed } from "./foo-seed.ts";
