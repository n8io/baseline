# A starter app with the layout and patterns a project made from baseline uses. Its one bounded context, foo, shows the patterns inside a context; Event handlers and anti-corruption layers are shown in `docs/agents/events.md` and `docs/agents/bridges.md`.

## Architecture

The standard DDD and hexagonal terms ([ADR 0001](https://github.com/n8io/baseline/blob/main/docs/adr/0001-standard-ddd-terms.md)). Code, paths and `CONTEXT-MAP.md` keep the old words and shape until the tickets that move them land; `glossary-check` lets the old words pass until then:
_Allowed until n8io/baseline#473 (added 2026-11-18)_: Domain, Model, Rule, API layer, SPI, Consumer, Bridge, Outcome Events

**Bounded context**:
The scope of one model and its language, holding one or more Aggregates grouped by business capability. In code and paths it is `context` (`src/contexts/<context>/`), split into `domain/`, `application/`, `adapters/inbound/` and `adapters/outbound/`, with dependencies pointing inward.
_Avoid_: Domain, feature

**Subdomain**:
The kind of business area a bounded context serves: core, supporting or generic. Each context's language file names its type.

**Context map**:
`CONTEXT-MAP.md`: each bounded context, its subdomain type, and its relationships to the others: upstream or downstream, anti-corruption layer, Published language, Shared kernel.

**Shared kernel**:
What every bounded context shares and changes together: the result, id and authn Packages. Their types are the only imports `domain/` may take from outside itself.

**Aggregate**:
An Aggregate root with the entities and value objects it owns, saved and loaded as one unit through one Repository. Every change to it goes through a transition in its `domain/` file, so a Use case cannot save one that breaks an invariant. One Aggregate per transaction is the default; several only inside one bounded context when one invariant spans them, with a `// invariant: <what>` comment above the transaction. Across contexts it is always a Domain event.
_Avoid_: Entity graph, root object

**Aggregate root**:
The entity an Aggregate is held, loaded and saved by. Its schema, its value objects, its transitions and its specifications live in `domain/<aggregate>.ts`.
_Avoid_: Model, main model

**Entity**:
A business object with an identity that lasts through its changes, defined as a Zod schema and the type inferred from it.
_Avoid_: DTO

**Value object**:
A business value defined only by what it holds, with no identity of its own, defined as a Zod schema in its Aggregate's file.

**Invariant**:
A condition an Aggregate always holds. Its transitions keep it: each is a pure function that returns `Result` (`invoiceLineAdd(invoice, input)`).
_Avoid_: Rule

**Specification**:
A reusable predicate over an Aggregate, in its `domain/` file, named ending in `Is`, `Has` or `Can` (`invoicePaidIs`).
_Avoid_: Policy, validator

**Domain service**:
Logic over several Aggregates that belongs to none of them, as a pure function in its own `domain/` file.

**Use case**:
One operation a bounded context performs, in `application/`, such as creating a foo (`fooCreate`). It loads an Aggregate through its ports, calls a transition, saves the result and publishes. Each gets its ports from a factory: `fooCreate(ports)` returns the function.
_Avoid_: Service, interactor

**Module**:
Anything with an interface and an implementation, at any scale: a function, a file, a Package or a bounded context. A bounded context is one deep module: a lot of behaviour behind a small interface.

**Interface**:
Everything a caller must know to use a module correctly: its types, and also its invariants, ordering, errors and required configuration. A bounded context's interface is its `index.ts`: `<context>ContextCreate(...)` and its Published language. Outside code imports nothing else from a context, and Use case tests go through it.
_Avoid_: signature

**Seam**:
A place where behaviour can change without editing that place: where a module's interface lives.

**Adapter**:
A concrete thing that satisfies an interface at a seam, named for the slot it fills, not for what is inside it.

**Port**:
The interface at a seam: what a bounded context declares it needs from outside, such as saving an Aggregate or caching. A port stays only where two adapters exist, a production one and a memory one. Repository ports live in `domain/repositories.ts`; the others (Clock, cache, analytics, live, transaction, events) in `application/ports.ts`.
_Avoid_: Contract, gateway

**Repository**:
The port that saves and loads one Aggregate. Each Aggregate root has exactly one, named after it; the rest of the Aggregate is saved through it.
_Avoid_: DAO, data mapper

**Inbound adapter**:
An adapter that drives a bounded context from outside by calling its Use cases: HTTP routes, live streams, Event handlers, Schedules and Seeds, in `adapters/inbound/`. It holds no business logic.
_Avoid_: API layer, HTTP layer, controllers, transport

**Outbound adapter**:
An adapter that a bounded context drives through a port, with real technology or in memory: Postgres repositories and tables, memory fakes and anti-corruption layers, in `adapters/outbound/`. It holds no business logic, and `domain/` and `application/` never import it.
_Avoid_: SPI, Infrastructure, providers, drivers

**Clock**:
The port a bounded context reads the current time from (`<context>Clock.now()`). Use cases never call `new Date()` or `Date.now()`; tests set or advance the memory clock instead.
_Avoid_: Time provider, now function

**Actor**:
Who is performing a use case: a signed-in user or a machine client.
_Avoid_: principal, current user, identity, session

**Intake**:
Where new work enters a process: HTTP server, sockets, Event handlers, schedules.

**UI**:
The pages a project serves, outside every bounded context; their loaders and actions call Use cases of any context through its interface. Holds no business logic.
_Avoid_: frontend, web, client

**Domain event**:
A fact a bounded context records in past tense (OrderPlaced) and delivers to other contexts once the change that caused it commits. Domain events go through the queue (pg-boss), and nothing else carries them. The schemas a context exports are part of its Published language.
_Avoid_: message, signal, notification

**Published language**:
What a bounded context shares through its interface besides `<context>ContextCreate`: its Domain event schemas, its error types and the input schemas the UI needs.

**Event key**:
The id of the entity a Domain event is about, named at every publish. Domain events with the same Event key reach each Event handler one at a time, in the order their changes committed; ones with different Event keys run beside each other.
_Avoid_: partition key, ordering key, group id

**Event handler**:
An inbound adapter that receives one kind of Domain event and calls a Use case, in `<context>-<event>-handler.ts`. The queue Package's `queueConsumerCreate` keeps its name, because it is the messaging API.
_Avoid_: Consumer, subscriber, listener

**Outbox**:
Domain events written in the same transaction as the change that caused them and sent once it commits. The queue's publish is the outbox.

**Inbox**:
The record that an Event handler handled a Domain event, written in the same transaction as the work it did, so a repeated delivery of that event is skipped.
_Avoid_: dedupe table, processed events

**Anti-corruption layer**:
A translation inside a downstream bounded context that reads an upstream context through the upstream's interface and turns what it returns into the downstream's own terms, in `adapters/outbound/<context>-<upstream>-acl.ts`. It runs in process, with no reader port or memory fake: its tests run the real upstream on memory adapters. Short form: ACL.
_Avoid_: Bridge, integration, connector, facade

**Saga**:
A business process across bounded contexts carried by Domain events (choreographed): an Event handler in each context calls a Use case that acts on one Domain event and publishes the next, including the outcome a waiting context needs.
_Avoid_: Outcome Events

**Projection**:
A read model a bounded context builds from Domain events, such as a running total kept from each posted amount.

**Schedule**:
An inbound adapter that calls one Use case on a timer.
_Avoid_: cron job, timer, task

**Live update**:
A short note to open pages that something they show has changed, so they reload it.
_Avoid_: push, notification, real-time event

**Analytics event**:
A record that an actor did something, sent to product analytics (Mixpanel) for funnels and retention. It carries ids and counts only. Unlike a Domain event, nothing in the app handles it, it is sent after commit without blocking the request, and losing one is acceptable.
_Avoid_: tracking event, product event, metric

**Error report**:
An unexpected error sent to error tracking (Sentry) for triage: its class name, stack frames, cause chain and trace id, never its message. Every error the logger logs at error or fatal becomes one, so code reports an error by logging it.
_Avoid_: crash report, Sentry issue

**Composition root**:
A file that starts one process: it parses config, opens connections, picks adapters and mounts what each bounded context's interface returns (`src/server.ts`, `src/worker.ts`, `src/migrate.ts`, `src/seed.ts`, `src/blocked-keys.ts`). It is the only code that imports adapters, and it holds no business logic.
_Avoid_: bootstrap, main, container

**Worker**:
The process that runs a project's Event handlers and schedules, started from `src/worker.ts`; it never serves pages or the API.
_Avoid_: job runner, background process

**Seed**:
An inbound adapter that creates example data for local development by calling its bounded context's own Use cases.
_Avoid_: fixture, sample data

## Language

**Foo**:
The Template's example bounded context, `foo`, and its Aggregate root: a named record that shows every pattern a context uses. A project never contains it: it starts with no context, `context-create` copies foo's context-level files under a new context's name, and `aggregate-create` copies Foo under each new Aggregate's name.
_Avoid_: widget, example, sample

**Bar**:
The Template's second example Aggregate in `foo`: a short note on one Foo, deleted with its Foo in the same transaction. It shows a context holding several Aggregates and a transaction across two under an invariant. Neither command copies it.
