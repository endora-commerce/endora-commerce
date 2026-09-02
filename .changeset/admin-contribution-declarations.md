---
'@endora-commerce/contracts': minor
'@endora-commerce/admin-kit': minor
---

Publish the admin contribution declarations, and the package a module's admin
layer is written against.

**`@endora-commerce/contracts`** gains `admin-contributions.ts`, re-exported
from the barrel. It is additive and breaks nothing:

- `AdminRouteDeclarationSchema`, `AdminNavDeclarationSchema` and
  `AdminZoneContributionSchema` — the data half of what a module package's
  `./admin` layer exports, so a generator, a check or a server can enumerate a
  contribution without evaluating any of the module's UI code.
- `AdminNavSectionNameSchema` — the closed set of sidebar sections a module may
  join, derived from the twelve `admin/src/components/AppShell.tsx` already
  declares. A module may not invent a section: an invented section is a heading
  nobody else can join.
- `AdminZoneNameSchema` — the closed, hierarchical set of places in one
  module's screen where another module's contribution may appear. The four
  opening members are exactly the places measured module additions reached into
  by editing another module's file.
- `PermissionRequirementSchema` — a permission code, or a set any one of which
  suffices; the shape `admin/src/lib/surface-visibility.ts` already defines,
  published so a module package declares it without reaching into the admin for
  the type.
- `AdminContributions`, `AdminRouteDeclaration`, `AdminZoneContribution` and
  `AdminComponentFactory` — the interfaces that carry the dynamic-import
  factory, which is the only function-valued field a contribution has. It is a
  TypeScript type rather than a Zod schema deliberately: a function value
  carries nothing to validate beyond its arity, and a `z.function()` here would
  tell a reader it had been checked.

**`@endora-commerce/admin-kit`** is new, private, and publishes one subpath:

```ts
import { AdminNavSectionNameSchema, type AdminContributions }
  from '@endora-commerce/admin-kit/contributions';
```

Every export is the identical binding rather than a copy —
`@endora-commerce/contracts` is a peer dependency, so a consumer resolves one
copy and a schema compared across the seam is the same object.

The four design-system subpaths the feature derives (`./ui`, `./components`,
`./lib`, `./i18n`) are **not** in this release. The package's README records the
measurement: a `tsc`-emitted façade re-exporting `admin/src` is TS6059 —
verified on a two-file probe — and dropping `rootDir` to make it compile emits a
second copy of every component into the kit's `dist`, which is a duplicated
module-scope value in a tree full of React context. Publishing them takes the
shape feature 080 used for the platform relocation: the implementations move
into the package and `admin/src` keeps re-export shims at their old paths.
