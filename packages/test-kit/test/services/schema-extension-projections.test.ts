import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MikroORM } from '@mikro-orm/postgresql';

import { fixtureOrm } from './fixture-platform.js';

/**
 * `specs/178-extensible-columns/` FR-031, research R-4 (tasks.md T017).
 *
 * A declared extension's projection is a second entity on its host's table,
 * which the SchemaGenerator would render as a second `create table` for that
 * table. Production never runs the generator, and projections are added only by
 * the platform's `mikroOrmConfigFrom`. This fixture ORM *does* run
 * `updateSchema`, over its own entities — so it must never carry a projection,
 * and this is the test that says so.
 */
describe('the test-kit fixture ORM', () => {
  const lifecycle = fixtureOrm();
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await lifecycle.open();
  });

  afterAll(async () => {
    await lifecycle.close();
  });

  it('registers no schema-extension projection', () => {
    const names = Object.values(orm.getMetadata().getAll()).map((meta) => meta.className);
    expect(names.filter((name) => name.startsWith('__x_'))).toEqual([]);
    expect(names).toEqual(['TestKitOrgRow']);
  });

  it('keeps MikroORM’s own duplicate-table check, since it composes no projection', () => {
    expect(orm.config.get('discovery').checkDuplicateTableNames).not.toBe(false);
  });
});
