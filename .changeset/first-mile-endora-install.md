---
'@endora-commerce/cli': minor
---

`endora install <dir>` — one command from nothing to an installed Endora Commerce.

It composes `endora new instance` and `endora new storefront` and reimplements neither: it
writes the instance, writes the storefront beside it as a sibling, derives the instance's
`.env` from the `compose.dev.yml` the same run rendered, and then runs the sequence that block
prints — `pnpm install`, `dev:services`, `setup`, `admin:create` and, when asked, `cli demo
seed`. Every step is echoed before it runs, a failing step exits with **its own** code and
prints the remaining steps as a resumable list, and the seeding is the one step whose failure
does not fail the install.

**It never prompts**, and that is the whole reason this half could ship now: a command that
asks nothing is under `cli-product.md` R2.5c's ceiling by construction, so the pipeline needed
no amendment. The wizard is a later phase.

Preconditions are decided completely before anything is written and reported in one refusal:
the target directory, Node's version, a package-manager runner (`pnpm` on `PATH`, then
`corepack pnpm@latest` — never `corepack enable`), a reachable Docker daemon unless
`--no-services`, a reference storefront unless `--no-storefront`, all four administrator
answers and the demo answer, which has deliberately no default.

`REVALIDATE_SECRET` is generated **once** and written into both trees — the one value no
sequence of the two existing commands can agree on.
