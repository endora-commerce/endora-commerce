---
---

No release meaning. Everything this branch changes is test harness: the repository's shared
vitest base configuration, the backend's `globalSetup`, two new files under `backend/test/`
and one under `scripts/`, plus one added case in `packages/cli/test/install.test.ts`. Test
sources are outside every package's `tsconfig.build.json` and outside its published `files`,
so nothing a consumer installs changes — no runtime behaviour, no exported type, no manifest.

A run now declares the Docker daemon absent the way it already declared the three services
absent, and the generable secrets a test run holds are derived from the platform's and the
modules' own declarations rather than copied into a list.
