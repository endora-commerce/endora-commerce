import { describe, expect, it } from 'vitest';
import {
  analyzeSource,
  isPending,
  isViolation,
  ownerOf,
  stalePending,
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
