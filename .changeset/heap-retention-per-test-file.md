---
'@endora-commerce/test-kit': patch
'@endora-commerce/mod-ksef': patch
---

Two handles a composed test platform never gave back — a Redis connection nobody opened on purpose,
and a five-minute `setInterval` whose `close()` nothing ever called. Together they were ending every
`test:backend` shard.

**Why two forgotten handles are worth 1.2 GB.** A libuv handle is a GC root, so everything its
callback closes over is *live data*, not garbage. The `ksef` sweep's callback closes over that
module's options, whose `auditLogService` holds the harness's entity-manager factory, which closes
over the composition — every module entry, every module namespace, and therefore that test file's
entire transformed module graph. The backend suite composes a whole platform **per test file** in
one shared fork, so one uncleared timer per composition is one retained platform per test file.

**`@endora-commerce/mod-ksef` — the reconcile sweep is disposed with its registration.**
`ksefModule` has always returned a `close()` that clears the `setInterval` and drains the queue and
worker; the container registration declared no `.disposer`, so `container.dispose()` walked past it.
A heap snapshot taken after twelve compose/teardown cycles held twelve live `Timeout` objects,
every one of them created by this plugin.

**`@endora-commerce/test-kit` — the subscriber client is opened only when it is armed.**
`composeTestServer` opened a second `ioredis` client on **every** composition so that
`exercisePubSub` could choose between it and an inert stub, but handed it to `teardownTestServer`
only when the option was set — which nearly no test sets. It is now created only when it will be
subscribed to, which is also the shape that survives a teardown path throwing before it reaches a
disconnect.

**Measured, shard 1 of five, one process, `--max-old-space-size=2048`, post-GC live set after each
test file:**

| at file | neither repair | `ksef` only | both |
| --- | --- | --- | --- |
| 16 | 634 MB | 581 MB | 582 MB |
| 46 | 980 MB | 591 MB | 640 MB |
| 76 | 1424 MB | 587 MB | 686 MB |
| 106 | **1914 MB** | **728 MB** | **728 MB** |
| 297 | fork dead at 110 of 300; 190 files never ran | 723 MB | 723 MB |

1914 MB at file 106 is the 93%-of-cap reading CI reported after that same file.

**The attribution, since the two are shipped together:** the `ksef` disposer is the whole of the
heap repair — a run with it and without the test-kit change is identical to the one with both, to
0.8 MB at file 106. The test-kit change is a connection leak repaired on its own terms: it is worth
one ioredis client and one socket per composition, which is what the new `TCPWRAP` assertion
catches and what a developer's long-lived local Redis notices before the heap does.

`backend/test/integration/kernel/heap-ceiling.test.ts` now brackets three composition cycles with
`async_hooks` and refuses a surviving `Timeout` or `TCPWRAP`, which is the assertion the existing
post-GC heap measurement in that file cannot make: a handle's graph is legitimately live, so it
reads as retention rather than as a leak.
