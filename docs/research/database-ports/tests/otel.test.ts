// Q4: do Drizzle's queries on the checked-out client produce pg spans under the request's span?
import assert from "node:assert/strict";
import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";
import { check, failureCount } from "./harness.ts";

const exporter = new InMemorySpanExporter();
const provider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] });
context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
trace.setGlobalTracerProvider(provider);
registerInstrumentations({ instrumentations: [new PgInstrumentation()] });

// Load pg only after the instrumentation is registered.
const { pgPoolCreate, schemaReset } = await import("./db.ts");
const { fooTransactionPostgres, fooReadRepositoryPostgres } = await import("../foo/spi/foo-repository.postgres.ts");
const { fooCreate } = await import("../foo/use-cases/foo-create.ts");

await check("[4] every pg span of fooCreate (Drizzle on the checked-out client) sits in its own request's trace, 10 requests on a pool of 1", async () => {
  const pgPool = pgPoolCreate({ max: 1 });
  await schemaReset(pgPool);
  exporter.reset();
  const create = fooCreate({ fooTransaction: fooTransactionPostgres(pgPool) });
  const read = fooReadRepositoryPostgres(pgPool);
  const tracer = trace.getTracer("test");
  const requests = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      tracer.startActiveSpan(`POST /foos ${i}`, async (span) => {
        const result = await create({ name: `otel-${i}`, tags: ["a"] });
        const found = await read.findByName(`otel-${i}`); // pool read, same request
        span.end();
        assert.equal(result.ok, true);
        assert.equal(found?.name, `otel-${i}`);
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
    assert.ok(names.includes("pg-pool.connect"), names.join(","));
    for (const s of mine) {
      let parent = s.parentSpanContext?.spanId;
      while (parent && parent !== request.spanId) parent = byId.get(parent)?.parentSpanContext?.spanId;
      assert.equal(parent, request.spanId, `${s.name} not under its request`);
    }
    if (request === requests[0]) {
      console.log(`  span names for one request: ${names.join(" | ")}`);
      const insert = mine.find((s) => s.name.startsWith("pg.query:INSERT"));
      console.log(`  insert span attributes: ${JSON.stringify(insert?.attributes)}`);
    }
    assert.equal(mine.filter((s) => s.name.startsWith("pg.query:INSERT")).length, 2, "one insert per table");
  }
  const orphans = pgSpans.filter((s) => !requests.some((r) => r.traceId === s.spanContext().traceId));
  assert.equal(orphans.length, 0, "pg span in another trace");
  console.log(`  pg spans total ${pgSpans.length}, in a trace other than a request's: ${orphans.length}`);
});
process.exitCode = failureCount() > 0 ? 1 : 0;
