---
'@endora-commerce/platform': minor
---

The tenant guard authors **writes**: an `@OrgScoped` row carrying an organization outside the ambient scope is refused at flush

**If your code writes an `@OrgScoped` entity for an organization the ambient `TenantContext` does
not cover, this release makes that write fail.** It used to succeed, silently and completely.

`@OrgScoped()` attaches a MikroORM global filter, and MikroORM applies a filter to `SELECT` /
`UPDATE` / `DELETE` and **not to `INSERT`**. So a classification bought a narrowed read and bought
nothing on the write side, and the two halves composed into an escalation wherever a handler diffs
a narrowed read against a caller-supplied set: an organization id the actor cannot *see* reads as
absent, and is then inserted. Measured on a real route — a `sales_representative` assigned to one
organization submitted two, was answered `200`, and created the other organization's row (D-260).

What changes for a consumer, in the order you will meet it:

- **One MikroORM `EventSubscriber` is registered by `mikroOrmConfigFrom`**, on `beforeCreate` and
  `beforeUpdate`, over every class the classification registry records as `scope === 'org'`. Its
  predicate is the already-exported `isOrgInScope`. There is nothing to declare, nothing to
  register and no per-entity or per-route opt-in: applying `@OrgScoped()` is what subscribes a
  class, exactly as it is what attaches the read filter today.
- **`all` and `system` contexts are unaffected.** Both answer "permitted" for every organization,
  which is what `isOrgInScope` already returned for them, so a platform admin and every worker
  inside `enterSystemScope` write across organizations exactly as before.
- **A refused write throws the new `OrgWriteOutOfScopeError`** from inside `em.flush()`. Under the
  Command Bus that is inside the command's single transaction, so the rollback is *whole* — no
  orphan row, no audit row, no event. If you catch around a flush, this error is a refusal and not
  a fault: re-throw it. `http/error-envelope.ts` maps it to `403 FORBIDDEN` with a message that
  names no organization.
- **A refusal that used to arrive as `409 VERSION_CONFLICT` now arrives as `403`.** Inserting a row
  for an organization whose existing row the actor's own narrowed read could not see collided on a
  tenant-keyed unique constraint, and the envelope reported that as *"the resource was changed by
  another process"* — a refusal dressed as a lost race. The 409 mapping is unchanged and still
  correct for a genuine duplicate; what changed is that the refusal no longer reaches it.
- **Two arms are deliberately permissive, and neither is an oversight.** A row whose
  `organizationId` is `null` or absent is not refused — it carries no organization to be out of
  scope, and such a row is invisible to every scoped reader anyway. And the guard covers
  `scope === 'org'` only: `@TransitivelyScoped` children carry no organization column, and
  `@CustomerScoped` classes that carry one (`Cart`) are a separate decision.
- **A write with no ambient tenant context throws `MissingTenantContextError`**, which is what a
  *read* of the same class already did. If you write an `@OrgScoped` entity from outside a request
  — a script, a job of your own, a fixture — wrap it in `withSystemScope('<reason>', …)`.
- **No migration and no schema change.** Nothing about the tables moved.

`minor` rather than `major` because no package in this repository leaves `0.x` yet; in a `0.x`
series a minor already takes every caret dependent out of range, which is the consumer-facing
meaning of the break.

No route, service or DTO changed, and no module was edited: the five payment gateways whose deny
lists were the measured escalation are repaired by this package and by nothing of their own.
