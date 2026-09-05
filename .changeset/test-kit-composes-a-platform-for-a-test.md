---
'@endora-commerce/test-kit': minor
---

New package: `@endora-commerce/test-kit`, the seam a server-bound test composes an Endora
Commerce platform through. Three subpaths, and it declares **no module package** in any
dependency field.

`./server` — `composeTestServer(options)` takes a `PlatformComposition` and never builds
one. Its four members are the four things only the caller knows: the module entries to
compose, an ORM opener and closer, the loaded manifest registry, and the test-support
contributions of exactly the modules being composed. Everything else it does is
host-shaped and true of any platform — the container, the audit writer, the event and
command buses, the two Redis clients, the settings and sales-channel kernels, one
`composeModules` pass, one contribution window, the tenancy request-scope hook, one boot
phase, `buildServer`, and `teardownTestServer` to take it all down again.

```ts
import { composeTestServer, teardownTestServer } from '@endora-commerce/test-kit/server';

const handle = await composeTestServer({
  composition: { modules, orm: { open, close }, manifests },
  buildTenantContext: async (request) => resolveTenantContext(actorOf(request)),
});
// handle.app.inject(...), handle.container.cradle.myService, handle.em()
await teardownTestServer(handle);
```

A composition whose `modules` lacks a module declaring `activation.nonDeactivatable` is
refused by the platform's own `RequiredModuleAbsentError`, naming the module, the sentence
its manifest gives and the remedy. The kit adds no second check and swallows nothing.

`./database` — the per-invocation database lease (issue #189): one `vitest run` gets its
own `create database … template` clone and its own Redis logical database, both released
when the run ends and swept if it crashed. `BACKEND_TEST_ISOLATION=shared` and
`BACKEND_TEST_KEEP_DATABASE=1` behave exactly as they always have. The two application
facts are now the caller's: `identity`, the digest over its migration set, and
`migrateTemplate`, the step that applies its schema.

`./support` — `TestSupportContribution`, the four-member declaration a module package
publishes at `./test-support`. `registrations` is applied today; `volatileTables` and
`seed` are declared and not yet collected, so a module writes one declaration rather than
two.

Nothing here reads `process.env.DEPLOYMENT`, walks `node_modules` or reads a generated
artefact: each of those is a fact about the caller's process, and a kit that answered them
would answer them differently from the platform that composes for real.
