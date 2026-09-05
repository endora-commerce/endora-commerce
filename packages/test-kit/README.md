# `@endora-commerce/test-kit`

Composes an Endora Commerce platform for a test, from a composition its caller supplies.

`specs/109-backend-test-kit/` is the feature; `contracts/test-kit-package.md` is normative.

---

## Why it exists

`backend/test/helpers/test-server.ts` is 2993 lines and composes a platform by **finding**
one: the generated module list, the application's ORM configuration, the resolved manifest
registry, the overlay loader and the package loader. Every one of those is a fact about
*this repository's tree*, so a package cannot have any of them — which is why a module
package's server-bound test had nowhere to run but `backend/test`, and why 211 such files
are still there.

68 % of a server-bound test file's wall clock is that composition (116.6 s of a 171 s run,
median 4700 ms). The kit does not make it cheaper. What it makes is **reachable**: the same
composition, from a package, for a module that this repository has never heard of.

## The inversion

`composeTestServer` takes a `PlatformComposition` and never builds one. Its four members
are the four things only the caller knows:

| Member | What the caller supplies |
| --- | --- |
| `modules` | the module entries to compose — this repository's `MODULES` plus overlay plus discovered packages, or a third party's own set |
| `orm` | an opener and a closer |
| `manifests` | the loaded manifest registry the lifecycle needs |
| `testSupport` | the contributions of exactly the modules in `modules` |

Everything else it does is host-shaped and true of any platform: the container, the ORM
registrations, the audit writer, the event and command buses, the two Redis clients, the
registry cache, the settings and sales-channel kernels, one `composeModules` pass, one
contribution window, the tenancy request-scope hook, one boot phase, `buildServer`, and
`teardownTestServer`.

It does **not** read `process.env.DEPLOYMENT`, walk `node_modules` or read a generated
artefact. Each of those is a fact about the caller's process (D-104's predicate), and a kit
that answered them would answer them differently from the platform that composes for real.

```ts
import { composeTestServer, teardownTestServer } from '@endora-commerce/test-kit/server';

const handle = await composeTestServer({
  composition: { modules, orm: { open, close }, manifests },
  buildTenantContext: async (request) => resolveTenantContext(actorOf(request)),
  prepareDatabase: async ({ em }) => { /* truncate, seed */ },
});

const response = await handle.app.inject({ method: 'GET', url: '/api/v1/…' });
const service = handle.container.cradle.myService;

await teardownTestServer(handle);
```

**Nothing on `TestServerHandle` names a module.** The application's own handle carries 29
module-specific fields today, and every one of them is a container resolution its readers
can make for themselves: `handle.container.cradle` is how a caller reaches a module's
service. Draining those fields is Phase 2.

## What it refuses

A composition whose `modules` lacks a module declaring `activation.nonDeactivatable` is
refused by `composeModules` **before the first module registers** — with
`RequiredModuleAbsentError`, naming the module, the sentence its own manifest gives and the
remedy. The kit adds no second check and swallows nothing on that path, because a paraphrase
written here would be a second answer to a question the platform already answers.

That matters more than it sounds: 23 modules declare `nonDeactivatable`, and the union with
each module's transitive `dependencies` closure is a median of 23–24 of 70. So "just my
module" is not a composition anybody can run, and a stranger's first attempt is the one most
likely to meet this.

## The subpaths

| Subpath | Contents |
| --- | --- |
| `./server` | `composeTestServer`, `teardownTestServer`, and the two types they take and return |
| `./database` | the per-invocation database lease (issue #189), and the naming and selection rules behind it |
| `./support` | `TestSupportContribution` — what a module publishes at its own `./test-support` |

There is **no root export**: a caller names the seam it wants, so a test that needs only the
lease does not load the server.

`./off-state` (`expectModuleAbsent`, `withModuleOff`) is in the contract's table and is not
here yet. `backend/test/helpers/off-state.ts` is `check:off-state-coverage`'s subject and
that check's caller walk is `backend/test/**`, so moving the file before the walk follows it
(T074) would take 46 modules' off-state proofs out of the population that judges them.

## Running its tests

```bash
pnpm --filter @endora-commerce/test-kit run test           # service-free
pnpm --filter @endora-commerce/test-kit run test:services  # needs PostgreSQL and Redis
```

Two configurations rather than one with a condition, because a condition is a green that can
quietly become "not looking" (issue #113). CI's `test:frontend` job runs every non-backend
member's `test` script in an image with no service containers; `test:kit` runs the second
half beside the services.

The service-bound tests compose a fixture platform that is **nobody's module** — two
synthetic modules, one `@OrgScoped` entity, one route — because the kit may name no module
package (R1.5). That is the point rather than an inconvenience: what those tests have to
prove is that the seam works for a *stranger's* composition.
