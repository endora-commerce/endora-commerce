# @endora-commerce/test-kit

## 0.7.0

### Minor Changes

- fc0d289: New package: `@endora-commerce/test-kit`, the seam a server-bound test composes an Endora
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

### Patch Changes

- Updated dependencies [73d0887]
- Updated dependencies [0a08996]
- Updated dependencies [93a300c]
- Updated dependencies [b2552d5]
- Updated dependencies [cebad9c]
- Updated dependencies [196fbfa]
- Updated dependencies [543151a]
- Updated dependencies [e5ae42c]
- Updated dependencies [f11ccdb]
- Updated dependencies [21dac4f]
- Updated dependencies [43e1968]
- Updated dependencies [a28c796]
- Updated dependencies [727cbf5]
- Updated dependencies [f66359f]
- Updated dependencies [81726cf]
- Updated dependencies [1ba52e1]
- Updated dependencies [86359f8]
- Updated dependencies [b0df9c1]
- Updated dependencies [4ed4b84]
- Updated dependencies [4db867c]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [a80e2bb]
- Updated dependencies [d23bce2]
- Updated dependencies [2f04481]
- Updated dependencies [04cba90]
- Updated dependencies [fbf1bf8]
- Updated dependencies [469a5f4]
- Updated dependencies [7e71642]
- Updated dependencies [ee02c59]
- Updated dependencies [cb44af0]
- Updated dependencies [cc9c2f4]
- Updated dependencies [eeb6a47]
- Updated dependencies [cd013dd]
- Updated dependencies [3c8102e]
- Updated dependencies [4e964e0]
- Updated dependencies [dc5c19d]
- Updated dependencies [c53fef3]
- Updated dependencies [c94c52d]
- Updated dependencies [4013a8b]
- Updated dependencies [fc34995]
- Updated dependencies [1050b9a]
- Updated dependencies [32cc6e4]
- Updated dependencies [63be98c]
- Updated dependencies [9ce0b40]
- Updated dependencies [07b2715]
- Updated dependencies [9b2a43e]
- Updated dependencies [c4703f9]
- Updated dependencies [49164fb]
- Updated dependencies [284276b]
- Updated dependencies [d59f846]
- Updated dependencies [566f233]
- Updated dependencies [0ec3f95]
- Updated dependencies [13e12bd]
- Updated dependencies [f2fa9ea]
- Updated dependencies [28c7f22]
- Updated dependencies [30a5475]
- Updated dependencies [1f4475e]
- Updated dependencies [ce1d197]
- Updated dependencies [028d8b4]
- Updated dependencies [81f4b08]
- Updated dependencies [31975ca]
- Updated dependencies [e1465e0]
- Updated dependencies [a84ad28]
- Updated dependencies [a47dcc8]
- Updated dependencies [a47dcc8]
- Updated dependencies [31975ca]
- Updated dependencies [456ffa7]
- Updated dependencies [49164fb]
- Updated dependencies [49164fb]
- Updated dependencies [7f02d62]
- Updated dependencies [2cd9c14]
- Updated dependencies [aab1f32]
- Updated dependencies [764b379]
- Updated dependencies [bbf9258]
- Updated dependencies [0a2bbd4]
- Updated dependencies [e3a6a02]
- Updated dependencies [184fa9f]
- Updated dependencies [2c8635b]
- Updated dependencies [aab5273]
  - @endora-commerce/contracts@0.7.0
  - @endora-commerce/platform@0.7.0
