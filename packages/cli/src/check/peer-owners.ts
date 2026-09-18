/**
 * What a package's **peers** own — the one input Phase 3's owner-map rules share
 * (`specs/101-endora-check/contracts/package-scope-layout.md` §2, the `owner
 * maps` row, and §5's Tier B).
 *
 * ## The measurement that made this file necessary
 *
 * `check:port-catches` was assessed as needing no peer input at all, on the
 * reasoning that its alias table is *"a fixpoint over port-carrying values"*
 * seeded on a resolution — and a consuming package writes its own resolutions.
 * That reasoning is wrong, and the code says where: the seed is
 * `lazyPort(ctx, '<name>')` **whose name is already in `portOwners`**, and
 * `portOwners` is built from `di.providePort` in a file that declares
 * `registerModule` — the **owner's** file, not the consumer's. A package that
 * only consumes ports has an empty seed.
 *
 * Measured over this repository's module packages, because the hazard is worth
 * having as evidence rather than as an assertion: the whole-tree run attributes
 * **226** guarded-port sites to 41 packages; the same analysis run over each
 * package **in isolation** finds **19**, in 10 packages. **31 of the 41 lose
 * every site**, and they include all four PIM connectors (17–19 sites each) and
 * `product_feeds` (24) — which is to say the paid modules this phase exists for.
 * A package-scope host without this input would have printed `violations=0` over
 * exactly the packages it was built to judge.
 *
 * The reasoning that produced the wrong assessment is worth naming too, since it
 * is not specific to this rule: it came from **the rule's header comment**, which
 * describes the alias table as a fixpoint over port-carrying values and is
 * accurate — and says nothing about the seed. The predicate is six lines of
 * `isProxyCall`. A written statement trusted in place of the thing it describes is
 * the failure this whole estate exists against, and it reaches the people
 * building the estate too.
 *
 * ## Both discovery halves are needed, and a reader will not notice deleting one
 *
 * Stated here because neither tree alone shows it: the **installed** walk finds
 * nothing in this repository, because every module package is a workspace member
 * symlinked into `node_modules` and the walk correctly rejects a candidate whose
 * real path leaves the `node_modules` it was reached through. The **workspace**
 * walk finds nothing in a client instance, which has no workspace. So a reader
 * who deletes either half sees a green run in whichever tree they are standing
 * in, and the other tree's hosts go quietly blind.
 *
 * ## Why this is synchronous, takes no new dependency, and duplicates nothing
 *
 * The obvious route — resolve `@endora-commerce/platform/packages` out of the
 * subject's tree and call `scanNodeModulesRoots` — is async, and
 * {@link PackageRuleHost} is synchronous by Phase 1's design. It is also
 * unnecessary: `lib/module-packages.ts` already carries an **installed** walk
 * beside its workspace one, with its own recorded reason for being separate from
 * the platform's boot walk and an explicit agreement on the three rules that
 * decide an answer. So the discovery exists, in this package, and this file adds
 * none of its own.
 *
 * What it adds is the *reading*: a peer's registrations come out of its emitted
 * `./backend`-ish artefact as **text through the compiler API**, using the same
 * `providedPortNames` / `registeredNames` the repository hosts use over source.
 * No import of a stranger's composition, no platform, no ORM, no `await`.
 *
 * ## Two sources, because a peer can be either
 *
 * A peer is a workspace member (this checkout, and a stranger's monorepo) **or**
 * a package installed under a `node_modules` (a stranger's instance). That is
 * `module-roots.ts`' own two-sourced derivation with the population narrowed, and
 * both halves are needed: in *this* repository every module package is a
 * workspace member symlinked into `node_modules`, which the installed walk
 * correctly rejects as `links-out-of-node-modules`, so the installed half alone
 * would find nothing here and the workspace half alone would find nothing in a
 * client instance.
 *
 * ## It never answers "nobody owns it"
 *
 * A name no peer provides is **not attributed to nobody** — it is *unattributed*,
 * and the count of those is what a rule turns into `sources=owners:<n>/<m>` on
 * its own `read:` line and, when `n` is zero, into `unreadable`. That is the
 * whole of §5's *"a port whose owner module is not installed is `unreadable` for
 * that edge, never `unowned`"*, expressed in the idiom the estate already prints
 * rather than in a sentence a reader has to trust.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  discoverModulePackages,
  scanInstalledModulePackages,
  type ModulePackage,
} from '../lib/module-packages.js';
import { declaresRegisterModule } from '../lib/module-roots.js';
import { providedPortNames, registeredNames } from '../lib/port-registrations.js';

import type { PackageLayout } from './layout.js';

/** A peer whose declarations could not be read, named with the reason. */
export interface UnreadablePeer {
  readonly name: string;
  readonly moduleId: string;
  /** In the words the rule's own line uses. */
  readonly reason: string;
}

export interface PeerOwners {
  /** Peer module packages found, the subject excluded. */
  readonly peers: readonly ModulePackage[];
  /** Gated port name → the module id whose artefact provides it. */
  readonly portOwners: ReadonlyMap<string, string>;
  /** Container registration name → the module id whose artefact registers it. */
  readonly containerOwners: ReadonlyMap<string, string>;
  /** Emitted artefacts opened — the `files=` contribution. */
  readonly filesRead: number;
  /** Peers that claimed to be modules and could not be read. Never a silent zero. */
  readonly unreadable: readonly UnreadablePeer[];
  /** Which half, or halves, the peers came from. Printed, so a zero is legible. */
  readonly discovery: 'installed' | 'workspace' | 'both' | 'none';
}

/** The empty answer — a package standing alone, with nothing installed beside it. */
export const NO_PEER_OWNERS: PeerOwners = {
  peers: [],
  portOwners: new Map(),
  containerOwners: new Map(),
  filesRead: 0,
  unreadable: [],
  discovery: 'none',
};

/**
 * Every ancestor of the package that could hold peers, nearest first.
 *
 * "Could hold peers" is *has a `node_modules`* or *declares a workspace* — both
 * questions about the tree rather than about a path anybody spells. The walk
 * stops at the filesystem root; a package in a temp directory yields none, which
 * is the honest answer and the one the fixtures rely on.
 */
function candidateRoots(packageRoot: string): readonly string[] {
  const roots: string[] = [];
  let dir = resolve(packageRoot);
  for (;;) {
    if (existsSync(join(dir, 'node_modules')) || existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      roots.push(dir);
    }
    const parent = dirname(dir);
    if (parent === dir) return roots;
    dir = parent;
  }
}

/**
 * The subpath whose artefact **composes** the peer, derived rather than spelled.
 *
 * `declaresRegisterModule` is `generate-composer.ts`'s own marker, so the
 * composer, the repository hosts and this file cannot disagree about which file
 * composes a module. Nothing here names `./backend` (D-100): the composing
 * artefact is whichever declared target says so about itself.
 */
function composingArtefact(pkg: ModulePackage): { path: string; text: string } | null {
  for (const target of pkg.exports.values()) {
    const path = join(pkg.dir, ...target.replace(/^\.\//, '').split('/'));
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    if (declaresRegisterModule(text)) return { path, text };
  }
  return null;
}

/**
 * Read what the subject's peers own.
 *
 * Every failure is named. A peer that publishes no composing artefact is
 * *readable and empty* — it registers nothing, by its own `exports` map — while a
 * peer whose artefact is absent is **unreadable**, because a package that was
 * never built is a package whose registrations this run cannot see and must not
 * credit with none.
 */
export function readPeerOwners(layout: PackageLayout): PeerOwners {
  const byId = new Map<string, ModulePackage>();
  let installed = false;
  let workspace = false;
  const unreadable: UnreadablePeer[] = [];

  for (const root of candidateRoots(layout.packageRoot)) {
    const scan = scanInstalledModulePackages(root);
    for (const pkg of scan.packages) {
      if (pkg.moduleId === layout.moduleId) continue;
      if (!byId.has(pkg.moduleId)) {
        byId.set(pkg.moduleId, pkg);
        installed = true;
      }
    }
    try {
      for (const pkg of discoverModulePackages(root)) {
        if (pkg.moduleId === layout.moduleId) continue;
        if (!byId.has(pkg.moduleId)) {
          byId.set(pkg.moduleId, pkg);
          workspace = true;
        }
      }
    } catch (error: unknown) {
      // Two workspace members claiming one module id. It is a real defect and it
      // is not the subject's, so it is reported as an unreadable peer set rather
      // than thrown: a stranger's malformed workspace must not abort their run,
      // and crediting it with no peers would be the silence this file exists
      // against.
      unreadable.push({
        name: root,
        moduleId: '(workspace)',
        reason: `its workspace could not be enumerated (${
          error instanceof Error ? error.message : String(error)
        })`,
      });
    }
  }

  const portOwners = new Map<string, string>();
  const containerOwners = new Map<string, string>();
  let filesRead = 0;

  for (const pkg of [...byId.values()].sort((a, b) => a.moduleId.localeCompare(b.moduleId))) {
    const artefact = composingArtefact(pkg);
    if (artefact === null) {
      // Readable and empty vs unreadable, decided by the package's own map: a
      // peer that declares subpaths whose targets are not on disk was never
      // built, and its registrations are unread rather than absent.
      const declaresTargets = [...pkg.exports.values()].some((target) =>
        existsSync(join(pkg.dir, ...target.replace(/^\.\//, '').split('/'))),
      );
      if (pkg.exports.size > 0 && !declaresTargets) {
        unreadable.push({
          name: pkg.name,
          moduleId: pkg.moduleId,
          reason:
            'none of the targets its `exports` map declares is on disk, so the ports and ' +
            'container names it registers cannot be read — it was never built',
        });
      }
      continue;
    }
    filesRead += 1;
    for (const name of providedPortNames(artefact.text, artefact.path)) {
      if (!portOwners.has(name)) portOwners.set(name, pkg.moduleId);
    }
    for (const name of registeredNames(artefact.text, artefact.path)) {
      if (!containerOwners.has(name)) containerOwners.set(name, pkg.moduleId);
    }
  }

  return {
    peers: [...byId.values()],
    portOwners,
    containerOwners,
    filesRead,
    unreadable,
    discovery:
      installed && workspace ? 'both' : installed ? 'installed' : workspace ? 'workspace' : 'none',
  };
}
