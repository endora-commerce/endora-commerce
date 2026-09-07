/**
 * CI check — three signals on a published port (D-97.3, issues #192 and #196).
 * **Repository-scope host** over the relocated analysis.
 *
 * The rule lives in `@endora-commerce/cli/rules/port-shape.js`
 * (`specs/101-endora-check/contracts/package-scope-layout.md` §6: one analysis,
 * two hosts). This file resolves this repository's contracts sources, its module
 * walk roots, the `./ports` subpaths its packages declare and its population
 * floor, and it supplies the four values that are statements about *this*
 * composition rather than about a source text: both ledgers below,
 * `PLATFORM_OWNED_NAMES` and `HOST_REGISTERED_PORTS`. The forwarding specifier
 * is **bare**, never a path into `dist`.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  checkPortShape,
  collectPortShapeSources as walk,
  PORT_DOC_MARKER,
  type PortShapeInput,
} from '@endora-commerce/cli/rules/port-shape.js';

import { HOST_REGISTERED_PORTS, PLATFORM_OWNED_NAMES } from './check-port-dependencies.js';
import { refuseVacuousModulePopulation } from './lib/module-population.js';
import { requireModuleLayout, type ModuleTreeLayout } from './lib/module-roots.js';
import { reportReadSize } from './lib/read-size.js';

export * from '@endora-commerce/cli/rules/port-shape.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const CONTRACTS_SRC = join(HERE, '..', '..', 'packages', 'contracts', 'src');

/**
 * Every module's own `ports/` directory, and the package manifests that say
 * which of them must exist.
 *
 * **"The module's own directory", never "a path with a `ports` segment in
 * it".** D-171 is explicit that `surfaceOf` answers `'port'` for a relative
 * `services/ports/foo.ts`, which is a private file, and that a path-text
 * heuristic is *"correct for choosing a remedy sentence and wrong as a boundary
 * decision"*. So the directory is reached from the module's own location, which
 * `module-roots.ts` derives, and the two source layouts are **probed**: a module
 * in the application tree keeps its sources at its directory, a module package
 * one level in, under the source root its build compiles from. `existsSync`
 * answers rather than a rule, so a package arranged differently is followed
 * rather than silently missed.
 *
 * `declaredPortsSubpaths` is the independent second author (issue #244): a
 * package's `exports` map declares `./ports` or it does not, and that is
 * written by the manifest generator from the file's presence — a different
 * derivation of the same fact, so a walk that stopped seeing ports directories
 * disagrees with it in the same run.
 */
function modulePortsPopulation(layout: ModuleTreeLayout): {
  readonly files: string[];
  readonly packagesDeclaringPorts: number;
  readonly packagesWalked: number;
} {
  const files: string[] = [];
  let packagesDeclaringPorts = 0;
  let packagesWalked = 0;

  for (const root of layout.moduleRoots) {
    if (root.origin !== 'workspace-package') continue;
    const manifestPath = join(root.directory, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      exports?: Record<string, unknown>;
    };
    if (manifest.exports?.['./ports'] === undefined) continue;
    packagesDeclaringPorts += 1;
    // The declaration is the publication; the location is a probe. A package
    // keeps its sources under the root its build compiles from, which is `src`
    // for every package the generator renders — so `existsSync` answers, and a
    // package arranged differently contributes nothing rather than being
    // guessed at.
    const portsDir = join(root.directory, 'src', 'ports');
    const found = existsSync(portsDir) ? walk(portsDir) : [];
    if (found.length > 0) packagesWalked += 1;
    files.push(...found);
  }

  return { files, packagesDeclaringPorts, packagesWalked };
}

/** Absolute paths → sources, keyed by the layout's own spelling (T040a). */
function keyed(files: readonly string[], keyOf: (file: string) => string): Map<string, string> {
  const sources = new Map<string, string>();
  for (const file of files) sources.set(keyOf(file), readFileSync(file, 'utf8'));
  return sources;
}

function read(root: string, files: string[], prefix: string): Map<string, string> {
  const sources = new Map<string, string>();
  for (const file of files) {
    sources.set(`${prefix}${relative(root, file).split('\\').join('/')}`, readFileSync(file, 'utf8'));
  }
  return sources;
}

/**
 * Published interfaces with no registration behind them, and why each stands.
 *
 * **Two-way**: an entry whose port has gained a registration, or whose port no
 * longer exists, fails the check as stale. This is not a queue to add to — a
 * port nobody provides is what `@endora-commerce/contracts` would publish to the outside
 * world at F4, so an entry is a decision that has been taken and recorded, not
 * one deferred.
 *
 * **Empty, which is the state this ledger should be in.** Its one entry was
 * `ModuleManifestReadPort`, standing unprovided while Q2 of the Phase-P
 * unreached-port audit was open; D-98.5 answered it — module manifests are
 * platform-owned and the interface is deleted — by the retirement condition
 * that entry itself named.
 */
export const PORTS_WITHOUT_A_REGISTRATION: Readonly<Record<string, string>> = {};

/**` whose
 * name is registered by a **different** module and is not platform-owned. A
 * self-resolution is not a finding — a module naming its own registration is
 * not reaching across a boundary. A **cradle** read is not a finding either,
 * and that is a decision rather than an omission: a cradle name is a
 * contribution seam a composition root or the kernel supplies, where "name a
 * published contract" would be the wrong requirement. `PortResolution.via`
 * carries the distinction from the one function that decides it.
 *
 * **Publication is the `./ports` subpath *and* the `Container name:` marker, and
 * an entry can stand on either half being absent.** Since D-171.1 an owner that
 * has been packaged publishes its interface, so the entry goes — that is what
 * retired `carts`, `invoices`, `inventory` and `custom_fields`, whose consumers
 * had already been converted to name the subpath and whose entries only this
 * check could not see were spent. The mutual `orders` <-> `payments` pair went with T040b
 * packaging both of them, which is the second half D-171.1 predicted. The three
 * entries left all have packaged owners and stand anyway, because their
 * `ports/` declarations name the container in **prose** rather than in the
 * marker line `portDocOf` reads (`creditLimitService`,
 * `promotionUsageFinalizer`, `personalOrganizationProvisionApi`). That is an omission rather than a
 * decision, and it is recorded rather than repaired here: adding a marker
 * publishes a name, which is signal 2's subject and the owner's call.
 */
export const RESOLUTIONS_OF_UNPUBLISHED_NAMES: Readonly<Record<string, string>> = {
  // The two D-94.5 ports, and they are one entry written twice: each is an
  // interface the **owner** declares beside its implementation, deliberately
  // outside `@endora-commerce/contracts`, because its signature carries the caller's
  // MikroORM `EntityManager` and FR-034 keeps a MikroORM type out of that
  // package. Both are held there by a foreign key rather than by a convention
  // — `credit_limit_reservations_order_fk` and `promotion_usages_order_fk`,
  // both `on delete restrict` — so the reservation and the usage row must be
  // written inside the placement's own transaction.
  //
  // They are `permanent: true` entries in `orders`' cross-module-imports shard
  // for exactly that reason, and they retire the same way that shard says they
  // do: F4 package entry points, not a port and not a doc block. Publishing
  // either shape today would mean publishing an `EntityManager`.
  'orders:creditLimitService':
    'D-94.5 — `CreditLimitPort` is declared by `credit_limits` beside its ' +
    'implementation and stays out of `@endora-commerce/contracts` because `reserve` takes the ' +
    "caller's `EntityManager` (FR-034); `credit_limit_reservations_order_fk` is what " +
    'holds it co-transactional. Retired by F4 package entry points, as the matching ' +
    "`permanent: true` entry in `orders`' cross-module-imports shard says.",
  'orders:promotionUsageFinalizer':
    'D-94.5 — the twin of the entry above and the same shape: `PromotionUsageFinalizer` ' +
    'is `promotions`\' own interface, kept out of `@endora-commerce/contracts` because ' +
    '`finalizeUsage` takes the placement transaction, and held there by ' +
    '`promotion_usages_order_fk`. Retired by F4 package entry points.',
  // D-178's seam, and the same shape once more: an interface the owner declares
  // beside its implementation, kept out of `@endora-commerce/contracts` because
  // its signature carries the caller's `EntityManager`, held co-transactional by
  // a foreign key.
  'customer_accounts:personalOrganizationProvisionApi':
    'D-178 — `PersonalOrganizationProvisionApi` is declared by `organizations` beside its ' +
    'implementation and stays out of `@endora-commerce/contracts` because `provisionFor` takes ' +
    "the caller's `EntityManager` (FR-034). What holds it co-transactional is " +
    '`customer_accounts_organization_fk` (`on delete restrict`) over a column D-178 makes ' +
    '`NOT NULL`: the account row cannot be inserted before its Organization exists, and a ' +
    'second transaction cannot satisfy a foreign key against a row it cannot see. Splitting ' +
    'the two reopens the window that ruling closed — a committed account with no tenant, and ' +
    'nothing that retries. The **read**-shaped half of the same capability is published, as ' +
    "`PersonalOrganizationPort`; this name answers only the write. Retired by F4 package " +
    "entry points, as the matching `permanent: true` entries in this module's " +
    'cross-module-imports shard say.',
};

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');

  // Every root a module's source can live in, derived (feature 080, T040a).
  const layout = await requireModuleLayout('[port-shape]');
  const contractFiles = walk(CONTRACTS_SRC);
  const moduleFiles = layout.moduleWalkRoots.flatMap((root) => walk(root));
  if (contractFiles.length === 0) {
    console.error(
      '[port-shape] no sources under packages/contracts/src — ' +
        'refusing to report a vacuous pass',
    );
    process.exit(2);
  }
  // The module half of that pair was an emptiness test, and emptiness is the
  // one case a moved module tree does not produce (issue #215): `src/apps`
  // survives it, and the three floors below are each satisfied by a single
  // surviving registration or resolution. The floor is per registered module.
  const coverage = await refuseVacuousModulePopulation({
    prefix: '[port-shape]',
    manifestIndexPath: layout.manifestIndexPath,
    files: moduleFiles,
    moduleIdOf: layout.moduleIdOfPath,
  });

  const ports = modulePortsPopulation(layout);
  const input: PortShapeInput = {
    contracts: read(CONTRACTS_SRC, contractFiles, 'contracts/'),
    modules: keyed(moduleFiles, layout.keyOf),
    modulePorts: keyed(ports.files, layout.keyOf),
    hostResidentModules: layout.hostResidentModules,
    unregisteredLedger: PORTS_WITHOUT_A_REGISTRATION,
    unpublishedResolutionLedger: RESOLUTIONS_OF_UNPUBLISHED_NAMES,
    platformOwnedNames: PLATFORM_OWNED_NAMES,
    hostRegisteredPorts: HOST_REGISTERED_PORTS,
  };
  const result = checkPortShape(input);

  if (result.portTypes.length === 0) {
    console.error(
      `[port-shape] no published port found in ${contractFiles.length} contract files — ` +
        `the '${PORT_DOC_MARKER}' doc convention changed, and a green here would mean ` +
        `"not looking" rather than "clean"`,
    );
    process.exit(2);
  }

  if (result.registeredNameCount === 0) {
    console.error(
      `[port-shape] the scan of ${moduleFiles.length} module files found no container ` +
        `registration at all — every published port would read as unregistered, so this ` +
        `is "not looking" rather than a result (issue #113)`,
    );
    process.exit(2);
  }

  if (result.publishedContainerCount === 0) {
    console.error(
      `[port-shape] not one of the ${result.portTypes.length} published ports names a ` +
        `container — the '${PORT_DOC_MARKER}' line is what signal 3 compares a consumer's ` +
        `\`lazyPort\` literal against, so every cross-module resolution in the tree would ` +
        `read as unpublished (issue #113)`,
    );
    process.exit(2);
  }

  if (result.lazyPortResolutionCount === 0) {
    console.error(
      `[port-shape] the scan of ${moduleFiles.length} module files found no \`lazyPort\` ` +
        `resolution at all — signal 3's population is empty, which is "not looking" rather ` +
        `than "clean" (issue #113)`,
    );
    process.exit(2);
  }

  if (result.modulePortCount === 0) {
    console.error(
      `[port-shape] the walk of ${ports.files.length} module \`ports/\` files found no ` +
        `published port — D-171.1 widened this check's population to a module's own ` +
        `\`ports/\` directory, and a walk that produces none has turned signal 4 off ` +
        `entirely and reported the resolution ledger's retired entries as stale, which ` +
        `invites deleting the record of a repair that did not happen (issue #113)`,
    );
    process.exit(2);
  }

  if (listMode) {
    for (const name of result.portTypes) console.log(`PORT ${name}`);
    console.log('');
  }

  const violations =
    result.findings.length +
    result.nameFindings.length +
    result.staleLedgerEntries.length +
    result.unpublishedResolutions.length +
    result.staleUnpublishedResolutions.length +
    result.declaredElsewhere.length;
  // What was read, in the shared grammar (issue #244). `files` is both walks —
  // the contracts package and the module tree — and `sites` is the union of the
  // two unit kinds this check judges: the published ports (signals 1 and 2) and
  // the cross-module resolutions (signal 3). Each has a floor of its own above;
  // the union is what the ratchet watches for a silent halving.
  reportReadSize({
    prefix: '[port-shape]',
    files: contractFiles.length + moduleFiles.length + ports.files.length,
    sites: result.portTypes.length + result.lazyPortResolutionCount,
    coverage: [
      coverage,
      // The second author for the half of the population D-171.1 added: a
      // module package's `exports` map declares `./ports` because the generator
      // saw the file, so a walk that stopped finding ports directories
      // disagrees with the manifests in the same run.
      {
        source: 'ports-subpaths',
        expected: ports.packagesDeclaringPorts,
        covered: ports.packagesWalked,
      },
    ],
  });
  console.log(
    `[port-shape] ports=${result.portTypes.length} ` +
      `module-declared-ports=${result.modulePortCount} ` +
      `contract-files=${contractFiles.length} module-files=${moduleFiles.length} ` +
      `module-port-files=${ports.files.length} ` +
      `registered-names=${result.registeredNameCount} ` +
      `published-container-names=${result.publishedContainerCount} ` +
      `lazy-port-resolutions=${result.lazyPortResolutionCount} ` +
      `ledgered-unregistered=${Object.keys(PORTS_WITHOUT_A_REGISTRATION).length} ` +
      `ledgered-unpublished-resolutions=` +
      `${Object.keys(RESOLUTIONS_OF_UNPUBLISHED_NAMES).length} ` +
      `violations=${violations}`,
  );

  if (result.findings.length > 0) {
    console.error(
      '\nA published port declares an optional method, so a consumer can neither detect it\n' +
        'nor safely call it: `lazyPort`\'s proxy answers every property with a function, and\n' +
        'the forward throws when the provider has none (D-97.3).\n' +
        'Make the method required, or ask a question the provider can always answer — the\n' +
        'freshness guarantee `listForEntityFresh` replaced `publishInvalidate?` with is the\n' +
        'worked example.\n',
    );
    for (const finding of result.findings) {
      console.error(
        `  - ${finding.file}:${finding.line}  ${finding.typeName}.${finding.member}?() ` +
          `[${finding.kind}, port ${finding.portName}]`,
      );
    }
  }

  if (result.nameFindings.length > 0) {
    console.error(
      "\nA published port's doc block names a container that is not the registration\n" +
        '(port-publication.md §1.2). The name is what a consumer copies into\n' +
        "`lazyPort<T>(ctx, 'thatName')`, and nothing else in the tree checks it: an\n" +
        'unregistered name fails at first call, and a name that resolves to the ungated\n' +
        'legacy service does not fail at all — it hands the class across with no\n' +
        '`MODULE_DISABLED` gate, and `tsc` is satisfied by the structural match.\n' +
        'Correct the doc block, or register the name it gives.\n',
    );
    for (const finding of result.nameFindings) {
      const target =
        finding.registered === null
          ? 'registered by nothing'
          : `registered as \`${finding.registered}\``;
      const documented =
        finding.documentedRegistrationKind === null
          ? 'nothing registers it'
          : `that name is a ${finding.documentedRegistrationKind} registration`;
      console.error(
        `  - ${finding.file}:${finding.line}  ${finding.portName} documents ` +
          `\`${finding.documented}\` — ${documented}; the port is ${target} ` +
          `[${finding.kind}]`,
      );
    }
  }

  if (result.unpublishedResolutions.length > 0) {
    console.error(
      '\nA module resolves, cross-module, a container name **no contract publishes**\n' +
        '(D-98.2). The name is the whole of the promise a port makes — `lazyPort<T>` is\n' +
        '`new Proxy({} as T, …)`, so `T` is asserted and nothing compares it to what is\n' +
        'registered. A consumer that copies the owner\'s *class* registration instead of\n' +
        'its published port therefore compiles, and receives the entity.\n' +
        'Either the owner publishes the name — a contract type with a `Container name:`\n' +
        'doc block — or the consumer resolves the published name instead. Both are\n' +
        'ordinary repairs; a ledger entry is for a name that cannot be published, and it\n' +
        'has to say why and what retires it.\n',
    );
    for (const finding of result.unpublishedResolutions) {
      console.error(
        `  - ${finding.file}:${finding.line}  ${finding.moduleId} resolves ` +
          `\`${finding.name}\`, registered by \`${finding.owner}\` and published by no ` +
          `contract [${finding.kind}]`,
      );
    }
  }

  if (result.staleUnpublishedResolutions.length > 0) {
    console.error(
      '\nA `RESOLUTIONS_OF_UNPUBLISHED_NAMES` entry no longer describes the tree: the\n' +
        'site has gone, or the name it resolves is published now. Delete the entry — a\n' +
        'draining ledger that keeps its drained entries stops being a measurement.\n',
    );
    for (const key of result.staleUnpublishedResolutions) console.error(`  - ${key}`);
  }

  if (result.staleLedgerEntries.length > 0) {
    console.error(
      '\nA `PORTS_WITHOUT_A_REGISTRATION` entry no longer describes the tree: the port has\n' +
        'gained a registration, or it is no longer published. Delete the entry.\n',
    );
    for (const portName of result.staleLedgerEntries) console.error(`  - ${portName}`);
  }

  if (result.declaredElsewhere.length > 0) {
    console.error(
      '\nAn interface one module declares is registered by another, which names it at no\n' +
        '`implements` clause (D-171.1). Declaring a port on the consumer side is licensed\n' +
        'only against that condition: `lazyPort<T>` is an unchecked cast and verifies\n' +
        'nothing, so everything `tsc` checks happens on the provider — TS2420 at the\n' +
        '`implements` clause, TS2345 at the explicitly typed `providePort<T>`, whose\n' +
        '`Registration<T> = Resolver<T>` puts `T` in return position. With neither, the\n' +
        'only relation between the two types is the cast, which is D-77`s rejected\n' +
        'alternative and stays refused.\n' +
        'Add the `implements` clause to the class the provider registers.\n',
    );
    for (const finding of result.declaredElsewhere) {
      console.error(
        `  - ${finding.file}:${finding.line}  ${finding.portName} is declared by ` +
          `\`${finding.declaringModule}\` and registered as \`${finding.container}\` by ` +
          `\`${finding.providingModule}\`, which implements it nowhere [${finding.kind}]`,
      );
    }
  }

  process.exit(violations > 0 ? 1 : 0);
}

// CLI only — importing this module (the unit self-test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
