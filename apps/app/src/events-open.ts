// How Events travel, for a composition root: on the queue, or "memory" with a memory database. The
// only file that names the Events transport; to move Events to another one, change it here.
// `pnpm piece-remove queue` deletes this file.
import {
	type Events,
	type Queue,
	queueEventsCreate,
} from "@n8io/baseline-queue";

export const eventsOpen = (queue: Queue | "memory"): Events | "memory" =>
	queue === "memory" ? "memory" : queueEventsCreate(queue);
