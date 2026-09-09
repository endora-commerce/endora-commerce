---
'@endora-commerce/platform': minor
---

`DemoComposition` gains an optional **foundation** phase: `applyFoundation()` runs before the
first module's `seed`, and `withdrawFoundation()` after the last module's `reset`.

```ts
const composition: DemoComposition = {
  applyFoundation: async () => ({ applied: ['the shop’s sales channels'], skipped: [] }),
  apply: async () => ({ applied: ['products joined to the channel'], skipped: [] }),
  withdraw: async () => ({ applied: ['products joined to the channel'], skipped: [] }),
  withdrawFoundation: async () => ({ applied: ['the shop’s sales channels'], skipped: [] }),
};
```

**Both methods are optional and a composition that declares neither is unchanged**, including
the shape of the report `formatDemoReport` produces — so no caller has to do anything.

Reach for it only for a row a module's own demo body **reads** and no module may own. The single
after-the-modules position `apply` occupies is right for wiring, which needs both sides to
exist, and wrong for a precondition: a module whose body enumerates sales channels and places a
warehouse against each cannot see a channel the composition creates afterwards, and loses the
assignment with nothing failing. A step placed in the foundation to avoid thinking about
ordering is a step that will read an empty table.

The withdrawal's position is forced rather than symmetric for its own sake. Taking the
foundation away *before* the modules' own `reset` deletes rows those modules' rows reference and
removes them through the database's cascade instead of through the module that owns them.

`DemoCompositionResult` also gains an optional `credentials`, merged into `DemoRunResult.
credentials` and printed by `formatDemoReport` alongside the modules' own. A composition creates
accounts a module cannot — a tenant-scoped buyer whose `organization_id` is `NOT NULL` is
created by the composition and by nothing else — and until now nothing could print its sign-in.

`SEED_SCOPE_REASON` is **removed** from `@endora-commerce/platform/composition`. It was the scope
reason of a legacy developer seed script; use `DEMO_SEED_SCOPE_REASON` or
`DEMO_RESET_SCOPE_REASON`, which name the two commands that exist.
