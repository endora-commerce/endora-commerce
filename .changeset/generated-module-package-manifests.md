---
---

No package changes anything it publishes in this branch, so nothing is released by it.

`packages/modules/blog/package.json` is the one file under `packages/` this branch touches,
and the change is an **encoding**, not a value: its `description` wrote its em dash as a
`—` JSON escape, and the generator that now writes every module package's manifest
serialises with `JSON.stringify`, which emits the character — which is what
`quote_requests` and `google_analytics` already had. The two spellings `JSON.parse` to the same
string, so every consumer of `@endora-commerce/mod-blog` reads the identical `description` before
and after, and the `exports` map, the `endora` block, the peer set and every version range come
out byte-for-byte unchanged. That is the measurement this row exists to report: the derivation
reproduces all three hand-written manifests, and this one byte is the whole of the difference.

What the branch adds is a command and a gate, both outside every package:
`pnpm --filter backend run manifests:generate` derives a module package's `package.json` from
its layer inventory, its own `src/manifest.ts` and the specifiers its sources actually name;
`manifests:check` refuses drift; and
`backend/test/unit/packages/module-package-manifest.test.ts` byte-compares the render against
disk on every merge request that touches `packages/**`.

A reviewer who thinks a byte change to a published `package.json` is release-meaningful should
say so on this file rather than in the merge request description — that is what an empty
changeset is for.
