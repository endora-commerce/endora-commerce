# @endora-commerce/mod-auth

## 0.9.2

### Patch Changes

- Updated dependencies [b413e2d]
- Updated dependencies [0c59e92]
  - @endora-commerce/contracts@0.13.0
  - @endora-commerce/platform@0.12.0

## 0.9.1

### Patch Changes

- 8f61a6b: Every published package now ships its own `LICENSE` and `README.md`.

  npm force-includes a file named `LICENSE` into the tarball exactly as it does `README.md`,
  whatever `files` says, so the text has to be in the package directory and not only at the
  repository root — `LICENSE-COMMERCIAL.md` states that rule and, until this release, no package
  obeyed it. Measured on `master`: **0** of the 82 publishable packages carried a `LICENSE` and
  **14** carried a `README.md`, so every tarball shipped without licence text and 68 registry
  pages would have rendered empty.

  Both files are **generated**, by `pnpm --filter backend run manifests:generate`, and refused
  when stale by `manifests:check` in the `quality` job:
  - the `LICENSE` is the repository's root `LICENSE`, copied verbatim — the same single source
    the `license: MIT` field is already rendered from. A package that declares a licence of its
    own in the `SEE LICENSE IN <file>` form is skipped and keeps the file it names.
  - the `README.md` is rendered from what the package's own manifest declares: its description,
    its module id where it has one, every published subpath with what that layer holds, its peer
    dependencies with the optional ones marked, the locales its `i18n/` carries and what the
    tarball ships. A `README.md` **without** the generated marker on its first line is a human's
    and is never rewritten — the fourteen that existed are untouched.

  Five module packages also get their npm description back. `@endora-commerce/mod-blog`,
  `mod-credit-limits`, `mod-dhl-parcel`, `mod-google-analytics` and `mod-quote-requests` carried
  the note written when they were moved out of `backend/src/modules` — _"the first module to
  leave backend/src/modules … the manifest id stays identity of record"_ — as the sentence a
  registry shows under the package name. Each now carries the sentence its own module manifest
  declares, which is where `descriptionFor` seeds one from in the first place.

  No API changes, no new dependency, no behaviour change: what moves is what the tarball carries
  and what a package page says.

- Updated dependencies [4915024]
- Updated dependencies [8f61a6b]
- Updated dependencies [6b2ed26]
- Updated dependencies [55fc950]
  - @endora-commerce/contracts@0.12.0
  - @endora-commerce/platform@0.11.1

## 0.9.0

### Minor Changes

- 0eeb9b5: Require Node >= 22.18.0.

  The previous floor was 22.17.0, which MikroORM 7 sets. 22.18.0 is the first release that
  strips TypeScript types without a flag, and that is what loads a deployment's overlay module:
  in a scaffolded instance `apps/` is outside every compiled member, so the unit the platform
  `import()`s is the client's own `.ts`. On 22.17.x that import throws
  `ERR_UNKNOWN_FILE_EXTENSION` and the process dies before it listens. Emitting a `.js` beside
  the client's source was measured and refused — the overlay loader resolves `.js` before `.ts`
  while the divergence derivation admits both, so the sibling doubles every seam site in the
  report.

  Derived by probing 22.17.0, 22.17.1, 22.18.0 and 22.19.0 against a `.ts` module imported with
  no flag; 22.18.0 is the lowest that loads it.

  If you run 22.17.x, upgrade to 22.18 or later. Nothing else in these packages changed.

### Patch Changes

- Updated dependencies [c7b3512]
- Updated dependencies [c9a64de]
- Updated dependencies [0eeb9b5]
  - @endora-commerce/platform@0.11.0
  - @endora-commerce/contracts@0.11.0

## 0.8.2

### Patch Changes

- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0

## 0.8.1

### Patch Changes

- Updated dependencies [10a17f0]
- Updated dependencies [471defd]
- Updated dependencies [e6f053a]
- Updated dependencies [6c8d958]
- Updated dependencies [30430d1]
- Updated dependencies [6bd9ae9]
- Updated dependencies [c1d281f]
- Updated dependencies [bd596a9]
- Updated dependencies [def780b]
- Updated dependencies [97f9233]
- Updated dependencies [8e86e55]
- Updated dependencies [2fe0b8d]
- Updated dependencies [ee80d6b]
- Updated dependencies [52c2bfd]
  - @endora-commerce/platform@0.9.0
  - @endora-commerce/contracts@0.9.0

## 0.8.0

### Minor Changes

- 016524f: Retire the two module-package **value** imports the production composition root
  still held.

  `backend/src/composition.ts` names a module package 23 times over 21 packages.
  Nineteen of those packages are reached type-only; two were reached by value, and
  a value import does not retire by moving a type. That matters because
  `specs/110-instance-repository/` T118 moves this root's contribution wiring, ORM
  boot, request-scope hook, error-envelope options and tenant-context resolution
  into `@endora-commerce/platform`, **where a platform file may not import a
  module** (D-52, D-53). Each of the two needed a seam of its own, and they did not
  want the same one.

  **`@endora-commerce/mod-auth` — a port.** `promoteAdminActor` is no longer
  exported from `./backend`. The implementation has not moved and must not: `auth`
  reads it itself from `require-admin.ts`, and promotion is about `request.actor`
  and `request.adminActor`, two decorations this module's plugin applies. It is
  registered instead under the container name `promoteAdminActor`, which is the
  step the old export's own doc block and
  `test/contract/kernel/harness-parity.test.ts` both recorded as open — _"actor
  promotion published as a port, resolved from the container"_.

  ```diff
  -import { promoteAdminActor } from '@endora-commerce/mod-auth/backend';
  -promoteAdminActor(request);
  +import type { AdminActorPromotion } from '@endora-commerce/platform/kernel/ports/require-admin.js';
  +// resolved from the container, never captured — the gate is transient
  +const promote = container.cradle.promoteAdminActor as AdminActorPromotion;
  +promote(request);
  ```

  The module gains two things. The port, above. And **the actor types**, published
  as `Actor`, `ActorAnonymous`, `ActorCustomer`, `ActorAdmin` and `ActorApiKey`,
  because retiring the value import took something nobody had noticed it was
  carrying: `plugin.ts` holds a `declare module 'fastify'` block adding `actor` and
  `adminActor` to `FastifyRequest`, an ambient augmentation reaches a consumer only
  if the declaring file is in that consumer's program, and the value import was the
  only thing putting it there. Thirty reads of `request.actor` stopped compiling
  the moment it went. A consumer that reads `request.actor` now writes a
  **type-only** import from `./backend` and the augmentation travels with it.

  **`@endora-commerce/mod-i18n` — a relocation, and a port was structurally
  unavailable.** `buildErrorTranslationTargets`, `describeErrorCodeCollisions` and
  their five shapes are gone from `./backend`; they are
  `@endora-commerce/platform`'s now, at `kernel/i18n/error-translation.ts`, beside
  `request-language.ts` — the producer of the other `ErrorEnvelopeOptions` member a
  composition root injects.

  ```diff
  -import { buildErrorTranslationTargets } from '@endora-commerce/mod-i18n/backend';
  +// the platform's; no published subpath carries it, and no module calls it
  ```

  The line it moved across is _the routing is derived from manifests, the
  translation is a service_. `I18nService.translate` — what the envelope's
  `translateErrorMessage` closure calls — stays here and is unchanged. The
  derivation translated nothing: it read `manifest.errorCodes` off the resolved
  manifest set, which is a composition-root input, and it had **no consumer inside
  this package at all** — the barrel re-exported it and nothing here called it,
  which is T040b's criterion 8, the test `absolutizePublicUrl` moved out of `email`
  under. A port was not a design choice rejected on taste: the production root
  calls this _before_ `composeModules`, so there is no container to resolve one
  from, and moving the call after composition would move the collision warning with
  it — a diagnostic logged where it is so that an operator reads it before the
  first request that renders wrong.

  The aggregate return type is renamed `ErrorTranslationRouting`.
  `http/error-envelope.ts` declares an `ErrorTranslationTargets` of its own — the
  record this one's `targets` member is assigned to — and two types of one name in
  one package, one being the input to the other's consumer, is a confusion with a
  real cost. Nothing outside the package named the aggregate.

  **`@endora-commerce/platform`** gains both targets and publishes neither on a
  barrel: no module calls the derivation and no module resolves the promotion port,
  so `specs/080-f4-real-scope/contracts/host-package.md` §1.3 classifies both
  _unreached_, and putting a host-only name into the module-facing contract is what
  that classification exists to prevent. `AdminActorPromotion` sits in
  `kernel/ports/require-admin.ts` beside `RequireAdminFactory` and
  `RequireCustomerGuard`, which is where a Fastify-shaped port type lives —
  `@endora-commerce/contracts` declares no dependency on Fastify.

  Behaviour is unchanged. `composition.ts` computes the same map at the same point
  in the boot, logs the same collision warning, and promotes the same actor in the
  same closure; the existing composition, error-envelope and harness-parity tests
  are the assertion and none of them moved.

- 5ba2e97: `request.actor` is declared by the platform, and `Actor` no longer carries the session.

  **`@endora-commerce/mod-auth` — breaking, two ways.**

  `Actor`, `ActorAnonymous`, `ActorCustomer`, `ActorAdmin` and `ActorApiKey` are no
  longer exported from `@endora-commerce/mod-auth/backend`. Import them from
  `@endora-commerce/contracts` instead:

  ```ts
  // before
  import type { Actor, ActorAdmin } from '@endora-commerce/mod-auth/backend';

  // after
  import type { Actor, ActorAdmin } from '@endora-commerce/contracts';
  ```

  And the `declare module 'fastify'` block that adds `actor` and `adminActor` to
  `FastifyRequest` is no longer in this package. If you imported from
  `@endora-commerce/mod-auth/backend` only to make `request.actor` compile — a
  type-only import whose real job was to put the ambient declaration in your
  program — the import to write now is a normal one you probably already have:

  ```ts
  // before — erased at build time, and load-bearing anyway
  import type { Actor } from '@endora-commerce/mod-auth/backend';

  // after — any import from this subpath carries the declaration
  import { HttpError } from '@endora-commerce/platform/http';
  ```

  **`ActorCustomer.session` and `ActorAdmin.session` are gone.** They were the
  `Session` ORM entity, written onto every authenticated request. If you read one,
  resolve `authSessionPort` or `authSessionReadPort` from the container: both are
  declared in `@endora-commerce/contracts` and both answer with `AuthSessionRecord`,
  a plain shape rather than an entity. Nothing else about the actor changed — the
  same four kinds, the same fields, resolved by the same `onRequest` hook.

  **`@endora-commerce/contracts`** gains `Actor` and its four members, at
  `./actor.js` and on the root barrel. It imports neither Fastify nor the ORM.

  **`@endora-commerce/platform`** gains the Fastify augmentation on its existing
  `./http` subpath — no new subpath and no new export, because the file declares
  the two request properties and exports no symbol. Any import from
  `@endora-commerce/platform/http` brings it.

### Patch Changes

- Updated dependencies [5394b8f]
- Updated dependencies [0c9a799]
- Updated dependencies [e20276c]
- Updated dependencies [9f7591b]
- Updated dependencies [142fcdd]
- Updated dependencies [eb01958]
- Updated dependencies [4eeb5cd]
- Updated dependencies [a6a9d30]
- Updated dependencies [016524f]
- Updated dependencies [fb2659a]
- Updated dependencies [9eb0cb6]
- Updated dependencies [7e80824]
- Updated dependencies [e1748da]
- Updated dependencies [ca43192]
- Updated dependencies [fd7db00]
- Updated dependencies [6521134]
- Updated dependencies [089d2d4]
- Updated dependencies [e83be80]
- Updated dependencies [74a4797]
- Updated dependencies [9a5d4d2]
- Updated dependencies [a655909]
- Updated dependencies [1beac89]
- Updated dependencies [7fb0567]
- Updated dependencies [304f6d8]
- Updated dependencies [db1ec0b]
- Updated dependencies [f7147b0]
- Updated dependencies [72013ed]
- Updated dependencies [ec09593]
- Updated dependencies [dcface9]
- Updated dependencies [40e6e96]
- Updated dependencies [d321c67]
- Updated dependencies [03dec57]
- Updated dependencies [8249bb7]
- Updated dependencies [5ba2e97]
- Updated dependencies [0222f04]
- Updated dependencies [0ab2044]
  - @endora-commerce/contracts@0.8.0
  - @endora-commerce/platform@0.8.0

## 0.7.0

### Minor Changes

- 14fa7f9: `auth` is now a package: `@endora-commerce/mod-auth`.

  Its `./backend` subpath publishes `registerModule`, the `AuthCradle` shape and
  the `entities` array, plus four things a consumer must not reach through a
  filesystem path into this package's source: `promoteAdminActor`,
  `SessionService`, `AuthSessionReadService` / `createAuthSessionPort`, and the
  `createRequireAdmin` / `createRequireAdminAny` / `createRequireCustomer` guard
  factories.

  `promoteAdminActor` is the one the composition root calls. It was reached at
  `backend/src/modules/auth/plugin.js`; that spelling is gone and the bare
  specifier replaces it, so a host that already imports `./backend` holds one copy
  of this module rather than two.

  The `services/password-hasher.js` re-export is **removed**. `hashPassword` and
  `verifyPassword` have lived in `@endora-commerce/platform/kernel` since feature
  075's Phase P; import them from there.

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
