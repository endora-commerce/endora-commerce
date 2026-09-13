---
'@endora-commerce/cli': patch
---

`endora new instance` declares each `@endora-commerce/*` package at **that package's own**
version, not at the platform's.

Every module entry in the scaffolded root `package.json` was written as `^<platform version>`.
That is correct only while a release moves every package together, and a release does not: of the
packages published on 2026-09-11, 68 moved to `0.8.0` and 15 to `0.7.1`. A tree scaffolded from
such a release asked a registry for a version that does not exist, and the first `pnpm install`
in it failed:

```
ERR_PNPM_NO_MATCHING_VERSION  No matching version found for @endora-commerce/mod-addresses@^0.8.0
The latest release of @endora-commerce/mod-addresses is "0.7.1".
```

The version now comes from the manifest of the package the command **resolved beside the target
directory** — the same manifest, on the same install, that the platform will read when it composes
that instance — so the tree a client gets back is pinned to what they already have. Nothing about
the platform entry changes: it was, and remains, `^` over the platform's own version.

**Regenerate a scaffolded instance, or edit its root `package.json`.** A tree written by an earlier
build carries one range per module that may name a version its package never published; the ranges
are the only affected file, and every other entry in the manifest is unchanged.
