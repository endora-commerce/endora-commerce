import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { CommandBus, type Command } from '@endora-commerce/platform/commands';
import { AuditLogService } from '@endora-commerce/platform/composition';
import { EventBus, type EventBase } from '@endora-commerce/platform/events';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { Migration20261103T162518CoreAuditActorCustomerAccount } from '@endora-commerce/platform/migrations';
import { runWithTenantContext, type TenantContext } from '../../../src/tenancy/tenant-context.js';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * `audit_log_entries.actor_customer_account_id` — `specs/170-organization-roles/`
 * WP-01 T017, migration M1 (research R-21; data-model §4; FR-065, SC-006).
 *
 * A customer who acts for themselves is named on the audit row; until this
 * column a storefront administrator's change recorded `actor_admin_user_id =
 * null` and nothing else, so it read as nobody's. An impersonation keeps its two
 * existing columns and leaves this one `null`.
 *
 * The migration cases run inside a rolled-back transaction, so the shared
 * database never sees the dropped column. The Command cases commit for real —
 * the bus forks its own transaction — and delete what they wrote.
 */
describe('audit_log_entries.actor_customer_account_id (M1)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  function migration(em: EntityManager): Migration20261103T162518CoreAuditActorCustomerAccount {
    return new Migration20261103T162518CoreAuditActorCustomerAccount(em.getDriver(), em.config);
  }

  async function apply(em: EntityManager, direction: 'up' | 'down'): Promise<void> {
    const m = migration(em);
    await m[direction]();
    for (const query of m.getQueries()) await em.execute(query as string);
  }

  async function columnShape(em: EntityManager): Promise<unknown[]> {
    return em.execute(
      `select data_type, is_nullable, column_default from information_schema.columns
        where table_name = 'audit_log_entries' and column_name = 'actor_customer_account_id'`,
    );
  }

  describe('the migration', () => {
    beforeEach(async () => {
      await db.beginTx();
    });

    it('adds a nullable uuid column with no default', async () => {
      try {
        const em = db.em();
        expect(await columnShape(em)).toEqual([{ data_type: 'uuid', is_nullable: 'YES', column_default: null }]);
      } finally {
        await db.rollbackTx();
      }
    });

    it('up() is repeatable (FR-074) and down() drops the column', async () => {
      try {
        const em = db.em();
        await apply(em, 'up');
        expect(await columnShape(em)).toHaveLength(1);
        await apply(em, 'down');
        expect(await columnShape(em)).toEqual([]);
        await apply(em, 'up');
        expect(await columnShape(em)).toEqual([{ data_type: 'uuid', is_nullable: 'YES', column_default: null }]);
      } finally {
        await db.rollbackTx();
      }
    });
  });

  describe('a Command run through the bus', () => {
    const written: string[] = [];
    let bus: CommandBus;

    beforeAll(() => {
      bus = new CommandBus(
        db.orm,
        new AuditLogService(() => db.orm.em.fork()),
        new EventBus<Record<string, EventBase>>(),
      );
    });

    afterAll(async () => {
      const em = db.orm.em.fork();
      for (const objectId of written.splice(0)) await em.nativeDelete(AuditLogEntry, { objectId });
    });

    function probe(): Command<string> {
      const objectId = randomUUID();
      written.push(objectId);
      return {
        action: 'audit_probe.update',
        objectType: 'audit_probe',
        objectId,
        async run() {
          return { result: objectId, after: { probed: true } };
        },
      };
    }

    async function rowOf(objectId: string): Promise<Record<string, unknown>> {
      const rows = await db.orm.em.fork().execute<Array<Record<string, unknown>>>(
        `select "actor_admin_user_id", "impersonated_customer_account_id", "actor_customer_account_id"
           from "audit_log_entries" where "object_id" = ?`,
        [objectId],
      );
      expect(rows).toHaveLength(1);
      return rows[0]!;
    }

    it("names the customer who acted for themselves on the row (R-21)", async () => {
      const customerAccountId = randomUUID();
      const organizationId = randomUUID();
      const ctx: TenantContext = {
        mode: 'single-org',
        organizationId,
        customerAccountId,
        actor: { kind: 'customer', id: customerAccountId },
      };
      const objectId = await runWithTenantContext(ctx, () => bus.run(probe()));
      expect(await rowOf(objectId)).toEqual({
        actor_admin_user_id: null,
        impersonated_customer_account_id: null,
        actor_customer_account_id: customerAccountId,
      });
      const entry = await db.orm.em.fork().findOneOrFail(AuditLogEntry, { objectId });
      expect(entry.actorCustomerAccountId).toBe(customerAccountId);
    });

    it('leaves it null under impersonation, which keeps its own two columns', async () => {
      const customerAccountId = randomUUID();
      const adminUserId = randomUUID();
      const ctx: TenantContext = {
        mode: 'single-org',
        organizationId: randomUUID(),
        customerAccountId,
        actor: { kind: 'customer', id: customerAccountId },
        impersonation: { realAdminUserId: adminUserId, impersonatedCustomerAccountId: customerAccountId },
      };
      const objectId = await runWithTenantContext(ctx, () => bus.run(probe()));
      expect(await rowOf(objectId)).toEqual({
        actor_admin_user_id: adminUserId,
        impersonated_customer_account_id: customerAccountId,
        actor_customer_account_id: null,
      });
    });

    it('leaves it null for an administrator', async () => {
      const adminUserId = randomUUID();
      const ctx: TenantContext = { mode: 'all', actor: { kind: 'admin', id: adminUserId } };
      const objectId = await runWithTenantContext(ctx, () => bus.run(probe()));
      expect(await rowOf(objectId)).toEqual({
        actor_admin_user_id: adminUserId,
        impersonated_customer_account_id: null,
        actor_customer_account_id: null,
      });
    });
  });
});
