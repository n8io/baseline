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

## Production codebases (added 2026-10-31)

The sources above are mostly pattern authors and teaching repos. This section checks large codebases that run in production. Repo trees were read on 2026-10-31 through the GitHub and GitLab APIs, from each default branch.

Two questions for each: is the top level split by business area or by technical layer? And do the inbound adapters (HTTP, GraphQL) and outbound adapters (database) sit inside the business module or outside it?

### Shopify core (Rails monolith, private repo)

Source: Shopify Engineering blog. The repo is private, so I could not check the tree.

- **Before: layer-first.** "our code was organized like a typical Rails application: by software concepts (models, views, controllers)." ([Kirsten Westeinde, "Deconstructing the Monolith", 2019-02-21](https://shopify.engineering/deconstructing-monolith-designing-software-maximizes-developer-productivity))
- **Move to domain-first.** "The goal was to re-organize it by real-world concepts (like orders, shipping, inventory, and billing), in an attempt to make it easier to locate code, locate people who understand the code, and understand the individual pieces on their own. Each component would be structured as its own mini rails app." (same post)
- **Result.** "We defined components as implementations of subdomains of the domain of commerce, and moved the files into corresponding folders." "We currently have 37 components in our main monolith." Components "evolved to look more and more like Rails Engines", and new Rails apps would be generated as "multiple separately tested engines out of the box ... removing the top level app folder". ([Philip Müller, "Under Deconstruction", 2020-09-16](https://shopify.engineering/shopify-monolith)) The Packwerk post shows paths like `components/online_store`. ([Enforcing Modularity in Rails Apps with Packwerk](https://shopify.engineering/enforcing-modularity-rails-apps-packwerk))
- **Adapters: inside.** A component is a "mini rails app", so its controllers and models live in it.
- **Later lesson (important).** "we quickly discovered that domains and the boundaries between them do not reflect the way Shopify's code actually functions in practice." Packwerk "generated monstrously large todo files for every component". Their fix: "use components as top-level organizational tools for grouping one or more packages ... teams can still own domains, while individual packages act as the truly modular code units." Privacy checks "were removed from Packwerk with the release of version 3.0." ([Gannon McGibbon, "A Packwerk Retrospective", 2024-02-07](https://shopify.engineering/a-packwerk-retrospective)) They kept business areas at the top. What failed was treating a whole business area as one sealed unit.

### GitLab (Rails monolith, gitlab-org/gitlab)

Sources: the repo, the development docs, and the handbook design documents.

- **Today: layer-first at the top, business area as a namespace inside each layer.** [`app/`](https://gitlab.com/gitlab-org/gitlab/-/tree/master/app) holds `controllers graphql models services workers ...`. Inside them, `app/models/ci/` and `app/services/ci/` group CI code.
- **Rule.** "We should expect any class to be defined inside a module/namespace that represents the contexts where it operates." Allowed namespaces are listed in [`config/bounded_contexts.yml`](https://gitlab.com/gitlab-org/gitlab/-/blob/master/config/bounded_contexts.yml) and enforced by a RuboCop cop. ([Software design guides](https://docs.gitlab.com/development/software_design/#bounded-contexts)) The YAML header says: "Application layer (controllers, REST endpoints) and view layer are exempt".
- **Direction: move business areas into their own folders.** The design document says: "Extract cohesive functional domains into separate directory structure using Domain-Driven Design practices." Its example tree is `domains/ci/{package.yml, core/app/{models,services,lib}, ee/..., public/...}`. ([Hexagonal Rails Monolith](https://handbook.gitlab.com/handbook/engineering/architecture/design-documents/modular_monolith/hexagonal_monolith/), last modified 2026-06-15)
- **It has started.** The repo now has a top-level [`domains/`](https://gitlab.com/gitlab-org/gitlab/-/tree/master/domains) folder. Its README: "This directory holds bounded-context domains extracted from the monolith. Each domain lives in `domains/<name>/`." "A domain mirrors the top-level repo layout: `app/`, `lib/` and `spec/`." Sidekiq workers in `domains/*/app/workers` are picked up. On 2026-10-31 the folder holds only the README; no domain has moved in yet.
- **Adapters: outside, on purpose (for now).** "We start by focusing on the application domain (backend business logic) leaving the application adapters (Web controllers and views, REST/GraphQL endpoints) outside the scope of the modularization initially." Reasons given: "Code in application adapters may not always align with a specific domain. For example: a project settings endpoint or a merge request page contains references to many domains", and they want to boot Sidekiq-only nodes without the web stack. "The decision to scope out application adapters is not final." ([ADR 001](https://handbook.gitlab.com/handbook/engineering/architecture/design-documents/modular_monolith/decisions/001_modular_application_domain/))
- **Adapters later: split per domain too.** The transport-layer page plans four horizontal adapters (Web, REST, GraphQL, Sidekiq). "Once domains are isolated ... each horizontal adapter could be split per domain: `ci-api`, `ci-graphql`, `packages-api` ..." "Each per-domain adapter depends on its domain in the domain layer for business logic." ([Decomposing the transport layer into adapters](https://handbook.gitlab.com/handbook/engineering/architecture/design-documents/modular_monolith/transport_layer/))

### Medusa v2 (medusajs/medusa, TypeScript)

- **v1: layer-first.** At tag `v1.20.0`, [`packages/medusa/src`](https://github.com/medusajs/medusa/tree/v1.20.0/packages/medusa/src) has `api controllers models repositories services strategies subscribers ...`, with 71 files in `services/`.
- **v2: one package per business area for data and services.** [`packages/modules/`](https://github.com/medusajs/medusa/tree/develop/packages/modules) holds `cart customer fulfillment inventory order payment pricing product promotion region tax user ...` (plus provider modules such as `cache-redis`). Each module has its own data layer: `packages/modules/product/src/{migrations, models, repositories, services, ...}`.
- **Adapters: HTTP outside, DB inside.** HTTP routes stay in one layer folder, grouped by resource inside it: [`packages/medusa/src/api/admin/products`](https://github.com/medusajs/medusa/tree/develop/packages/medusa/src/api/admin/products), `api/store/carts`. Cross-module logic lives in a third layer, [`packages/core/core-flows/src/{cart,order,product,...}`](https://github.com/medusajs/medusa/tree/develop/packages/core/core-flows/src). So the top of `packages/` is by layer (api, workflows, modules), and each layer is split by business area inside.
- **Why they moved.** "In Medusa 1.0, services, e.g., Product and Cart, held most cross-domain business logic, and relationships between data models were defined via foreign keys in the database. The Cart service strictly depended on the Product service." In 2.0 modules "only manage resources within their domain. All cross-domain functionality has been moved to extensible workflows", and foreign keys between modules were removed. ([Medusa 2.0 release, 2024-10-23](https://medusajs.com/blog/v2-release/)) Earlier: "We are moving services into standalone packages like `@medusajs/product` and `@medusajs/pricing` ... These modules work independently of the rest of Medusa." ([Toward Medusa 2.0, 2023-11-22](https://medusajs.com/blog/toward-medusa-2/)) Docs: "Modules can't access resources, such as services or data models, from other modules." ([Module isolation](https://docs.medusajs.com/learn/fundamentals/modules/isolation))

### Cal.com (calcom/cal.diy, TypeScript, 49k stars)

The repo `calcom/cal.com` now redirects to `calcom/cal.diy`.

- **Domain-first, stated as policy.** "We are transitioning to a strict architectural model based on Vertical Slice Architecture and Domain-Driven Design (DDD)." "Our codebase is organized by domain, not by technical layer. The `packages/features` directory is the heart of this architectural approach." ([Keith Williams, "Engineering in 2026 and beyond", 2025-10-14](https://cal.com/blog/engineering-in-2026-and-beyond)) The same text is in the repo's agent rules: [`agents/rules/architecture-vertical-slices.md`](https://github.com/calcom/cal.diy/blob/main/agents/rules/architecture-vertical-slices.md).
- **Why.** Layered code means "Changes to one feature require touching files scattered across multiple directories", "it's hard to understand what a feature does because its code is fragmented", and "Teams step on each other's toes". (same post)
- **It is a migration in progress.** "New features start as vertical slices." The post gives no plan for moving old code.
- **Tree.** [`packages/features/`](https://github.com/calcom/cal.diy/tree/main/packages/features) has about 60 folders (`bookings availability eventtypes schedules webhooks ...`). `packages/features/bookings/` has `repositories/ services/ di/ components/ hooks/ lib/`.
- **Adapters: DB inside, HTTP outside.** Repositories live in each feature ([`data-repository-pattern.md`](https://github.com/calcom/cal.diy/blob/main/agents/rules/data-repository-pattern.md): "Repositories are the only code that knows about Prisma"). HTTP sits in separate packages, grouped by feature inside: tRPC routers in `packages/trpc/server/routers/viewer/{bookings,slots,...}` and NestJS controllers in `apps/api/v2/src/modules/{event-types,slots,...}`. [`architecture-features-modules.md`](https://github.com/calcom/cal.diy/blob/main/agents/rules/architecture-features-modules.md): "Files in `packages/features/**` should NOT import from `@calcom/trpc`", so that features "can be used by other apps (like `apps/api/v2`)". The reason the HTTP layer is outside is that two apps (web and API v2) share one feature package.

### n8n (n8n-io/n8n, TypeScript, 209k stars)

- **Legacy: layer-first.** `packages/cli/src/controllers/` (37 files) and `packages/cli/src/services/` (56 files) still hold much of the backend.
- **New code: backend modules.** [`packages/cli/src/modules/`](https://github.com/n8n-io/n8n/tree/master/packages/cli/src/modules) has 40+ folders (`data-table favorites sso-saml source-control.ee ...`). The [backend module guide](https://github.com/n8n-io/n8n/blob/master/scripts/backend-module/backend-module-guide.md): "A backend module is a self-contained unit of backend functionality tied to a specific n8n feature." Reasons listed: "Keep code structured, focused and discoverable", "Reduce conflicts among teams working independently", "Prevent features from becoming entangled with internals", "Load and run only modules that are explicitly enabled". The root `AGENTS.md` tells contributors to implement backend logic in a module following that guide.
- **Adapters: inside.** The template is `my-feature.entity.ts # DB model`, `my-feature.repository.ts # DB access`, `my-feature.controller.ts # HTTP REST routes`, `my-feature.service.ts # business logic`, `my-feature.module.ts # entrypoint`. Example: `modules/data-table/` holds `data-table.controller.ts`, `data-table.repository.ts`, `data-table.entity.ts`.
- **Still moving.** Open PRs add a lint rule that blocks undeclared module-to-module imports and any core-to-module import ([#35914](https://github.com/n8n-io/n8n/pull/35914)), and move modules into their own workspace packages under `packages/modules/<name>/backend` ([#42431](https://github.com/n8n-io/n8n/pull/42431), part of a "Backend Modularization" project). Neither was merged on 2026-10-31.

### Twenty (twentyhq/twenty, TypeScript CRM, 60k stars)

- **Domain-first, in two groups.** [`packages/twenty-server/src/`](https://github.com/twentyhq/twenty/tree/main/packages/twenty-server/src) has `engine/` (the platform) and `modules/` (CRM business areas: `company person opportunity messaging calendar workflow ...`). `engine/core-modules/` is also split by area (`auth billing file workspace ...`).
- **Adapters: inside.** `engine/core-modules/billing/` holds `billing.resolver.ts` (GraphQL), `billing.module.ts`, `services/`, `entities/`, `jobs/`, `stripe/`. `modules/messaging/message-import-manager/drivers/` holds `gmail/ imap/ microsoft/ smtp/`, the outbound adapters for that feature.
- **Frontend: same idea.** "Each module represents a feature or a group of feature, comprising its specific components, states, and operational logic." Reason: "it's easier to find the files related to specific features." ([frontend folder architecture doc](https://github.com/twentyhq/twenty/blob/main/packages/twenty-docs/developers/contribute/capabilities/frontend-development/folder-architecture-front.mdx)) The matching backend doc is out of date (it lists folders that no longer exist), so I relied on the tree.

### Backstage (backstage/backstage, TypeScript, Spotify)

- **Domain-first, one package per plugin.** 161 folders under [`plugins/`](https://github.com/backstage/backstage/tree/master/plugins) (`catalog-backend scaffolder-backend search-backend ...`).
- **Adapters: inside.** `plugins/catalog-backend/src/` holds `service/createRouter.ts` (HTTP), `database/` (`DefaultCatalogDatabase.ts`, `migrations.ts`, `tables.ts`), and its own business folders (`processing ingestion stitching`).
- **Stated reason.** "Each plugin operates completely independently of all other plugins and they only communicate with each other through network calls. ... each plugin can be considered a separate microservice." ([Backend plugins doc](https://github.com/backstage/backstage/blob/master/docs/backend-system/architecture/04-plugins.md))

### Counter-evidence: production codebases that are layer-first

- **Immich (immich-app/immich, TypeScript/NestJS, 118k stars) moved the other way.** Up to `v1.98.0`, [`server/src`](https://github.com/immich-app/immich/tree/v1.98.0/server/src) was `immich/` (controllers), `domain/<feature>/` (`album/`, `asset/`, `person/` ... each with service and DTOs) and `infra/` (repositories, entities). In March 2024 a series of PRs flattened it to pure layers: [`server/src`](https://github.com/immich-app/immich/tree/main/server/src) is now `controllers services repositories dtos schema ...` (84, 104, 66 and 56 files). The PRs are [#8119 "move controllers and middleware"](https://github.com/immich-app/immich/pull/8119), [#8131 "move dtos"](https://github.com/immich-app/immich/pull/8131), [#8133 "move services"](https://github.com/immich-app/immich/pull/8133), [#8138 "infra folder"](https://github.com/immich-app/immich/pull/8138). The PR bodies are empty, and I found no written reason. Their [architecture doc](https://github.com/immich-app/immich/blob/main/docs/docs/developer/architecture.mdx) says the server "loosely follows the Hexagonal Architecture. Specifically, we aim to separate technology specific implementations (`src/repositories`) from core business logic (`src/services`)." Note that the old layout already had adapters outside the feature folders; the move removed the feature folders inside the core.
- **Mattermost (mattermost/mattermost, Go, 39k stars).** `server/channels/` is `api4/ app/ store/ web/ wsapi/ jobs/`. `api4/` has 185 files across all features. The store doc explains one benefit of the layer split: the store is wrapped by generated decorator layers (timer, retry, local cache, search) over the whole SQL store ([`store/doc.go`](https://github.com/mattermost/mattermost/blob/master/server/channels/store/doc.go)). That is a cross-cutting concern applied to every entity at once. I found no document that argues for layer-first as such.
- **GitLab today** (above) is layer-first at the top, but its own design documents call that a problem to fix.
- **Rails defaults.** Shopify and GitLab both started layer-first because that is the Rails default, not because they chose it.

### What this shows

1. **Business area first is where large codebases end up.** Shopify, GitLab, Medusa, Cal.com and n8n each started layer-first and are moving, or have moved, to business-area folders. Their reasons are the same: hard to find code, teams in each other's way, and coupling between areas that nobody can see. Twenty and Backstage were built that way. Immich is the one move in the other direction, with no stated reason.
2. **Outbound adapters (DB) sit inside the business module in every domain-first example.** Shopify, GitLab's planned `domains/`, Medusa, Cal.com, n8n, Twenty and Backstage all keep the data layer with the business area.
3. **Inbound adapters (HTTP) are split.** Inside the module: Shopify, n8n, Twenty, Backstage. Outside, in a layer folder split by business area inside it: GitLab, Medusa, Cal.com. The stated reasons for keeping them outside are that one page or endpoint touches many areas (GitLab), that several apps share one business package (Cal.com), and that they want to boot a worker without the HTTP stack (GitLab). GitLab still plans to split adapters per domain later.
4. **Shopify's warning.** A whole business area can be too big to be one sealed unit. They now treat the business area as the top-level grouping and seal smaller packages inside it.

For baseline: this supports domain-first for `models/`, `rules/`, `use-cases/`, `ports.ts` and `spi/`. It is mixed on keeping `api/` inside each Domain. That choice holds while one app serves each Domain's routes and a route maps to one Domain. If a later app (a second API, a worker-only process) needs a Domain without its routes, the GitLab and Cal.com pattern is the one to look at.

What I could not check: the Shopify core tree (private repo), and any written reason for the Immich change.
