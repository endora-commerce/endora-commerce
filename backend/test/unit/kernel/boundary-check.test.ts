import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analyzeKernelImports,
  analyzeSource,
  importFindingKey,
  isDraining,
  isImportViolation,
  isPending,
  isViolation,
  ownerOf,
  stalePending,
  staleDraining,
  KERNEL_MODULE_IMPORTS_TO_DRAIN,
  PENDING_RELOCATION,
} from '../../../scripts/check-kernel-boundary.js';

/**
 * The kernel boundary rule (feature 072, T021) is satisfied by construction now
 * that T018/T019 have landed: every remaining cross-owner ORM relation points
 * into the kernel. So the check's own test has to prove it can go **red**, not
 * merely that it agrees with the current tree.
 *
 * `analyzeSource` resolves a relation target through the import that declares
 * it, and skips a specifier that does not resolve to a file on disk — so these
 * fixtures must name entities that really exist.
 */

const ENTITY = (relation: string, imports: string): string => `
${imports}
@Entity()
export class Thing {
  ${relation}
  other!: unknown;
}
`;

describe('ownerOf', () => {
  it('reads the module id out of the path', () => {
    expect(ownerOf('/repo/backend/src/modules/search/entities/x.entity.ts')).toBe('search');
  });

  it('calls the kernel the kernel', () => {
    expect(ownerOf('/repo/backend/src/kernel/audit/x.entity.ts')).toBe('kernel');
  });

  it('calls pre-split core entities core', () => {
    expect(ownerOf('/repo/backend/src/db/entities/x.entity.ts')).toBe('core');
  });
});

describe('isViolation', () => {
  const finding = (sourceOwner: string, targetOwner: string) => ({
    file: 'x',
    className: 'Thing',
    property: 'other',
    decorator: 'ManyToOne',
    targetName: 'Other',
    sourceOwner,
    targetOwner,
  });

  it('allows a relation inside one module', () => {
    expect(isViolation(finding('orders', 'orders'))).toBe(false);
  });

  it('allows a module to relate into the kernel', () => {
    expect(isViolation(finding('search', 'kernel'))).toBe(false);
  });

  it('forbids a module relating into another module', () => {
    expect(isViolation(finding('search', 'sales_channels'))).toBe(true);
  });

  it('forbids the kernel relating into a module', () => {
    expect(isViolation(finding('kernel', 'catalog'))).toBe(true);
  });
});

/** A cross-module import that still resolves after the D-32 relocations. */
const CATALOG_CATEGORY_IMPORT =
  "import { Category } from '../../catalog/entities/category.entity.js';";

describe('analyzeSource', () => {
  it('finds the relation target through the import that declares it', () => {
    const findings = analyzeSource(
      ENTITY(
        '@ManyToOne(() => Category, { fieldName: "category_id" })',
        CATALOG_CATEGORY_IMPORT,
      ),
      '/home/mzabielski/www/b2b-platform/backend/src/modules/search/entities/search-phrase-record.entity.ts',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      sourceOwner: 'search',
      targetOwner: 'catalog',
      decorator: 'ManyToOne',
      targetName: 'Category',
    });
    expect(isViolation(findings[0]!)).toBe(true);
  });

  it('ignores a plain @Property — an FK column is not an ORM relation', () => {
    const findings = analyzeSource(
      ENTITY('@Property({ type: "uuid" })', CATALOG_CATEGORY_IMPORT),
      '/home/mzabielski/www/b2b-platform/backend/src/modules/search/entities/x.entity.ts',
    );
    expect(findings).toEqual([]);
  });

  it('reads the entity out of the object form too', () => {
    const findings = analyzeSource(
      ENTITY(
        '@ManyToMany({ entity: () => Category, pivotTable: "setting_categories" })',
        CATALOG_CATEGORY_IMPORT,
      ),
      '/home/mzabielski/www/b2b-platform/backend/src/modules/settings/entities/setting.entity.ts',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.targetOwner).toBe('catalog');
  });

  it('allows the relocated settings → SalesChannel relations, now kernel-internal', () => {
    const findings = analyzeSource(
      ENTITY(
        '@ManyToOne(() => SalesChannel, { fieldName: "sales_channel_id" })',
        "import { SalesChannel } from '../../../kernel/sales-channels/sales-channel.entity.js';",
      ),
      '/home/mzabielski/www/b2b-platform/backend/src/modules/search/entities/search-phrase-record.entity.ts',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.targetOwner).toBe('kernel');
    expect(isViolation(findings[0]!)).toBe(false);
  });
});

describe('the pending-relocation ratchet', () => {
  it('is empty — T018 and T019 dissolved every entry it carried', () => {
    // The completion signal for D-32: the four SalesChannel relations became
    // module→kernel (search) or kernel-internal (settings), so nothing is
    // pending. A non-empty list here is a debt marker, never an exemption.
    expect(PENDING_RELOCATION).toEqual([]);
  });

  it('does not cover a new cross-module relation', () => {
    expect(
      isPending({
        file: 'x',
        className: 'Invoice',
        property: 'order',
        decorator: 'ManyToOne',
        targetName: 'Order',
        sourceOwner: 'invoices',
        targetOwner: 'orders',
      }),
    ).toBe(false);
  });

  it('reports nothing stale while the list is empty', () => {
    expect(stalePending([])).toEqual([]);
  });
});

/**
 * The import rule (D-37). The relation rule above polices foreign keys; this one
 * polices specifiers, which is the mechanism the kernel actually reached into
 * `src/modules/` through. As with the relation rule the fixtures are synthetic,
 * so the check has to be able to go **red** on shapes the tree does not contain
 * yet — every specifier form of the plan's §4.2 table.
 */
const BACKEND_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const kernelFile = (relative: string): string => join(BACKEND_ROOT, 'src/kernel', relative);

describe('analyzeKernelImports', () => {
  it('finds a value import into a module and names its bindings', () => {
    const findings = analyzeKernelImports(
      "import { ModuleDisabledError } from '../../modules/_lifecycle/plugin-helpers.js';",
      kernelFile('ports/provide.ts'),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      targetOwner: '_lifecycle',
      bindings: ['ModuleDisabledError'],
      kind: 'import',
      line: 1,
    });
    expect(isImportViolation(findings[0]!)).toBe(true);
  });

  it('refuses a type-only import — it does not erase from a package.json', () => {
    const findings = analyzeKernelImports(
      "import type { Organization } from '../../modules/organizations/entities/organization.entity.js';",
      kernelFile('ports/organizations.ts'),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.targetOwner).toBe('organizations');
    expect(isImportViolation(findings[0]!)).toBe(true);
  });

  it('refuses the inline `import(…).Type` annotation ESLint encourages', () => {
    const findings = analyzeKernelImports(
      'export type Org = import("../../modules/organizations/entities/organization.entity.js").Organization;',
      kernelFile('ports/organizations.ts'),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ targetOwner: 'organizations', kind: 'import-type' });
    expect(isImportViolation(findings[0]!)).toBe(true);
  });

  it('refuses a re-export — an import with a wider blast radius', () => {
    const findings = analyzeKernelImports(
      "export { Category } from '../modules/catalog/entities/category.entity.js';",
      kernelFile('index.ts'),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ targetOwner: 'catalog', kind: 'export' });
    expect(isImportViolation(findings[0]!)).toBe(true);
  });

  it('refuses a dynamic import', () => {
    const findings = analyzeKernelImports(
      "const m = await import('../modules/catalog/backend.js');",
      kernelFile('compose.ts'),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ targetOwner: 'catalog', kind: 'dynamic' });
  });

  it('refuses a require()', () => {
    const findings = analyzeKernelImports(
      "const m = require('../modules/catalog/backend.js');",
      kernelFile('compose.ts'),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ targetOwner: 'catalog', kind: 'require' });
  });

  it('refuses a deployment overlay module', () => {
    const findings = analyzeKernelImports(
      "import { thing } from '../apps/example/modules/example_overlay/service.js';",
      kernelFile('compose.ts'),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.targetOwner).toBe('example_overlay');
    expect(isImportViolation(findings[0]!)).toBe(true);
  });

  it('refuses a deployment decoration — a kernel that differs per deployment is not a kernel', () => {
    const findings = analyzeKernelImports(
      "import { decorate } from '../apps/example/decorations/catalog-service.js';",
      kernelFile('compose.ts'),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.targetOwner).toBe('apps/example');
    expect(isImportViolation(findings[0]!)).toBe(true);
  });

  it('allows the kernel to import a peer of the kernel', () => {
    const findings = analyzeKernelImports(
      "import { scopedEm } from '../tenancy/scoped-em.js';",
      kernelFile('container.ts'),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.targetOwner).toBeNull();
    expect(isImportViolation(findings[0]!)).toBe(false);
  });

  it('ignores a kernel-internal import and a package specifier', () => {
    const findings = analyzeKernelImports(
      ["import { asFunction } from 'awilix';", "import { x } from './container.js';"].join('\n'),
      kernelFile('ports/provide.ts'),
    );
    expect(findings).toEqual([]);
  });

  it('says nothing about a module importing the kernel — that direction is allowed', () => {
    const findings = analyzeKernelImports(
      "import { registerPort } from '../../kernel/ports/provide.js';",
      join(BACKEND_ROOT, 'src/modules/catalog/backend.ts'),
    );
    expect(findings).toEqual([]);
  });

  it('does not gate on the target existing on disk', () => {
    const findings = analyzeKernelImports(
      "import { gone } from '../modules/catalog/services/deleted-yesterday.js';",
      kernelFile('compose.ts'),
    );
    expect(findings).toHaveLength(1);
    expect(isImportViolation(findings[0]!)).toBe(true);
  });
});

describe('the kernel→module import ledger', () => {
  it('holds the four edges D-37 A1 inherits', () => {
    expect(Object.keys(KERNEL_MODULE_IMPORTS_TO_DRAIN).sort()).toEqual([
      'src/kernel/module-context.ts:../modules/_lifecycle/plugin-helpers.js -> _lifecycle',
      'src/kernel/ports/organizations.ts:../../modules/organizations/entities/organization.entity.js -> organizations',
      'src/kernel/ports/provide.ts:../../modules/_lifecycle/plugin-helpers.js -> _lifecycle',
      'src/kernel/ports/provide.ts:../../modules/_lifecycle/services/effective-state.js -> _lifecycle',
    ]);
  });

  it('covers a ledgered import and nothing else', () => {
    const [ledgered] = analyzeKernelImports(
      "import { effectiveState } from '../../modules/_lifecycle/services/effective-state.js';",
      kernelFile('ports/provide.ts'),
    );
    expect(importFindingKey(ledgered!)).toBe(
      'src/kernel/ports/provide.ts:../../modules/_lifecycle/services/effective-state.js -> _lifecycle',
    );
    expect(isDraining(ledgered!)).toBe(true);

    const [fresh] = analyzeKernelImports(
      "import { effectiveState } from '../../modules/_lifecycle/services/effective-state.js';",
      kernelFile('compose.ts'),
    );
    expect(isDraining(fresh!)).toBe(false);
  });

  it('fails on an entry that no longer describes an import', () => {
    expect(staleDraining([]).sort()).toEqual(Object.keys(KERNEL_MODULE_IMPORTS_TO_DRAIN).sort());
  });
});
