import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { RecordMergeRuntime } from '@endora-commerce/platform/composition';
import { expectMergeParticipant } from '@endora-commerce/test-kit/merge';
import { entityNamedIn } from '@endora-commerce/test-kit/support';
import { installedModuleEntities } from '../../entities.generated.js';
import { predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * `specs/192-organization-merge/` T051 – T057 (MR-C2) over a real database:
 * each participant as the application composes it — the one the runner calls
 * — is held to `expectMergeParticipant` on its own tables, inside the merge's
 * own system scope, with its audit entries read back from `audit_log_entries`.
 * The co-located package tests prove the same participants' rules in memory;
 * this proves their ORM writes, the tenant write guard's merge-scope pass, and
 * the audit the real Command Bus records.
 */

type Row = Record<string, unknown>;

interface Case {
  readonly moduleId: string;
  readonly key: string;
  readonly table: string;
  /** Further tables of the same participant, read by the same column. */
  readonly alsoTables?: readonly string[];
  /** The column holding the Organization id (the polymorphic id for `quick_order`). */
  readonly column: string;
  readonly action: string;
  /** Rows of the participant's own entities, for the pair. */
  readonly seed: (ids: {
    survivorId: string;
    loserId: string;
    channelId: string;
    /** Real customer accounts of the loser, for the tables whose account column has a foreign key. */
    accounts: readonly string[];
  }) => Array<[string, Row]>;
}

const token = (): string => randomUUID().replace(/-/g, '').slice(0, 32);

const CASES: readonly Case[] = [
  {
    moduleId: 'shopping_lists',
    key: 'shopping-lists',
    table: 'shopping_lists',
    column: 'organization_id',
    action: 'shopping_list.merge_reassign',
    seed: ({ survivorId, loserId }) => [
      ...[0, 1, 2].map((i): [string, Row] => ['ShoppingList', { organizationId: loserId, customerAccountId: randomUUID(), name: `List ${i}`, isDefault: true }]),
      ['ShoppingList', { organizationId: survivorId, customerAccountId: randomUUID(), name: 'Survivor list' }],
    ],
  },
  {
    moduleId: 'comparisons',
    key: 'comparisons',
    table: 'comparisons',
    column: 'organization_id',
    action: 'comparison.merge_reassign',
    seed: ({ loserId, channelId, accounts }) =>
      accounts.map((account): [string, Row] => ['Comparison', { shareToken: token(), organizationId: loserId, customerAccountId: account, salesChannelId: channelId }]),
  },
  {
    moduleId: 'inventory',
    key: 'availability-notifications',
    table: 'availability_notifications',
    column: 'organization_id',
    action: 'availability_notification.merge_reassign',
    seed: ({ loserId }) =>
      [0, 1, 2].map((): [string, Row] => ['AvailabilityNotification', { organizationId: loserId, customerAccountId: randomUUID(), productId: randomUUID() }]),
  },
  {
    moduleId: 'newsletter',
    key: 'subscribers',
    table: 'newsletter_subscribers',
    column: 'organization_id',
    action: 'newsletter_subscriber.merge_reassign',
    seed: ({ loserId }) =>
      [0, 1, 2].map((): [string, Row] => ['NewsletterSubscriber', { email: `merge-${token()}@example.test`, organizationId: loserId, customerAccountId: randomUUID() }]),
  },
  {
    moduleId: 'customer_notifications',
    key: 'notifications',
    table: 'customer_notifications',
    column: 'organization_id',
    action: 'customer_notification.merge_reassign',
    seed: ({ loserId }) =>
      [0, 1, 2].map((i): [string, Row] => [
        'CustomerNotification',
        {
          organizationId: loserId,
          customerAccountId: randomUUID(),
          sourceModule: 'orders',
          sourceKey: `merge-${i}-${token()}`,
          kind: 'order_status',
          title: 'Order shipped',
          titleMessage: { scope: 'orders', key: 'notification.shipped', params: {} },
        },
      ]),
  },
  {
    moduleId: 'pwa',
    key: 'push',
    table: 'push_subscriptions',
    alsoTables: ['push_notification_preferences'],
    column: 'organization_id',
    action: 'pwa.merge_reassign',
    seed: ({ loserId, channelId }) => [
      ...[0, 1].map((): [string, Row] => [
        'PushSubscription',
        { salesChannelId: channelId, organizationId: loserId, customerAccountId: randomUUID(), endpoint: `https://push.example.test/${token()}`, p256dh: 'k', auth: 'a' },
      ]),
      ['PushNotificationPreference', { organizationId: loserId, customerAccountId: randomUUID(), orderStatusEnabled: false }],
    ],
  },
  {
    moduleId: 'quick_order',
    key: 'default-preferences',
    table: 'quick_order_default_preferences',
    column: 'scope_id',
    action: 'quick_order.merge_reassign',
    seed: ({ loserId }) => [['QuickOrderDefaultPreference', { scope: 'organization', scopeId: loserId }]],
  },
  {
    moduleId: 'mfa',
    key: 'organization-policy',
    table: 'mfa_organization_policies',
    column: 'organization_id',
    action: 'mfa.merge_reassign',
    seed: ({ survivorId, loserId }) => [
      ['MfaOrganizationPolicy', { organizationId: survivorId, enforceTotp: false }],
      ['MfaOrganizationPolicy', { organizationId: loserId, enforceTotp: true }],
    ],
  },
  {
    moduleId: 'api_keys',
    key: 'bound-keys',
    table: 'api_keys',
    column: 'organization_id',
    action: 'api_key.merge_reassign',
    seed: ({ loserId, channelId, accounts }) =>
      accounts.slice(0, 2).map((account, i): [string, Row] => [
        'ApiKey',
        { name: `Bound ${i}`, keyHash: token() + token(), lastFour: '0000', organizationId: loserId, salesChannelId: channelId, customerAccountId: account },
      ]),
  },
  {
    moduleId: 'webhooks',
    key: 'bound-webhooks',
    table: 'webhooks',
    column: 'organization_id',
    action: 'webhook.merge_reassign',
    seed: ({ loserId }) =>
      [0, 1].map((i): [string, Row] => ['Webhook', { name: `Hook ${i}`, url: 'https://hooks.example.test/in', secret: token(), organizationId: loserId }]),
  },
  {
    moduleId: 'analytics',
    key: 'events',
    table: 'analytics_events',
    column: 'organization_id',
    action: 'analytics.merge_reassign',
    seed: ({ loserId }) => [0, 1, 2, 3].map((): [string, Row] => ['AnalyticsEvent', { type: 'page_view', organizationId: loserId }]),
  },
];

const MODULE_OF_ENTITY: Record<string, string> = {
  ShoppingList: 'shopping_lists',
  Comparison: 'comparisons',
  AvailabilityNotification: 'inventory',
  NewsletterSubscriber: 'newsletter',
  CustomerNotification: 'customer_notifications',
  PushSubscription: 'pwa',
  PushNotificationPreference: 'pwa',
  QuickOrderDefaultPreference: 'quick_order',
  MfaOrganizationPolicy: 'mfa',
  ApiKey: 'api_keys',
  Webhook: 'webhooks',
  AnalyticsEvent: 'analytics',
  FormEntry: 'forms',
};

describe('Organization merge — the C2 participants over a real database', () => {
  let h: BackendServerHandle;
  let channelId: string;

  const runtime = (): RecordMergeRuntime =>
    (h.container.cradle as unknown as { recordMergeRuntime: RecordMergeRuntime }).recordMergeRuntime;

  async function sql<T = Row[]>(statement: string, params: unknown[] = []): Promise<T> {
    return h.em().fork().getConnection().execute(statement, params) as Promise<T>;
  }

  async function organization(): Promise<string> {
    const id = randomUUID();
    await sql(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","is_personal","registered_address","path","custom_field_values","order_confirmation_emails","created_at","updated_at")
       values (?, ?, ?, 'active', 'vat_payer', false, '{"street":"ul. Prosta 1","city":"Łódź","postalCode":"90-001","country":"PL"}'::jsonb,
               ?, '{}'::jsonb, '[]'::jsonb, now(), now())`,
      [id, `C2 Merge ${id.slice(0, 6)}`, `C2${token().slice(0, 14).toUpperCase()}`, `/${id}/`],
    );
    return id;
  }

  async function account(organizationId: string): Promise<string> {
    const id = randomUUID();
    await sql(
      `insert into "customer_accounts"
         ("id","organization_id","email","password_hash","first_name","last_name","organization_role_id","created_at","updated_at")
       values (?, ?, ?, 'x', 'Merge', 'Participant', ?, now(), now())`,
      [id, organizationId, `${id.slice(0, 8)}@c2-merge.example`, await predefinedRoleIdOf(h.em(), organizationId, 'member')],
    );
    return id;
  }

  async function insertRows(rows: Array<[string, Row]>): Promise<string[]> {
    return withSystemScope('test: seed merge participant rows', async () => {
      const em: EntityManager = h.em().fork();
      const created = rows.map(([entity, values]) => {
        const cls = entityNamedIn(installedModuleEntities, MODULE_OF_ENTITY[entity]!, entity);
        return em.create(cls as never, values as never) as { id: string };
      });
      await em.flush();
      return created.map((row) => row.id);
    });
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const [channel] = await sql<Array<{ id: string }>>(`select "id" from "sales_channels" where "system_default" = true limit 1`);
    channelId = channel!.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('composes one participant per declared moving participation, and none for admin_users\' kept reasons', () => {
    const composed = runtime()
      .registry.participantsOf('organization')
      .map((participant) => `${participant.moduleId}/${participant.key}`);
    for (const c of CASES) expect(composed).toContain(`${c.moduleId}/${c.key}`);
    expect(composed).toContain('forms/form-entries');
    expect(composed.some((entry) => entry.startsWith('admin_users/'))).toBe(false);
    const analytics = runtime()
      .registry.participantsOf('organization')
      .find((participant) => participant.moduleId === 'analytics');
    expect(analytics).toMatchObject({ trailing: true, batchSize: 500, phase: 'records' });
  });

  for (const c of CASES) {
    it(`${c.moduleId}: ${c.action} conforms on its own tables`, async () => {
      const participant = runtime()
        .registry.participantsOf('organization')
        .find((candidate) => candidate.moduleId === c.moduleId && candidate.key === c.key)!.participant;
      const survivorId = await organization();
      const loserId = await organization();
      const mergeId = randomUUID();
      let seeded: string[] = [];
      await expectMergeParticipant({
        participant,
        ids: { survivorId, loserId, mergeId },
        batchSize: 2,
        enterScope: (reason, run) => withSystemScope(reason, run),
        seed: async () => {
          const accounts = [await account(loserId), await account(loserId), await account(loserId)];
          seeded = await insertRows(c.seed({ survivorId, loserId, channelId, accounts }));
        },
        snapshot: async () => {
          const ids = `{${seeded.join(',')}}`;
          const tables = [c.table, ...(c.alsoTables ?? [])];
          const rows: Row[] = [];
          for (const table of tables) {
            rows.push(...(await sql(`select "id", "${c.column}" as "org" from "${table}" where "id" = any(?::uuid[])`, [ids])));
          }
          return rows.sort((a, b) => String(a['id']).localeCompare(String(b['id'])));
        },
      });
      const audit = await sql<Array<{ action: string; object_type: string; object_id: string; merge_id: string | null }>>(
        `select "action", "object_type", "object_id", "state_after"->>'mergeId' as "merge_id"
           from "audit_log_entries" where "action" = ? and "object_id" = ?`,
        [c.action, survivorId],
      );
      expect(audit.length).toBeGreaterThan(0);
      for (const entry of audit) expect(entry).toMatchObject({ object_type: 'organization', merge_id: mergeId });
    });
  }
});
