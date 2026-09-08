---
'@endora-commerce/mod-search': minor
---

The indexer now waits for a Meilisearch task long enough to survive a busy queue, and it
notices a task that failed.

Nine of `SearchIndexer`'s twelve task waits passed no `timeout`, taking the `meilisearch`
client's default of **5000 ms**. That number is the wrong order of magnitude for what is
being waited on: a task wait is `the queue ahead of this task` + `this task's own work`,
and Meilisearch's task queue is global to the instance. Measured against Meilisearch 1.x,
a **one-document** write into an empty index expired the 5000 ms wait after 5006 ms with
twelve document batches enqueued ahead of it — and then settled `succeeded` 10540 ms
later. Nothing about that task was slow. A full reindex of a real catalogue, or any
reindex against a Meilisearch shared with other work, hit the same wall as
`MeilisearchTaskTimeOutError` thrown out of `reindexChannel`.

**The second half is the one to read.** `waitForTask` does **not** throw for a task that
failed — it resolves, carrying `status: 'failed'` and Meilisearch's own `error`. All
twelve waits discarded that value, so a refused document batch and an applied one were the
same thing to the caller: `reindexChannel` reported a document count for an index
Meilisearch had written nothing into. The old code therefore failed loudly on the benign
case and silently on the malignant one.

**New setting.** `search.index_task_timeout_seconds`, default `120`, platform-wide. Raise
it for a large catalogue or a shared Meilisearch instance. It is re-read per wait, so it
takes effect without a restart. Its default is exported as
`DEFAULT_INDEX_TASK_TIMEOUT_SECONDS` from the manifest and
`DEFAULT_INDEX_TASK_TIMEOUT_MS` from the indexer.

**What a consumer will now see.** Two new exported error classes, and the distinction
between them is the point — they have opposite remedies:

```ts
import {
  SearchIndexTaskFailed,        // Meilisearch refused the write; `.meilisearchCode` says why
  SearchIndexTaskStillRunning,  // the wait expired; the task was NOT cancelled and may yet succeed
} from '@endora-commerce/mod-search/backend';
```

`SearchIndexTaskStillRunning` replaces the `MeilisearchTaskTimeOutError` that used to
escape, and its message names the setting to raise. `SearchIndexTaskFailed` is new
behaviour rather than a rename: **an indexing failure that was previously silent now
throws.** If you call `reindexAllChannels`, `reindexChannel`, `upsertProduct`,
`deleteProduct` or `refreshAttributeSettings` directly, expect to see genuine Meilisearch
refusals you were not seeing before. The module's own event subscribers are unchanged —
they log and continue, as they already did.

`SearchIndexerOptions` gains one **optional** field, `resolveTaskTimeoutMs?: () => Promise<number>`;
omitted, it answers the manifest default, so existing construction sites keep compiling and
behave identically.
