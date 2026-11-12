---
'@endora-commerce/cli': patch
---

`check:platform-surface` now reads a module's test files (`*.test.ts`, `*.test.tsx`) and judges them on which subpaths of `@endora-commerce/platform` they name: a host-internal subpath such as `./composition` is `host-internal-subpath`, an undeclared one `unpublished-subpath` (issue #114). Test files are not asked the symbol question and do not count toward the host-dependent coverage floor. `endora check` over a module package applies the same rule to the package's tests. New exports from `@endora-commerce/cli/rules/platform-surface.js`: `isPlatformSurfaceTestSource` and `collectPlatformSurfaceTestSources`.
