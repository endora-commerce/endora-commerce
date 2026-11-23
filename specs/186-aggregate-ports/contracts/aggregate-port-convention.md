# Contract: the aggregate-port convention

The text below is what T016 writes into `specs/conventions/module-composition.md` as item **2a**
(beside item 2, *Ports you own*), and what `docs/docs/architecture/customisation-ladder.md` rung 3 and
`docs/docs/architecture/kernel.md` point at. It is the rule's one home once merged; this file is its
design record.

---

**2a. A write port is the port of its aggregate (D-293, OD-2).** When another module, an overlay or an
integration needs to write an aggregate you own, extend that aggregate's port; do not publish a port
shaped by the request.

1. **One per aggregate.** The aggregate's write port is `<aggregate>CommandPort`, declared in your
   contracts file beside the aggregate's read port, with the `Container name:` marker. For an
   extensible host the name is the `aggregatePort` of its `CUSTOM_FIELD_HOST_BINDINGS` row, and
   `check:port-shape` holds the two together.
2. **Operations are your Commands.** Each method runs exactly one Command — the one your admin route
   for that operation runs, from the same factory in `src/backend/commands/`. If the admin path is not
   a Command yet, convert it first, on both paths, keeping its audit action string (Principle XIII).
   Whatever the route does outside its write (notices, cache invalidation, reindex) moves where the
   port call reaches it too.
3. **The actor is ambient.** No `actorAdminUserId` parameter. A worker calls under
   `withSystemScope(reason)` (system actor) or `withSystemScopeActingFor(adminUserId, reason)`; a
   detached caller opens one with `enterSystemScope`.
4. **The last parameter is `options?: AggregateCommandOptions`** (`extensions`, `expectedVersion`,
   `source`) from `@endora-commerce/contracts`.
5. **Refusals are your admin route's**, as the platform's `HttpError` with its `code`. A status change
   whose callers answer a third party (a payment callback) may answer refusals as an outcome type
   instead; say so in the method's JSDoc.
6. **No permission check, no reads, no optional methods.** The caller is the gate; never resolve the
   port for a customer-facing route. Reads belong on the read port. Optional methods are refused
   (D-97.3, `check:port-shape`).
7. **A call is its own Command transaction.** Callers call it after their own commit. Atomicity with
   another module's write is a `beforeCommit` command hook, not a port call.
8. **Say what happens when you are off** — in the port's JSDoc, in the words `module-activation.md`
   uses. A consumer declares the edge in its manifest (`dependencies`, or `nonBindingDependencies`
   `refuses-without`), resolves with `lazyPort<T>(ctx, '<literal>')` per use, and never wraps the call
   in a bare `catch` (item 7).
9. **A capability port beside it** is allowed only for semantics the aggregate port does not have — a
   bulk report, an announcement, a child-Command factory for your own Commands — and its JSDoc says
   which.
10. **Changing a published method** follows `published-surface.md`: deprecate for one release
    (`@deprecated since <version>; use {@link …} instead.`), then remove.

---

## Port JSDoc template

```ts
/**
 * Container name: `<aggregate>CommandPort`. Owner: `<module>` (`specs/186-aggregate-ports/`, D-293).
 *
 * The <Aggregate> aggregate's write port: each method runs one audited Command, the one the admin
 * route for the same operation runs, with the ambient actor. **No permission is checked** — the
 * caller is the gate; never resolve it for a customer-facing route. Call it after your own commit.
 *
 * **Owner off:** <fails closed — 503 MODULE_DISABLED | the owner is non-deactivatable, so the gate
 * cannot close in practice>.
 */
```
