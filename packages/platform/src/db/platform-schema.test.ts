import { describe, expect, it } from 'vitest';

import {
  CORE_MODULE_ID,
  PLATFORM_ENTITIES,
  PLATFORM_MIGRATION_ENTRIES,
  mergeByIdentity,
} from './platform-schema.js';
import { BASELINE_MIGRATIONS } from '../migrations/index.js';

/**
 * The platform's own schema is the platform's to supply
 * (`specs/110-instance-repository/` T141).
 *
 * The red proof this file exists for is the one the acceptance criterion
 * measured: an instance supplies `coreEntities: []` and `coreEntries: []`,
 * because it ships no generated registry, and before this it therefore ran none
 * of the platform's twelve migrations and registered none of its six entities —
 * so `migrate` died on the first module migration to touch a table
 * `core_foundation_init` creates.
 */
describe('the platform contributes its own schema', () => {
  it('names every migration class its `./migrations` barrel publishes', () => {
    // Derived from the barrel rather than counted here (D-100): the thirteenth
    // migration is caught by existing, not by anyone remembering this file.
    const published = new Set(
      BASELINE_MIGRATIONS.filter((name) => /^Migration\d{8}T\d{6}Core/.test(name)),
    );
    const declared = new Set(PLATFORM_MIGRATION_ENTRIES.map((entry) => entry.cls.name));
    for (const name of published) expect(declared).toContain(name);
  });

  it('files every one of them under the cross-cutting `core` module', () => {
    for (const entry of PLATFORM_MIGRATION_ENTRIES) {
      expect(entry.moduleId).toBe(CORE_MODULE_ID);
    }
  });

  it('declares no migration twice, by class name', () => {
    const names = PLATFORM_MIGRATION_ENTRIES.map((entry) => entry.cls.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('declares entity classes, each exactly once', () => {
    expect(PLATFORM_ENTITIES.length).toBeGreaterThan(0);
    expect(new Set(PLATFORM_ENTITIES).size).toBe(PLATFORM_ENTITIES.length);
  });
});

describe('mergeByIdentity', () => {
  it('keeps the first array whole and appends only what it does not already hold', () => {
    const a = { n: 1 };
    const b = { n: 2 };
    expect(mergeByIdentity([a], [a, b])).toEqual([a, b]);
  });

  it('compares on the identity a caller names, not on the member', () => {
    // The migration case: two different wrappers around one class. Comparing
    // the wrappers finds no overlap and hands `orderMigrations` a duplicate
    // name, which is how a host that already declares these would have broken.
    class Migration20260101T000000CoreSomething {}
    const host = { moduleId: 'core', cls: Migration20260101T000000CoreSomething };
    const ours = { moduleId: 'core', cls: Migration20260101T000000CoreSomething };
    expect(mergeByIdentity([host], [ours])).toHaveLength(2);
    expect(mergeByIdentity([host], [ours], (entry) => entry.cls)).toEqual([host]);
  });
});
