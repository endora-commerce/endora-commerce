---
'@endora-commerce/cli': minor
'@endora-commerce/admin-shell': minor
'@endora-commerce/mod-settings': patch
---

`endora new instance` writes the admin member, and `endora generate` renders what it is built from.

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
