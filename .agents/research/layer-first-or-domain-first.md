# Layer-first or domain-first folders

Research for [#19](https://github.com/n8io/baseline/issues/19), which reopened the layout in [#3](https://github.com/n8io/baseline/issues/3). Date of research: 2026-10-31.

The test from the ticket: which layout lets an AI agent see the pattern at a glance and copy it without mistakes.

## Answer

Keep **domain-first** (`apps/app/src/domains/foo/` with `api/`, `spi/`, `models/`, `rules/`, `use-cases/` inside), as #3 decided.

The user's position was layer-first unless there is a really good reason or it is common practice. Both conditions hold:

- **Common practice.** For an app that holds several business areas, the pattern authors and the well-known reference repos put the business area at the top and the layers inside it. Layer-first shows up in templates whose whole app is one bounded context, so in those repos "the app" is the same thing as one of our Domains.
- **Reason.** A Domain here is "sized like a microservice" (`CONTEXT.md`). In microservice reference repos the layers sit inside each service. Domain-first is that same shape with the service boundary turned into a folder.

## The two layouts

### Domain-first (current, from #3)

```
apps/app/src/
├─ main.ts                         # composition root: picks adapters, calls each fooDomainCreate
└─ domains/
   └─ foo/
      ├─ index.ts                  # fooDomainCreate(ports) → { useCases, routes }; the only import from outside
      ├─ foo-errors.ts
      ├─ ports.ts                  # FooRepository, FooPorts
      ├─ models/foo.ts
      ├─ rules/foo-name-valid.ts   (+ .test.ts)
      ├─ use-cases/foo-create.ts   (+ .test.ts), foo-get, foo-list, foo-update, foo-delete
      ├─ api/foo-routes.ts
      └─ spi/
         ├─ foo-table.ts
         ├─ foo-repository.postgres.ts
         └─ foo-repository.memory.ts
```

### Layer-first (the alternative)

```
apps/app/src/
├─ main.ts
├─ api/
│  └─ foo/foo-routes.ts
├─ core/                           # cannot be called domain/: see "Glossary" below
│  └─ foo/
│     ├─ index.ts
│     ├─ foo-errors.ts
│     ├─ ports.ts
│     ├─ models/foo.ts
│     ├─ rules/foo-name-valid.ts
│     └─ use-cases/foo-create.ts, ...
└─ spi/
   └─ foo/
      ├─ foo-table.ts
      ├─ foo-repository.postgres.ts
      └─ foo-repository.memory.ts
```

## What the sources do

### Pattern authors

- **Alistair Cockburn, [Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/).** Prescribes no folders. It describes "an application on the inside communicating over some number of ports", with "for each external device ... an adapter". The unit is one application with its adapters around it. That matches one Domain with its `api/` and `spi/`, not one `spi/` shared by every application.
- **Robert C. Martin, [Screaming Architecture](https://blog.cleancoder.com/uncle-bob/2011/09/30/Screaming-Architecture.html).** "Your architectures should tell readers about the system, not about the frameworks you used in your system." The top level should show the use cases. Top-level `api/` and `spi/` folders show the technical roles first.
- **Martin Fowler, [PresentationDomainDataLayering](https://martinfowler.com/bliki/PresentationDomainDataLayering.html).** Layering "should only be applied at a relatively small granularity". Top-level layers are "OK for smaller systems, but once any of these layers gets too big" you should "split your top level into domain oriented modules which are internally layered". And: "it's usually not best to use presentation-domain-data as the higher level of modules." This is the most direct primary source on the question, and it favors domain-first.
- **Simon Brown, "The Missing Chapter" (ch. 34 of Martin's *Clean Architecture*, 2017).** Compares package by layer, by feature, ports and adapters, and by component, and argues against horizontal layers as the top-level grouping. (From the book; the O'Reilly page returned 403, so no quote here.)

### Modular monoliths

- **Kamil Grzybek, [modular-monolith-with-ddd](https://github.com/kgrzybek/modular-monolith-with-ddd).** Each module "consists of the following submodules": Application, Domain, Infrastructure, IntegrationEvents. Module first, layers inside. "Modules can only have a dependency on the integration events assembly of other Module", checked by architecture tests.
- **[Spring Modulith](https://docs.spring.io/spring-modulith/reference/fundamentals.html).** "Each direct sub-package of the main package is considered an application module package." Sub-packages of a module are internal by default, and a module can expose an `spi` package as a named interface. The tool's module boundary is the top-level business folder.

### TypeScript and Node reference repos

Domain-first:

- **[goldbergyoni/nodebestpractices](https://github.com/goldbergyoni/nodebestpractices/blob/master/sections/projectstructre/breakintcomponents.md)** (practice 1.1). "Assign a folder or repository in your system root for each business component and make it self-contained." Its good example is `apps/orders/{api, domain, data-access}`. It labels grouping by technical role (controllers, services, models) as "Bad".
- **[Sairyss/domain-driven-hexagon](https://github.com/Sairyss/domain-driven-hexagon)** (hexagonal + DDD in TypeScript). `src/modules/user/{commands, queries, domain, database}`, shared code in `src/libs`.
- **[stemmlerjs/ddd-forum](https://github.com/stemmlerjs/ddd-forum)** (Khalil Stemmler). `src/modules/{forum,users}/{domain, useCases, repos, infra, mappers, dtos}`.
- **[alan2207/bulletproof-react](https://github.com/alan2207/bulletproof-react)** (36k stars, frontend). `src/features/{comments,users,...}/{api, components}`.
- **[Feature-Sliced Design](https://feature-sliced.design/docs/get-started/overview)** (frontend). Its top level is layers, but those are levels of business composition (`pages`, `features`, `entities`), not technical roles. The technical split (`ui`, `api`, `model` segments) sits inside each business slice. "Slices cannot use other slices on the same layer."

Layer-first:

- **[santiq/bulletproof-nodejs](https://github.com/santiq/bulletproof-nodejs)**: `src/{api, services, models, loaders, subscribers}`. Last pushed 2024-06.
- **[jbuget/nodejs-clean-architecture-app](https://github.com/jbuget/nodejs-clean-architecture-app)**: `lib/{domain, application, infrastructure, interfaces}`. Last pushed 2023-01.
- **[jasontaylordev/CleanArchitecture](https://github.com/jasontaylordev/CleanArchitecture)** (.NET, 20k stars) and **[ardalis/CleanArchitecture](https://github.com/ardalis/CleanArchitecture)** (.NET, 18k stars): projects `Domain`, `Application`/`UseCases`, `Infrastructure`, `Web`. Two things to note. Each is a template for **one** service. And inside the layers they group by feature again (`Application/TodoItems/Commands`, `UseCases/Contributors`, `Web/Contributors`), so a feature is still split across layer folders.

Microservices:

- **[dotnet/eShop](https://github.com/dotnet/eShop)** (Microsoft's reference app). `src/Ordering.API`, `src/Ordering.Domain`, `src/Ordering.Infrastructure`, `src/Basket.API`, `src/Catalog.API`. Layers live inside each service and the service name comes first. Our Domain is sized like one of these services.

**Summary of the evidence.** Layer-first is common, but only where the whole codebase is one business area. Once a codebase holds several business areas, every source above puts the business area first. The baseline app holds several Domains by design.

## dependency-cruiser rules each layout needs

dependency-cruiser checks resolved paths with regexes, and `$1` in a `to.path` or `to.pathNot` refers to a group captured by `from.path` ([rules reference, "group matching"](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md)). Its own docs show "no relations between business components" as one rule over `^src/business-components/([^/]+)/`. The toolchain research for #7 tested this capture-group rule on dependency-cruiser 18.7.0.

### Domain-first

```js
const D = "^apps/app/src/domains/";

module.exports = {
  forbidden: [
    {
      name: "domain-not-cross-domain",
      severity: "error",
      from: { path: `${D}([^/]+)/` },
      to: { path: D, pathNot: `${D}$1/` },
    },
    {
      name: "domain-only-via-index",
      severity: "error",
      from: { pathNot: D },
      to: { path: `${D}[^/]+/`, pathNot: `${D}[^/]+/index\\.ts$` },
    },
    {
      name: "core-not-adapters",
      comment: "models, rules, use cases and root files (except index.ts) never import api/ or spi/",
      severity: "error",
      from: { path: `${D}[^/]+/(models|rules|use-cases)/|${D}[^/]+/(?!index\\.ts$)[^/]+\\.ts$` },
      to: { path: `${D}[^/]+/(api|spi)/` },
    },
    {
      name: "rule-only-models",
      severity: "error",
      from: { path: `${D}([^/]+)/rules/` },
      to: { path: `${D}$1/`, pathNot: `${D}$1/(models|rules)/` },
    },
    {
      name: "api-not-spi",
      severity: "error",
      from: { path: `${D}([^/]+)/api/` },
      to: { path: `${D}$1/spi/` },
    },
    {
      name: "spi-only-ports-models",
      severity: "error",
      from: { path: `${D}([^/]+)/spi/` },
      to: { path: `${D}$1/`, pathNot: `${D}$1/(ports\\.ts|models/|spi/)` },
    },
  ],
};
```

### Layer-first

```js
const S = "^apps/app/src/";

module.exports = {
  forbidden: [
    {
      name: "domain-not-cross-domain",
      comment: "the entity name is the second segment in every layer",
      severity: "error",
      from: { path: `${S}(api|core|spi)/([^/]+)/` },
      to: { path: `${S}(api|core|spi)/`, pathNot: `${S}(api|core|spi)/$2/` },
    },
    {
      name: "core-not-adapters",
      severity: "error",
      from: { path: `${S}core/` },
      to: { path: `${S}(api|spi)/` },
    },
    {
      name: "rule-only-models",
      severity: "error",
      from: { path: `${S}core/([^/]+)/rules/` },
      to: { path: `${S}core/$1/`, pathNot: `${S}core/$1/(models|rules)/` },
    },
    { name: "api-not-spi", severity: "error", from: { path: `${S}api/` }, to: { path: `${S}spi/` } },
    {
      name: "spi-only-ports-models",
      severity: "error",
      from: { path: `${S}spi/([^/]+)/` },
      to: { path: `${S}core/`, pathNot: `${S}core/$1/(ports\\.ts|models/)` },
    },
  ],
};
```

Neither sketch has been run; both use only features the docs describe. Check the lookahead in `core-not-adapters` when the config is built.

### How they compare

- **Layer rules** are a little shorter in layer-first (`^src/spi/` → `^src/api/` needs no capture group). In domain-first each layer rule carries the `([^/]+)` capture. Both are one rule per boundary.
- **No cross-domain imports** is one rule in both.
- **Public surface of a domain** is the real difference. Domain-first has one entry (`domains/foo/index.ts`) and one rule enforces it. Layer-first has no single public surface: the composition root has to reach into `api/foo/`, `core/foo/` and `spi/foo/`, so "only through the index" has no clean equivalent.
- **Missing pieces.** Neither layout lets dependency-cruiser catch a domain that is missing a folder (it checks imports, not which folders exist). In layer-first, forgetting `spi/bar/` breaks no import rule. In domain-first, a missing `domains/bar/spi/` is visible next to `domains/foo/spi/` in one listing.

## How each layout scores on the ticket's points

| | Domain-first | Layer-first |
| --- | --- | --- |
| Folders an agent opens to add one operation (`fooArchive`: use case, rule, route, maybe a repository method) | One: `domains/foo/` | Three: `api/foo/`, `core/foo/`, `spi/foo/` |
| Adding a new domain `bar` | Copy one folder, rename `foo` → `bar` | Copy three folders; forgetting one fails no rule |
| What `ls src/` tells an agent | The business areas (Screaming Architecture) | The technical roles; the domains are one level down, three times |
| Splitting a domain out into its own service later | Move one folder; its imports already stop at the folder edge | Collect three folders and rebuild the boundary |
| Glossary fit | `domains/foo/` is exactly one Domain | A top-level `domain/` folder would hold only part of a Domain (no API, no SPI), which contradicts `CONTEXT.md`. Needs another name such as `core/`, plus a new glossary term |
| Matches | Fowler, Martin, nodebestpractices, Sairyss, Stemmler, Grzybek, Spring Modulith, eShop (per service) | Single-service templates (Taylor, Ardalis, bulletproof-nodejs, jbuget) |

## Recommendation

Domain-first, unchanged from #3.

To make the pattern harder still to get wrong for agents, both of which belong to other tickets (CI, template upgrades):

- Keep `domains/foo/` as a complete, tested example that is the thing to copy.
- Add a generator (for example `turbo gen domain bar`, Turborepo's Plop-based generator) that stamps out every folder. Then "add a domain" is one command, not a copy-and-rename.
- Add a small structure test that fails when a folder under `domains/` lacks `index.ts`, `ports.ts`, `models/`, `use-cases/`, `api/` or `spi/`, or has a folder outside that list. dependency-cruiser cannot check this.

## The strongest case for layer-first

- **The layer is the first thing anyone sees.** `src/api`, `src/core`, `src/spi` at the top tell an agent "this is hexagonal" before it opens anything. With domain-first, an agent that opens `domains/foo/use-cases/foo-create.ts` alone may not notice the `api/`/`spi/` split next to it.
- **Work tends to be per layer.** "Add rate limiting to every route", "swap Postgres for SQLite in every repository" and "add OpenTelemetry spans to every adapter" each touch one layer across all domains. Layer-first keeps those changes in one folder.
- **Popularity, and so training data.** The two most-starred clean-architecture templates (Taylor, 20k; Ardalis, 18k) are layer-first, so agents have seen that shape a lot.
- **Shorter layer rules.** The layer rules need no capture groups.

Why it does not win here. The per-layer changes in the second point are cross-cutting concerns. In this stack they live in shared packages and middleware (OTel, the `database` adapter package, Hono middleware), not in each domain's folders. Both popular templates are one service each, and inside one of our Domains they are the same shape as domain-first. And the glossary already defines Domain as the bundle that includes its API and SPI, so a top-level `domain/` folder would hold only part of it.
