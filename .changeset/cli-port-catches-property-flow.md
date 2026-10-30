---
'@endora-commerce/cli': patch
---

The `port-catches` rule (`@endora-commerce/cli/rules/port-catches.js`) no longer treats an
object-literal property name as a binding (issue #100).

`{ value: lazyPort(ctx, 'somePort') }` used to make every bare identifier `value` in the module
read as that port, so an unrelated `const value = makeEngine()` around a `try`/`catch` became a
reported site. Deps-object keys are now a table of their own, reached only through an expression
that reads a property, and the analysis follows the value through the shapes that do:

- a property read, `x.key` / `x.key.method()`;
- a call through a key whose value is an accessor closure —
  `{ sender: () => cradle().transactionalEmailSenderAccessor() }` read back as
  `const s = deps.sender(); s.send(…)`, whatever the local is called;
- a destructuring, `const { key } = x`, `const { key: local } = x`, `({ key }: Deps) => …`;
- a class's own method returning a carrying value, `const p = this.#port()`.

The mirror holds too: a property read no longer answers to a local `const` of the same spelling.
`findPortCatches` and `checkPortCatches` keep their signatures. A tree's site population moves:
sites that existed only through a shared spelling leave it, and port reaches the old spelling match
missed (an accessor's result bound under another name, a renamed destructuring) join it.
