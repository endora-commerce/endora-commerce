/**
 * A platform the kit composes that is **nobody's module**.
 *
 * The kit may name no module package (R1.5) and no path under `backend/`
 * (R1.4), so its own server-bound tests cannot compose this repository's
 * platform — and that is the point rather than an inconvenience: what the tests
 * below have to prove is that `composeTestServer` works for a *stranger's*
 * composition, and a stranger's composition is exactly what this file is.
 *
 * Two synthetic modules, one entity, one route, and a manifest set that
 * declares one of the modules `nonDeactivatable` so the composition is complete
 * in the platform's own terms (issue #258).
 */

import { randomUUID } from 'node:crypto';

import { Entity, PrimaryKey, Property } from '@mikro-orm/core';
import { MikroORM, defineConfig, type EntityManager } from '@mikro-orm/postgresql';
import type { ModuleManifest } from '@endora-commerce/contracts';
import { OrgScoped } from '@endora-commerce/platform/tenancy';

import type { PlatformComposition } from '@endora-commerce/test-kit/server';

/**
 * One organization-scoped row.
 *
 * Every property carries an explicit `type`: esbuild — which is what
 * transpiles this file under vitest — implements `experimentalDecorators` and
 * does **not** implement `emitDecoratorMetadata`, so a MikroORM property whose
 * type is inferred from reflection has no type at all here. Naming it is not a
 * workaround, it is the only spelling that means the same thing in both
 * toolchains.
 */
@Entity({ tableName: 'test_kit_org_rows' })
@OrgScoped()
export class TestKitOrgRow {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'organization_id' })
  organizationId!: string;

  @Property({ type: 'string' })
  label!: string;
}

export const FIXTURE_TABLE = 'test_kit_org_rows';
export const FIXTURE_MODULE_ID = 'test_kit_fixture';
export const REQUIRED_MODULE_ID = 'test_kit_required';
export const REQUIRED_MODULE_REASON =
  'the fixture platform cannot run without it — it is what makes this composition complete';
export const ROWS_ROUTE = '/api/v1/test-kit/org-rows';
/** The header the fixture route's tenant context is derived from. */
export const ORGANIZATION_HEADER = 'x-test-kit-organization';

function manifest(id: string, activation: ModuleManifest['activation']): ModuleManifest {
  return {
    id,
    name: id,
    version: '1.0.0',
    dependencies: [],
    ...(activation === undefined ? {} : { activation }),
  } as ModuleManifest;
}

/**
 * The manifests of the fixture platform.
 *
 * `test_kit_required` declares `nonDeactivatable`, which is what makes
 * `composeModules` refuse a composition that leaves it out — the subject of
 * `required-module-refusal.test.ts`.
 */
export const FIXTURE_MANIFESTS: readonly { readonly manifest: ModuleManifest }[] = [
  {
    manifest: manifest(REQUIRED_MODULE_ID, {
      nonDeactivatable: true,
      reason: REQUIRED_MODULE_REASON,
    }),
  },
  {
    manifest: manifest(FIXTURE_MODULE_ID, {
      settingCode: 'test_kit_fixture.enabled',
      default: true,
    }),
  },
];

/** The required module: it registers nothing, and being present is its whole job. */
export const requiredModuleEntry = {
  id: REQUIRED_MODULE_ID,
  version: '1.0.0',
  registerModule: (): void => {
    /* nothing — this module exists so that the composition can be complete */
  },
};

/**
 * The fixture module: one route that reads the entity through the container's
 * own `emFactory`, which is the fork the request scope stamps.
 */
export const fixtureModuleEntry = {
  id: FIXTURE_MODULE_ID,
  version: '1.0.0',
  registerModule: (ctx: {
    routes(register: (app: FixtureApp) => Promise<void> | void): void;
    cradle<C extends object>(): C;
  }): void => {
    ctx.routes(async (app) => {
      app.get(ROWS_ROUTE, async () => {
        const em = ctx.cradle<{ emFactory: () => EntityManager }>().emFactory();
        const rows = await em.find(TestKitOrgRow, {});
        return { data: rows.map((row) => ({ id: row.id, label: row.label })) };
      });
    });
  },
};

/** The one method of Fastify this fixture uses, so the fixture declares no plugin type. */
interface FixtureApp {
  get(path: string, handler: () => Promise<unknown>): unknown;
}

/**
 * Open an ORM over the fixture entity and nothing else.
 *
 * `DATABASE_URL` is read at call time and not at import, which is the whole
 * reason `PlatformComposition.orm` is an opener rather than an instance: the
 * lease writes that variable in the parent process and the workers inherit it.
 */
export function fixtureOrm(): { open(): Promise<MikroORM>; close(): Promise<void> } {
  let orm: MikroORM | undefined;
  return {
    open: async () => {
      const clientUrl = process.env['DATABASE_URL'];
      if (clientUrl === undefined) {
        throw new Error(
          'DATABASE_URL is unset — the lease writes it in the parent process and a worker ' +
            'inherits it, so an unset value means this run had no globalSetup.',
        );
      }
      orm = await MikroORM.init(
        defineConfig({
          clientUrl,
          entities: [TestKitOrgRow],
          debug: false,
          allowGlobalContext: false,
        }),
      );
      return orm;
    },
    close: async () => {
      await orm?.close(true);
      orm = undefined;
    },
  };
}

/** The whole fixture composition, or a caller-narrowed subset of its modules. */
export function fixtureComposition(
  modules: readonly { id: string; version: string; registerModule: never }[] | undefined = undefined,
): PlatformComposition {
  return {
    modules: (modules ?? [requiredModuleEntry, fixtureModuleEntry]) as PlatformComposition['modules'],
    orm: fixtureOrm(),
    manifests: FIXTURE_MANIFESTS,
  };
}

/** The one "migration" this fixture platform has, named as MikroORM names one. */
export const FIXTURE_MIGRATION = `TestKitFixtureSchema:${FIXTURE_TABLE}`;

/**
 * Create the fixture schema, and record that it was applied.
 *
 * The second half is not bookkeeping: the lease **verifies** that a template it
 * is about to clone holds the migration set the caller declared, by reading
 * `mikro_orm_migrations` — which is what stops a run being handed another
 * branch's platform (issue #289). A caller whose schema step wrote no row would
 * be refused by that check, correctly, so this fixture records its one
 * migration exactly as the application's migrator records its own.
 */
export async function createFixtureSchema(): Promise<void> {
  const lifecycle = fixtureOrm();
  const orm = await lifecycle.open();
  try {
    await orm.getSchemaGenerator().updateSchema({ safe: false, wrap: false });
    const connection = orm.em.getConnection();
    await connection.execute(
      `create table if not exists "mikro_orm_migrations" (
         "id" serial primary key,
         "name" varchar(255),
         "executed_at" timestamptz default current_timestamp)`,
    );
    const applied = await connection.execute<{ name: string }[]>(
      'select name from mikro_orm_migrations',
    );
    if (!applied.some((row) => row.name === FIXTURE_MIGRATION)) {
      await connection.execute('insert into "mikro_orm_migrations" ("name") values (?)', [
        FIXTURE_MIGRATION,
      ]);
    }
  } finally {
    await lifecycle.close();
  }
}
