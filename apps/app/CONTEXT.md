# A starter app with the layout and patterns a project made from baseline uses. Its one Domain, Foo, shows the patterns inside a domain; Consumers and Bridges are shown in `docs/agents/events.md` and `docs/agents/bridges.md`.

## Architecture

**Domain**:
One business entity and the operations on it, sized like a microservice. Every domain has the same layout.
_Avoid_: Module, feature, service

**Model**:
A business object a domain defines in its `models/` folder, as a Zod schema and the type inferred from it. A domain has one main model and may have supporting ones. The main model is the root of its aggregate.
_Avoid_: Schema, DTO

**Aggregate**:
A main model together with the supporting models it owns, saved and loaded as one unit through one repository. A transaction may change more than one aggregate, but only within one domain.
_Avoid_: Entity graph, root object

**Use case**:
One operation a domain performs, such as creating a foo (`fooCreate`). A use case loads what it needs through ports and applies the domain's rules. Each gets its ports from a factory: `fooCreate(ports)` returns the function.
_Avoid_: Service, handler, interactor

**Rule**:
One business rule a domain enforces, defined in its `rules/` folder as a pure function over models. Use cases apply rules; the API and the SPI never do.
_Avoid_: Policy, validator, business role

**API**:
The layer of inbound adapters that receive requests from outside a domain (HTTP routes, live streams, consumers, schedules, seeds) and call its use cases. It holds no business rules.
_Avoid_: HTTP layer, routes, controllers, transport

**Port**:
An interface a domain declares for something it needs from outside itself, such as saving or caching an entity.
_Avoid_: Contract, gateway

**Repository**:
The port that saves and loads one aggregate. Each aggregate root has exactly one, named after it; a supporting model is saved through its root's repository.
_Avoid_: DAO, data mapper

**SPI**:
The layer of adapters that implement ports with real technology. It holds no business rules. Domain code depends on ports, never on the SPI.
_Avoid_: Infrastructure, providers, drivers

**Actor**:
Who is performing a use case: a signed-in user or a machine client.
_Avoid_: principal, current user, identity, session

**Intake**:
Where new work enters a process: HTTP server, sockets, consumers, schedules.

**UI**:
The pages a project serves, outside every domain; their loaders and actions call use cases of any domain through each domain's entry. Holds no business rules.
_Avoid_: frontend, web, client

**Event**:
A fact a domain records in past tense (OrderPlaced) and delivers to other domains once the change that caused it commits. Events go through the queue (pg-boss), and nothing else carries them.
_Avoid_: message, signal, notification

**Event key**:
The id of the entity an event is about, named at every publish. Events with the same Event key reach each consumer one at a time, in the order their changes committed; events with different Event keys run beside each other.
_Avoid_: partition key, ordering key, group id

**Consumer**:
An inbound adapter in a domain's API that receives one kind of event and calls a use case.
_Avoid_: subscriber, listener, handler

**Inbox**:
The record that a consumer handled an event, written in the same transaction as the work it did, so a repeated delivery of that event is skipped.
_Avoid_: dedupe table, processed events

**Bridge**:
An adapter outside every domain that fills one domain's read port by calling another domain's use case.
_Avoid_: integration, connector, facade

**Schedule**:
An inbound adapter in a domain's API that calls one use case on a timer.
_Avoid_: cron job, timer, task

**Live update**:
A short note to open pages that something they show has changed, so they reload it.
_Avoid_: push, notification, real-time event

**Analytics event**:
A record that an actor did something, sent to product analytics (Mixpanel) for funnels and retention. It carries ids and counts only. Unlike an event, nothing in the app consumes it, it is sent after commit without blocking the request, and losing one is acceptable.
_Avoid_: tracking event, product event, metric

**Error report**:
An unexpected error sent to error tracking (Sentry) for triage: its class name, stack frames, cause chain and trace id, never its message. Every error the logger logs at error or fatal becomes one, so code reports an error by logging it.
_Avoid_: crash report, Sentry issue

**Composition root**:
A file that starts one process: it parses config, opens connections, picks adapters, builds each domain's use cases and wires its intakes (`src/server.ts`, `src/worker.ts`, `src/migrate.ts`, `src/seed.ts`). Holds no business rules.
_Avoid_: bootstrap, main, container

**Worker**:
The process that runs a project's consumers and schedules, started from `src/worker.ts`; it never serves pages or the API.
_Avoid_: job runner, background process

**Seed**:
An inbound adapter in a domain's API that creates example data for local development by calling the domain's own use cases.
_Avoid_: fixture, sample data

## Language

**Foo**:
The template's example domain: a named record that shows every pattern a domain uses. `app-create` replaces it with the project's first domain.
_Avoid_: widget, example, sample
