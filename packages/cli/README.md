# @endora-commerce/cli

The `endora` command line of **Endora Commerce**, the modular B2B/B2C commerce platform: it
installs an instance, scaffolds what you add to one, and checks a module package against the
platform's rules.

## Install an instance

```bash
npx @endora-commerce/cli install my-shop
cd my-shop && pnpm run dev:all
```

`npx create-endora-commerce@latest my-shop` is the same command under a shorter name. It writes an
instance into `my-shop/` and a storefront beside it, starts the development services in Docker,
installs every module of the open-source set and creates your administrator. You need
**Node.js ≥ 22.18** and **Docker** with Compose v2; pnpm is optional.
[Getting started](https://docs.commerce.endora.software/getting-started/) documents every question
and flag.

## The commands

| Command | What it does |
| --- | --- |
| `endora install [<dir>]` | The one command: the instance, the storefront beside it, the development services, every module and the administrator. `--only api\|admin\|storefront` stands one component up on a machine of its own; `--public-url` puts the three behind one host with paths. |
| `endora new instance <dir>` | Writes the instance alone and prints the steps `install` would run. |
| `endora new storefront <dir>` | Writes the reference storefront as a repository you own. |
| `endora new module <id>` | Inside an instance: an overlay module under `apps/<deployment>/modules/<id>/`. Inside a checkout of the platform repository: a module package. |
| `endora generate` | Renders the files an instance's admin and docs are built from, and its divergence report. An instance runs it as `pnpm run generate`. |
| `endora dev` | The API, the admin preview and the storefront in one terminal. An instance runs it as `pnpm run dev:all`. |
| `endora check [path]` | Evaluates the platform's static checks against one module package. |

`endora --help` prints every flag of every command, from the release you are running.

Inside an instance the CLI is already a dependency, so the commands are `pnpm exec endora …` or the
root scripts that wrap them. To add it to a module package of your own:

```bash
pnpm add -D @endora-commerce/cli
```

## Where it is documented

- [Getting started](https://docs.commerce.endora.software/getting-started/) — `endora install`.
- [Create your first Module](https://docs.commerce.endora.software/create-your-first-module/) —
  `endora new module` and `endora generate` in an instance.

## Licence

MIT — the text is in `LICENSE`, beside this file.
