---
'@endora-commerce/cli': patch
---

The instructions for adding a module package to an instance give a command that works. The README
`endora new` writes into an instance said "Adding a module later is `pnpm add`", and
`endora new-module` refused a dependency nothing provides with "`pnpm add <package>`". In the root
of an instance — a pnpm workspace root whose `dependencies` are the module list — that command
exits 1 under pnpm 9 with `ERR_PNPM_ADDING_TO_ROOT`, and under pnpm 10 writes a range, `^<version>`,
beside packages the scaffold pinned exactly. Both now say
`pnpm add -w -E <package>@<version>`, with the version the release's other packages are pinned at.

Messages only: no command, option or exit code changes. An instance that already exists keeps the
README it was created with; the form to use there is the same, and
`docs/docs/upgrading-an-instance.md` § *Adding a module that is new in a release* describes it.
