---
'@endora-commerce/contracts': minor
'@endora-commerce/cli': minor
---

A scaffolded instance's `.env.example` declares everything that instance reads,
and the `.env` beside it is the file a client actually edits.

`endora new instance` wrote a `.env.example` carrying the **five build inputs**
and nothing else, while the platform declared 23 runtime inputs and nine module
packages declared nineteen more. The instance acceptance criterion had been
reporting the gap in its own output for weeks — *"supplied `DATABASE_URL`,
`REDIS_URL`, `SESSION_COOKIE_SECRET`, `PUBLIC_API_BASE_URL`, `NODE_ENV` to the
instance's own processes; its `.env.example` declares none of them, so a client
who fills in the file the command wrote has nothing to put them in"*.

The file is now derived, never listed: the **resolved platform's**
`PLATFORM_ENVIRONMENT_INPUTS`, unioned with the `env` of every module manifest
the run installed, scoped to the members it wrote, each entry carrying that
declaration's own `describes` and its `requirement` sentence rather than a
rewrite. A different `--module` set is a different file with nothing edited.

Three further changes make the file reach the process that needs it.

* **A `.env` is written**, holding the secrets the run generated
  (`cli-product.md` R2.5d — the `generable && secret` class, four of them over
  the default module set) and a **commented-out** placeholder for every other
  declared input. Commented, because Node's `--env-file` reads `NAME=` as the
  empty string and the platform's `??` fallbacks treat that as a value: a file
  of blanks turned twenty *unset*s into twenty empty strings and the acceptance
  run's health route answered 503 over a search engine that was running. A
  `.env` the operator placed there first is merged into, never rewritten.
* **Every `node` script the backend member declares carries
  `--env-file-if-exists=../.env`.** Without it the file was inert: the root
  scripts are `pnpm -C backend run …`, so a `.env` at the root of the tree was
  read by nothing and a client who filled it in still could not start.
* The next-steps block no longer says `cp .env.example .env`, which would now
  overwrite the generated secrets with empty strings.

New in `@endora-commerce/contracts`: `unionEnvironmentInputs`, the join over
several authors' declarations, first author wins. New in
`@endora-commerce/cli`: `instanceEnvironmentInputs`, `declaredEnvironmentInputs`,
`generableEnvironmentInputs`, `backendScripts`, and `parseEnvFile` /
`renderEnvValue` / `writeEnvFile` re-exported from the package root.
`ModuleCandidate` gains `env`, `PlanInput` gains `declared`, `existingEnv` and
`generated`, `DeployInput` gains `declared`, and `loadModuleCandidates` returns
`{ candidates, platformEnv }` instead of the map alone — all four are breaking
for a caller that constructs one of those shapes, and `major` is refused in a
`0.x` series (D-225).
