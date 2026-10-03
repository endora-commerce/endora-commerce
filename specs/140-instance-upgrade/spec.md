# Feature Specification: upgrade an instance from one release to the next

**Feature directory**: `specs/140-instance-upgrade/`
**Created**: 2026-10-03
**Status**: Accepted — owner-approved goal of 2026-10-03
**Input**: *"Give an Endora Commerce instance a documented, proven upgrade path from one published
release to the next."* Several pages said *"upgrade the instance's `@endora-commerce/*` packages
past 0.100.2"* and the scaffolded README said *"`pnpm update`"*, and no page gave the command or
proved it.

## What was measured before anything was built

Instances scaffolded from npmjs with `npx create-endora-commerce@0.101.0` and `@0.100.2`, each on
its own services, then upgraded to `0.101.1` the way a user would.

- **M1 — `pnpm update` leaves the exact pin behind.** It moves every `^0.101.0` to `^0.101.1` and
  leaves `"@endora-commerce/contracts": "0.101.0"` where it is, so the instance resolves **two**
  copies of `contracts` and pnpm prints one *unmet peer* per module (61), while exiting 0. The
  exact pin is deliberate (`release-intent.md`, S1): it exists so there is one copy.
- **M2 — `pnpm update` is a no-op across a minor.** In `0.x`, `^0.101.0` is `<0.102.0`, so the
  next minor release is unreachable through the command the README named.
- **M3 — it rewrites ranges nobody asked about.** `"react": "^19"` became `"^19.3.0"`,
  `"@measured/puck": "^0"` became `"^0.20.2"`, every third-party range in the root manifest.
- **M4 — auto-installed peers are never updated.** `page-builder-core` and `email-components`
  reach an instance as peers pnpm installs by itself. No `pnpm update` form, `pnpm install`,
  `--fix-lockfile`, `dedupe` or `--depth Infinity` moves them; from `0.100.2` the upgraded
  instance kept `0.100.2` beside the modules' own exact `0.101.1` — two copies again. Dropping
  their entries from `pnpm-lock.yaml` and installing re-resolves them.
- **M5 — the storefront is a second repository with the same pin.** Its manifest pins
  `contracts` exactly and ranges two siblings; nothing upgrades it.
- **M6 — after the packages, `pnpm run setup` is the whole rest.** `generate`, `build`, `migrate`
  and `module:install --all` are idempotent on an installed instance (61 × *already installed
  (no-op)*); `migrate` applies what a release adds and `module:install --all` installs a module
  the manifest newly declares.
- **M7 — the paid modules share the scope and not the version** (`mod-inpost` `0.10.0` beside a
  `0.101.x` release), so "every `@endora-commerce/*` package to one version" is wrong for an
  instance carrying one.

## Requirements

- **FR-001** `endora upgrade [<version>]`, run inside an instance, moves every dependency that
  belongs to the release to `<version>` in every workspace member's manifest — and, by default, in
  the storefront beside the instance — then installs and runs the instance's own `setup`.
  `<version>` absent is the registry's `latest` of the platform package.
- **FR-002** "Belongs to the release" is decided by **name**, from the release index the CLI
  carries (`lib/release-index.ts`) — never by scope. A package the index does not name (a paid
  module, a third-party package) is left exactly as written and reported.
- **FR-003** A range keeps its operator: an exact pin stays exact at the new version, `^` stays
  `^`, `~` stays `~`. A spec that is not a version range (`file:`, `link:`, `workspace:`, `npm:`,
  a tag, a URL) is left as written and reported. No other line of a manifest changes.
- **FR-004** The lockfile entries of release packages at any other version than the target are
  removed before the install, so an auto-installed peer is re-resolved with the rest (M4).
- **FR-005** Validate completely, then write, then run (`install/index.ts`' discipline). Before
  the first byte is written: the instance root, its platform installed, the target resolvable,
  **every** release package the manifests declare published at the target, no downgrade, the
  named storefront present. Every failure is one refusal naming all of them, exit 1; an input it
  could not read is exit 2.
- **FR-006** Every command is printed before it runs. A failing step exits with that step's own
  code and prints what is left, as commands a person can type.
- **FR-007** Already at the target — every release range names it, the platform installed at it,
  no other release version in either lockfile — is a no-op that says so, exit 0, nothing written
  and nothing run.
- **FR-008** `--dry-run` prints every manifest change, the lockfile entries it would drop and
  every step; it writes and runs nothing.
- **FR-009** A newly scaffolded instance declares `"upgrade": "endora upgrade"` beside `dev:all`,
  under the same predicate (the CLI is on the root's path), and its README names it.
- **FR-010** The documentation has one page, *Upgrading an instance*, in English and Polish,
  linked from *Getting started*; every page that said "upgrade past 0.100.2" links to it, and it
  gives the manual equivalent for an instance whose CLI predates the verb.

## Out of scope

- Downgrading. Migrations do not run backwards; the verb refuses.
- The storefront's own **files**. It is the client's repository (D-195); only its release
  packages move.
- Third-party ranges a new release may need raised. pnpm reports an unmet peer; the page says so.
- Restarting processes. The verb names what to restart.
