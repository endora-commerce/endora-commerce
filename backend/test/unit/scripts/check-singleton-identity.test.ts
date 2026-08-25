import { describe, expect, it } from 'vitest';

import {
  bindingKey,
  checkSingletonIdentity,
  composedSingletons,
  exportedKinds,
  packagesInEntitiesRegistry,
  resolveRelative,
  WHOLE_FILE_REACHES_ALLOWED,
  type ModulePackageSurface,
  type SingletonIdentityFindingKind,
  type SingletonIdentityInput,
} from '../../../scripts/check-singleton-identity.js';

/**
 * `check-singleton-identity` — the shapes it refuses and the shapes it must not
 * (feature 080, T061).
 *
 * Every fixture here is **source text plus a package list**, which is exactly
 * what a real run hands the analysis: the walk reads files off disk and the
 * layout names the packages, and everything else — specifier resolution, the
 * derivation of what the platform composed, the both-copies-in-one-process
 * closure — happens inside. A proof that handed in resolved targets or a
 * pre-derived singleton set would exercise the last predicate and leave the
 * three stages above it unproven, which is issue #130's defect.
 */

const PKG: ModulePackageSurface = {
  moduleId: 'payment_methods',
  npmName: '@endora-commerce/mod-payment-methods',
  root: 'packages/modules/payment_methods',
};

/** The package's own registry singleton, in the shape the real one has. */
const REGISTRY_SOURCE = `
import { PaymentAdapterRegistry } from './payment-adapter-registry.js';
export const paymentAdapterRegistry = new PaymentAdapterRegistry();
`;

/** Its composition: the one place that says the container holds that object. */
const BACKEND_INDEX = `
import { paymentAdapterRegistry } from './services/registry-singleton.js';
import { PaymentMethod } from './entities/payment-method.entity.js';

export const entities = [PaymentMethod];

export function registerModule(ctx) {
  ctx.di.register({
    paymentAdapterRegistry: ctx.asFunction(() => paymentAdapterRegistry).singleton(),
  });
}
`;

const ENTITY_SOURCE = `
import { Entity } from '@mikro-orm/core';
@Entity({ tableName: 'payment_methods' })
export class PaymentMethod {}
`;

/** A plain collaborator: code, not state. A second copy of it is not a finding. */
const HELPER_SOURCE = `
export function formatAdapterKey(key) { return key.trim(); }
export class PaymentMethodEligibilityService {}
`;

/** The generated composition — this is what puts the artefact in the process. */
const COMPOSITION = `
import * as module1 from '@endora-commerce/mod-payment-methods/backend';
export const MODULES = [module1];
`;

/** The harness every integration test reaches the composition through. */
const HARNESS = `
import { MODULES } from '../../src/composition.generated.js';
export function setupBackendServer() { return MODULES; }
`;

const PACKAGE_FILES: Record<string, string> = {
  'packages/modules/payment_methods/src/backend/index.ts': BACKEND_INDEX,
  'packages/modules/payment_methods/src/backend/services/registry-singleton.ts': REGISTRY_SOURCE,
  'packages/modules/payment_methods/src/backend/services/payment-adapter-registry.ts':
    'export class PaymentAdapterRegistry {}',
  'packages/modules/payment_methods/src/backend/entities/payment-method.entity.ts': ENTITY_SOURCE,
  'packages/modules/payment_methods/src/backend/services/helpers.ts': HELPER_SOURCE,
  'backend/src/composition.generated.ts': COMPOSITION,
  'backend/test/helpers/test-server.ts': HARNESS,
};

function inputWith(consumers: Record<string, string>): SingletonIdentityInput {
  return {
    sources: new Map(Object.entries({ ...PACKAGE_FILES, ...consumers })),
    packages: [PKG],
  };
}

function findingsOf(
  consumers: Record<string, string>,
  kind: SingletonIdentityFindingKind,
  allowed: Readonly<Record<string, string>> = {},
): number {
  return checkSingletonIdentity(inputWith(consumers), allowed).findings.filter(
    (finding) => finding.kind === kind,
  ).length;
}

/** A consumer that composes the platform — conjunct 1 true. */
const composing = (body: string): Record<string, string> => ({
  'backend/test/integration/x.test.ts': `import { setupBackendServer } from '../helpers/test-server.js';\n${body}`,
});

describe('composed-singleton-reach — the container holds the other copy', () => {
  it('refuses a value reach onto a singleton the package registers', () => {
    const findings = checkSingletonIdentity(
      inputWith(
        composing(
          "import { paymentAdapterRegistry } from '../../../packages/modules/payment_methods/src/backend/services/registry-singleton.js';",
        ),
      ),
      {},
    ).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe('composed-singleton-reach');
    expect(findings[0]?.binding).toBe('paymentAdapterRegistry');
    expect(findings[0]?.moduleId).toBe('payment_methods');
    expect(findings[0]?.why).toContain('composed container');
  });

  it('refuses the same reach written as `asValue`', () => {
    const asValue = {
      ...PACKAGE_FILES,
      'packages/modules/payment_methods/src/backend/index.ts': BACKEND_INDEX.replace(
        'ctx.asFunction(() => paymentAdapterRegistry).singleton()',
        'ctx.asValue(paymentAdapterRegistry)',
      ),
    };
    const result = checkSingletonIdentity(
      {
        sources: new Map(
          Object.entries({
            ...asValue,
            ...composing(
              "import { paymentAdapterRegistry } from '../../../packages/modules/payment_methods/src/backend/services/registry-singleton.js';",
            ),
          }),
        ),
        packages: [PKG],
      },
      {},
    );
    expect(result.findings.map((f) => f.kind)).toEqual(['composed-singleton-reach']);
  });

  it("refuses a value reach onto a class in the package's published entities array", () => {
    // D-160.6's own subject, now derived from the artefact rather than written
    // down: the ORM keys metadata on the class the registry imported, so the
    // source copy is a class it never discovered.
    const findings = checkSingletonIdentity(
      inputWith(
        composing(
          "import { PaymentMethod } from '../../../packages/modules/payment_methods/src/backend/entities/payment-method.entity.js';",
        ),
      ),
      {},
    ).findings;
    expect(findings.map((f) => f.binding)).toEqual(['PaymentMethod']);
    expect(findings[0]?.why).toContain('entities array');
  });

  it('follows a re-exported specifier and a directory target', () => {
    // The two resolution shapes a hand-written reach actually uses. Both are
    // inside the analysis, so a fixture cannot skip them.
    expect(
      resolveRelative(
        'backend/test/integration/x.test.ts',
        '../../../packages/modules/payment_methods/src/backend/index.js',
        new Set(Object.keys(PACKAGE_FILES)),
      ),
    ).toBe('packages/modules/payment_methods/src/backend/index.ts');
    expect(
      resolveRelative(
        'backend/test/integration/x.test.ts',
        '../../../packages/modules/payment_methods/src/backend',
        new Set(Object.keys(PACKAGE_FILES)),
      ),
    ).toBe('packages/modules/payment_methods/src/backend/index.ts');
  });
});

describe('the conjunction, not either half', () => {
  it('clears the same reach from a file that never loads the artefact', () => {
    // The five entity reaches in this repository's unit tests are correct for
    // exactly this reason (D-168), and it is *derived* rather than ledgered:
    // one copy in the process is no copies too many.
    const result = checkSingletonIdentity(
      inputWith({
        'backend/test/unit/x.test.ts':
          "import { PaymentMethod } from '../../../packages/modules/payment_methods/src/backend/entities/payment-method.entity.js';",
      }),
      {},
    );
    expect(result.findings).toHaveLength(0);
    // …and the site was still examined, so the clean answer is a measurement.
    expect(result.sites).toBe(1);
  });

  it('clears an `import type` of the same singleton', () => {
    // The repair !982 took. A type erases, so it evaluates nothing and puts no
    // second copy in any process.
    expect(
      findingsOf(
        composing(
          "import type { PaymentAdapterRegistry } from '../../../packages/modules/payment_methods/src/backend/services/payment-adapter-registry.js';",
        ),
        'composed-singleton-reach',
      ),
    ).toBe(0);
  });

  it('clears a reach onto a function or a plain class the composition never holds', () => {
    expect(
      findingsOf(
        composing(
          "import { formatAdapterKey, PaymentMethodEligibilityService } from '../../../packages/modules/payment_methods/src/backend/services/helpers.js';",
        ),
        'composed-singleton-reach',
      ),
    ).toBe(0);
  });

  it("clears a package file reaching its own package's source", () => {
    const result = checkSingletonIdentity(inputWith({}), {});
    expect(result.findings).toHaveLength(0);
    expect(result.singletons).toBeGreaterThan(0);
  });

  it('carries conjunct 1 through a helper rather than only one hop', () => {
    // The harness is two edges away from the composition; a one-hop closure
    // would clear every integration test in this repository.
    expect(
      findingsOf(
        {
          'backend/test/helpers/orders-ports.ts':
            "import { setupBackendServer } from './test-server.js';\nexport const ports = setupBackendServer;",
          'backend/test/integration/y.test.ts':
            "import { ports } from '../helpers/orders-ports.js';\n" +
            "import { paymentAdapterRegistry } from '../../../packages/modules/payment_methods/src/backend/services/registry-singleton.js';",
        },
        'composed-singleton-reach',
      ),
    ).toBe(1);
  });
});

describe('whole-file-reach — a reach that names no binding', () => {
  it('refuses a dynamic import of a package source', () => {
    const findings = checkSingletonIdentity(
      inputWith(
        composing(
          "const m = await import('../../../packages/modules/payment_methods/src/backend/index.js');",
        ),
      ),
      {},
    ).findings;
    expect(findings.map((f) => f.kind)).toEqual(['whole-file-reach']);
  });

  it('refuses a namespace import and a side-effect import the same way', () => {
    expect(
      findingsOf(
        composing(
          "import * as backend from '../../../packages/modules/payment_methods/src/backend/index.js';",
        ),
        'whole-file-reach',
      ),
    ).toBe(1);
    expect(
      findingsOf(
        composing("import '../../../packages/modules/payment_methods/src/backend/index.js';"),
        'whole-file-reach',
      ),
    ).toBe(1);
  });

  it('is cleared by a ledger entry, and the entry going stale is a finding', () => {
    const consumer = composing(
      "const m = await import('../../../packages/modules/payment_methods/src/backend/index.js');",
    );
    const key =
      'backend/test/integration/x.test.ts:packages/modules/payment_methods/src/backend/index.ts';
    expect(checkSingletonIdentity(inputWith(consumer), { [key]: 'why' }).findings).toHaveLength(0);
    // The other direction: the same file, with the reach taken out. It is the
    // file rather than an empty tree on purpose — staleness is judged in the
    // tree that holds the file, so an entry naming a file the walk never
    // opened is skipped rather than reported (see the comment at that skip).
    const repaired = composing('const m = 1;');
    const stale = checkSingletonIdentity(inputWith(repaired), { [key]: 'why' }).findings;
    expect(stale.map((f) => f.kind)).toEqual(['stale-allowance']);
    expect(stale[0]?.file).toBe('backend/test/integration/x.test.ts');
  });
});

describe('the derivations the verdict rests on', () => {
  it('classifies a module-scope value apart from a function and a class', () => {
    const kinds = exportedKinds('x.ts', `${REGISTRY_SOURCE}\n${HELPER_SOURCE}`);
    expect(kinds.get('paymentAdapterRegistry')).toBe('value');
    expect(kinds.get('formatAdapterKey')).toBe('function');
    expect(kinds.get('PaymentMethodEligibilityService')).toBe('class');
    expect(exportedKinds('e.ts', ENTITY_SOURCE).get('PaymentMethod')).toBe('entity');
  });

  it('derives the composed set from the package, and attributes it to the declaring file', () => {
    const composed = composedSingletons(inputWith({}));
    expect(
      composed.get(
        bindingKey(
          'packages/modules/payment_methods/src/backend/services/registry-singleton.ts',
          'paymentAdapterRegistry',
        ),
      ),
    ).toContain('payment_methods');
    expect(
      composed.has(
        bindingKey(
          'packages/modules/payment_methods/src/backend/entities/payment-method.entity.ts',
          'PaymentMethod',
        ),
      ),
    ).toBe(true);
    // Not the entry file that names them — the file that declares them, which
    // is the file a reach resolves to.
    expect(
      composed.has(
        bindingKey('packages/modules/payment_methods/src/backend/index.ts', 'entities'),
      ),
    ).toBe(false);
  });

  it('reads the independent expectation out of the generated entity registry', () => {
    const registry =
      "import { AuditLogEntry } from '../kernel/audit/audit-log-entry.entity.js';\n" +
      "import { entities as paymentMethodsEntities } from '@endora-commerce/mod-payment-methods/backend';\n" +
      "import { entities as strangerEntities } from '@endora-commerce/mod-not-a-member/backend';\n";
    expect(packagesInEntitiesRegistry(registry, new Set([PKG.npmName]))).toEqual([PKG.npmName]);
    // A registry naming no package is what makes `reportReadSize` refuse rather
    // than corroborate, so the empty answer has to be reachable.
    expect(packagesInEntitiesRegistry('export const ENTITIES = [];', new Set([PKG.npmName]))).toEqual(
      [],
    );
  });
});

describe('the ledger is about sites that exist', () => {
  it('keys every entry as <file>:<target>', () => {
    for (const key of Object.keys(WHOLE_FILE_REACHES_ALLOWED)) {
      const [file, target] = key.split(':');
      expect(file, key).toMatch(/\.tsx?$/);
      expect(target, key).toMatch(/^packages\/modules\/[^/]+\/src\/.*\.tsx?$/);
    }
  });

  it('gives every entry a reason that says why the second copy is inert', () => {
    for (const [key, reason] of Object.entries(WHOLE_FILE_REACHES_ALLOWED)) {
      expect(reason.length, key).toBeGreaterThan(80);
      expect(reason, key).toMatch(/Retires|same reason|same split/);
    }
  });
});

describe('the ledger names sites this checkout still holds', () => {
  it('resolves every entry against disk, in both directions', async () => {
    // The half `checkSingletonIdentity` deliberately does not judge: it skips an
    // entry whose file the walk never opened, because a fixture tree with no
    // `test/` directory would otherwise report every entry stale. Deletion is
    // therefore ratcheted here, against the one tree where "the file is not in
    // the walk" can only mean "the file is gone".
    const { existsSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { join } = await import('node:path');
    const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
    for (const key of Object.keys(WHOLE_FILE_REACHES_ALLOWED)) {
      const [file = '', target = ''] = key.split(':');
      expect(existsSync(join(repoRoot, file)), `${key}: consumer is gone`).toBe(true);
      expect(existsSync(join(repoRoot, target)), `${key}: target is gone`).toBe(true);
    }
  });
});
