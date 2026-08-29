---
'@endora-commerce/platform': minor
---

`ctx.di.decorate` now **enqueues**, and `composeModules` drains the queue after the last module
has registered — plus a new refusal, `PackageDecorationNotOfferedError`, for a deployment's
overlay wrapping a registration an installed extension package owns (D-176).

**The drain.** A decoration used to write the container at the call, while the registration pass
was still running, so array order decided whether it was possible at all: a module composed
before the owner of the name it wraps got *"nothing is registered under that name"* — the right
error for the wrong reason. That is now one pass and one drain, with no sort and no dependency
graph. Three consequences for a caller:

- **A decoration may name any registration in the composition, whatever the order.** Nothing that
  composed before is affected: an entry that worked at the call works at the drain.
- **`hasRegistration`'s refusal changed meaning, and its message with it.** It now means *"no
  module in this composition ever registers that name"* — check the spelling, and that the owner
  is composed — where it used to say the owning module had to be composed first. There is no such
  order any more, so any code matching on the old wording should stop.
- **Refusals are raised at the drain, not inside `registerModule`.** `ForeignDecorationError` and
  `AmbiguousDecorationError` are unchanged and still name every module they named. Anything else a
  wrap throws is now wrapped as `ModuleCompositionError` with a new phase, `'decorate'` — so
  `ModuleCompositionError['phase']` is `'register' | 'decorate' | 'boot'`. Narrow on it rather
  than assuming two values.

Call order is preserved: one module decorating one name twice still wraps in the order it wrote
the calls, which is why that case is exempt from `AmbiguousDecorationError` and why the queue is a
queue.

**The refusal.** `ModuleEntry` gains `installedPackage?: boolean`, set by the host that discovers
a package and never by the package. When the owner of a decorated name carries it, `decorate`
throws `PackageDecorationNotOfferedError` — including for a deployment's overlay module, which is
otherwise exempt from the ownership rule. Nothing that composed before is affected: an overlay
wrapping a core or overlay registration is unchanged, a package wrapping its own registration is
unchanged, and a module wrapping another module's is refused exactly as it was, one error class
more specifically where the owner is a package.

Its reason, which the message carries in full: a package's `exports` map publishes
`registerModule`, its entities, its migrations and `./ports`, and a container name it registers
internally is published by none of them — so the wrap would be written against a name the package
never offered and may rename in a patch release. The message says *not offered yet* rather than
*forbidden*, and names the exit: a package declaring which of its registrations are decoratable,
`./ports` being the natural home, where changing the shape costs a major bump.

`PackageDecorationNotOfferedError` and `createDecorationQueue` are exported from
`kernel/compose.js` and `kernel/module-context.js` beside the errors already there.
