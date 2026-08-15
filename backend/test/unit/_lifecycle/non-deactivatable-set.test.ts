import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACKNOWLEDGED_PORT_EDGES,
  closureOf,
  providedPortNames,
} from '../../../scripts/check-port-dependencies.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';

/**
 * Which **real** modules may declare `nonDeactivatable` — feature 073,
 * Amendment A1.
 *
 * Everything that existed before this file was shape rules over fixtures
 * (`test/unit/contracts/module-activation-manifest.test.ts`) and a fixture-level
 * refusal in `orchestrator.test.ts`. Nothing named a shipped module, so fourteen
 * declarations drifted away from a specified four without a single test going
 * red — while `assertDeactivatable` (`orchestrator.ts`) had meanwhile made the
 * flag bind **both** presence axes, with no `--force` on either.
 *
 * The two sets this file keeps apart:
 *
 *  - the **criterion set** — the four modules the specification names as the
 *    platform's irreducible core;
 *  - the **declaring set** — every module that ships the flag, which is
 *    legitimately larger, because dependencies fail closed: a module a criterion
 *    module cannot run without must not be switchable off either.
 *
 * Three grounds are admissible, and they are asserted separately so that adding
 * or dropping a declaration is a deliberate edit rather than a silent drift.
 */

/** The specification's criterion set. Changing it is a specification change. */
const CRITERION_MODULES = ['admin_roles', 'admin_users', 'auth', 'organizations'] as const;

type Ground =
  /** Named by the specification itself. */
  | 'criterion'
  /** `_`-prefixed platform-internal module; the manifest schema forces the flag. */
  | 'infrastructure-prefix'
  /** In the transitive manifest-`dependencies` closure of a criterion module. */
  | 'dependency-closure'
  /** Owns a port a criterion module resolves through an acknowledged edge. */
  | 'acknowledged-port-edge';

/**
 * Every declaring module outside the criterion set, with the one ground that
 * carries it. Kept literal on purpose: the grounds below are *computed*, so a
 * wrong entry fails just as loudly as a missing one.
 */
const EXPECTED_GROUNDS: Readonly<Record<string, Ground>> = {
  _i18n: 'infrastructure-prefix',
  _lifecycle: 'infrastructure-prefix',
  addresses: 'acknowledged-port-edge',
  customer_accounts: 'acknowledged-port-edge',
  custom_fields: 'dependency-closure',
  dictionaries: 'dependency-closure',
  languages: 'dependency-closure',
};

/** The three the amendment moves onto an operator control. */
const NEWLY_DEACTIVATABLE = ['admin_actions', 'delivery_methods', 'payment_methods'] as const;

const manifestsById = new Map(REGISTERED_MANIFESTS.map((e) => [e.manifest.id, e]));

const dependencies: ReadonlyMap<string, readonly string[]> = new Map(
  REGISTERED_MANIFESTS.map((e) => [e.manifest.id, e.manifest.dependencies]),
);

const declaringModules = REGISTERED_MANIFESTS.filter(
  (e) => e.manifest.activation && 'nonDeactivatable' in e.manifest.activation,
)
  .map((e) => e.manifest.id)
  .sort();

/** The union of the criterion modules' transitive dependency closures. */
const criterionClosure = new Set<string>(
  CRITERION_MODULES.flatMap((id) => [...closureOf(id, dependencies)]),
);

/**
 * The port edges a criterion module genuinely has but deliberately does **not**
 * declare in its manifest, because declaring them would close a cycle. Read from
 * `ACKNOWLEDGED_PORT_EDGES` rather than copied: a closure computed from manifest
 * `dependencies` alone is silently wrong for exactly `addresses` and
 * `customer_accounts`, which is the trap this whole amendment came out of.
 */
function portEdgeJustifiedModules(): Set<string> {
  const criterionResolvers = new Set<string>([...CRITERION_MODULES, ...criterionClosure]);
  const acknowledgedPorts = new Set<string>();
  for (const key of Object.keys(ACKNOWLEDGED_PORT_EDGES)) {
    const separator = key.indexOf(':');
    const resolver = key.slice(0, separator);
    const port = key.slice(separator + 1);
    if (criterionResolvers.has(resolver)) acknowledgedPorts.add(port);
  }

  const owners = new Set<string>();
  for (const [id, entry] of manifestsById) {
    const backend = join(dirname(entry.filePath), 'backend.ts');
    if (!existsSync(backend)) continue;
    const provided = providedPortNames(readFileSync(backend, 'utf8'), backend);
    if (provided.some((name) => acknowledgedPorts.has(name))) owners.add(id);
  }
  return owners;
}

const portEdgeJustified = portEdgeJustifiedModules();

/**
 * The one ground a declaration rests on.
 *
 * The `_` prefix is checked first because it is the *stronger* statement: the
 * manifest schema refuses any other form for such a module, so the flag is there
 * whatever the dependency graph happens to say this week.
 */
function groundFor(moduleId: string): Ground | null {
  if (moduleId.startsWith('_')) return 'infrastructure-prefix';
  if ((CRITERION_MODULES as readonly string[]).includes(moduleId)) return 'criterion';
  if (criterionClosure.has(moduleId)) return 'dependency-closure';
  if (portEdgeJustified.has(moduleId)) return 'acknowledged-port-edge';
  return null;
}

describe('nonDeactivatable — the criterion set (ground 1)', () => {
  it('is exactly the four modules the specification names', () => {
    expect([...CRITERION_MODULES].sort()).toEqual([
      'admin_roles',
      'admin_users',
      'auth',
      'organizations',
    ]);
  });

  it('every criterion module declares the flag', () => {
    const missing = CRITERION_MODULES.filter((id) => !declaringModules.includes(id));
    expect(missing).toEqual([]);
  });

  it('no module outside the criterion set is carried by the criterion ground', () => {
    const carried = declaringModules.filter((id) => groundFor(id) === 'criterion');
    expect(carried.sort()).toEqual([...CRITERION_MODULES].sort());
  });
});

describe('nonDeactivatable — the declaring set beyond the criterion (grounds 2 and 3)', () => {
  it('every further declaration rests on exactly the ground recorded for it', () => {
    const computed: Record<string, Ground | null> = {};
    for (const id of declaringModules) {
      if ((CRITERION_MODULES as readonly string[]).includes(id)) continue;
      computed[id] = groundFor(id);
    }
    expect(computed).toEqual(EXPECTED_GROUNDS);
  });

  it('the `_`-prefixed pair holds the flag under the prefix rule, not the criterion', () => {
    for (const id of ['_i18n', '_lifecycle']) {
      expect(declaringModules).toContain(id);
      expect(groundFor(id)).toBe('infrastructure-prefix');
      expect((CRITERION_MODULES as readonly string[]).includes(id)).toBe(false);
    }
  });

  it('the closure trio is genuinely reachable from `organizations` manifest dependencies', () => {
    const organizationsClosure = closureOf('organizations', dependencies);
    for (const id of ['custom_fields', 'dictionaries', 'languages']) {
      expect(organizationsClosure.has(id)).toBe(true);
    }
  });

  it('`addresses` and `customer_accounts` are carried by a port edge, not by the closure', () => {
    for (const id of ['addresses', 'customer_accounts']) {
      // The trap: both are absent from every criterion module's declared
      // dependencies on purpose — declaring the edge would close a cycle — so a
      // closure-only check would report them unjustified and drop them.
      expect(criterionClosure.has(id)).toBe(false);
      expect(portEdgeJustified.has(id)).toBe(true);
    }
  });
});

describe('nonDeactivatable — no declaration without a ground', () => {
  it('holds for every declaring module', () => {
    const unjustified = declaringModules.filter((id) => groundFor(id) === null);
    expect(unjustified).toEqual([]);
  });

  it('the modules the amendment releases declare an operator activation control instead', () => {
    for (const id of NEWLY_DEACTIVATABLE) {
      const activation = manifestsById.get(id)?.manifest.activation;
      expect(activation, `${id} has no activation declaration`).toBeDefined();
      expect(activation, `${id} still declares itself non-deactivatable`).not.toHaveProperty(
        'nonDeactivatable',
      );
      expect(activation).toHaveProperty('settingCode', `${id}.enabled`);
      expect(activation).toHaveProperty('default', true);
    }
  });
});
