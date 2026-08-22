---
'@b2b/api-client': major
---

`@b2b/api-client` now ships compiled JavaScript and declarations. `main`, `types` and its
one `exports` subpath resolve under `./dist`; `files` is `["dist"]`.

**What changes for you.** Resolving `@b2b/api-client` gave you `src/index.ts` and left the
compiling to you; it now gives you `dist/index.js` with `dist/index.d.ts` beside it. Drop
the `transpilePackages` entry, loader or bundler plugin you needed for it. No exported
symbol moved.

**The types it re-exports from `@b2b/contracts` are now read from that package's built
declarations**, not from its source. They are the same types — asserted by a probe that
compiles a bad union member under `@ts-expect-error` against the built `.d.ts` — but the
resolution is different, and it is worth knowing which file an editor is taking you to.
