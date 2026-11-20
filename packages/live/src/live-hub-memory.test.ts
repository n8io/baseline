import { liveHubMemoryCreate } from "./index.ts";
import { liveHubContract } from "./live-hub.contract.ts";

liveHubContract(async () => liveHubMemoryCreate());
