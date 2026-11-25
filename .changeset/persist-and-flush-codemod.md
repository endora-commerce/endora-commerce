---
"@endora-commerce/platform": patch
---

Every `em.persistAndFlush(x)` and `em.removeAndFlush(x)` in the platform and the modules is now
written `em.persist(x).flush()` and `em.remove(x).flush()`. MikroORM 6 implements the two methods as
exactly that chain, so nothing behaves differently; MikroORM 7, which a coming release moves to
(issue #1073), removes them.

Your own overlay modules can be rewritten the same way now, while the instance is still on
MikroORM 6, with the codemod this repository uses for its own tree. It is one file that needs
nothing but the instance's own `typescript` and Node 22.18 or later. From the instance root, with
`<version>` the release this changeset ships in:

```bash
curl -fsSL -o backend/persist-and-flush.ts \
  https://raw.githubusercontent.com/endora-commerce/endora-commerce/v<version>/backend/scripts/codemods/persist-and-flush.ts
cd backend && node persist-and-flush.ts ../apps && rm persist-and-flush.ts
```

It rewrites every call site, on any receiver, keeping `await` and the arguments, and turns a test
double that stood in for `persistAndFlush` (`persistAndFlush: vi.fn()`, `async persistAndFlush(x)
{ … }`) into a `persist(x)` returning an object whose `flush()` does what the double did. A double
it cannot rewrite without guessing — one whose object already has a `persist` that does something,
one assigned onto an object, a spy — is listed as `path:line:column` with a reason, and the run
exits 1; fix those by hand and run it again. `--dry-run` reports without writing.
