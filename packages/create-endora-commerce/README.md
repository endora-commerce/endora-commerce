# create-endora-commerce

The front door to **Endora Commerce**, the modular B2B/B2C commerce platform:

```bash
npx create-endora-commerce@latest my-shop
cd my-shop && pnpm run dev:all
```

The first command asks a few questions — which parts to write, whether to start the development
services in Docker, whether to load demo data, and who your administrator is — then writes an
instance into `my-shop/` and a storefront beside it in `my-shop-storefront/`, installs every
module of the open-source set and creates the administrator. The second starts the API, the admin
and the storefront in one terminal. You need **Node.js ≥ 22.18** and **Docker** with Compose v2;
pnpm is optional.

It runs `endora install my-shop` from [`@endora-commerce/cli`](https://www.npmjs.com/package/@endora-commerce/cli),
with every argument you typed passed through unchanged, and exits with its exit code. It
implements nothing of its own — no scaffolding, no questions, no defaults — so this command and

```bash
npx @endora-commerce/cli install my-shop
```

are the same command.

## Where it is documented

- [Getting started](https://docs.commerce.endora.software/getting-started/) — every question and
  flag, what you get and where to sign in, running without questions (`--non-interactive`), and
  standing the API, the admin and the storefront up on machines of their own (`--only`,
  `--public-url`).
- `npx create-endora-commerce@latest --help` — the same flags, from the release you are running.

## Licence

MIT — the text is in `LICENSE`, beside this file.
