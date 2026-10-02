---
'@endora-commerce/cli': patch
---

An instance written by `endora new instance` (and so by `npx create-endora-commerce`) now composes its own overlay directory with no hand edit. It wrote `apps/<deployment>/` and no `DEPLOYMENT`, so an overlay module placed there was silently not composed; and it did not declare `@endora-commerce/contracts`, so any overlay `manifest.ts` stopped every command with `ERR_MODULE_NOT_FOUND`. The run now writes `DEPLOYMENT=<deployment>` into `.env` and `.env.example`, and declares `@endora-commerce/contracts` in the root `dependencies` at the exact version the resolved platform pins. With no `--deployment`, a `DEPLOYMENT` in a `.env` you placed in the target directory first names the directory. An instance created by an earlier release needs both lines added by hand: `echo "DEPLOYMENT=<dir under apps/>" >> .env` and `pnpm add -w @endora-commerce/contracts@<the platform's version>`.
