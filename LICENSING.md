# Endora Commerce — packages under their own licence

This file states a mechanism. **It is not a licence**: it carries no terms, grants nothing and
takes nothing away from any package's own licence file.

## The open core ships MIT, in each package

Endora Commerce is MIT-licensed (`LICENSE`). npm force-includes a file called `LICENSE` in the
published tarball exactly as it does `README.md`, whatever `files` says — so the text has to be
*in the package directory*, not only at the repository root. The root `LICENSE` is the canonical
copy those are rendered from, by `pnpm --filter backend run manifests:generate`.

## What `SEE LICENSE IN LICENSE.md` means

A package whose `package.json` declares

```json
"license": "SEE LICENSE IN LICENSE.md"
```

is **not** under the MIT licence, whatever the repository root says. It ships a `LICENSE.md` in
its own directory in place of the MIT `LICENSE`, and that file is the licence statement that
applies to it. The root `LICENSE` does not extend to it, and the generator writes no MIT
`LICENSE` beside it. `SEE LICENSE IN <file>` is the form npm and third-party licence scanners
understand for a licence that is not an SPDX identifier.

For a module package the field is not written by hand. The module exports

```ts
export const packageLicense = 'SEE LICENSE IN LICENSE.md';
```

beside its manifest, and the manifest generator renders the field. `check:release-intent`
refuses a package that declares this form without shipping the file it names
(`unresolvable-license-file`).

## Where the terms are

The terms under which such a package may be used are the copyright holder's, and they are
**not drafted in this repository**. The package's own `LICENSE.md` is what applies to it; where
that file grants no right, no right is granted. Nothing in this file adds to it or replaces it.

## Why this file names no package

**This file names no package, deliberately.** Each package declares its licence in its own
`package.json`, and that declaration is the only list. Do not add one here, not even as an
example: a second list is one that drifts from the first, and it is the packages' declarations
that npm, licence scanners and `check:release-intent` read.
