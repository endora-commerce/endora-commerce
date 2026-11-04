import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeOrganizationName, type OrganizationPermissionPort } from '@endora-commerce/contracts';
import {
  Migration20261103T190132CustomerAccountsOrganizationRoleAssignment,
  Migration20261104T094540CustomerAccountsDropLegacyRoleColumn,
} from '@endora-commerce/mod-customer-accounts/migrations';
import {
  Migration20261103T173304OrganizationsOrganizationRoles,
  Migration20261104T094535OrganizationsDropLegacyRoleColumns,
} from '@endora-commerce/mod-organizations/migrations';
import { hashPassword, SalesChannel } from '@endora-commerce/platform/kernel';
import type { BackendServerHandle } from '../../helpers/test-server.js';
import { migratedDatabase, type MigratedDatabase } from '../../helpers/migrated-database.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import {
  EXPECTED_DIFFERENCES,
} from '../../fixtures/organization-roles/expected-differences.js';
import {
  ORACLE_KEY_OF_ID,
  ORACLE_POPULATION as POPULATION,
  ORACLE_REQUESTS,
  PRE_UPGRADE_OUTCOMES,
  legacyRoleKind,
  oracleMember,
  oracleOrganization,
  roleToRoleId,
  type OracleChannelCode,
  type OracleMemberKey,
  type OracleOutcome,
  type OracleRequest,
  type OracleRoleKind,
} from '../../fixtures/organization-roles/pre-upgrade-outcomes.js';

/**
 * The roles upgrade replay — `specs/170-organization-roles/` T131 (WP-13a),
 * closed by T112 (WP-13) (research R-27, R-38; `contracts/migration-and-replay.md`
 * §6; FR-070 – FR-074, PR-3, PR-5).
 *
 * The frozen WP-00 oracle recorded what today's code answers; this file asks the
 * same questions of an **upgraded** database, which is the state the release
 * meets. A migrated clone of its own is taken back to the pre-170 schema by the
 * `down()` statements of the 170 migrations, `ORACLE_POPULATION` is written into
 * it with raw SQL in that shape — legacy `role` enums, `requires_cart_approval`,
 * `P.owner` as the `regular_user` it is today — and the `up()` statements map it,
 * exactly as an operator's upgrade would. Only this path runs FR-071's mapping
 * and M3's backfill over existing rows; a live seed gets its roles from the
 * insert triggers instead (R-38).
 *
 * **The migration lists.** `down()` runs M5, M4, M3, M2 and `up()` M2, M3, M4,
 * M5 (T138, WP-12): the population names the legacy columns M4 and M5 drop, so
 * their `down()`s re-add them before it is written.
 *
 * **The order, and why the server boots first.** `setupBackendServer` truncates
 * and reseeds every table the population lives in, and the population needs
 * what that seed writes (the channels, the product, the delivery and payment
 * methods). So the server boots against the clone first — `DATABASE_URL` set to
 * it before the dynamic `import()` of the harness, because the ORM configuration
 * reads it on first use and each file runs in a fresh fork — and the
 * `down()` → population → `up()` sequence runs on that booted clone, before the
 * first request. Nothing the 170 migrations touch exists between the truncate and
 * the population, so no cache holds a pre-upgrade row.
 *
 * **The comparison** (§6 step 5) is on the oracle's whole `{ status, code }`:
 * a row of `EXPECTED_DIFFERENCES` equals its `after`, every other row equals
 * `PRE_UPGRADE_OUTCOMES` — never the status alone (PR-5). Request bodies go
 * through `roleToRoleId`, because the API now takes `roleId` where the oracle
 * sent `role`; the outcome must not change with the shape. `send` and `observe`
 * are the oracle's, copied unchanged, which is what the hand-over (T132: the
 * live oracle and this file, with every row at `before`, both green on one tree)
 * proved. The interim landing ledger of §6.2, which let each package's rows move
 * at its own merge, is gone (T112): `landedBy` stays in the table as provenance
 * and the replay no longer reads it.
 */

const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ONE_CLICK_ENABLED = 'quick_order.one_click_buy_enabled';
const DAY = 24 * 60 * 60 * 1000;

/** The 170 migrations, in the order an upgrade applies them (M2–M5, §6 step 4; T138). */
const UPGRADE = [
  Migration20261103T173304OrganizationsOrganizationRoles,
  Migration20261103T190132CustomerAccountsOrganizationRoleAssignment,
  Migration20261104T094535OrganizationsDropLegacyRoleColumns,
  Migration20261104T094540CustomerAccountsDropLegacyRoleColumn,
] as const;

type MigrationClass = (typeof UPGRADE)[number];

/** The statements a migration emits in one direction, as the migrator would run them. */
async function statementsOf(migrationClass: MigrationClass, direction: 'up' | 'down'): Promise<string[]> {
  // The base class only stores these; nothing in `up()`/`down()` reaches the driver.
  const migration = new migrationClass(undefined as never, undefined as never);
  await migration[direction]();
  return migration.getQueries().map((query) => String(query));
}

/** Only on `BACKEND_TEST_ISOLATION=shared`, where there is no template to clone. */
async function migrateFromEmpty(databaseUrl: string): Promise<void> {
  await new Promise<void>((resolveRun, rejectRun) => {
    const child = spawn('pnpm', ['exec', 'tsx', 'src/db/migrate.ts', 'up'], {
      cwd: BACKEND_ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', rejectRun);
    child.on('close', (code) =>
      code === 0 ? resolveRun() : rejectRun(new Error(`migration up exited ${code}\n${output}`)),
    );
  });
}

interface MigrationSnapshot {
  roles: unknown[];
  accounts: unknown[];
  invitations: unknown[];
  triggers: unknown[];
}

describe('organization roles — the upgrade replay (170 WP-13a, WP-13)', () => {
  let h: BackendServerHandle;
  let database: MigratedDatabase;
  const declaredDatabaseUrl = process.env['DATABASE_URL'];
  const channelIdOf = new Map<OracleChannelCode, string>();
  const channelCodeOf = new Map<OracleChannelCode, string>();
  const cookieOf = new Map<OracleMemberKey, string>();
  /** `<organizationId>:<kind>` → the predefined role id M2 gave it. */
  const roleIdOf = new Map<string, string>();
  /** What the first `up()` left, read before any request is sent. */
  let upgraded: MigrationSnapshot;
  let pre170Schema: {
    organizationRoles: boolean;
    accountRoleColumn: boolean;
    invitationRoleColumn: boolean;
    legacyColumns: string[];
  };
  /** The legacy columns left after the first `up()` — none, once M4 and M5 ran. */
  let legacyColumnsAfterUpgrade: string[];

  const memberId = (key: OracleMemberKey): string => oracleMember(key).id;
  const addressIdOf = (key: string): string => POPULATION.addresses.find((a) => a.key === key)!.id;

  const execute = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await h.em().getConnection().execute(sql, params)) as T[];

  async function apply(direction: 'up' | 'down'): Promise<void> {
    const order = direction === 'up' ? [...UPGRADE] : [...UPGRADE].reverse();
    for (const migrationClass of order) {
      for (const sql of await statementsOf(migrationClass, direction)) await execute(sql);
    }
  }

  async function snapshot(): Promise<MigrationSnapshot> {
    return {
      roles: await execute(
        `select "id", "organization_id", "kind", "name", "permissions", "member_defaults_offered", "version",
                "created_at", "updated_at"
           from "organization_roles" order by "id"`,
      ),
      accounts: await execute(
        `select "id", "organization_id", "organization_role_id", "updated_at" from "customer_accounts" order by "id"`,
      ),
      invitations: await execute(
        `select "id", "organization_role_id", "updated_at" from "organization_invitations" order by "id"`,
      ),
      triggers: await execute(
        `select "tgname", "tgrelid"::regclass::text as "table" from pg_trigger
          where not "tgisinternal" and "tgname" in
            ('organizations_seed_predefined_roles', 'organization_invitations_default_role',
             'customer_accounts_default_organization_role')
          order by "tgname"`,
      ),
    };
  }

  beforeAll(async () => {
    // ── A migrated clone, and the server booted against it ───────────────────
    database = await migratedDatabase('roles_replay', migrateFromEmpty);
    process.env['DATABASE_URL'] = database.url;
    const { setupBackendServer } = await import('../../helpers/test-server.js');
    h = await setupBackendServer();
    const [current] = await execute<{ name: string }>('select current_database() as "name"');
    if (current?.name !== database.name) {
      throw new Error(`the replay booted against ${current?.name}, not its clone ${database.name}`);
    }
    const em = h.em();

    // ── Channels (not role data: as the oracle made them) ────────────────────
    const systemDefault = await em.findOneOrFail(SalesChannel, { systemDefault: true });
    channelIdOf.set('default', systemDefault.id);
    channelCodeOf.set('default', systemDefault.code);
    const extra = em.create(SalesChannel, {
      code: 'oracle_extra',
      name: { 'pl-PL': 'Oracle 170', 'en-US': 'Oracle 170' },
      defaultLanguage: 'pl-PL',
      defaultCurrency: 'PLN',
    });
    await em.persistAndFlush(extra);
    for (const code of ['pl_retail', 'pl_b2b_vip', 'oracle_extra'] as const) {
      const channel = await em.findOneOrFail(SalesChannel, { code });
      channelIdOf.set(code, channel.id);
      channelCodeOf.set(code, code);
    }

    // ── Back to the pre-170 schema ───────────────────────────────────────────
    await apply('down');
    const legacyColumns = async (): Promise<string[]> =>
      (
        await execute<{ name: string }>(
          `select table_name || '.' || column_name as "name" from information_schema.columns
            where (table_name, column_name) in
              (('customer_accounts', 'role'), ('organization_invitations', 'role'), ('organizations', 'requires_cart_approval'))
            order by 1`,
        )
      ).map((row) => row.name);
    const [schema] = await execute<{ roles: boolean; account: boolean; invitation: boolean }>(
      `select to_regclass('organization_roles') is not null as "roles",
              exists (select 1 from information_schema.columns
                       where table_name = 'customer_accounts' and column_name = 'organization_role_id') as "account",
              exists (select 1 from information_schema.columns
                       where table_name = 'organization_invitations' and column_name = 'organization_role_id') as "invitation"`,
    );
    pre170Schema = {
      organizationRoles: schema!.roles,
      accountRoleColumn: schema!.account,
      invitationRoleColumn: schema!.invitation,
      legacyColumns: await legacyColumns(),
    };

    // ── ORACLE_POPULATION, raw SQL, in the pre-170 shape ─────────────────────
    for (const org of POPULATION.organizations) {
      await execute(
        `insert into "organizations"
           ("id", "name", "name_search", "tax_id", "status", "vat_status", "is_personal", "requires_cart_approval",
            "registered_address", "path", "version", "created_at", "updated_at")
         values (?, ?, ?, ?, 'active', ?, ?, ?, ?::jsonb, ?, 1, now(), now())`,
        [
          org.id,
          org.name,
          normalizeOrganizationName(org.name),
          org.taxId,
          org.isPersonal ? 'vat_exempt' : 'vat_payer',
          org.isPersonal,
          org.requiresCartApproval,
          JSON.stringify({ street: 'ul. Wyroczni 170', city: 'Warszawa', postalCode: '00-170', country: 'PL' }),
          `/${org.id}/`,
        ],
      );
      for (const channel of org.channels) {
        await execute(`insert into "sales_channel_organizations" ("sales_channel_id", "organization_id") values (?, ?)`, [
          channelIdOf.get(channel)!,
          org.id,
        ]);
      }
    }

    // Members — the withdrawn ones in the state the operator's block and delete
    // routes leave them (`customer_accounts`' lifecycle write port); their
    // sessions are revoked below, after the boot, as those routes revoke them.
    const passwordHash = await hashPassword('oracle-170-password-not-used');
    for (const member of POPULATION.members) {
      const blocked = member.state === 'blocked';
      const deleted = member.state === 'deleted';
      await execute(
        `insert into "customer_accounts"
           ("id", "organization_id", "email", "password_hash", "first_name", "last_name", "role", "email_verified_at",
            "blocked_at", "block_source", "blocked_by_admin_user_id", "block_reason",
            "deleted_at", "deletion_requested_by_admin_user_id", "created_at", "updated_at")
         values (?, ?, ?, ?, 'Oracle', ?, ?, now(), ?, ?, ?, ?, ?, ?, now(), now())`,
        [
          member.id,
          oracleOrganization(member.organization).id,
          member.email,
          passwordHash,
          member.key,
          member.role,
          blocked ? new Date() : null,
          blocked ? 'staff' : null,
          blocked ? TEST_ADMIN_ID : null,
          blocked ? 'Oracle 170' : null,
          deleted ? new Date() : null,
          deleted ? TEST_ADMIN_ID : null,
        ],
      );
    }

    for (const address of POPULATION.addresses) {
      await execute(
        `insert into "addresses"
           ("id", "organization_id", "kind", "recipient_name", "street", "city", "postal_code", "country", "is_default",
            "created_at", "updated_at")
         values (?, ?, ?, ?, 'ul. Wyroczni 170', 'Warszawa', '00-170', 'PL', ?, now(), now())`,
        [address.id, oracleOrganization(address.organization).id, address.kind, `Oracle 170 ${address.key}`, address.isDefault],
      );
    }

    for (const invitation of POPULATION.invitations) {
      const now = Date.now();
      await execute(
        `insert into "organization_invitations"
           ("id", "organization_id", "invited_by_customer_account_id", "email", "role", "token_hash",
            "expires_at", "consumed_at", "revoked_at", "created_at", "updated_at")
         values (?, ?, ?, ?, ?, ?, ?, ?, null, ?, ?)`,
        [
          invitation.id,
          oracleOrganization(invitation.organization).id,
          memberId(invitation.invitedBy),
          invitation.email,
          invitation.role,
          createHash('sha256').update(randomBytes(32)).digest('hex'),
          new Date(invitation.state === 'expired' ? now - DAY : now + 7 * DAY),
          invitation.state === 'accepted' ? new Date(now - DAY / 2) : null,
          new Date(now - 2 * DAY),
          new Date(now - 2 * DAY),
        ],
      );
    }

    for (const cart of POPULATION.carts) {
      const owner = oracleMember(cart.owner);
      const submitted = cart.approvalStatus !== 'not_required' ? new Date() : null;
      const approved = cart.approvalStatus === 'approved';
      const rejected = cart.approvalStatus === 'rejected_by_org_admin';
      // Only B's carts are approved or rejected; P has no administrator to name.
      const admin = approved || rejected ? memberId(`${owner.organization}.admin` as OracleMemberKey) : null;
      await execute(
        `insert into "carts"
           ("id", "customer_account_id", "organization_id", "sales_channel_id", "status", "approval_status",
            "submitted_for_approval_at", "approved_at", "approved_by_customer_account_id",
            "rejected_at", "rejected_by_actor", "rejected_reason", "last_activity_at", "version", "created_at", "updated_at")
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now(), 1, now(), now())`,
        [
          cart.id,
          owner.id,
          oracleOrganization(owner.organization).id,
          channelIdOf.get(cart.channel)!,
          cart.status,
          cart.approvalStatus,
          submitted,
          approved ? new Date() : null,
          approved ? admin : null,
          rejected ? new Date() : null,
          rejected ? `org_admin:${admin}` : null,
          rejected ? 'Oracle 170: seeded rejection' : null,
        ],
      );
      await execute(
        `insert into "cart_items" ("id", "cart_id", "product_id", "quantity", "unit_price", "currency", "created_at", "updated_at")
         values (gen_random_uuid(), ?, ?, ?, ?, 'PLN', now(), now())`,
        [cart.id, POPULATION.productId, cart.quantity, POPULATION.unitPrice],
      );
    }

    const snapshotAddress = JSON.stringify({
      recipientName: 'Oracle 170',
      street: 'ul. Wyroczni 170',
      city: 'Warszawa',
      postalCode: '00-170',
      country: 'PL',
    });
    for (const order of POPULATION.orders) {
      const placer = oracleMember(order.placedBy);
      await execute(
        `insert into "orders"
           ("id", "business_id", "organization_id", "placed_by_customer_account_id", "sales_channel_id", "status",
            "payment_status", "delivery_address", "billing_address", "delivery_method_id", "delivery_method_snapshot",
            "payment_method_id", "payment_method_snapshot", "subtotal", "tax_total", "discount_total", "delivery_total",
            "total", "currency", "placed_at", "created_at", "updated_at")
         values (?, ?, ?, ?, ?, 'completed', 'awaiting_payment', ?::jsonb, ?::jsonb, ?, ?::jsonb, ?, ?::jsonb,
                 ?, '0.00', '0', '0.00', ?, 'PLN', now(), now(), now())`,
        [
          order.id,
          `ORACLE-170-${order.key}`,
          oracleOrganization(placer.organization).id,
          placer.id,
          channelIdOf.get('default')!,
          snapshotAddress,
          snapshotAddress,
          POPULATION.deliveryMethodId,
          JSON.stringify({ code: 'in_person_pickup', name: 'Pickup', cost: 0 }),
          POPULATION.paymentMethodId,
          JSON.stringify({ code: 'bank_transfer', name: 'BT', kind: 'bank_transfer' }),
          POPULATION.unitPrice,
          POPULATION.unitPrice,
        ],
      );
      await execute(
        `insert into "order_items"
           ("id", "order_id", "product_id", "product_snapshot", "quantity", "unit_price", "tax_rate", "line_total", "created_at")
         values (gen_random_uuid(), ?, ?, ?::jsonb, 1, ?, '0.0000', ?, now())`,
        [
          order.id,
          POPULATION.productId,
          JSON.stringify({ sku: 'EXAMPLE-SIMPLE-001', name: 'Oracle 170 product', primaryAssetUrl: null }),
          POPULATION.unitPrice,
          POPULATION.unitPrice,
        ],
      );
    }

    for (const rfq of POPULATION.quoteRequests) {
      const owner = oracleMember(rfq.owner);
      await execute(
        `insert into "quote_requests"
           ("id", "business_id", "organization_id", "customer_account_id", "status", "submitted_at", "sales_channel_id",
            "created_at", "updated_at")
         values (?, ?, ?, ?, 'Pending', now(), ?, now(), now())`,
        [rfq.id, `QR-ORACLE-170-${rfq.key}`, oracleOrganization(owner.organization).id, owner.id, channelIdOf.get('default')!],
      );
      await execute(
        `insert into "quote_request_items"
           ("id", "quote_request_id", "product_id", "product_name", "quantity", "line_currency", "created_at", "updated_at")
         values (gen_random_uuid(), ?, ?, 'Oracle 170 product', 1, 'PLN', now(), now())`,
        [rfq.id, POPULATION.productId],
      );
    }

    for (const list of POPULATION.shoppingLists) {
      const owner = oracleMember(list.owner);
      await execute(
        `insert into "shopping_lists" ("id", "organization_id", "customer_account_id", "name", "created_at", "updated_at")
         values (?, ?, ?, ?, now(), now())`,
        [list.id, oracleOrganization(owner.organization).id, owner.id, `Oracle 170 ${list.key}`],
      );
      await execute(
        `insert into "shopping_list_items" ("id", "shopping_list_id", "product_id", "quantity", "created_at", "updated_at")
         values (gen_random_uuid(), ?, ?, 1, now(), now())`,
        [list.id, POPULATION.productId],
      );
    }

    for (const defaults of POPULATION.oneClickDefaults) {
      await execute(
        `insert into "quick_order_default_preferences"
           ("id", "scope", "scope_id", "default_payment_method_id", "default_delivery_method_id",
            "default_billing_address_id", "default_shipping_address_id", "created_at", "updated_at")
         values (gen_random_uuid(), 'organization', ?, ?, ?, ?, ?, now(), now())`,
        [
          oracleOrganization(defaults.organization).id,
          POPULATION.paymentMethodId,
          POPULATION.deliveryMethodId,
          addressIdOf(defaults.billingAddress),
          addressIdOf(defaults.deliveryAddress),
        ],
      );
    }

    // ── The upgrade ──────────────────────────────────────────────────────────
    await apply('up');
    upgraded = await snapshot();
    legacyColumnsAfterUpgrade = await legacyColumns();
    for (const row of upgraded.roles as Array<{ id: string; organization_id: string; kind: string }>) {
      roleIdOf.set(`${row.organization_id}:${row.kind}`, row.id);
    }

    // ── Operator state that is not role data, as the oracle set it ───────────
    await h.settings.adminService.setValueForSubset(
      ONE_CLICK_ENABLED,
      POPULATION.oneClickEnabledChannels.map((c) => channelCodeOf.get(c)!),
      true,
      null,
      { actorAdminUserId: null },
    );
    await h.settings.cache.invalidate(ONE_CLICK_ENABLED);
    await execute(`update "stock_levels" set "on_hand" = 100000 where "product_id" = ?`, [POPULATION.productId]);

    // ── Every member's real session; the withdrawn members' revoked ──────────
    for (const member of POPULATION.members) {
      const session = await h.sessionService.createSession({ kind: 'customer', customerAccountId: member.id });
      cookieOf.set(member.key, session.cookieValue);
    }
    for (const member of POPULATION.members) {
      if (member.state !== 'active') await h.sessionService.destroyAllForCustomer(member.id);
    }
  }, 300_000);

  afterAll(async () => {
    if (h) {
      const { teardownBackendServer } = await import('../../helpers/test-server.js');
      await teardownBackendServer(h);
    }
    if (declaredDatabaseUrl === undefined) delete process.env['DATABASE_URL'];
    else process.env['DATABASE_URL'] = declaredDatabaseUrl;
    await database?.drop();
  });

  /** The body the API takes: the oracle's `role` sent as `roleId` (§6 step 5). */
  function asSent(request: OracleRequest): OracleRequest {
    if (request.body === undefined) return request;
    const body = roleToRoleId(request, (organizationId: string, kind: OracleRoleKind) => {
      const id = roleIdOf.get(`${organizationId}:${kind}`);
      if (!id) throw new Error(`no ${kind} role for Organization ${organizationId}`);
      return id;
    });
    return { ...request, ...(body !== undefined ? { body } : {}) };
  }

  /** The outcome a row must have after the upgrade (§6 step 5). */
  function expectedOutcome(id: string): OracleOutcome | undefined {
    return EXPECTED_DIFFERENCES[id]?.after ?? PRE_UPGRADE_OUTCOMES[id];
  }

  async function send(request: OracleRequest): Promise<OracleOutcome> {
    const res = await h.app.inject({
      method: request.method,
      url: request.path,
      cookies: { b2b_session: cookieOf.get(request.actor)! },
      headers: {
        'accept-language': 'en',
        ...(request.channel ? { 'x-sales-channel': channelCodeOf.get(request.channel)! } : {}),
        ...(request.body ? { 'content-type': 'application/json' } : {}),
      },
      ...(request.body ? { payload: request.body as Record<string, unknown> } : {}),
    });
    return observe(request, res.statusCode, res.body);
  }

  it('reached the pre-170 schema before writing the population', () => {
    expect(pre170Schema).toEqual({
      organizationRoles: false,
      accountRoleColumn: false,
      invitationRoleColumn: false,
      legacyColumns: ['customer_accounts.role', 'organization_invitations.role', 'organizations.requires_cart_approval'],
    });
  });

  it('leaves no legacy role column after the upgrade (M4, M5; FR-073)', () => {
    expect(legacyColumnsAfterUpgrade).toEqual([]);
  });

  it('declares every request once, with a stable id', () => {
    const ids = ORACLE_REQUESTS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // §6 step 6 — what the upgrade wrote, before any request changed it.
  describe('the upgraded data (FR-070, FR-071, PR-3)', () => {
    type RoleRow = { id: string; organization_id: string; kind: string; permissions: string[]; member_defaults_offered: string[] };
    const roles = (): RoleRow[] => upgraded.roles as RoleRow[];
    const roleKindOf = (id: string): string | undefined => roles().find((r) => r.id === id)?.kind;

    it('gives every Organization both predefined roles, and nothing else', () => {
      for (const org of POPULATION.organizations) {
        const own = roles().filter((r) => r.organization_id === org.id);
        expect(own.map((r) => r.kind).sort(), org.key).toEqual(['administrator', 'member']);
        for (const role of own) expect(role.permissions, `${org.key} ${role.kind}`).toEqual([]);
      }
    });

    it('maps every account, blocked and deleted included, to the role its legacy enum named — P.owner to Administrator', () => {
      const accounts = upgraded.accounts as Array<{ id: string; organization_id: string; organization_role_id: string }>;
      const mapped = Object.fromEntries(
        POPULATION.members.map((m) => {
          const row = accounts.find((a) => a.id === m.id)!;
          return [m.key, { held: roleKindOf(row.organization_role_id), own: row.organization_id === oracleOrganization(m.organization).id }];
        }),
      );
      expect(mapped).toEqual(
        Object.fromEntries(
          POPULATION.members.map((m) => [
            m.key,
            {
              held: oracleOrganization(m.organization).isPersonal ? 'administrator' : legacyRoleKind(m.role),
              own: true,
            },
          ]),
        ),
      );
      // Written as the `regular_user` it is today (step 3), mapped to Administrator (PR-3).
      expect(POPULATION.members.find((m) => m.key === 'P.owner')?.role).toBe('regular_user');
      expect(mapped['P.owner']).toEqual({ held: 'administrator', own: true });
    });

    it('maps every invitation — pending, expired and accepted — to the role its legacy enum names', () => {
      const invitations = upgraded.invitations as Array<{ id: string; organization_role_id: string }>;
      const mapped = Object.fromEntries(
        POPULATION.invitations.map((i) => [i.key, roleKindOf(invitations.find((r) => r.id === i.id)!.organization_role_id)]),
      );
      expect(mapped).toEqual(Object.fromEntries(POPULATION.invitations.map((i) => [i.key, legacyRoleKind(i.role)])));
    });

    it("withholds from B's Member exactly the two codes cart approval withheld, and from A's nothing (FR-071)", () => {
      const offered = Object.fromEntries(
        POPULATION.organizations.map((org) => [
          org.key,
          roles().find((r) => r.organization_id === org.id && r.kind === 'member')!.member_defaults_offered,
        ]),
      );
      expect(offered).toEqual({ A: [], B: ['carts.order_without_approval', 'quick_order.one_click'], P: [] });
    });

    it("lets B's Member hold every other member default and A's every one", async () => {
      const cradle = h.container.cradle as unknown as {
        organizationPermissionPort: OrganizationPermissionPort;
        organizationRoleCatalogue: { memberDefaults(): ReadonlySet<string> };
      };
      const defaults = [...cradle.organizationRoleCatalogue.memberDefaults()];
      const effective = async (key: OracleMemberKey): Promise<readonly string[]> =>
        (
          await cradle.organizationPermissionPort.effective({
            customerAccountId: memberId(key),
            organizationId: oracleOrganization(oracleMember(key).organization).id,
          })
        ).permissions;
      const withheld = new Set(['carts.order_without_approval', 'quick_order.one_click']);
      expect([...(await effective('A.regular'))].sort()).toEqual([...defaults].sort());
      expect([...(await effective('B.regular'))].sort()).toEqual(defaults.filter((c) => !withheld.has(c)).sort());
    });

    it("leaves every cart's approval state as it was", async () => {
      const carts = await execute<{ id: string; approval_status: string }>(
        `select "id", "approval_status" from "carts" where "id" in (${POPULATION.carts.map(() => '?').join(', ')})`,
        POPULATION.carts.map((c) => c.id),
      );
      expect(Object.fromEntries(carts.map((c) => [ORACLE_KEY_OF_ID.get(c.id), c.approval_status]))).toEqual(
        Object.fromEntries(POPULATION.carts.map((c) => [c.key, c.approvalStatus])),
      );
    });
  });

  it('answers every gated request as the oracle recorded, but for the expected differences at their `after`', async () => {
    const observed: Record<string, OracleOutcome> = {};
    for (const request of ORACLE_REQUESTS) {
      observed[request.id] = await send(asSent(request));
    }

    const unrecorded = ORACLE_REQUESTS.map((r) => r.id).filter((id) => !(id in PRE_UPGRADE_OUTCOMES));
    const stale = Object.keys(PRE_UPGRADE_OUTCOMES).filter((id) => !(id in observed));
    expect(
      { unrecorded, stale },
      `every request needs a recorded outcome and every recorded outcome a request; observed:\n${renderTable(observed)}`,
    ).toEqual({ unrecorded: [], stale: [] });

    const differing = ORACLE_REQUESTS.filter(
      (r) => JSON.stringify(observed[r.id]) !== JSON.stringify(expectedOutcome(r.id)),
    ).map((r) => ({
      id: r.id,
      expected: expectedOutcome(r.id),
      observed: observed[r.id],
      inTable: r.id in EXPECTED_DIFFERENCES,
    }));
    expect(differing, `observed:\n${renderTable(observed)}`).toEqual([]);
  }, 300_000);

  // §6 step 7 — FR-074, SC-002.
  it('changes nothing when the upgrade runs a second time', async () => {
    const before = await snapshot();
    await apply('up');
    expect(await snapshot()).toEqual(before);
  });
});

/** The outcome a request is recorded as — see `OracleObservation`. Copied from the oracle, unchanged. */
function observe(request: OracleRequest, status: number, raw: string): OracleOutcome {
  let body: unknown = null;
  try {
    body = raw.length > 0 ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }
  const error = (body as { error?: { code?: string; details?: { code?: unknown } } } | null)?.error;
  if (status >= 400 || error) {
    if (!error?.code) return { status };
    const detail = typeof error.details?.code === 'string' ? `/${error.details.code}` : '';
    return { status, code: `${error.code}${detail}` };
  }
  const data = (body as { data?: unknown } | null)?.data;
  switch (request.observe ?? 'error') {
    case 'visible': {
      const rows = Array.isArray(data) ? (data as Array<{ id?: string }>) : [];
      const known = rows.map((r) => ORACLE_KEY_OF_ID.get(r.id ?? '')).filter((k): k is string => k !== undefined);
      const other = rows.length - known.length;
      return { status, code: `visible:${[...known.sort(), ...(other > 0 ? [`+${other}`] : [])].join(',')}` };
    }
    case 'primaryCta':
      return { status, code: `primaryCta:${String((data as { primaryCta?: unknown } | null)?.primaryCta)}` };
    case 'eligibility': {
      const e = data as { enabled?: boolean; reason?: string | null } | null;
      return { status, code: `eligibility:${e?.enabled ? 'enabled' : String(e?.reason)}` };
    }
    default:
      return { status };
  }
}

/** The observed table in the fixture's own syntax, for recording and for a reviewer. */
function renderTable(observed: Record<string, OracleOutcome>): string {
  return ORACLE_REQUESTS.map((r) => {
    const o = observed[r.id]!;
    return `  '${r.id}': { status: ${o.status}${o.code !== undefined ? `, code: '${o.code}'` : ''} },`;
  }).join('\n');
}
