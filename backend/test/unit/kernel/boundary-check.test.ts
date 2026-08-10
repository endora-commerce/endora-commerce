import { describe, expect, it } from 'vitest';
import {
  analyzeSource,
  isPending,
  isViolation,
  ownerOf,
} from '../../../scripts/check-kernel-boundary.js';

/**
 * The kernel boundary rule (feature 072, T021) is satisfied today by accident:
 * the tree contains exactly six ORM relations and four of them cross a module
 * boundary. So the check's own test has to prove it can go **red**, not merely
 * that it agrees with the current tree.
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

describe('analyzeSource', () => {
  it('finds the relation target through the import that declares it', () => {
    const findings = analyzeSource(
      ENTITY(
        '@ManyToOne(() => SalesChannel, { fieldName: "sales_channel_id" })',
        "import { SalesChannel } from '../../sales_channels/entities/sales-channel.entity.js';",
      ),
      '/home/mzabielski/www/b2b-platform/backend/src/modules/search/entities/search-phrase-record.entity.ts',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      sourceOwner: 'search',
      targetOwner: 'sales_channels',
      decorator: 'ManyToOne',
      targetName: 'SalesChannel',
    });
    expect(isViolation(findings[0]!)).toBe(true);
  });

  it('ignores a plain @Property — an FK column is not an ORM relation', () => {
    const findings = analyzeSource(
      ENTITY(
        '@Property({ type: "uuid" })',
        "import { SalesChannel } from '../../sales_channels/entities/sales-channel.entity.js';",
      ),
      '/home/mzabielski/www/b2b-platform/backend/src/modules/search/entities/x.entity.ts',
    );
    expect(findings).toEqual([]);
  });

  it('reads the entity out of the object form too', () => {
    const findings = analyzeSource(
      ENTITY(
        '@ManyToMany({ entity: () => SalesChannel, pivotTable: "sales_channel_settings" })',
        "import { SalesChannel } from '../../sales_channels/entities/sales-channel.entity.js';",
      ),
      '/home/mzabielski/www/b2b-platform/backend/src/modules/settings/entities/setting.entity.ts',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.targetOwner).toBe('sales_channels');
  });
});

describe('the pending-relocation ratchet', () => {
  it('covers exactly the four relations T019 dissolves by moving SalesChannel', () => {
    const pending = [
      { sourceOwner: 'search', className: 'SearchPhraseRecord', property: 'salesChannel' },
      { sourceOwner: 'settings', className: 'Setting', property: 'salesChannels' },
      { sourceOwner: 'settings', className: 'SettingGroup', property: 'salesChannels' },
      { sourceOwner: 'settings', className: 'SettingValue', property: 'salesChannel' },
    ].map((f) => ({
      ...f,
      file: 'x',
      decorator: 'ManyToOne',
      targetName: 'SalesChannel',
      targetOwner: 'sales_channels',
    }));

    for (const finding of pending) expect(isPending(finding)).toBe(true);
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
});
