---
'@endora-commerce/cli': minor
---

`endora new instance` / `endora install`: overlay code under `apps/` is now type-checked (issue
#1847). Until now Node's type stripping was the only thing that read it, so an `enum` crashed the
boot with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` and a type error after an upgrade appeared only at
run time.

A new instance gets:

- `backend/tsconfig.apps.json` — extends `backend/tsconfig.json`, includes
  `apps/*/modules/**/*.ts` and `apps/*/*.ts` (admin layers and `*.test.ts` excluded), sets
  `erasableSyntaxOnly: true` and `noEmit: true`. Bare specifiers resolve through the instance's
  `node_modules` to the installed packages' `dist` declarations.
- `typecheck` in `backend/package.json`:
  `tsc -p tsconfig.json --noEmit && tsc -p tsconfig.apps.json --noEmit`, and a root `typecheck`
  that runs it (`pnpm -C backend run typecheck`).
- `setup` runs `typecheck` after `generate` and `build` and before `migrate`:
  `pnpm run generate && pnpm run build && pnpm run typecheck && pnpm run migrate && pnpm run module:install --all`.

An existing instance gets the file and the scripts from `endora upgrade` (the second run from
0.112.0, see the #1848 entry of this release); a script you edited is reported, and then you add
it by hand. The first run can report an `enum`, a `namespace` or a constructor
parameter property your overlay code already has; replace an `enum` with a union of string
literals and a parameter property with a declared field assigned in the constructor.
