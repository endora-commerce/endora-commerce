---
'@endora-commerce/test-kit': patch
---

`vitest` is now an optional peer of `@endora-commerce/test-kit`. No file the package ships imports it — the kit is called from a vitest run, and only its own tests name the runner — but as a required peer pnpm installed it into every project that installed the kit and declared no runner, the temporary host of `endora install` included. There it brought `vite@8` and produced `unmet peer vite@^7.3.2: found 8.3.2` under `@endora-commerce/admin-shell`. A project that runs tests already declares `vitest` and is unaffected; one that relied on the kit to bring `vitest` in must now declare `vitest@^4.1.11` itself.
