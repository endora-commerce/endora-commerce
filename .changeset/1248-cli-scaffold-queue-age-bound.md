---
'@endora-commerce/cli': patch
---

`endora new module --worker` emits a queue whose `removeOnComplete` / `removeOnFail` default job options carry an `age` bound beside the `count` bound (issue #1248): one day for a completed job, seven days for a failed one. The emitted comment says why the age alone does not empty a quiet queue, and that a queue whose jobs carry personal data also needs a scheduled `queue.clean`.
