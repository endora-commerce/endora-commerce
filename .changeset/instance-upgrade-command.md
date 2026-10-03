---
'@endora-commerce/cli': minor
---

Add `endora upgrade [<version>]`, and declare it in every new instance as `pnpm run upgrade`.

Run inside an instance, it moves every package of the release the CLI belongs to — the platform,
every module, the admin shell, `@endora-commerce/contracts` — to one version (the registry's
latest when none is named), in every member's `package.json` and in the storefront beside the
instance, then runs `pnpm install`, the instance's `pnpm run setup` and `pnpm install` in the
storefront. An exact pin stays exact and `^` stays `^`; a package the release does not carry (a
module versioned outside the release, a third-party library) or a spec that is not a version
range is left as written and named. Lockfile entries of release packages at another version are dropped so pnpm re-resolves the
peers it installed by itself. Every precondition is checked before anything is written; a failing
step exits with its own code and prints what is left; `--dry-run` reports and does nothing; an
instance already at the version is told so and left untouched; a version older than the one
installed is refused. `--storefront-dir <path>` and `--no-storefront` choose the storefront.

Do not upgrade an instance with `pnpm update`: it leaves the exact `contracts` pin behind (two
copies installed, one unmet-peer warning per module), cannot cross a minor release in `0.x`, and
never moves an auto-installed peer. An instance created by `0.101.x` or earlier has no `upgrade`
script; `pnpm add -D -w @endora-commerce/cli@<version>` and then `pnpm exec endora upgrade
<version>` upgrade it. The documentation page *Upgrading an instance* has the details.

`runUpgrade`, `rewriteRange`, `rewriteManifestText`, `pruneLockfile` and `compareVersions` are
exported from the package root.
