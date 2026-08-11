import { describe, expect, it } from 'vitest';
import {
  MIGRATION_FILE_RE,
  buildScaffold,
  classNameFromFile,
  formatStamp,
  migrationFileName,
  nextFreeStamp,
  normalizeSlug,
  parseStamp,
  segmentFor,
  validateModuleId,
} from '../../../scripts/new-migration.js';

/**
 * Pure parts of the migration scaffolder (FR-032, FR-033). Filesystem writes
 * are not exercised here; the rules under test are the ones
 * specs/065-manifest-aware-migrations/contracts/naming-convention.md §1, §2
 * and §6 fix.
 */

const KNOWN_IDS = new Set(['orders', 'catalog', '_i18n', '_lifecycle']);

describe('validateModuleId', () => {
  it('accepts a known module id', () => {
    expect(() => validateModuleId('orders', KNOWN_IDS)).not.toThrow();
  });

  it("accepts the 'core' pseudo-module even though it has no manifest", () => {
    expect(() => validateModuleId('core', KNOWN_IDS)).not.toThrow();
  });

  it('rejects an unknown id, naming it and listing the valid ids', () => {
    let message = '';
    try {
      validateModuleId('ghost', KNOWN_IDS);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('ghost');
    expect(message).toContain('core');
    for (const id of KNOWN_IDS) expect(message).toContain(id);
  });
});

describe('segmentFor — contracts/naming-convention.md §1', () => {
  it.each([
    ['orders', 'orders'],
    ['sales_channels', 'sales_channels'],
    ['_i18n', 'i18n'],
    ['_lifecycle', 'lifecycle'],
    ['core', 'core'],
  ])('normalizes %s to %s', (moduleId, expected) => {
    expect(segmentFor(moduleId)).toBe(expected);
  });
});

describe('normalizeSlug', () => {
  it.each([
    ['placement_intents', 'placement_intents'],
    ['Placement Intents', 'placement_intents'],
    ['add-order-column', 'add_order_column'],
    ['__weird__name__', 'weird_name'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeSlug(input)).toBe(expected);
  });

  it('rejects a slug that normalizes to nothing', () => {
    expect(() => normalizeSlug('---')).toThrow(/slug/i);
  });
});

describe('formatStamp', () => {
  it('emits fixed-width UTC YYYYMMDDTHHmmss with no separators', () => {
    expect(formatStamp(new Date(Date.UTC(2026, 7, 5, 14, 15, 30)))).toBe('20260805T141530');
  });

  it('zero-pads every component', () => {
    expect(formatStamp(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))).toBe('20260102T030405');
  });
});

describe('nextFreeStamp — collision advance', () => {
  it('returns the stamp itself when it is free', () => {
    expect(nextFreeStamp(new Date(Date.UTC(2026, 7, 5, 14, 15, 30)), new Set())).toBe(
      '20260805T141530',
    );
  });

  it('advances by one whole second past a taken stamp', () => {
    const taken = new Set(['20260805T141530']);
    expect(nextFreeStamp(new Date(Date.UTC(2026, 7, 5, 14, 15, 30)), taken)).toBe(
      '20260805T141531',
    );
  });

  it('advances past a run of taken stamps', () => {
    const taken = new Set(['20260805T141530', '20260805T141531', '20260805T141532']);
    expect(nextFreeStamp(new Date(Date.UTC(2026, 7, 5, 14, 15, 30)), taken)).toBe(
      '20260805T141533',
    );
  });

  it('rolls over a minute boundary', () => {
    const taken = new Set(['20260805T141559']);
    expect(nextFreeStamp(new Date(Date.UTC(2026, 7, 5, 14, 15, 59)), taken)).toBe(
      '20260805T141600',
    );
  });

  it('never emits a stamp inside the uncorrected block', () => {
    // A clock reading before UNCORRECTED_THROUGH would otherwise produce a
    // stamp that silently opts the migration out of dependency correction.
    expect(
      nextFreeStamp(new Date(Date.UTC(2026, 6, 30, 16, 18, 18)), new Set(), '20260801T000000'),
    ).toBe('20260801T000001');
  });

  it('treats the floor itself as taken', () => {
    expect(
      nextFreeStamp(new Date(Date.UTC(2026, 7, 1, 0, 0, 0)), new Set(), '20260801T000000'),
    ).toBe('20260801T000001');
  });

  it('leaves a stamp already past the floor alone', () => {
    expect(
      nextFreeStamp(new Date(Date.UTC(2026, 8, 1, 9, 0, 0)), new Set(), '20260801T000000'),
    ).toBe('20260901T090000');
  });

  it('still advances past a taken stamp above the floor', () => {
    expect(
      nextFreeStamp(
        new Date(Date.UTC(2026, 6, 30, 16, 18, 18)),
        new Set(['20260801T000001']),
        '20260801T000000',
      ),
    ).toBe('20260801T000002');
  });
});

describe('parseStamp', () => {
  it('round-trips formatStamp', () => {
    for (const stamp of ['20260801T000000', '20260102T030405', '20261231T235959']) {
      expect(formatStamp(parseStamp(stamp))).toBe(stamp);
    }
  });
});

describe('migrationFileName + classNameFromFile round-trip', () => {
  it.each([
    ['orders', '20260805T141530', 'placement_intents', '20260805T141530_orders_placement_intents.ts'],
    ['core', '20260424T165847', 'foundation_init', '20260424T165847_core_foundation_init.ts'],
    ['_i18n', '20260511T093000', 'admin_i18n_init', '20260511T093000_i18n_admin_i18n_init.ts'],
  ])('%s → %s', (moduleId, stamp, slug, expected) => {
    const filename = migrationFileName(stamp, moduleId, slug);
    expect(filename).toBe(expected);
    expect(MIGRATION_FILE_RE.test(filename)).toBe(true);
  });

  it('does not double the segment when the slug already starts with it', () => {
    expect(migrationFileName('20260805T141530', 'orders', 'orders_placement')).toBe(
      '20260805T141530_orders_placement.ts',
    );
  });

  it.each([
    ['20260805T141530_orders_placement_intents.ts', 'Migration20260805T141530OrdersPlacementIntents'],
    ['20260424T165847_core_foundation_init.ts', 'Migration20260424T165847CoreFoundationInit'],
    ['20260511T093000_i18n_admin_i18n_init.ts', 'Migration20260511T093000I18nAdminI18nInit'],
  ])('derives the class name of %s', (filename, expected) => {
    expect(classNameFromFile(filename)).toBe(expected);
  });
});

describe('buildScaffold', () => {
  const scaffold = buildScaffold({
    moduleId: 'orders',
    slug: 'placement intents',
    stamp: '20260805T141530',
  });

  it('produces a filename and a class name that agree', () => {
    expect(scaffold.filename).toBe('20260805T141530_orders_placement_intents.ts');
    expect(scaffold.className).toBe(classNameFromFile(scaffold.filename));
  });

  it('targets the owning module directory', () => {
    expect(scaffold.relativePath).toBe(
      'src/modules/orders/migrations/20260805T141530_orders_placement_intents.ts',
    );
  });

  it('puts core migrations in src/db/migrations', () => {
    const core = buildScaffold({ moduleId: 'core', slug: 'tenant_indexes', stamp: '20260805T141530' });
    expect(core.relativePath).toBe('src/db/migrations/20260805T141530_core_tenant_indexes.ts');
  });

  it('emits a compiling migration body with empty up/down', () => {
    expect(scaffold.contents).toContain("import { Migration } from '@mikro-orm/migrations';");
    expect(scaffold.contents).toContain(`export class ${scaffold.className} extends Migration {`);
    expect(scaffold.contents).toContain('override async up(): Promise<void> {');
    expect(scaffold.contents).toContain('override async down(): Promise<void> {');
  });

  it('prints the exact import line, entry line and group banner to paste', () => {
    expect(scaffold.importLine).toBe(
      `import { ${scaffold.className} } from '../modules/orders/migrations/${scaffold.filename.replace(/\.ts$/, '.js')}';`,
    );
    expect(scaffold.entryLine).toBe(`  migration('orders', ${scaffold.className}),`);
    expect(scaffold.groupBanner).toContain('── orders ──');
  });

  it('imports core migrations from ./migrations/', () => {
    const core = buildScaffold({ moduleId: 'core', slug: 'tenant_indexes', stamp: '20260805T141530' });
    expect(core.importLine).toContain("from './migrations/20260805T141530_core_tenant_indexes.js'");
    expect(core.entryLine).toBe(`  migration('core', ${core.className}),`);
  });
});
