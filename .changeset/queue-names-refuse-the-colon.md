---
'@endora-commerce/cli': minor
'@endora-commerce/mod-comarch-xl': patch
---

`check:queue-names` — a BullMQ queue name may not contain `:`.

**`@endora-commerce/cli`** adds `rules/queue-names.js`: the analysis behind the new
`check:queue-names`, plus its `endora check` package-scope host and its estate entry. A site is
`new <Binding>(<arg0>, …)` where the binding is what the file imported from `bullmq` (alias
followed) and the class is one whose first constructor parameter is the queue name. `arg0`
resolves as a literal, as a `const` in the same file, or as a `const` imported one hop over a
relative specifier; anything else is an unresolved site, counted in the read line and never
judged. One finding, `colon-in-queue-name`, and no ledger — a ledgered colon is a queue that
cannot be constructed. The rule is the colon alone; the repository's broader
`<module_id>.<verb>` convention is deliberately not enforced.

**`@endora-commerce/mod-comarch-xl`** renames its three queues from `comarch_xl:detect`,
`comarch_xl:sync` and `comarch_xl:shop-export` to the dot spelling every other module already
uses. BullMQ owns `:` as its Redis key-namespace separator and refuses such a name in
`new QueueBase` before it reaches Redis, so the module's worker start threw, its plugin never
finished loading and the backend never listened — and the same throw landed in the activation
control's gate-off phase, so an operator could not switch the module off either. No queue had
ever been constructed under the old names, so no data migration is needed.
