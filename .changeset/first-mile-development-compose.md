---
'@endora-commerce/cli': minor
'@endora-commerce/platform': minor
---

A scaffolded instance now carries a **runnable** development environment, and the operator CLI
stops printing a command line that resolves to a different program.

**`@endora-commerce/cli`** — `endora new instance` writes `compose.dev.yml` at the instance
root: PostgreSQL, Redis, Meilisearch and Mailpit, started with
`docker compose -f compose.dev.yml up -d --wait` in a tree whose `.env` has never been opened.
Everything under `deploy/` pulls images the client has not built yet, so those three services
were theirs to provision by hand. The new file is rendered from the **same** service catalogue
the production examples are rendered from, so no second statement of what Endora needs to run
enters a client's tree. Two new exports on `new-instance/deploy.js`: `developmentComposeFile`
and `undefaultedExpansions`, plus `DEV_COMPOSE_PATH`.

**`@endora-commerce/platform`** — `./cli` replaces the `CLI_USAGE` constant with
`cliUsage(program?)` and `DEFAULT_CLI_PROGRAM`, and `dispatchCli`/`runCli` take a `program`
option. The constant opened `usage: endora <module id> <command>`, and in a scaffolded instance
`endora` on the path is the scaffolder — a different program, with no `demo` verb and no
`<module id>` positional. The default is now `pnpm run cli`, which is what an instance's own
next-steps block prints. `demoHelpFor(verb, program?)` takes the same parameter.
