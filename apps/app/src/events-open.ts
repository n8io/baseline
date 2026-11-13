// How Events travel, for a composition root: on the queue, or "memory" with a memory database. The
// only file that names the Events transport: to move Events to another one, change this file and
// nothing else. `pnpm piece-remove queue` deletes this file.
import {
	type Events,
	type Queue,
	queueEventsCreate,
} from "@n8io/baseline-queue";
import type { ShutdownStep } from "@n8io/baseline-shutdown";

// Everything a transport may need from the composition root. The queue's Events need only the
// queue, which queue-open.ts already stops at shutdown.
export const eventsOpen = ({
	queue,
}: {
	queue: Queue | "memory";
	role: "publisher" | "worker";
	intakes: ShutdownStep[];
	resources: ShutdownStep[];
}): Events | "memory" =>
	queue === "memory" ? "memory" : queueEventsCreate(queue);
