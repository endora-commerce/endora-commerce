---
---

`mod-inpost` gains 14 co-located test files and publishes nothing new

Empty deliberately, and the reason is checkable rather than a judgement call.

`specs/conventions/release-intent.md` states the governing question as *"does this commit change
what a published package emits?"*, and says the answer **is a function of the package's
`tsconfig.build.json`, not of a path**. So it was asked that way:

  * `packages/modules/inpost/tsconfig.json` carries
    `"exclude": ["src/admin/**/*", "src/**/*.test.ts", "src/**/*.spec.ts"]`, and
    `tsconfig.build.json` extends it without overriding `exclude` — every one of these files is
    excluded from the emit **by name**, not incidentally;
  * rebuilt after the move, `find packages/modules/inpost/dist -name '*.test.*'` returns **0**;
  * the manifest's `files` is `["dist", "i18n", "docs", "tailwind.css"]`, so `src/` never ships at
    all;
  * and the whole diff under `packages/` is 14 added `*.test.ts` files in this one package and
    nothing else — no source file, no manifest, no export.

A consumer therefore receives a byte-identical artefact, which is why this is not a `patch`: a
patch would assert that an installed consumer gets something different, and none does.

The same document names this case explicitly — *"Where a change genuinely has no release meaning —
a comment, **a test**, a rename crossing no export — write the empty changeset rather than looking
for a way past the gate"* — and asks for a human's "I looked, there is nothing to release" in the
diff where a reviewer can disagree with it. I looked, in the place the document points at, and
there is nothing to release.

The tests came from `backend/test/{unit,contract,integration}/inpost/` under
`specs/134-paid-module-extraction/` T030, so that the package carries its own tests before it is
extracted. That is a change to how this repository is tested, not to what it publishes.
