import { describe, expect, it } from 'vitest';

import {
  bindingKey,
  chainParentReaches,
  chainParentSubjects,
  checkSingletonIdentity,
  composedSingletons,
  entityClassLocations,
  exportedKinds,
  packagesInEntitiesRegistry,
  resolveRelative,
  transitiveParents,
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

/**
 * `chain-parent-reach` — the shape batch four had to catch by hand (T061a).
 *
 * Its own fixture set rather than the one above, because the subject is a
 * different arrangement of packages: an entity class in one package, the
 * `@TransitivelyScoped` child that names it in another, and a **service**
 * between the consumer and the entity — which is the whole point. Every fixture
 * is source text and a package list, exactly as the real run hands them in.
 *
 * Modelled on the live case: `invoices` owns `Invoice`, `ksef` owns
 * `KsefSubmission` (`@TransitivelyScoped('Invoice', 'invoiceId')`), and seven
 * test-tree files reached `Invoice` through an `invoices` service.
 */
const BILLING: ModulePackageSurface = {
  moduleId: 'billing',
  npmName: '@endora-commerce/mod-billing',
  root: 'packages/modules/billing',
};

const FILINGS: ModulePackageSurface = {
  moduleId: 'filings',
  npmName: '@endora-commerce/mod-filings',
  root: 'packages/modules/filings',
};

const CHAIN_FILES: Record<string, string> = {
  'packages/modules/billing/src/backend/entities/document.entity.ts':
    "import { Entity } from '@mikro-orm/core';\n" +
    "@Entity({ tableName: 'documents' })\nexport class Document {}\n",
  // The service between the consumer and the entity: it names the class, the
  // consumer names the service, and nothing in the consumer mentions `Document`.
  'packages/modules/billing/src/backend/services/document-corrections.ts':
    "import { Document } from '../entities/document.entity.js';\n" +
    'export class DocumentCorrections { constructor() { void Document; } }\n',
  'packages/modules/billing/src/backend/index.ts':
    "import { Document } from './entities/document.entity.js';\n" +
    'export const entities = [Document];\n' +
    'export function registerModule(ctx) { void ctx; }\n',
  // The child, in a *second* package — both of this platform's chains cross a
  // module boundary (D-169), so a fixture with one package would prove a
  // narrower rule than the one that exists.
  'packages/modules/filings/src/backend/entities/filing.entity.ts':
    "import { Entity } from '@mikro-orm/core';\n" +
    "import { TransitivelyScoped } from '@endora-commerce/platform/tenancy';\n" +
    "@Entity({ tableName: 'filings' })\n@TransitivelyScoped('Document', 'documentId')\n" +
    'export class Filing {}\n',
  'packages/modules/filings/src/backend/index.ts':
    "import { Filing } from './entities/filing.entity.js';\n" +
    'export const entities = [Filing];\n',
  'backend/src/composition.generated.ts':
    "import * as billing from '@endora-commerce/mod-billing/backend';\n" +
    "import * as filings from '@endora-commerce/mod-filings/backend';\n" +
    'export const MODULES = [billing, filings];\n',
  'backend/test/helpers/test-server.ts':
    "import { MODULES } from '../../src/composition.generated.js';\n" +
    'export function setupBackendServer() { return MODULES; }\n',
};

function chainInput(consumers: Record<string, string>): SingletonIdentityInput {
  return {
    sources: new Map(Object.entries({ ...CHAIN_FILES, ...consumers })),
    packages: [BILLING, FILINGS],
  };
}

/** A consumer that composes the platform — conjunct 1 true for the file itself. */
const composingChain = (body: string): Record<string, string> => ({
  'backend/test/integration/billing.test.ts':
    "import { setupBackendServer } from '../helpers/test-server.js';\n" + body,
});

const SERVICE_REACH =
  "import { DocumentCorrections } from " +
  "'../../../packages/modules/billing/src/backend/services/document-corrections.js';";

describe('chain-parent-reach — the duplication the platform refuses', () => {
  it('refuses a service reach whose own import pulls a @TransitivelyScoped parent', () => {
    const findings = checkSingletonIdentity(chainInput(composingChain(SERVICE_REACH)), {}).findings;
    expect(findings.map((finding) => finding.kind)).toEqual(['chain-parent-reach']);
    expect(findings[0]?.binding).toBe('Document');
    expect(findings[0]?.moduleId).toBe('billing');
    expect(findings[0]?.target).toBe(
      'packages/modules/billing/src/backend/entities/document.entity.ts',
    );
    // The reason is what an author acts on: the child that names the parent, the
    // failure it produces, and the path the specifier took to get there.
    expect(findings[0]?.why).toContain('Filing');
    expect(findings[0]?.why).toContain('UnresolvableTenantParentError');
    expect(findings[0]?.why).toContain(
      'packages/modules/billing/src/backend/services/document-corrections.ts -> ' +
        'packages/modules/billing/src/backend/entities/document.entity.ts',
    );
    expect(findings[0]?.why).toContain('1 hop(s)');
  });

  it('refuses the reach from a helper that loads the artefact only through its callers', () => {
    // Batch four's seventh site. `orders-neighbour-ports.ts` reaches the harness
    // through `import type`, so its *own* closure holds one copy and the narrow
    // conjunct 1 clears it — while every test that imports it holds both and
    // dies in `setupBackendServer`.
    const findings = checkSingletonIdentity(
      chainInput({
        'backend/test/helpers/billing-ports.ts':
          `${SERVICE_REACH}\n` +
          "import type { setupBackendServer } from './test-server.js';\n" +
          'export const ports = { DocumentCorrections };\n',
        'backend/test/integration/orders.test.ts':
          "import { setupBackendServer } from '../helpers/test-server.js';\n" +
          "import { ports } from '../helpers/billing-ports.js';\n",
      }),
      {},
    ).findings;
    expect(findings.map((finding) => finding.kind)).toEqual(['chain-parent-reach']);
    expect(findings[0]?.file).toBe('backend/test/helpers/billing-ports.ts');
  });

  it('follows a second hop, which is where a cap of one would go blind', () => {
    // Measured on the real tree: two live consumers sit at two hops today. The
    // fixture stretches the same chain by one file rather than asserting the
    // number, so the proof is about the walk and not about this repository.
    const findings = checkSingletonIdentity(
      chainInput({
        'packages/modules/billing/src/backend/routes.admin.ts':
          "import { DocumentCorrections } from './services/document-corrections.js';\n" +
          'export function registerRoutes() { return DocumentCorrections; }\n',
        ...composingChain(
          "import { registerRoutes } from " +
            "'../../../packages/modules/billing/src/backend/routes.admin.js';",
        ),
      }),
      {},
    ).findings;
    expect(findings.map((finding) => finding.kind)).toEqual(['chain-parent-reach']);
    expect(findings[0]?.why).toContain('2 hop(s)');
  });
});

describe('chain-parent-reach — the cases it must not fire on', () => {
  it('clears the same reach from a process that holds one copy', () => {
    // The control conjunct 1 is: a unit test that composes nothing has no second
    // copy to disagree with (D-168), whatever its import graph loads.
    const result = checkSingletonIdentity(
      chainInput({ 'backend/test/unit/billing.test.ts': SERVICE_REACH }),
      {},
    );
    expect(result.findings).toHaveLength(0);
    expect(result.sites).toBe(1);
  });

  it('clears a transitively reached entity that no tenant chain names', () => {
    // The narrowing itself. Without it the signal is "any composed singleton
    // reached transitively", which is several hundred correct reaches and a
    // ledger of nothing but exceptions.
    const withoutTheChild = { ...CHAIN_FILES };
    delete withoutTheChild['packages/modules/filings/src/backend/entities/filing.entity.ts'];
    const result = checkSingletonIdentity(
      {
        sources: new Map(
          Object.entries({ ...withoutTheChild, ...composingChain(SERVICE_REACH) }),
        ),
        packages: [BILLING, FILINGS],
      },
      {},
    );
    expect(result.findings).toHaveLength(0);
    expect(result.chainParentNames).toEqual([]);
    // …and the site was examined, so the clean answer is a measurement.
    expect(result.sites).toBe(1);
  });

  it('clears a chain whose middle edge is a type', () => {
    const typeOnlyMiddle = {
      ...CHAIN_FILES,
      'packages/modules/billing/src/backend/services/document-corrections.ts':
        "import type { Document } from '../entities/document.entity.js';\n" +
        'export class DocumentCorrections { }\n',
    };
    const result = checkSingletonIdentity(
      {
        sources: new Map(Object.entries({ ...typeOnlyMiddle, ...composingChain(SERVICE_REACH) })),
        packages: [BILLING, FILINGS],
      },
      {},
    );
    expect(result.findings).toHaveLength(0);
  });

  it('reports a direct reach on the class once, as the named-binding finding', () => {
    const findings = checkSingletonIdentity(
      chainInput(
        composingChain(
          "import { Document } from " +
            "'../../../packages/modules/billing/src/backend/entities/document.entity.js';",
        ),
      ),
      {},
    ).findings;
    expect(findings.map((finding) => finding.kind)).toEqual(['composed-singleton-reach']);
  });
});

describe('the chain-parent population, and the four ways it refuses to guess', () => {
  it('names a parent only for a decorator on a persisted class', () => {
    const scan = transitiveParents(
      new Map([
        [
          'packages/modules/filings/src/backend/entities/filing.entity.ts',
          CHAIN_FILES['packages/modules/filings/src/backend/entities/filing.entity.ts'] ?? '',
        ],
        // The tenancy suite's shape: a synthetic class exercising the registry,
        // carrying no `@Entity()`. 29 of these stand in this tree and every one
        // of them would put a name nothing declares into the reconciliation.
        [
          'backend/test/unit/tenancy/chains.test.ts',
          "@TransitivelyScoped('AnEntityThisPlatformDoesNotHave', 'x')\nclass Synthetic {}\n",
        ],
        // And the shape a text scan gets wrong: the decorator quoted in prose.
        [
          'packages/contracts/src/invoices.ts',
          '/** `Invoice` is `@TransitivelyScoped` through `Order`. */\nexport const x = 1;\n',
        ],
      ]),
    );
    expect([...scan.parents.keys()]).toEqual(['Document']);
    expect(scan.parents.get('Document')).toEqual(['Filing']);
    expect(scan.unreadable).toEqual([]);
  });

  it('refuses a parent it cannot read rather than shortening the population', () => {
    const scan = transitiveParents(
      new Map([
        [
          'packages/modules/filings/src/backend/entities/filing.entity.ts',
          "@Entity({ tableName: 'filings' })\n@TransitivelyScoped(PARENT_NAME, 'documentId')\n" +
            'export class Filing {}\n',
        ],
      ]),
    );
    expect(scan.parents.size).toBe(0);
    expect(scan.unreadable).toEqual([
      'packages/modules/filings/src/backend/entities/filing.entity.ts:2',
    ]);
  });

  it('reconciles each named parent against the class the walk actually read', () => {
    const full = checkSingletonIdentity(chainInput({}), {});
    expect(full.chainParentNames).toEqual(['Document']);
    expect(full.resolvedChainParentNames).toEqual(['Document']);
    // #215 over this population: the walk lost the root holding the parent's
    // declaration, so the name is still derived and no longer resolves — which
    // is a `short-walk` refusal rather than a clean run over a residue.
    const withoutTheParent = { ...CHAIN_FILES };
    delete withoutTheParent['packages/modules/billing/src/backend/entities/document.entity.ts'];
    const short = checkSingletonIdentity(
      { sources: new Map(Object.entries(withoutTheParent)), packages: [BILLING, FILINGS] },
      {},
    );
    expect(short.chainParentNames).toEqual(['Document']);
    expect(short.resolvedChainParentNames).toEqual([]);
  });

  it('derives the subject from the package artefact, not from the decorator alone', () => {
    // Two derivations meet here: the class is a chain parent *and* the platform
    // composed it out of the package's own `entities` array. `Order` is the live
    // case for the other side — a chain parent in the application tree, which
    // has no `dist` twin for anything to duplicate.
    const input = chainInput({});
    const subjects = chainParentSubjects(input);
    expect(subjects.map((subject) => subject.className)).toEqual(['Document']);
    expect(subjects[0]?.moduleId).toBe('billing');
    expect(subjects[0]?.file).toBe(
      'packages/modules/billing/src/backend/entities/document.entity.ts',
    );
    const notComposed = {
      ...CHAIN_FILES,
      'packages/modules/billing/src/backend/index.ts':
        'export const entities = [];\nexport function registerModule(ctx) { void ctx; }\n',
    };
    expect(
      chainParentSubjects({
        sources: new Map(Object.entries(notComposed)),
        packages: [BILLING, FILINGS],
      }),
    ).toEqual([]);
  });

  it('locates every entity class the walk read, by name', () => {
    const found = entityClassLocations(new Map(Object.entries(CHAIN_FILES)));
    expect(found.get('Document')).toEqual([
      'packages/modules/billing/src/backend/entities/document.entity.ts',
    ]);
    expect(found.has('DocumentCorrections')).toBe(false);
  });

  it('walks the shortest path and stops, with no depth given to it', () => {
    const hits = chainParentReaches(
      new Map([
        ['a.ts', ['b.ts']],
        ['b.ts', ['c.ts']],
        ['c.ts', ['entity.ts']],
        // A cycle, which is what makes "walk to exhaustion" a claim worth
        // proving rather than an invitation to hang.
        ['entity.ts', ['a.ts']],
      ]),
      [{ file: 'entity.ts', className: 'Document', moduleId: 'billing', children: ['Filing'] }],
    );
    expect(hits.get('c.ts')?.[0]?.hops).toBe(1);
    expect(hits.get('a.ts')?.[0]?.hops).toBe(3);
    expect(hits.get('a.ts')?.[0]?.via).toEqual(['a.ts', 'b.ts', 'c.ts', 'entity.ts']);
  });
});
