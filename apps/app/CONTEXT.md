# A starter app that shows every pattern a project made from baseline uses.

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
A fact a domain records in past tense (OrderPlaced), saved with the change that caused it and delivered to other domains.
_Avoid_: message, signal, notification

**Consumer**:
An inbound adapter in a domain's API that receives one kind of event and calls a use case.
_Avoid_: subscriber, listener, handler

**Bridge**:
An adapter outside every domain that fills one domain's read port by calling another domain's use case.
_Avoid_: integration, connector, facade

**Schedule**:
An inbound adapter in a domain's API that calls one use case on a timer.
_Avoid_: cron job, timer, task

**Live update**:
A short note to open pages that something they show has changed, so they reload it.
_Avoid_: push, notification, real-time event

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
