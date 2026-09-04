---
'@endora-commerce/cli': minor
---

`endora new storefront` learns about a registry, and declares which package
manager the scaffold is installed with.

**`--registry <url>`** writes an `.npmrc` into the scaffolded storefront naming
that endpoint for the scopes the storefront actually installs, with a single auth
line for the endpoint:

```
@endora-commerce:registry=https://<host>/api/v4/packages/npm/
//<host>/api/v4/packages/npm/:_authToken=${ENDORA_NPM_TOKEN}
```

The token is written as an **environment reference and never as a value** — pnpm
expands `${VAR}` in both the registry and the auth position — so the file holds no
secret and is committable. A registry URL carrying its own credentials is refused
rather than copied through, because that is the one shape that would put a secret
into a client's repository. The trailing slash GitLab's own troubleshooting
requires is appended; a blank value, a relative URL, a scheme npm cannot fetch
from and a URL with a query or a fragment are each refused with the reason.

**Omitting the flag writes no `.npmrc` at all**, and that is the default on
purpose: it is what a consumer of the public registry holds, so the path the
command takes without being told anything is the destination rather than the
rehearsal.

The scopes are derived from the reference storefront's own `workspace:` ranges —
the packages that stop resolving the moment the copy leaves the workspace — so a
checkout that grows a second scope gets a second registry line in the same run,
and a storefront declaring no scoped workspace dependency is refused rather than
handed a file that configures nothing.

**The scaffolded manifest now declares `packageManager`**, taken from the
storefront's own manifest if it has one and otherwise from the checkout's root. A
pnpm lockfile records integrity and no registry; an npm lockfile records a
`resolved` URL per package. So which one a client wrote decides whether moving
between registries is one edited line or a regenerated lockfile, and that was
previously left to their habits. A checkout declaring neither is refused rather
than given an invented version.

New exports: `TOKEN_VARIABLE`, `normalizeRegistry`, `npmrcContent`,
`installedScopes`, `packageManagerFor`, and `PlanOptions`. `StorefrontPlan` gains
`registry`, the endpoint the copy installs from or `null` for the public one.
`planStorefront` takes an optional fourth argument; existing three-argument calls
are unchanged.

The command's closing "Next steps" text no longer tells its reader to pack
tarballs and pin them through `pnpm.overrides`. That was honest while nothing
under `packages/` was published and became wrong the moment something was — and
it is printed into a copy the client owns outright, which nobody comes back to
correct.
