---
'@endora-commerce/cli': patch
---

`endora generate` in an instance now exits 1 in two cases where it exited 0. A `migrations/` or `entities/` directory, or a source declaring an `@Entity()` class, under `apps/<deployment>/modules/` is refused before anything is written, naming each file: an overlay module contributes no schema, and nothing in an instance would have run it. And a finding in the divergence report — a divergence with no sentence in `divergence.ts`, a sentence for one that is gone, a declaration field not written as a literal — now fails the command after the report is written, with what each kind asks for; it used to print the finding and succeed, so `pnpm run setup` passed over an unexplained divergence. A script that runs `pnpm run generate` over a deployment with open findings will now stop there.
