---
'@endora-commerce/platform': minor
'@endora-commerce/cli': minor
---

Complete the host-internal `./composition` barrel, and give the demo-data layer
`./demo`.

Both are **host-internal** subpaths (D-160.14): they are declared by the
`exports` map, so `node` and `tsc` resolve them for a composition root, a host
CLI and a test kit — and they are not public API, so `check:platform-surface`
answers a *module* that names either one with `host-internal-subpath`.
`PUBLISHED_SUBPATHS` is unchanged at five and no published barrel gains a name.

**`@endora-commerce/platform`**

`./composition` gains twelve names, every one of them a symbol
`kernel/index.ts`' own header already enumerated as excluded — *"the composition
machinery … and the errors they raise"*:

```ts
import {
  registerErrorEnvelope,          // http/error-envelope.ts
  parseTrustedProxy,              // http/trusted-proxy.ts
  type TrustedProxy,
  ModuleCompositionError,         // kernel/compose.ts
  type ModuleEntry,
  createModuleContext,            // kernel/module-context.ts
  createModuleRegistrationSink,
  type ModuleRegistrationSink,
  AmbiguousDecorationError,
  ForeignDecorationError,
  PackageDecorationNotOfferedError,
  type AdminActorPromotion,       // kernel/ports/require-admin.ts
  absolutizePublicUrl,            // kernel/public-api-base-url.ts
} from '@endora-commerce/platform/composition';
```

`./http` carries `HttpError`, which is what a module *raises*, and not the
registration that attaches the envelope to an app — a module owns no app to
attach one to. `./kernel` carries `RequireAdminFactory` and
`PublicApiBaseUrlNotConfiguredError`, which are what a module reads; the
promotion hook and the absolutiser are what a root *supplies*.

`./demo` is new. It carries `runDemo`, `unwrapDemoFailure`, `formatDemoReport`,
`mustBeNonProduction`, `TEST_DATABASE_NAME_PATTERN`, `DEMO_SEED_SCOPE_REASON`,
`DEMO_RESET_SCOPE_REASON` and the four types those name. `packages/platform/src/demo/`
was the one platform directory with a barrel and **no subpath at all**, so its
consumers reached `packages/platform/dist/demo/index.js` by relative path — a
specifier that resolves in the monorepo and in no installed instance, which for
this directory means a demo an instance cannot run.

**The demo barrel exports eighteen fewer names than the directory declares**, and
under `exports` that is not a removal: none of them was reachable from outside
the package before, because there was no subpath. `planDemoRun`,
`classifySeedTarget`, `createDemoPackageResolver`, `DemoRunFailedError`,
`demoBodyFromPackage`, `DemoPackageShapeError` and the plan and run-result shapes
stay internal until something asks for one by name. Adding a name back is not a
breaking change.

**`@endora-commerce/cli`**

`HOST_INTERNAL_SUBPATHS` gains a `demo` member with its reason. The record is
what `check:platform-surface` and `test/unit/kernel/published-surface.test.ts`
both read, so a subpath cannot join the class without a written statement of who
may name it and why.
