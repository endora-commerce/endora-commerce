---
"@endora-commerce/cms-components": patch
---

The eight `@tiptap/*` packages and `leaflet` are now regular `dependencies` of `@endora-commerce/cms-components` instead of optional peers. The package's entry point imports Tiptap statically and its `Map` component loads `leaflet`, so they were never optional for anyone who bundles it — and pnpm does not install an optional peer, so an instance scaffolded with `--module cms` could end up declaring none of them and its admin build stopped on `"TextStyle" is not exported by "__vite-optional-peer-dep:@tiptap/extension-text-style:…"`. Installing the package now brings them. An application that declared them by hand to satisfy the old peers can drop those entries; keeping them is harmless.
