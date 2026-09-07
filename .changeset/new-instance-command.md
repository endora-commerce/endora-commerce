---
'@endora-commerce/cli': minor
---

`endora new instance <dir>` — the command that writes an instance repository.

New export `runNewInstance(options)` from `@endora-commerce/cli`, with
`InstanceHostError` / `InstanceInputError` (each carrying the refusal class its
exit code is read off), `resolveInstanceHost`, `loadModuleCandidates`,
`resolveModuleSet` and `planInstance`.

It writes a workspace whose root `package.json` **is** the module list, a
deployment directory and a backend member of entry points, and copies nothing —
so unlike `endora new storefront` there is no rewriting step and no outward
reference to repair. With no `--module` it writes the smallest set that composes
(the modules whose manifest declares `activation.nonDeactivatable`, closed over
the manifests' own `dependencies`); with `--module <id>` it writes that set
unioned with its closure. `--deployment <name>` names the deployment directory,
`--registry <url>` writes an `.npmrc` naming the scope with the token as an
environment reference, and `--dry-run` reports every file, the resolved set with
its closure and every omission while writing nothing.

Everything it needs is derived from what a client's machine can see: the scope
and `engines.node` from this package's own manifest, the ranges from the
`@endora-commerce/platform` installed beside the target, the module manifests
from the packages themselves. It refuses in eight classes — an occupied target,
an uncomposable set, an unknown module id and a bad deployment name at exit `1`;
an unreadable registry, an unresolvable platform version, an unreadable package
manifest and an undeterminable CLI version at exit `2`.

The admin member and the host CLI dispatcher are reported as omissions rather
than written: the first is `contracts/instance-tree.md` §2.4's, the second has no
published entry point until that feature's Phase 2 lands.
