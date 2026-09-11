# @endora-commerce/admin-shell

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
