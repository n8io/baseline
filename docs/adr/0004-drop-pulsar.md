# Drop the Pulsar transport; Events run on the Postgres queue only

Status: accepted, 2026-11-13

Events once had two transports, the Postgres queue and a Pulsar Package. Keeping Pulsar to the queue's promise of order per Event key kept costing more (Key_Shared subscriptions, retries inside the Worker, no rolling upgrade, no clean way to hold a failing key), and the systems that publish to Pulsar are not ours to change. So the Pulsar Package was deleted and its npm versions deprecated; the transport-neutral `Events` port stays, so a new transport would be one more adapter. Do not build or fix anything for Pulsar.
