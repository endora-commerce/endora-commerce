---
'@endora-commerce/cli': patch
---

The `port-catches` rule (`@endora-commerce/cli/rules/port-catches.js`) follows a holder built from
a deps bag and attributes its gates per method (issue #576).

`new C({ k: lazyPort(ctx, 'somePort') })` still carries nothing as a value. It is now tracked as a
holder: a class instance, a closure or an object literal, bound to the declaration that holds it
(destructurings included) and passed on through parameters, `this.<field>` and container
registrations. A call on a holder reaches what **escapes** the method or closure it resolves to:

- `read.list()` reaches what `C#list` reaches, and `read.getOrFail()`, a row read, makes no site;
- `this.deps.audience(id)` reaches what the closure under `audience` in *this class's own* bag
  reaches. Keys are looked up in the literal the receiver holds, not by their spelling across the
  module;
- a presence answer the callee's own `catch` consumes (e.g. `if (!(err instanceof
  ModuleDisabledError)) throw err; return record(err)`) does not reach the caller's `catch`.

The D-88 `this` hop pulls a holder call's escaping gates into the calling method. A call the value
tables already judge keeps exactly its gates. A pin over a name the holder tables follow now reads
stale ("the analysis already follows the name without it"). `PORT_CATCH_UNIT=<regex>` prints what
escapes each matching unit. A tree's site population grows: holder method reaches the analysis
could not see before join it.
