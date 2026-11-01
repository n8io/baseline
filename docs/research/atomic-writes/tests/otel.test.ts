// Do pg spans stay under the request's span when work goes through fooTransaction?
import assert from "node:assert/strict";
import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";
import { check } from "./harness.ts";

const exporter = new InMemorySpanExporter();
const provider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] });
context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
trace.setGlobalTracerProvider(provider);
registerInstrumentations({ instrumentations: [new PgInstrumentation()] });

// Load pg only after the instrumentation is registered.
const { pgPoolCreate, schemaReset } = await import("./db.ts");
const { fooTransactionPostgres } = await import("../foo/spi/foo-repository.postgres.ts");
const { fooCreate } = await import("../foo/use-cases/foo-create.ts");

await check("[otel] every pg span of fooCreate sits in its own request's trace, 10 requests on a pool of 1", async () => {
  const pgPool = pgPoolCreate({ max: 1 });
  await schemaReset(pgPool);
  exporter.reset();
  const create = fooCreate({ fooTransaction: fooTransactionPostgres(pgPool) });
  const tracer = trace.getTracer("test");
  const requests = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      tracer.startActiveSpan(`POST /foos ${i}`, async (span) => {
        const result = await create({ name: `otel-${i}`, tags: ["a"] });
        span.end();
        assert.equal(result.ok, true);
        return { traceId: span.spanContext().traceId, spanId: span.spanContext().spanId };
      }),
    ),
  );
  await pgPool.end();
  const spans = exporter.getFinishedSpans();
  const pgSpans = spans.filter((s) => s.instrumentationScope.name.includes("pg"));
  const byId = new Map(spans.map((s) => [s.spanContext().spanId, s]));
  for (const request of requests) {
    const mine = pgSpans.filter((s) => s.spanContext().traceId === request.traceId);
    const names = mine.map((s) => s.name);
    // Each request must own its pool connect, BEGIN, two selects/inserts and COMMIT.
    assert.ok(names.includes("pg-pool.connect"), names.join(","));
    for (const s of mine) {
      let parent = s.parentSpanContext?.spanId;
      while (parent && parent !== request.spanId) parent = byId.get(parent)?.parentSpanContext?.spanId;
      assert.equal(parent, request.spanId, `${s.name} not under its request`);
    }
    if (request === requests[0]) console.log(`  span names for one request: ${names.join(" | ")}`);
  }
  const orphans = pgSpans.filter((s) => !requests.some((r) => r.traceId === s.spanContext().traceId));
    assert.ok(orphans.every((s) => !s.parentSpanContext), "pg span with a foreign parent");
  console.log(`  pg spans total ${pgSpans.length}, outside any request ${orphans.length}`);
});

import { failureCount as fooFailureCount } from "./harness.ts";
process.exitCode = fooFailureCount() > 0 ? 1 : 0;
