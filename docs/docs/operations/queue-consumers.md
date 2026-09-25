---
title: Queue Consumers & Background Processing
---

# Queue Consumers & Background Processing

Asynchronous work on the B2B Platform — bulk edits, search re-indexing,
webhook delivery — runs through durable, Redis-backed queues consumed by
**workers**. This page explains how to run those consumers and how the
platform's current queue-backed operations behave.

The design follows the platform's **scalable queue consumer** rule. The
binding invariant is:

- the queue is a **durable, distributed substrate** (Redis / BullMQ-class), not
  an in-memory list bound to one process;
- every job is **claimed atomically** so that `N ≥ 2` consumer instances never
  double-process a job, and handlers are **idempotent** under retries;
- the component that enqueues (an HTTP handler, an event subscriber, a
  scheduler) is the **producer** — it only enqueues and returns, never
  inline-executing the job on the request path;
- the consumer is a **separable worker entrypoint** — a process that can be
  started on its own and scaled to multiple instances *without code changes*.

## Running the consumers

Workers and the API share one composition (the same module wiring), so the
consumer needs no separate service graph. Which role a process plays is chosen
by the `BACKEND_ROLE` environment variable:

| `BACKEND_ROLE` | Process behaviour |
| --- | --- |
| unset / `all` (default) | API **and** co-located workers — the single-VPS default |
| `api` | HTTP only; runs **no** consumers (pair it with a separate worker process) |
| `worker` | Consumers only; serves no HTTP (set automatically by the worker entrypoint) |

### Single deployable (default)

For a single VPS, run only the API process — it co-locates the workers:

```bash
pnpm --filter backend run start      # production (built)
pnpm --filter backend run dev        # development (tsx watch)
```

This is the posture the rule allows for low-volume work: the worker
stays a *separable entrypoint* but is hosted in the API process to keep the
deployment simple.

### Separate, independently scalable workers

When bulk edits, imports, or re-indexing get heavy enough to contend with
request latency, split the workers into their own process(es):

```bash
# Web tier — HTTP only, no in-process consumers.
BACKEND_ROLE=api pnpm --filter backend run start

# Worker tier — consumers only, no HTTP listener.
pnpm --filter backend run worker          # production (built)
pnpm --filter backend run worker:dev      # development (tsx watch)
```

Scale the worker tier **horizontally** by starting more worker processes (or
containers). BullMQ's atomic job claim guarantees a job is processed by exactly
one of them; no configuration change is required to add instances.

Both tiers must point at the **same Redis** (`REDIS_URL`, default
`redis://localhost:6379`) and the same PostgreSQL database. Redis is the queue
substrate; Postgres holds the operation rows that are the source of truth.

### Graceful shutdown

The worker entrypoint (`backend/src/worker.ts`) handles `SIGINT` / `SIGTERM`:
it closes the BullMQ workers (letting in-flight jobs finish), then disconnects
Redis and the ORM. Send `SIGTERM` and wait for the process to exit before
replacing it during a deploy.

## Current queue-backed operations

### Catalog bulk operations — `catalog.bulk-operation`

Backs the admin **Bulk actions** (*Akcje masowe*) page. Two job types share one
queue:

- **`product_bulk_update`** — a product bulk-edit larger than the synchronous
  threshold (50 products). The admin request persists a `pending`
  `BulkOperation` row, enqueues its id, and returns `202` immediately.
- **`search_reindex`** — a full Meilisearch re-index (the CLI
  `pnpm search:reindex` equivalent), enqueued automatically when an attribute's
  `searchable` flag is flipped.

The consumer claims a row by flipping it `pending → running` with a conditional
UPDATE (atomic claim), runs the handler, and persists live progress plus a
final `completed` / `failed` status. On finish, the requester gets an in-app
bell notification **and** an email. Re-delivery of an already-claimed job is a
no-op, so the handler is safe at `N ≥ 2` workers.

At worker startup a **boot reconciliation** re-enqueues any rows left `pending`
(e.g. created while Redis was briefly unreachable). This only *enqueues* onto
the durable queue — it is not a draining sweeper.

### Webhook delivery — `webhook.deliver`

Domain events on the in-process event bus are bridged onto a BullMQ queue; the
worker signs each payload (HMAC-SHA-256) and POSTs it to the subscriber URL. Up
to 8 attempts with exponential backoff; a final failure is dead-lettered and
replayable from the admin **Webhooks → Deliveries** view. See the
[webhooks module](../modules/webhooks.md) for the delivery contract and retry
model.

## Other background jobs (not yet on a shared queue)

A few periodic/maintenance jobs still run as in-process timers or manual
scripts. These predate the scalable queue consumer rule and are tracked for migration
to the same worker model; document and operate them as follows in the meantime:

| Job | How it runs today | Invocation |
| --- | --- | --- |
| Cart abandonment sweep | Manual / cron script | `pnpm --filter backend run cart:abandonment-sweep` |
| Full search re-index | Manual CLI | `pnpm --filter backend run search:reindex` |
| Price-list status sweep | In-process `setInterval` (every 5 min) | starts with the API process |
| RFQ expiry | Service method, invoked on a schedule | `RfqExpiryWorker.sweep()` |

:::note
The in-process `setInterval` sweepers above are the legacy pattern the
scalable queue consumer rule replaces. New asynchronous, queue-backed work
MUST use the durable-queue + separable-worker model described here, never a
request-process timer.
:::

The cart abandonment sweep reads module presence from `module_registrations`
before it does anything and exits non-zero with `MODULE_DISABLED` when `carts`
is not installed on the deployment — the same answer an HTTP route would give,
for an entry point that has no route to gate. It sweeps in batches of 500,
committing each batch's status flips together with the audit rows for them, so
an interrupted run leaves whole batches behind rather than a partial one.

## Monitoring & troubleshooting

- **Queue depth / failed jobs** — inspect the BullMQ keys in Redis, e.g.
  `redis-cli keys 'bull:catalog.bulk-operation:*'` and
  `redis-cli keys 'bull:webhook.deliver:*'`. Failed jobs are retained
  (`removeOnFail`) for inspection.
- **Operation status** — for catalog work, the **Bulk actions** admin page
  lists pending / running / completed / failed operations with per-item
  counters; the underlying rows live in the `catalog_bulk_operations` table.
- **A queued operation never leaves `pending`** — confirm a worker is running
  (`BACKEND_ROLE` includes consumers) and that it shares the same `REDIS_URL`
  as the API. Restarting a worker re-enqueues orphaned `pending` rows via boot
  reconciliation.
- **Workers idle while jobs pile up** — check the owning module is enabled;
  workers registered through the module lifecycle are paused when their module
  is disabled and resumed when it is re-enabled.
