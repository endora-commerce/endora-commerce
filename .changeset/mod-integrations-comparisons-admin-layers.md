---
'@endora-commerce/mod-api-keys': minor
'@endora-commerce/mod-webhooks': minor
'@endora-commerce/mod-comparisons': minor
'@endora-commerce/contracts': minor
'@endora-commerce/admin-kit': minor
---

`api_keys`, `webhooks` and `comparisons` ship their admin surfaces, on a new `./admin` subpath
each; `KnownIconNameSchema` gains two members and the kit's icon map the glyphs behind them.

Each of the three module packages now exports `contributions` from
`@endora-commerce/mod-<id>/admin` as an `AdminContributions` object whose every component is a
dynamic-import factory, so a consumer's bundler emits one chunk per screen and none of it is
downloaded by an operator who cannot reach it. The routes are unchanged — `/api-keys`,
`/webhooks`, `/comparisons` and `/comparisons/:id` — and each package contributes a sidebar
entry as well.

Five things a consumer has to know:

- **The subpath is a new `exports` entry, so it needs a build.** `./admin` resolves at
  `dist/admin/index.js`, emitted by each package's new `tsconfig.ui.json`. A checkout that has
  not run `pnpm run build:packages` cannot resolve it.
- **`@endora-commerce/admin-kit`, `react` and `lucide-react` become peer dependencies of all
  three, and `react-router-dom` of `comparisons`.** They were backend-only packages before
  this. The kit is where every screen's design-system import now resolves, and React is peered
  rather than depended on so the application resolves one copy.
- **Every route carries a `requiredPermission`, and the admin enforces it.**
  `integrations:manage` for `/api-keys` and `/webhooks`, `comparisons:read` for both comparison
  routes — in each case the code the screen's own API enforces. A host `<Route>` was ungated,
  so a consumer who deep-links one of these paths for an operator without the code now gets the
  admin's not-found treatment where the screen used to render and its API answered 403.
- **`KnownIconNameSchema` gains `Webhook` and `Scale`.** A nav entry and a palette action name
  their icon; both glyphs were `lucide-react` imports inside the admin's own `AppShell.tsx`
  until this change, so keeping the sidebar looking the same meant adding the names rather than
  substituting two already on the allowlist. `@endora-commerce/admin-kit`'s `resolveIcon` maps
  both. Widening a `z.enum` is additive for a producer and narrowing for a consumer that
  exhaustively switches on `KnownIconName`; nothing in this repository does.
- **Each of the three declares its first command-palette action** — `open-api-keys`,
  `open-webhooks` and `open-comparisons` — with both labels in the package's own `i18n/` bundle.
  A consumer resolving palette entries from the manifests will see one more per module.

Nothing is removed and no existing export changes shape, so a consumer of any of the three
`./backend`, `./migrations` or root subpaths is unaffected.
