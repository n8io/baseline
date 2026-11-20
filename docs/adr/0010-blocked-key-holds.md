# A failed Event holds its Event key; no skip setting

Status: accepted, 2026-11-17

An Event that fails all five attempts could either hold the later Events of its Event key until someone releases it, or be skipped so they run on. Of 22 queue and stream defaults read from their own docs, 11 hold (pg-boss's `key_strict_fifo` among them), 10 skip and 1 does neither; the docs that offer a skip switch warn that order breaks. Nate chose the hold as the only behaviour: no skip setting per Event handler, no skip default, and a schema failure stays retryable so a retry can land on a newer Worker. A blocked key is made loud instead (an error log, gauges, `queue.blockedKeys()`), released by hand with `queue.blockedKeyRetry` or `queue.blockedKeyGiveUp`, and deleted after 7 days ([events.md](../../apps/app/docs/agents/events.md)).
