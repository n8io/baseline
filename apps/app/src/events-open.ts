// How Events travel, for a composition root: on the queue. The only file that names the Events
// transport: to move Events to another one, change this file and nothing else. queue-open.ts calls
// it once the queue is real. `pnpm piece-remove queue` deletes this file.
import {
	type Events,
	type Queue,
	queueEventsCreate,
} from "@n8io/baseline-queue";

export const eventsOpen = (queue: Queue): Events => queueEventsCreate(queue);
