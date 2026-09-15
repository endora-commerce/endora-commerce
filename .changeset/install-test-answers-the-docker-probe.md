---
---

No release meaning. `packages/cli/test/install.test.ts` is a test file: it is outside
`tsconfig.build.json`'s sources and outside the package's published `files`, so nothing a
consumer of `@endora-commerce/cli` installs changes. The repair is to the test's own
helper, which asked the host machine for a Docker daemon instead of supplying the answer
`runInstall` already takes by injection — the command's behaviour, its refusal and its
printed sequence are all untouched.
