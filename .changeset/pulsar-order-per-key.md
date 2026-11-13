---
"@n8io/baseline-pulsar": major
"app": patch
---

Events on Pulsar are kept in order per Event key, and a broker outage no longer restarts every Worker.

- Each Consumer gets the Events of one Event key one at a time, in the order the broker received them, on any number of Workers; other keys run beside them. A Worker holds up to four Events per Consumer at once.
- **Breaking:** a failed Event is retried inside the Worker that holds it (five attempts, 10 s, 20 s, 40 s and 80 s apart), so later Events of its key wait behind it. The broker's own redelivery is no longer used, because it puts a failed Event behind the later ones of its key.
- After the fifth failure the Event is copied to `<queueName>.dead` and its key moves on. This differs from the queue, where the key stays blocked until released; the README says why. Read dead letters with a Shared subscription.
- **Breaking:** `isAlive()` is false only when a Consumer's receive loop has not come round for 60 s. A broker that cannot be reached no longer fails it, so Workers stay up through an outage and reconnect by themselves.
- `publish` throws a `TypeError` for an empty key, as the queue does.
- **Upgrade step:** the subscription type changes, and the broker refuses it while Workers of the old release are connected. Scale the old Workers to zero, then deploy. See "Upgrading to 5" in the README.
- app: the unit test project gives hooks 20 s, like its tests. Importing `server.ts` in a `beforeAll` took over the default 10 s on a busy CI runner.
