---
'@b2b/cms-components': major
---

`@b2b/cms-components` now ships compiled JavaScript and declarations. `main`, `types` and
every `exports` subpath resolve under `./dist`; `files` is `["dist"]`. `./styles.css`
already pointed at `./dist/cms-components.css` and is unchanged — the `build` script now
runs `tsc` first and the Tailwind step second.

**What changes for you.** No import statement moves: `@b2b/cms-components`,
`@b2b/cms-components/components/*`, `@b2b/cms-components/schema/*` and the `./*` wildcard
all keep their names and reach the same modules, one directory over. What can go is the
`transpilePackages` entry, loader or bundler plugin you needed to compile its `.tsx`
source. `"use client"` survives the emit as the first line of each file.

**Five dependencies became optional peer dependencies**, and this is the part to read.
The package imports `@tiptap/extension-color`, `@tiptap/extension-highlight`,
`@tiptap/extension-image`, `@tiptap/extension-text-style` and `leaflet` from published
source, and declared all five as **devDependencies** — which are not installed for you.
Nothing said so: with the package distributed as TypeScript you compiled it yourself and
your own install happened to satisfy them, or the import sat in a code path you never
reached. Shipping `dist` makes them real specifiers in real emitted JavaScript, so they
are now declared where a consumer can see them, beside the four Tiptap peers that were
already there:

```
peerDependencies:      + @tiptap/extension-color @tiptap/extension-highlight
                       + @tiptap/extension-image @tiptap/extension-text-style + leaflet
peerDependenciesMeta:  all five optional
```

Optional, so an install that does not want the rich-text editor or the map is not warned
at. `leaflet` was already listed under `peerDependenciesMeta` with no matching
`peerDependencies` entry, which declares nothing at all; it does now. If you render
`RichContent` or `Map` and have not installed these, that was already broken and is now
visible at install time instead of at runtime.

**One hand-written declaration does not ship.** `src/types/leaflet.d.ts` is source, not
emit, so it is not in `dist`. Nothing in the published surface references it — the
`leaflet` import is dynamic and its type does not reach a public signature — but a change
that puts it there would need the file published with it.
