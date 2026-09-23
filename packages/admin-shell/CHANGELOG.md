# @endora-commerce/admin-shell

## 0.10.4

### Patch Changes

- Updated dependencies [d5778af]
- Updated dependencies [e267293]
- Updated dependencies [d6bfea0]
- Updated dependencies [8a05249]
- Updated dependencies [b3b4286]
  - @endora-commerce/contracts@0.14.0
  - @endora-commerce/admin-kit@0.9.4

## 0.10.3

### Patch Changes

- Updated dependencies [80751c2]
  - @endora-commerce/admin-kit@0.9.3

## 0.10.2

### Patch Changes

- Updated dependencies [b413e2d]
  - @endora-commerce/contracts@0.13.0
  - @endora-commerce/admin-kit@0.9.2

## 0.10.1

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
  - @endora-commerce/admin-kit@0.9.1

## 0.10.0

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

- Updated dependencies [0eeb9b5]
  - @endora-commerce/admin-kit@0.9.0
  - @endora-commerce/contracts@0.11.0

## 0.9.1

### Patch Changes

- Updated dependencies [5bfefe0]
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/admin-kit@0.8.2

## 0.9.0

### Minor Changes

- a71344d: `endora new instance` writes the admin member, and `endora generate` renders what it is built from.

  **`@endora-commerce/cli`** — two new surfaces and one moved one.
  - `endora generate` is a new command. Run anywhere inside a scaffolded instance, it renders the
    admin contribution registry and the admin stylesheet enumeration over the module packages that
    instance installed, and reports every candidate the discovery excluded. Programmatically:
    `runGenerate({ cwd, dryRun })`, with `generateReport`, `findInstanceRoot`, `artefactIsCurrent`,
    `GenerateInputError` (exit 1) and `GenerateHostError` (exit 2).
  - `endora new instance` now writes `admin/` — `package.json`, `tsconfig.json`, `index.html`,
    `vite.config.ts`, `src/main.tsx` and `src/index.css` — and the workspace, the root scripts and
    the `.gitignore` follow. The member is still omitted, in the same grammar, when
    `@endora-commerce/admin-shell` or `@endora-commerce/admin-kit` does not resolve, or when a range
    one of them should have declared is not there; the omission now names which.
  - `@endora-commerce/cli/lib/admin-artefacts.js` and `@endora-commerce/cli/lib/tailwind-sources.js`
    are new module specifiers. They hold the two artefacts' renderer, which this repository's
    `composer:generate` and a client's `endora generate` now share; the emitted bytes are unchanged.

  **`@endora-commerce/admin-shell`** — `AdminRoot` is a new export: the four wrappers `App` has to be
  mounted inside, which a project used to have to reproduce. Three of the four are this package's
  requirements rather than the project's, `unstable_useTransitions={false}` most of all — without it
  every module screen's URL changes and the outlet does not, with no error anywhere. `App`,
  `AuthProvider` and `registerAdminServiceWorker` are unchanged and still exported.

  The package now declares `vite`, `@vitejs/plugin-react`, `tailwindcss` and `@tailwindcss/vite` as
  **optional** peer dependencies. Nothing is required of an existing consumer that already has them;
  what they add is a statement, readable by a tool, of what kind of application a host that mounts
  this shell is.

  **`@endora-commerce/mod-settings`** — `ConfigurationReferenceInput` loads
  `@endora-commerce/mod-credentials`' preview modal lazily. `credentials` is an optional peer, so an
  admin bundle built in a tree that did not install it previously failed at build time on a named
  import of an unresolved stub, taking every module's screens with it over one button. The render was
  already gated on the module's presence and is unchanged.

### Patch Changes

- 10a17f0: The liveness and readiness probe is the platform's, and `@endora-commerce/mod-health-checks` is gone.

  `GET /api/v1/_health` is now registered by `@endora-commerce/platform` itself: `composeApp`
  puts `healthRoutePlugin({ orm, redis })` at the head of the module plugins it returns, and
  `composeTestServer` does the same, so an instance serves the probe because it is an Endora
  instance rather than because a module the scaffolder happened to select is installed. It was
  not: `endora new instance` writes the closure over the modules declaring
  `activation.nonDeactivatable`, `health_checks` declared no activation block at all, and no
  manifest named it as a dependency — so a scaffolded instance answered 404 on the route
  `deploy/compose.prod.yml` healthchecks, its API container never became healthy, and its
  storefront, which waits on `service_healthy`, never started. Moving the route also closes the
  withdrawal: `assertDeactivatable` returns early for a module with no activation block, so
  `module:uninstall health_checks` was accepted and an operator could take the liveness endpoint
  off a running instance with one command. Owner ruling D-229.

  **What a consumer has to do.** Nothing, if the instance composes through `composeApp` or
  `composeTestServer` — the route arrives with the platform. Remove
  `@endora-commerce/mod-health-checks` from the instance manifest; it no longer resolves. The
  route, its path, its payload and its status codes are unchanged.

  `@endora-commerce/platform/composition` gains `healthRoutePlugin`, `registerHealthRoutes`,
  `platformHealthProbes`, `healthResponseSchema`, `HealthDeps`, `HealthProbeSources` and
  `HealthResponse`. No new subpath: `./http` is untouched, because no module names any of this.

  `MEILISEARCH_URL` and `npm_package_version` are declared by the platform now, with the
  sentences the dissolved manifest carried. `@endora-commerce/mod-search` therefore stops
  declaring `MEILISEARCH_URL` — one variable may not carry two descriptions, and a module may not
  describe a platform input — while continuing to read it and to declare
  `MEILISEARCH_API_KEY`. **An operator-visible consequence:** the surviving declaration is
  `optional`, where `search`'s was `required`. Both readers have always defaulted to
  `http://localhost:7700`, so the requirement was aspirational, but a prompt built from these
  declarations will no longer insist on the value.

- Updated dependencies [10a17f0]
- Updated dependencies [471defd]
- Updated dependencies [c1d281f]
- Updated dependencies [52c2bfd]
  - @endora-commerce/contracts@0.9.0
  - @endora-commerce/admin-kit@0.8.1

## 0.8.0

### Minor Changes

- 16a9a6d: **`./theme.css` is withdrawn from this package.** It is now
  `@endora-commerce/admin-kit`'s (owner ruling D-219).

  **Old:**

  ```css
  @import '@endora-commerce/admin-shell/theme.css';
  ```

  **New:**

  ```css
  @import '@endora-commerce/admin-kit/theme.css';
  ```

  The import fails loudly rather than silently — `ERR_PACKAGE_PATH_NOT_EXPORTED`
  at the first build — so there is nothing to notice later.

  Nothing else about this package changes: it still peer-depends on the kit, and
  the kit's `./theme.css` is what its own screens render against. The subpath
  moved because 55 module packages declare the kit and **none** declares this
  package, so classes published from here would have been rendered by packages
  that cannot name their definer and cannot put a version range on it.

  `@endora-commerce/admin-kit`'s own changeset says what is in the file, what the
  new default palette is and how to override it.

- e811df3: New package: the admin application itself.

  `@endora-commerce/admin-shell` is the router, the sidebar and command palette,
  the breadcrumb trail, the sign-in screen and the four surfaces the platform owns
  rather than a module (the dashboard, the profile, `/platform/modules` and the
  not-found treatment). It was `admin/src`; an admin project now holds only
  `index.html`, `main.tsx`, its Vite and Tailwind configuration, its brand assets,
  its theme tokens and the generated contribution registry.

  The barrel is three members and they are the three lines of an entry point:

  ```tsx
  import { App, AuthProvider, registerAdminServiceWorker } from '@endora-commerce/admin-shell';

  registerAdminServiceWorker();
  createRoot(root).render(
    <StrictMode>
      <BrowserRouter>
        <AuthProvider>
          <App contributions={MODULE_ADMIN_CONTRIBUTIONS} />
        </AuthProvider>
      </BrowserRouter>
    </StrictMode>,
  );
  ```

  `contributions` is required rather than defaulted. The generated registry is the
  admin project's file and this is a package, so the shell cannot import it — and
  an `App` with no registry would render the host's own routes and none of the
  modules', which is a blank product that looks like a working one.

- fbe7317: The shell publishes its design tokens at a new subpath, `./theme.css`.

  It carries the `@theme inline` block, the `:root` and `.dark` token
  declarations, the `@layer base` rules and the 22-class `@layer components`
  legacy shim — everything an admin project used to hold in its own `index.css`.
  An instance now imports it and overrides a token by **redeclaring it after the
  import**:

  ```css
  @import 'tailwindcss';
  @import '@endora-commerce/admin-shell/theme.css';
  @import './tailwind.generated.css';

  /* last, so a redeclaration wins */
  :root {
    --primary: 262 83% 58%;
  }
  ```

  That works because every semantic token is an indirection —
  `--color-primary: hsl(var(--primary))` — so a utility this package's build never
  saw resolves against the consumer's `:root`. What a redeclaration cannot change
  is a value baked as a literal: the palette is overridable, Tailwind's spacing
  scale is not.

  **Why it matters to a consumer rather than to us.** The `@layer components` block
  defines `.page-header`, `.badge--warning`, `.alert--error`, `.btn--primary`,
  `.table` and eighteen others, and installed module packages _render_ them. Held
  in the consumer's own stylesheet, those definitions were frozen at the moment
  their project was created: a module release adding `.badge--info` would have
  rendered unstyled, in every existing project, with no error anywhere. They now
  belong to the package whose components render them and arrive with an upgrade.

  Additive: no existing subpath, export or symbol changes, and a project that does
  not import it is unaffected.

- e27bf6c: Every package that ships scannable UI now publishes its own Tailwind `@source`
  declarations at a new `./tailwind.css` subpath.

  A host compiling this package's utility classes no longer has to know where the
  package's sources are. Import the subpath from the stylesheet that builds your
  admin, and the package names its own layers:

  ```css
  @import 'tailwindcss';
  @import '@endora-commerce/mod-blog/tailwind.css';
  ```

  `@source` resolves relative to the stylesheet that declares it, so the paths hold
  wherever the package is installed. The file is generated from the package's layer
  inventory, ships in the tarball beside `package.json`, and its `dist` line is the one
  that matters to you — the `src` line beside it is inert in a published package and
  exists so that a checkout of this repository keeps scanning source in `dev`.

  **Nothing is removed or renamed**: every existing subpath resolves exactly as before.
  What is new is the obligation on the _host_ side, and it is a build error rather than a
  silent one. Before this, a host reached these packages with a glob over the monorepo
  (`@source "../../packages/**"`), which named a directory no installed tree has —
  and Tailwind reports nothing at all about a source that matches nothing, so such a host
  built green and rendered every screen unstyled. A host that now names a package that is
  not installed gets `Can't resolve`, and one whose tarball omits the file gets
  `ERR_PACKAGE_PATH_NOT_EXPORTED`.

  `@endora-commerce/cms-components` deliberately does **not** publish this subpath. It
  ships a finished, prefixed stylesheet at `./styles.css` and must not also be scanned by
  its host.

### Patch Changes

- Updated dependencies [16a9a6d]
- Updated dependencies [5394b8f]
- Updated dependencies [0c9a799]
- Updated dependencies [e20276c]
- Updated dependencies [9f7591b]
- Updated dependencies [142fcdd]
- Updated dependencies [4eeb5cd]
- Updated dependencies [9eb0cb6]
- Updated dependencies [ca43192]
- Updated dependencies [fd7db00]
- Updated dependencies [089d2d4]
- Updated dependencies [e83be80]
- Updated dependencies [db1ec0b]
- Updated dependencies [f7147b0]
- Updated dependencies [72013ed]
- Updated dependencies [e27bf6c]
- Updated dependencies [5ba2e97]
- Updated dependencies [0ab2044]
  - @endora-commerce/admin-kit@0.8.0
  - @endora-commerce/contracts@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [73d0887]
- Updated dependencies [0a08996]
- Updated dependencies [93a300c]
- Updated dependencies [68044b1]
- Updated dependencies [a85b425]
- Updated dependencies [4c9892c]
- Updated dependencies [972e7ed]
- Updated dependencies [b1589fd]
- Updated dependencies [316f44b]
- Updated dependencies [45e77bb]
- Updated dependencies [ebc08af]
- Updated dependencies [47c958f]
- Updated dependencies [b2552d5]
- Updated dependencies [7140eed]
- Updated dependencies [cebad9c]
- Updated dependencies [1d84094]
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
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [a80e2bb]
- Updated dependencies [d23bce2]
- Updated dependencies [2f04481]
- Updated dependencies [04cba90]
- Updated dependencies [7e71642]
- Updated dependencies [ee02c59]
- Updated dependencies [cb44af0]
- Updated dependencies [eeb6a47]
- Updated dependencies [cd013dd]
- Updated dependencies [214cbdb]
- Updated dependencies [3c8102e]
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
- Updated dependencies [31975ca]
- Updated dependencies [e1465e0]
- Updated dependencies [e7bbadc]
- Updated dependencies [a47dcc8]
- Updated dependencies [456ffa7]
- Updated dependencies [49164fb]
- Updated dependencies [49164fb]
- Updated dependencies [7f02d62]
- Updated dependencies [bbf9258]
- Updated dependencies [e3a6a02]
- Updated dependencies [184fa9f]
- Updated dependencies [2c8635b]
- Updated dependencies [aab5273]
  - @endora-commerce/contracts@0.7.0
  - @endora-commerce/admin-kit@0.7.0
