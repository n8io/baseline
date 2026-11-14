---
"app": minor
---

Two Projects on one machine run `pnpm dev` and `pnpm run ci` at the same time.

- A Project's port block from its name now holds seven ports: the four compose.yaml publishes, then the dev Server's `PORT` and `HEALTH_PORT` (new lines in `.env.development`) and the dev Worker's health port in the `dev` script. The Template keeps 3000, 9000 and 9001; production's `PORT` and `HEALTH_PORT` in `.env.schema` do not change.
- Integration tests claim the ports for the Servers and Workers they boot from 30000 to 31383 (`test/integration/integration-port-claimer.ts`): a claim is a socket the run keeps listening on the port's guard, 1384 ports above it, so the OS gives each port to one run and frees it when that run exits. Each Project's run used to take the same `20000 + VITEST_POOL_ID * 100` block, so two runs could both start a child on one port and a test could reach the other Project's Server.

To upgrade a Project: `pnpm template-upgrade` renders both releases with your Project's name, so it adds the `.env.development` lines and your own Worker port to the `dev` script. A Project that changed its `dev` script, e.g. by removing the queue or ui piece, gets a conflict there: keep your script and change its `HEALTH_PORT=9001` to the one the new side shows.
