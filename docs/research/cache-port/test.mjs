// Usage: CLIENT=redis|ioredis node --import ./register.mjs test.mjs
import { NodeSDK } from '@opentelemetry/sdk-node';
import { RedisInstrumentation } from '@opentelemetry/instrumentation-redis';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { trace } from '@opentelemetry/api';

const which = process.env.CLIENT ?? 'redis';
const finished = [];
const collector = { onStart() {}, onEnd: (s) => finished.push(s), forceFlush: async () => {}, shutdown: async () => {} };
const exporter = { getFinishedSpans: () => finished };
const sdk = new NodeSDK({
  spanProcessors: [collector],
  instrumentations: [which === 'redis' ? new RedisInstrumentation() : new IORedisInstrumentation()],
});
sdk.start();

const url = 'redis://localhost:56380';
let client, close;
if (which === 'redis') {
  const { createClient } = await import('redis');
  client = await createClient({ url }).connect();
  close = () => client.close();
} else {
  const { Redis } = await import('ioredis');
  client = new Redis(url);
  close = () => client.quit();
}
const tracer = trace.getTracer('test');
await tracer.startActiveSpan('parent', async (span) => {
  await client.set('foo:1', JSON.stringify({ id: 1 }), which === 'redis' ? { EX: 5 } : 'EX', ...(which === 'redis' ? [] : [5]));
  console.log('get =', await client.get('foo:1'));
  await client.del('foo:1');
  span.end();
});
await close();
const spans = exporter.getFinishedSpans();
const parent = spans.find((s) => s.name === 'parent');
for (const s of spans) {
  console.log(s.name.padEnd(10), 'child-of-parent:', s.parentSpanContext?.spanId === parent.spanContext().spanId, JSON.stringify({ sys: s.attributes['db.system.name'] ?? s.attributes['db.system'], op: s.attributes['db.operation.name'] ?? s.attributes['db.statement'] }));
}
console.log('redis/ioredis spans:', spans.length - 1);
await sdk.shutdown();
