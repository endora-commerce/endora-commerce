import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DISCOVERED_MANIFESTS } from '../../../src/manifest-index.generated.js';
import { tenantClassifications } from '../../../src/tenancy/org-scoped.decorator.js';

/**
 * A `@TransitivelyScoped` parent has to be in **every** composition the child
 * is in — and in this repository it always is, which is why nothing measured it.
 *
 * `transitive-parent-chains.test.ts` asks whether the chains resolve. They do,
 * here: this tree composes all 72 module packages, so every parent class is
 * registered whatever any manifest says. An instance composes the set
 * `endora new instance` writes — the `nonDeactivatable` modules closed over the
 * manifests' `dependencies` — and that set is smaller. A parent whose owner is
 * outside the child's own closure is a class the instance never loads, and the
 * reconciliation in `org-scoped.decorator.ts` refuses the boot:
 *
 * ```
 * InvoiceLedgerDelivery (fk 'invoiceId') is scoped through 'Invoice', and no
 * classified entity of that name is registered in this platform.
 * ```
 *
 * That is A3 of the instance acceptance criterion on pipeline 13835, and the
 * criterion is the **only** instrument that saw it: `registry` mode installs
 * what the manifests declare, while the criterion's `tarball` mode pins the
 * package closure, so `mod-invoices` arrived there as a non-optional peer of
 * `mod-orders` and the same tree migrated. A defect a supply route decides is
 * one this suite has to be able to state without either.
 *
 * ## The predicate, and why it is closure and not presence
 *
 * A manifest `dependencies` entry is what makes a module's presence real to the
 * install order and to `endora new instance`'s set (`module-composition.md` §4).
 * So a chain is well-founded when the parent's owner is the child's own module,
 * the platform itself — which arrives with every instance — or a module in the
 * child's transitive `dependencies` closure. **Anything else is a chain that
 * holds by accident of this repository composing everything.**
 *
 * It is deliberately not "is the parent registered", which is what the boot
 * reconciliation asks and what this tree answers `yes` to for every possible
 * chain.
 *
 * ## What it does not do
 *
 * It does not tell an author to add the dependency. For a `nonDeactivatable`
 * child that is precisely the move §4a forbids — it would make the parent
 * owner's activation control a dead switch — so the answer there is the
 * classification: an entity whose module can outlive its parent's module needs
 * a tenant key of its own. Both remedies are in the message.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

/** `dependencies`, transitively closed, for one module id. */
function closureOf(id: string, declared: ReadonlyMap<string, readonly string[]>): Set<string> {
  const seen = new Set<string>();
  const queue = [id];
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    for (const dependency of declared.get(next) ?? []) queue.push(dependency);
  }
  return seen;
}

/**
 * Every persisted entity class name, by the module that ships it.
 *
 * Read out of each package's own `./backend` export — the same array the
 * composer registers and the ORM is configured with — rather than off the
 * generated registry, which concatenates them and keeps no owner. A package
 * that publishes no `./backend` ships no entity and contributes nothing; a
 * package whose `./backend` cannot be loaded is a **refusal**, because a
 * population quietly one module shorter would report every chain well-founded.
 */
async function entityOwners(): Promise<ReadonlyMap<string, string>> {
  const owners = new Map<string, string>();
  const unreadable: string[] = [];
  for (const entry of DISCOVERED_MANIFESTS) {
    const packageName = packageNameOf(entry.manifestPath);
    if (packageName === null) continue;
    let entities: unknown;
    try {
      ({ entities } = (await import(`${packageName}/backend`)) as { entities?: unknown });
    } catch (error) {
      // A package declaring no `./backend` subpath owns no entity, which is its
      // own `exports` map speaking. Anything else is a read that failed.
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('ERR_PACKAGE_PATH_NOT_EXPORTED')) {
        unreadable.push(`${entry.id} (${packageName}): ${message.split('\n')[0]!}`);
      }
      continue;
    }
    if (!Array.isArray(entities)) continue;
    for (const entity of entities as { name?: string }[]) {
      if (typeof entity?.name === 'string') owners.set(entity.name, entry.id);
    }
  }
  expect(unreadable, 'packages whose `./backend` could not be read').toEqual([]);
  return owners;
}

/** The package a resolved manifest path belongs to, or `null` for the platform's own. */
function packageNameOf(manifestPath: string): string | null {
  let directory = dirname(manifestPath);
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as {
        name?: string;
      };
      if (typeof manifest.name === 'string') {
        // `_lifecycle` arrives with the platform, and the platform arrives with
        // every instance — it is never a module a set can omit.
        return manifest.name === '@endora-commerce/platform' ? null : manifest.name;
      }
    } catch {
      // Keep walking up: a `dist/` directory carries no manifest of its own.
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return null;
}

describe('a transitive tenancy chain is well-founded in every composition', () => {
  it('never scopes through a class outside the child module’s dependency closure', async () => {
    const declared = new Map(
      DISCOVERED_MANIFESTS.map((entry) => [entry.id, entry.manifest.dependencies ?? []] as const),
    );
    const owners = await entityOwners();
    // The vacuous-pass guard: a run that read no entity would satisfy every
    // assertion below, and this file's whole subject is a population.
    expect(owners.size).toBeGreaterThan(100);
    expect(REPO_ROOT.length).toBeGreaterThan(0);

    const transitive = tenantClassifications().filter((meta) => meta.scope === 'transitive');
    expect(transitive.length).toBeGreaterThan(0);

    const unfounded = transitive.flatMap((child) => {
      const childModule = owners.get(child.className);
      if (childModule === undefined) return [];
      const parentName = child.parentClassName;
      if (parentName === undefined) return [];
      const parentModule = owners.get(parentName);
      // A parent the platform itself ships is in every composition.
      if (parentModule === undefined || parentModule === childModule) return [];
      if (closureOf(childModule, declared).has(parentModule)) return [];
      return [
        `${childModule}.${child.className} is scoped through '${parentName}', which ` +
          `'${parentModule}' owns, and '${parentModule}' is not in '${childModule}'s manifest ` +
          `dependency closure. Declare it, or — where ${childModule} is nonDeactivatable and ` +
          `the entry would make ${parentModule}'s activation a dead switch — give the entity a ` +
          `tenant key of its own.`,
      ];
    });

    expect(unfounded).toEqual([]);
  });
});
