# Baseline

A starter template for new projects: shared packages that combine into one app, which can run as a backend, a frontend, or both.

## Language

**Domain**:
One business entity and the operations on it, sized like a microservice. Every domain has the same layout.
_Avoid_: Module, feature, service

**Model**:
A business object a domain defines in its `models/` folder, as a Zod schema and the type inferred from it. A domain has one main model and may have supporting ones.
_Avoid_: Schema, DTO

**Use case**:
One operation a domain performs, such as creating a foo (`fooCreate`). A use case loads what it needs through ports and applies the domain's rules. Each gets its ports from a factory: `fooCreate(ports)` returns the function.
_Avoid_: Service, handler, interactor

**Rule**:
One business rule a domain enforces, defined in its `rules/` folder as a pure function over models. Use cases apply rules; the API and the SPI never do.
_Avoid_: Policy, validator, business role

**API**:
The layer of inbound adapters that receive requests from outside a domain (HTTP routes, message consumers, gRPC) and call its use cases. It holds no business rules.
_Avoid_: HTTP layer, routes, controllers, transport

**Port**:
An interface a domain declares for something it needs from outside itself, such as saving or caching an entity.
_Avoid_: Contract, gateway

**SPI**:
The layer of adapters that implement ports with real technology. It holds no business rules. Domain code depends on ports, never on the SPI.
_Avoid_: Infrastructure, providers, drivers
