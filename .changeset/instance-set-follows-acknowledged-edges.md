---
'@endora-commerce/cli': minor
---

`endora new instance` closes its module set over `acknowledgedDependencies` as well as
`dependencies`.

The two spellings differ in one thing only — `acknowledgedDependencies` withdraws the install
**ordering** a `dependencies` entry claims, for an edge whose ordering would close a cycle.
`assertLockedModulesPresent` makes no such distinction: a module named in either array that the
deployment does not ship raises `ReducedDeploymentError` out of `loadModulePresence`, before
anything listens. So a scaffolded instance could be written with a set the platform then refused
to boot, and was: `carts` names `promotions` through two ports, `promotions` was not in the
derived set, and neither `pnpm run start` nor `pnpm run admin:create` got as far as a database.

If you scaffolded an instance before this and it refuses to boot with `ReducedDeploymentError`,
`pnpm add` the module the message names and run `pnpm run migrate && pnpm run module:install
--all`. A new instance needs nothing: the set it writes now contains it.
