/**
 * Migration naming — one implementation for every scaffolder
 * (`specs/190-overlay-full-modules/` T100, FR-056, FR-057).
 *
 * The table below was recorded from `backend/scripts/new-migration.ts` as it
 * stood before its naming moved here, so it is the parity the move owes: every
 * stamp and every slug names the same file and the same class it did. The class
 * name is what `mikro_orm_migrations` persists, so a drift here is a migration
 * every migrated database sees as pending.
 */
import { describe, expect, it } from 'vitest';

import { migrationClassOf, migrationFileOf } from '../new-module/emit.js';
import { buildScaffoldSpec, migrationStampFor } from '../new-module/spec.js';
import {
  BASELINE_THROUGH,
  buildMigrationScaffold,
  classNameFromFile,
  formatStamp,
  MIGRATION_FILE_RE,
  migrationFileName,
  nextFreeStamp,
  normalizeSlug,
  parseStamp,
  segmentFor,
} from './migration-naming.js';

const STAMP = '20261126T101500';

/** `[moduleId, slug, filename, className]`, as `new-migration.ts` produced them. */
const RECORDED: ReadonlyArray<readonly [string, string, string, string]> = [
  ['orders', 'placement_intents', '20261126T101500_orders_placement_intents.ts', 'Migration20261126T101500OrdersPlacementIntents'],
  ['orders', 'Add Index!', '20261126T101500_orders_add_index.ts', 'Migration20261126T101500OrdersAddIndex'],
  ['orders', 'init', '20261126T101500_orders_init.ts', 'Migration20261126T101500OrdersInit'],
  ['orders', '  two__words  ', '20261126T101500_orders_two_words.ts', 'Migration20261126T101500OrdersTwoWords'],
  ['orders', 'orders', '20261126T101500_orders.ts', 'Migration20261126T101500Orders'],
  ['quote_requests', 'quote_requests_init', '20261126T101500_quote_requests_init.ts', 'Migration20261126T101500QuoteRequestsInit'],
  ['quote_requests', 'init', '20261126T101500_quote_requests_init.ts', 'Migration20261126T101500QuoteRequestsInit'],
  ['quote_requests', 'orders', '20261126T101500_quote_requests_orders.ts', 'Migration20261126T101500QuoteRequestsOrders'],
  ['_lifecycle', 'quote_requests_init', '20261126T101500_lifecycle_quote_requests_init.ts', 'Migration20261126T101500LifecycleQuoteRequestsInit'],
  ['_i18n', 'Add Index!', '20261126T101500_i18n_add_index.ts', 'Migration20261126T101500I18nAddIndex'],
  ['core', 'placement_intents', '20261126T101500_core_placement_intents.ts', 'Migration20261126T101500CorePlacementIntents'],
  ['core', 'orders', '20261126T101500_core_orders.ts', 'Migration20261126T101500CoreOrders'],
  ['overlay_notes_fixture', 'init', '20261126T101500_overlay_notes_fixture_init.ts', 'Migration20261126T101500OverlayNotesFixtureInit'],
  ['overlay_notes_fixture', 'two__words', '20261126T101500_overlay_notes_fixture_two_words.ts', 'Migration20261126T101500OverlayNotesFixtureTwoWords'],
];

describe('file and class names, over a table of module ids and slugs', () => {
  it.each(RECORDED)('%s + %j → %s', (moduleId, slug, filename, className) => {
    const scaffold = buildMigrationScaffold({ moduleId, slug, stamp: STAMP }, ['Doc.']);
    expect(scaffold.filename).toBe(filename);
    expect(scaffold.className).toBe(className);
    expect(migrationFileName(STAMP, moduleId, normalizeSlug(slug))).toBe(filename);
    expect(classNameFromFile(filename)).toBe(className);
    expect(MIGRATION_FILE_RE.test(filename)).toBe(true);
    expect(scaffold.contents).toContain(`export class ${className} extends Migration {`);
    expect(scaffold.contents).toContain(`import { Migration } from '@mikro-orm/migrations';`);
  });

  it('normalises the segment as naming-convention.md §1 says', () => {
    expect(['orders', '_i18n', '_lifecycle', 'core'].map(segmentFor)).toEqual([
      'orders',
      'i18n',
      'lifecycle',
      'core',
    ]);
  });

  it('refuses a slug with nothing in it', () => {
    expect(() => normalizeSlug(' !! ')).toThrow(/empty slug/);
  });

  it('puts the caller’s doc lines in the class comment', () => {
    const { contents } = buildMigrationScaffold(
      { moduleId: 'orders', slug: 'x', stamp: STAMP },
      ['First line.', '', 'Second.'],
    );
    expect(contents).toContain('/**\n * First line.\n *\n * Second.\n */\nexport class');
  });
});

describe('stamps', () => {
  /** `[now, formatted, next free above the watermark with STAMP taken]`. */
  const STAMPS: ReadonlyArray<readonly [string, string, string]> = [
    ['2020-01-01T00:00:00.000Z', '20200101T000000', '20260801T000001'],
    ['2026-08-01T00:00:00.000Z', '20260801T000000', '20260801T000001'],
    ['2026-11-26T10:15:00.999Z', '20261126T101500', '20261126T101501'],
    ['2027-01-01T00:00:00.000Z', '20270101T000000', '20270101T000000'],
  ];

  it.each(STAMPS)('%s → %s, next free %s', (iso, formatted, next) => {
    const now = new Date(iso);
    expect(formatStamp(now)).toBe(formatted);
    expect(nextFreeStamp(now, new Set([STAMP]), BASELINE_THROUGH)).toBe(next);
    expect(formatStamp(parseStamp(formatted))).toBe(formatted);
  });

  it('the module scaffold clamps exactly as the migration scaffolder does', () => {
    for (const [iso] of STAMPS) {
      const now = new Date(iso);
      expect(migrationStampFor(now)).toBe(nextFreeStamp(now, new Set(), BASELINE_THROUGH));
    }
  });
});

describe('`endora new module --entities` names its first migration with the same code', () => {
  it.each(['orders', 'quote_requests', 'overlay_notes_fixture'])('%s', (id) => {
    const spec = buildScaffoldSpec({
      id,
      name: 'X',
      description: 'Y',
      entities: true,
      now: new Date(Date.UTC(2026, 10, 26, 10, 15, 0)),
    });
    const expected = buildMigrationScaffold(
      { moduleId: id, slug: 'init', stamp: spec.migrationStamp },
      [],
    );
    expect(migrationFileOf(spec)).toBe(expected.filename);
    expect(migrationClassOf(spec)).toBe(expected.className);
  });
});
