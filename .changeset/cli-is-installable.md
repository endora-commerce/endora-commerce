---
'@endora-commerce/cli': minor
---

`@endora-commerce/cli` is published, and its `endora` binary works when it is installed rather than only when it is developed.

Under D-208 this is the first package a client installs: somebody installs the CLI and, by running commands, builds their own Endora Commerce. It carried `"private": true`, so `changeset publish` filtered it out before it did anything. It now declares `repository`, `publishConfig.access` and no `private`, which is what the three packages published before it declare. It carries no `license`: D-203 defers that decision to the merge request that makes a package public **on npmjs**, and every package published so far carries none.

**The binary was silent from an install, and that is the substantive fix.** `endora --help` printed nothing and exited 0 for every consumer who installed this package — measured on a packed tarball in a scratch directory. A package manager links the `bin` rather than executing the file in place (pnpm's shim execs a path through the `node_modules/@endora-commerce/cli` symlink into its content-addressed store; npm links the entry itself), so `process.argv[1]` names the link, while Node's ESM loader resolves a module URL to its real location before evaluating it. Comparing the two as written is false for every install and true only in the checkout that developed it. The entry guard now compares realpaths, and the negative direction is asserted too, so `import { runNewModule }` still runs no program as a side effect.

**What this build's three commands do outside a checkout of the platform repository**, because installability and checkout-independence are two different properties and only the first is delivered here:

- `endora check` **works**. It reads the module package it is pointed at and nothing above it — the `endora` block, the `exports` map and the sources those subpaths reach — so a module author outside this repository can be held to the platform's static-check estate. This is the command the publication is for.
- `endora new module` and `endora new storefront` **refuse, at exit 2, naming what is missing**. The first derives the package manifest by running the platform's own manifest generator, which reads the workspace file for the npm scope, an application's manifest for the peer ranges and the root manifest for `engines.node`; the second copies the reference storefront out of the checkout and asks `git ls-files` what that application is. Neither invents those inputs. Making them work outside a checkout is `specs/110-instance-repository/`'s subject, not this change's.
