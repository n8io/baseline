# A starter app with the layout and patterns a Project made from baseline uses. Its one bounded context, foo, shows the patterns inside a context; Event handlers and anti-corruption layers are shown in `docs/agents/events.md` and `docs/agents/acl.md`.

## Architecture

The standard DDD and hexagonal terms ([ADR 0001](https://github.com/n8io/baseline/blob/main/docs/adr/0001-standard-ddd-terms.md)), shared by every bounded context. Each context's own terms live in its `src/contexts/<context>/CONTEXT.md`, listed in `CONTEXT-MAP.md`:

**Bounded context**:
The scope of one language, holding one or more Aggregates grouped by business capability. In code and paths it is `context` (`src/contexts/<context>/`), split into `domain/`, `application/`, `adapters/inbound/` and `adapters/outbound/`, with dependencies pointing inward.
_Avoid_: Domain, feature

**Subdomain**:
The kind of business area a bounded context serves: core, supporting or generic. `CONTEXT-MAP.md` and the context's own `CONTEXT.md` both name its type.

**Context map**:
`CONTEXT-MAP.md`: each bounded context, its subdomain type, and its relationships to the others: upstream or downstream, anti-corruption layer, Published language, Shared kernel.

**Shared kernel**:
What every bounded context shares and changes together: the result, id and authn Packages. Their types, and the result Package's `ok` and `err`, are the only imports `domain/` may take from outside itself, besides Zod and the id schema.

**Aggregate**:
An Aggregate root with the entities and value objects it owns, saved and loaded as one unit through one Repository. Every change to it goes through a Transition in its `domain/` file, so a Use case cannot save one that breaks an invariant. One Aggregate per transaction is the default; several only inside one bounded context when one invariant spans them, with a `// invariant: <what>` comment above the transaction. Across contexts it is always a Domain event.
_Avoid_: entity graph, root object

**Aggregate root**:
The entity an Aggregate is held, loaded and saved by. Its schema, its value objects, its Transitions and its Specifications live in `domain/<aggregate>.ts`.
_Avoid_: Model, main model

**Entity**:
A business object with an identity that lasts through its changes, defined as a Zod schema and the type inferred from it.
_Avoid_: DTO

**Value object**:
A business value defined only by what it holds, with no identity of its own, defined as a Zod schema in its Aggregate's file.

**Invariant**:
A condition an Aggregate always holds. Its Transitions keep it.
_Avoid_: Rule

**Transition**:
A pure function in an Aggregate's `domain/` file that makes the Aggregate or changes it, keeping its invariants: `invoiceNew(input)` returns the Aggregate, or a `Result` when something can refuse it; a change (`invoiceLineAdd(invoice, input)`) returns `Result`. A Use case changes an Aggregate only through one: architecture rule A29 refuses a Use case that builds or copies one itself.
_Avoid_: setter

**Specification**:
A reusable predicate over an Aggregate, in its `domain/` file, named ending in `Is`, `Has` or `Can` (`invoicePaidIs`).
_Avoid_: policy, validator

**Domain service**:
Logic over several Aggregates that belongs to none of them, as a pure function in its own `domain/` file.

**Use case**:
One operation a bounded context performs, in `application/`, such as creating an invoice (`invoiceCreate`). It loads an Aggregate through its ports, calls a Transition, saves the result and publishes. Each gets its ports from a factory: `invoiceCreate(ports)` returns the function.
_Avoid_: application service, service class, interactor

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
The interface at a seam: what a bounded context declares it needs from outside, such as saving an Aggregate or caching. A port stays only where two adapters exist, a production one and a memory one; an anti-corruption layer's slot, filled in process by the real upstream, is the one exception. Repository ports live in `domain/repositories.ts`; the others (Clock, cache, analytics, live, transaction, events) in `application/ports.ts`.
_Avoid_: port contract, gateway

**Repository**:
The port that saves and loads one Aggregate. Each Aggregate root has exactly one, named after it; the rest of the Aggregate is saved through it.
_Avoid_: DAO, data mapper

**Inbound adapter**:
An adapter that drives a bounded context from outside by calling its Use cases: HTTP routes, live streams, Event handlers, Schedules and Seeds, in `adapters/inbound/`. It holds no business logic.
_Avoid_: API layer, HTTP layer, controllers, transport

**Outbound adapter**:
An adapter that a bounded context drives through a port, with real technology or in memory: Postgres repositories and tables, memory fakes and anti-corruption layers, in `adapters/outbound/`. It holds no business logic, and `domain/` and `application/` never import it.
_Avoid_: SPI, infrastructure, adapter providers, drivers

**Clock**:
The port a bounded context reads the current time from (`<context>Clock.now()`). Use cases never call `new Date()` or `Date.now()`; tests set or advance the memory clock instead.
_Avoid_: time provider, now function

**Actor**:
Who is performing a Use case: a signed-in user or a machine client.
_Avoid_: principal, current user, user identity, user session

**Scope**:
What an Actor may do, named `<aggregate>:<verb>` (`invoice:refund`). The Actor carries its scopes; a context's `index.ts` exports each Aggregate's list ([docs/agents/authn.md](docs/agents/authn.md)).

**Intake**:
Where new work enters a process: HTTP routes, sockets, Event handlers, Schedules.

**UI**:
The pages a Project serves, outside every bounded context; their loaders and actions call Use cases of any context through its interface. Holds no business logic.
_Avoid_: frontend, web client

**Domain event**:
A fact a bounded context records in past tense (OrderPlaced) and delivers to other contexts once the change that caused it commits. Domain events go through the queue (pg-boss), and nothing else carries them. The schemas a context exports are part of its Published language. Short form: Event.
_Avoid_: queue message, signal

**Published language**:
What a bounded context shares through its interface besides `<context>ContextCreate`: its Domain event schemas, its error types and the input schemas the UI needs.

**Event key**:
The id of the entity a Domain event is about, named at every publish. Domain events with the same Event key reach each Event handler one at a time, in the order their changes committed; ones with different Event keys run beside each other.
_Avoid_: partition key, ordering key, group id

**Event handler**:
An inbound adapter that receives one kind of Domain event and calls a Use case, in `<context>-<event>-handler.ts`. The queue Package's `queueConsumerCreate` keeps its name, because it is the messaging API.
_Avoid_: Consumer, subscriber, event listener

**Outbox**:
Domain events written in the same transaction as the change that caused them and sent once it commits. The queue's publish is the outbox.

**Inbox**:
The record that an Event handler handled a Domain event, written in the same transaction as the work it did, so a repeated delivery of that event is skipped.
_Avoid_: dedupe table, processed events

**Anti-corruption layer**:
A translation inside a downstream bounded context that reads an upstream context through the upstream's interface and turns what it returns into the downstream's own terms, in `adapters/outbound/<context>-<upstream>-acl.ts`. It runs in process: the context's ports name what it reads in its own terms (`<context><Upstream>Acl`), the ACL is their only adapter, and no memory fake stands in for the upstream: tests run the real upstream on memory adapters. Short form: ACL.
_Avoid_: Bridge, integration layer, connector, facade

**Saga**:
A business process across bounded contexts carried by Domain events (choreographed): an Event handler in each context calls a Use case that acts on one Domain event and publishes the next, including the outcome a waiting context needs.
_Avoid_: Outcome Events

**Projection**:
A read model a bounded context builds from Domain events, such as a running total kept from each posted amount.

**Schedule**:
An inbound adapter that calls one Use case on a cron, from the Worker.
_Avoid_: cron job, scheduled task

**Live update**:
A short note to open pages that something they show has changed, so they reload it.
_Avoid_: push notification, real-time event

**Analytics event**:
A record that an actor did something, sent to product analytics (Mixpanel) for funnels and retention. It carries ids and counts only. Unlike a Domain event, nothing in the app handles it, it is sent after commit without blocking the request, and losing one is acceptable.
_Avoid_: tracking event, product event, product metric

**Error report**:
An unexpected error sent to error tracking (Sentry) for triage: its class name, stack frames, cause chain and trace id, never its message. Every error the logger logs at error or fatal becomes one, so code reports an error by logging it.
_Avoid_: crash report, Sentry issue

**Composition root**:
A file that starts one process: it parses config, opens connections, builds each bounded context through `src/contexts.ts` and mounts what each one's interface returns (`src/server.ts`, `src/worker.ts`, `src/migrate.ts`, `src/seed.ts`, `src/blocked-keys.ts`). It imports no adapter (each context's `index.ts` picks its own) and holds no business logic.
_Avoid_: bootstrap, main file, DI container

**Worker**:
The process that runs a Project's Event handlers and Schedules, started from `src/worker.ts`; it never serves pages or the API.
_Avoid_: job runner, background process

**Server**:
The process that serves the API, the UI pages and live updates, started from `src/server.ts`; several run behind a load balancer. It publishes Domain events and subscribes every context's Event handlers, but only the Worker runs them.
_Avoid_: web process, API process

**Seed**:
An inbound adapter that creates example data for local development by calling its bounded context's own Use cases.
_Avoid_: seed fixture, sample data

**Environment**:
A named place a Project's API runs, such as development or production, with one API URL, listed in `clients/environments.json`. A caller of the SDK or the CLI picks one by name instead of passing a URL.
_Avoid_: stage, deploy target

## Baseline

The words for where a Project comes from. They name what baseline is made of, not business terms. Baseline's own root `CONTEXT.md` defines the first four as well, with the same `_Avoid_` lists; `test/glossary-baseline.test.ts` there holds them equal.

**Project**:
An app made from the Template with `pnpm app-create`, in its own repository. It starts with no bounded context and takes newer Template releases by Template upgrade.
_Avoid_: generated repo, child repo, downstream repo, baseline app

**Template**:
The starter app in baseline's `apps/app`, released as `app@<version>`. A Project's `.template.json` names the release it was made from or last upgraded to.
_Avoid_: boilerplate, scaffold, skeleton

**Package**:
One of baseline's `@n8io/baseline-*` npm libraries (queue, authn, cache and the rest), which a Project depends on like any library. A change to one ships as a new version, not through a Template upgrade.
_Avoid_: shared lib, shared module, shared code

**Template upgrade**:
Moving a Project to a newer Template release with `pnpm template-upgrade` ([docs/agents/template-upgrade.md](docs/agents/template-upgrade.md)): a 3-way merge of what changed in the Template since the Project's release into the Project, with each conflict resolved by hand.
_Avoid_: template sync, template update, rebase onto the template, rebase on the template

**Piece**:
An optional slice of the Template a Project can take out whole with `pnpm piece-remove <piece>`: `ui`, `live`, `cache`, `redis`, `queue`, `analytics`, `error-tracking`, `api-reference`, `sdk` or `cli`. Its code is whole files plus lines between `piece-start` and `piece-end` markers; `pnpm piece-check` proves each still comes out, and `.template.json`'s `piecesKept` lists the ones a Project will never remove (`piece-check` skips them) ([docs/agents/pieces.md](docs/agents/pieces.md)).
_Avoid_: add-on, optional module

**Part**:
What `pnpm aggregate-create` adds to a new Aggregate beside its core (the Aggregate root, Use cases, repository, routes): `analytics`, `cache`, `live`, `pages`, `schedule` or `seed`, each a flag; `--bare` adds only the ones named. A part that belongs to a Piece (`pages` to `ui`, `schedule` to `queue`) needs that Piece installed.
