# create-endora-commerce

The front door to **Endora Commerce**, the modular B2B/B2C commerce platform:

```bash
npx create-endora-commerce@latest my-shop
```

It runs `endora install my-shop` from [`@endora-commerce/cli`](https://www.npmjs.com/package/@endora-commerce/cli),
with every argument you typed passed through unchanged, and exits with its exit code. It
implements nothing of its own — no scaffolding, no questions, no defaults — so this command and

```bash
npx @endora-commerce/cli install my-shop
```

are the same command. Everything a run accepts, asks and writes is documented by the CLI:
`npx @endora-commerce/cli --help`.

## Status

Not yet published. This package is kept `private` in its repository until the first public
release of Endora Commerce to npmjs, and the command above does not resolve before that release.

## Licence

MIT — the text is in `LICENSE`, beside this file.
