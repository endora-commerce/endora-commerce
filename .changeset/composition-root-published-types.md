---
'@endora-commerce/mod-organizations': minor
'@endora-commerce/mod-megamenu': minor
---

Publish `OrganizationTreeService`, `TargetValidatorDeps` and `StorefrontDeps`
from each package's `./backend` subpath.

The composition root contributes these shapes and must name their types. It
reached the source files by relative path, which is `TS6059` under the
backend's build `rootDir` — even for an `import type`, since a type-only
import still joins the program — so `pnpm --filter backend run build` was red
and the production image could not be built.
