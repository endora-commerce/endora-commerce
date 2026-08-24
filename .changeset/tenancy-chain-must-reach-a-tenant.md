---
'@endora-commerce/platform': major
---

`@TransitivelyScoped` chains are now walked to their end, and one that reaches no tenant is refused at boot.

`assertTransitiveParentsResolve()` used to check each transitive entity's **immediate** parent and stop.
It now walks the whole chain and requires it to terminate at a classification that carries a tenant key —
`@OrgScoped` or `@CustomerScoped`. Four shapes that used to pass now throw
`UnresolvableTenantParentError` (the same error class as before — there is deliberately no second one)
and stop the boot:

- a chain terminating at a `@GlobalEntity` parent;
- a chain terminating at a `@RuleScoped` parent (a foreign key cannot evaluate a rule);
- a cycle, `A → B → A`, which resolves at every step and grounds nowhere;
- a run of `@TransitivelyScoped` entities that reaches none of the above.

Each of them left the child entity reachable with no tenant predicate anywhere on its path.

**If your package ships an entity that now fails to boot**, the message names the entity, its foreign key
and the whole chain. Either point the chain at an ancestor that owns the tenant, or — if the entity
genuinely has no tenant — classify it `@GlobalEntity()` itself, which is a one-word change in the same
decorator block.

A chain terminating at a `@CustomerScoped` parent stays legal and now emits one `info` line naming the
chain: `customerFilterCond()` yields no predicate in `allowed-set` mode, so such a chain is unfiltered for
an org-scoped admin.

`assertTransitiveParentsResolve()` also takes an optional reporter — `{ info(obj, msg) }`, which a
`PlatformLogger` satisfies — as its first argument, for that line. Existing zero-argument calls keep
working and write to `console.info`.
