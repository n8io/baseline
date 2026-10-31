# Baseline

A starter template for new projects: shared packages that combine into one app, which can run as a backend, a frontend, or both.

## Language

**Domain**:
One business entity and the operations on it, sized like a microservice. Every domain has the same layout.
_Avoid_: Module, feature, service

**Port**:
An interface a domain declares for something it needs from outside itself, such as saving or caching an entity.
_Avoid_: Contract, gateway

**SPI**:
The layer of adapters that implement ports with real technology. Domain code depends on ports, never on the SPI.
_Avoid_: Infrastructure, providers, drivers
