import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { Entity, PrimaryKey } from '@mikro-orm/decorators/legacy';
import { MikroORM } from '@mikro-orm/postgresql';
import type { ModuleManifest } from '@endora-commerce/contracts';
import { migrationOwnershipOf, mikroOrmConfigFrom } from '@endora-commerce/platform/db';
import { defineColumnExtension } from '@endora-commerce/platform/kernel';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { composeTestServer, teardownTestServer } from '@endora-commerce/test-kit/server';

import {
  FIXTURE_MANIFESTS,
  TestKitOrgRow,
  fixtureModuleEntry,
  fixtureOrm,
  requiredModuleEntry,
} from './fixture-platform.js';

/**
 * `specs/193-admin-form-extensions/` D-300.22, D-300.23 (FR-015) — composed
 * through `composeTestServer`, as `composeApp` composes:
 *
 * 1. an `adminReads` loader registered while no ORM configuration has recorded
 *    its column declarations is refused with the ordering named, rather than
 *    admitted by a column reader that cannot yet tell "nothing declared" from
 *    "not recorded yet";
 * 2. a module that serves both `adminReads` columns and an `adminReads` loader
 *    on `organizations` is refused as `loader-and-columns-on-one-host`.
 *
 * The first case must run first: recording is once per process.
 */

const MODULE_ID = 'test_kit_links';
const HOST_ENTITY = 'organizations.Organization';

/**
 * The host table the D2 declaration extends, and nothing else of the host
 * module. Named `Organization` because the side-table host binding (M0) holds
 * the entity that maps `organizations` to that class name.
 */
@GlobalEntity()
@Entity({ tableName: 'organizations' })
class Organization {
  @PrimaryKey({ type: 'uuid' })
  id!: string;
}

const linksManifest = {
  manifest: {
    id: MODULE_ID,
    name: MODULE_ID,
    version: '1.0.0',
    dependencies: [],
    extends: [{ entity: HOST_ENTITY, table: 'test_kit_links_refs' }],
  } as unknown as ModuleManifest,
};

const linksModuleEntry = {
  id: MODULE_ID,
  version: '1.0.0',
  registerModule: (ctx: { entityExtensionLoaders(entries: readonly unknown[]): void }): void => {
    ctx.entityExtensionLoaders([
      {
        host: HOST_ENTITY,
        adminReads: true,
        schema: z.object({ ref: z.string() }),
        load: async () => new Map(),
      },
    ]);
  },
};

const columns = defineColumnExtension({
  host: 'organizations',
  module: MODULE_ID,
  columns: { code: { type: 'text', nullable: true } },
  adminReads: true,
});

/** An ORM built by the platform's own configuration, which records the declaration. */
function recordingOrm(): { open(): Promise<MikroORM>; close(): Promise<void> } {
  let orm: MikroORM | undefined;
  return {
    open: async () => {
      orm = await MikroORM.init(
        mikroOrmConfigFrom({
          entities: [TestKitOrgRow, Organization],
          migrations: {
            migrations: [],
            registered: [],
            names: [],
            diagnostics: [],
            ownership: migrationOwnershipOf([], []),
            packages: [],
            overlays: [],
          },
          schemaExtensions: [columns],
        }),
      );
      // The declared column exists, so the boot-time verifier holds.
      await orm.em
        .getConnection()
        .execute(`create table if not exists "organizations" ("id" uuid primary key, "x_${MODULE_ID}_code" text null)`);
      return orm;
    },
    close: async () => {
      await orm?.em.getConnection().execute('drop table if exists "organizations"');
      await orm?.close(true);
      orm = undefined;
    },
  };
}

async function refusal(run: Promise<unknown>): Promise<Error> {
  const failure = await run.then(
    (handle) => {
      void teardownTestServer(handle as never);
      return null;
    },
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(Error);
  return failure as Error;
}

describe('adminReads loaders in a composition (193 D-300.22, D-300.23)', () => {
  it('refuses an adminReads loader before any ORM configuration recorded its column declarations', async () => {
    const orm = fixtureOrm();
    try {
      const error = await refusal(
        composeTestServer({
          composition: {
            modules: [requiredModuleEntry, fixtureModuleEntry, linksModuleEntry] as never,
            orm,
            manifests: [...FIXTURE_MANIFESTS, linksManifest],
          },
        }),
      );
      expect(error.message).toMatch(/before modules register/);
      expect(error.message).toContain('loader-and-columns-on-one-host');
    } finally {
      await orm.close();
    }
  });

  it('refuses a module serving adminReads columns and an adminReads loader on one host', async () => {
    const orm = recordingOrm();
    try {
      const error = await refusal(
        composeTestServer({
          composition: {
            modules: [requiredModuleEntry, fixtureModuleEntry, linksModuleEntry] as never,
            orm,
            manifests: [...FIXTURE_MANIFESTS, linksManifest],
          },
        }),
      );
      // Raised at the module's own registration, so the kernel names the module around it.
      expect(error.name, error.message).toBe('ModuleCompositionError');
      expect((error as { moduleId?: string }).moduleId).toBe(MODULE_ID);
      const cause = (error as { cause?: unknown }).cause as { name?: string; rule?: string };
      expect(cause.name).toBe('EntityExtensionInvalidError');
      expect(cause.rule).toBe('loader-and-columns-on-one-host');
      expect(error.message).toContain(`extensions.${MODULE_ID}`);
    } finally {
      await orm.close();
    }
  });
});
