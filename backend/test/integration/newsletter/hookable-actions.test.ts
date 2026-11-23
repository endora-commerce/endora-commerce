import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MikroORM } from '@mikro-orm/postgresql';
import type { z } from 'zod';
import {
  defineModuleErrorCodes,
  NEWSLETTER_HOOKABLE_ACTIONS as NL,
  type NewsletterSubscriberHookData,
  type NewsletterSubscriberOutbox,
} from '@endora-commerce/contracts';
import {
  CommandBus,
  CommandHookRefusal,
  type AfterCommitContext,
  type CommandHookEntry,
} from '@endora-commerce/platform/commands';
import { AuditLogService, PostgresOutboxStore, runCommandOutboxDrainTick } from '@endora-commerce/platform/composition';
import { EventBus } from '@endora-commerce/platform/events';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { sealedCommandHookRegistry } from '@endora-commerce/test-kit/command-hooks';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { customerAccountPortsFor } from '../../helpers/customer-account-ports.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import { manifest } from '../../../../packages/modules/newsletter/src/manifest.js';
import { NewsletterTokenHelper } from '../../../../packages/modules/newsletter/src/backend/services/token.helper.js';
import { NewsletterOptInService } from '../../../../packages/modules/newsletter/src/backend/services/opt-in.service.js';
import { NewsletterSubscriberService } from '../../../../packages/modules/newsletter/src/backend/services/subscriber.service.js';
import type { SettingsService } from '../../../src/kernel/settings/settings.service.js';
import { NewsletterSubscriber, NewsletterTag } from '../../helpers/package-entities.js';

/**
 * Issue #1843 — `newsletter`'s hookable actions on Postgres. A hook module
 * (`acme_rewards`, registered here, as a deployment's overlay would) takes part
 * in a real subscribe and a real confirmation through the refs the module
 * publishes, on the subscriber service's own Command Bus:
 *
 *  - its `beforeCommit` hook sees the uncommitted row on the write's
 *    transaction and is handed ids and codes only — never the address;
 *  - its veto rolls the write back: no subscriber, no tag link, no audit entry,
 *    no outbox row, no confirmation e-mail;
 *  - its `afterCommit` handler gets one `command_outbox` row per write, in the
 *    write's transaction, which the drain then delivers;
 *  - switched off, it is skipped and the writes behave as before.
 *
 * Each test runs inside the file's transaction (`setupTestDb`), so the bus's own
 * transaction is a savepoint that a veto rolls back for real.
 */

const HOOK_MODULE = 'acme_rewards';
/** The hook module's own veto code, as a deployment's module would declare it. */
const ACME = defineModuleErrorCodes(['ACME_REWARDS_REFUSED']);
const log = { info: () => undefined, warn: () => undefined, error: () => undefined } as never;

class FakeSettings {
  mode: 'single' | 'double' = 'double';
  async get<T>(code: string, _channelId: string, schema: z.ZodType<T>): Promise<T> {
    if (code === 'newsletter.opt_in_mode') return schema.parse(this.mode);
    if (code === 'newsletter.confirm_ttl_hours') return schema.parse(168);
    return schema.parse('' as unknown);
  }
}

interface Calls {
  before: Array<{ action: string; objectId: string; data: NewsletterSubscriberHookData; seen: unknown }>;
  after: Array<{ action: string; objectId: string; data: NewsletterSubscriberOutbox; organizationId: string | null }>;
}

describe('newsletter hookable actions on Postgres (issue #1843)', () => {
  let db: TestDb;
  let settings: FakeSettings;
  let mailer: InMemoryMailer;
  const stamp = Date.now().toString(36);
  let seq = 0;
  const email = (): string => `s1843-${stamp}-${(seq += 1)}@example.test`;

  beforeAll(async () => {
    db = await setupTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.beginTx();
    settings = new FakeSettings();
    mailer = new InMemoryMailer();
  });
  afterEach(async () => {
    await db.rollbackTx();
  });

  /** The subscriber service on a bus whose hook registry holds `acme_rewards`' hooks. */
  function compose(options: { veto?: 'subscribe' | 'confirm'; present?: boolean } = {}) {
    const calls: Calls = { before: [], after: [] };
    const before = (ref: typeof NL.subscribe, id: string): CommandHookEntry => ({
      id,
      on: ref,
      phase: 'beforeCommit',
      handler: async (ctx) => {
        const seen = await ctx.em.findOne(NewsletterSubscriber, { id: ctx.objectId });
        calls.before.push({ action: ctx.action, objectId: ctx.objectId, data: ctx.data, seen: seen?.status ?? null });
        if (options.veto && ref === NL[options.veto]) {
          throw new CommandHookRefusal(409, ACME.ACME_REWARDS_REFUSED, 'The rewards module refused this subscriber.');
        }
      },
    });
    const after = (ref: typeof NL.subscribe, id: string): CommandHookEntry => ({
      id,
      on: ref,
      phase: 'afterCommit',
      handler: async (ctx: AfterCommitContext<NewsletterSubscriberOutbox>) => {
        calls.after.push({ action: ctx.action, objectId: ctx.objectId, data: ctx.data, organizationId: ctx.organizationId });
      },
    });
    const registry = sealedCommandHookRegistry({
      hookableActions: (manifest.hookableActions ?? []).map((declaration) => ({ moduleId: 'newsletter', ...declaration })),
      moduleDependencies: { [HOOK_MODULE]: ['newsletter'] },
      hooks: [
        {
          moduleId: HOOK_MODULE,
          entries: [
            before(NL.subscribe, 'check-subscribe'),
            before(NL.confirm, 'check-confirm'),
            after(NL.subscribe, 'grant-on-subscribe'),
            after(NL.confirm, 'grant-on-confirm'),
          ],
        },
      ],
      isPresent: (moduleId) => moduleId !== HOOK_MODULE || options.present !== false,
    });
    const orm = { em: { fork: () => db.em() } } as unknown as MikroORM;
    const bus = new CommandBus(orm, new AuditLogService(() => db.em()), new EventBus(), { hooks: registry });
    const service = new NewsletterSubscriberService({
      emFactory: () => db.em(),
      optIn: new NewsletterOptInService(settings as unknown as SettingsService, new NewsletterTokenHelper('test-secret')),
      resolveDefaultChannelId: async () => null,
      customerAccounts: customerAccountPortsFor(() => db.em()).read,
      links: { confirm: (t) => `http://x/confirm?token=${t}`, unsubscribe: (t) => `http://x/unsubscribe?token=${t}` },
      mailer,
      commandBus: {
        run: (command) => withSystemScope('newsletter integration test: hookable actions', () => bus.run(command)),
      } as CommandBus,
    });
    const drain = () => runCommandOutboxDrainTick({ store: new PostgresOutboxStore(() => db.em()), handlers: registry, log });
    return { calls, service, drain };
  }

  async function outboxRowsFor(objectId: string): Promise<Array<Record<string, unknown>>> {
    return db
      .em()
      .execute(
        `select "action", "object_type", "hook_module", "hook_id", "status", "organization_id", "data"
           from "command_outbox" where "object_id" = ? order by "sequence"`,
        [objectId],
      );
  }

  async function auditActionsFor(objectId: string): Promise<string[]> {
    const rows = (await db
      .em()
      .execute(`select "action" from "audit_log_entries" where "object_id" = ? order by "acted_at"`, [objectId])) as Array<{
      action: string;
    }>;
    return rows.map((row) => row.action);
  }

  async function seedTag(code: string): Promise<string> {
    const tag = db.em().create(NewsletterTag, { code, name: code });
    await db.em().persist(tag).flush();
    return tag.id;
  }

  it('runs both phases on subscribe and on confirm, ids and codes only, and the drain delivers the rows', async () => {
    const { calls, service, drain } = compose();
    const tagId = await seedTag(`s1843-${stamp}-news`);
    const address = email();

    expect(await service.subscribe({ email: address, salesChannelId: null, tags: [`s1843-${stamp}-news`] })).toEqual({
      status: 'pending',
    });
    const subscriber = await db.em().findOneOrFail(NewsletterSubscriber, { email: address });
    expect(await service.confirm(subscriber.id)).toEqual({ ok: true });
    // A second click on the link is answered before any Command runs: no hook.
    expect(await service.confirm(subscriber.id)).toEqual({ ok: true });

    const base = {
      subscriberId: subscriber.id,
      salesChannelId: null,
      customerAccountId: null,
      organizationId: null,
      tagIds: [tagId],
    };
    expect(calls.before).toEqual([
      {
        action: 'newsletter.subscriber.subscribe',
        objectId: subscriber.id,
        data: { ...base, status: 'pending', previousStatus: null },
        seen: 'pending',
      },
      {
        action: 'newsletter.subscriber.confirm',
        objectId: subscriber.id,
        data: { ...base, status: 'active', previousStatus: 'pending' },
        seen: 'active',
      },
    ]);
    expect(await auditActionsFor(subscriber.id)).toEqual(['newsletter.subscriber.subscribe', 'newsletter.subscriber.confirm']);

    const rows = await outboxRowsFor(subscriber.id);
    expect(rows).toEqual([
      expect.objectContaining({
        action: 'newsletter.subscriber.subscribe',
        object_type: 'newsletter_subscriber',
        hook_module: HOOK_MODULE,
        hook_id: 'grant-on-subscribe',
        status: 'pending',
        organization_id: null,
        data: { ...base, status: 'pending', previousStatus: null },
      }),
      expect.objectContaining({
        action: 'newsletter.subscriber.confirm',
        hook_id: 'grant-on-confirm',
        status: 'pending',
        data: { ...base, status: 'active', previousStatus: 'pending' },
      }),
    ]);
    expect(JSON.stringify([calls.before.map((call) => call.data), rows])).not.toContain(address);

    await drain();
    expect((await outboxRowsFor(subscriber.id)).map((row) => row['status'])).toEqual(['delivered', 'delivered']);
    expect(calls.after.filter((call) => call.objectId === subscriber.id)).toEqual([
      {
        action: 'newsletter.subscriber.subscribe',
        objectId: subscriber.id,
        organizationId: null,
        data: { ...base, status: 'pending', previousStatus: null },
      },
      {
        action: 'newsletter.subscriber.confirm',
        objectId: subscriber.id,
        organizationId: null,
        data: { ...base, status: 'active', previousStatus: 'pending' },
      },
    ]);
  });

  it('rolls a vetoed subscribe back: no subscriber, no tag link, no entry, no outbox row, no e-mail', async () => {
    const { service } = compose({ veto: 'subscribe' });
    await seedTag(`s1843-${stamp}-veto`);
    const address = email();

    await expect(service.subscribe({ email: address, salesChannelId: null, tags: [`s1843-${stamp}-veto`] })).rejects.toMatchObject({
      statusCode: 409,
      code: 'ACME_REWARDS_REFUSED',
    });

    expect(await db.em().fork().findOne(NewsletterSubscriber, { email: address })).toBeNull();
    const [links] = (await db
      .em()
      .execute(
        `select count(*)::int as n from "newsletter_subscriber_tags" st
           join "newsletter_tags" t on t."id" = st."tag_id" where t."code" = ?`,
        [`s1843-${stamp}-veto`],
      )) as Array<{ n: number }>;
    expect(links!.n).toBe(0);
    const [outbox] = (await db
      .em()
      .execute(`select count(*)::int as n from "command_outbox" where "action" like 'newsletter.%'`)) as Array<{ n: number }>;
    expect(outbox!.n).toBe(0);
    expect(mailer.sent).toHaveLength(0);
  });

  it('leaves a subscriber pending when its confirmation is vetoed', async () => {
    const { service } = compose({ veto: 'confirm' });
    const address = email();
    await service.subscribe({ email: address, salesChannelId: null });
    const subscriber = await db.em().findOneOrFail(NewsletterSubscriber, { email: address });

    await expect(service.confirm(subscriber.id)).rejects.toMatchObject({ statusCode: 409, code: 'ACME_REWARDS_REFUSED' });

    db.em().clear();
    const after = await db.em().findOneOrFail(NewsletterSubscriber, { id: subscriber.id });
    expect(after.status).toBe('pending');
    expect(after.confirmedAt ?? null).toBeNull();
    expect(await auditActionsFor(subscriber.id)).toEqual(['newsletter.subscriber.subscribe']);
    expect((await outboxRowsFor(subscriber.id)).map((row) => row['action'])).toEqual(['newsletter.subscriber.subscribe']);
  });

  it('skips a hook module that is switched off: no call, no outbox row, the writes unchanged', async () => {
    const { calls, service } = compose({ present: false, veto: 'subscribe' });
    const address = email();

    expect(await service.subscribe({ email: address, salesChannelId: null })).toEqual({ status: 'pending' });
    const subscriber = await db.em().findOneOrFail(NewsletterSubscriber, { email: address });
    expect(await service.confirm(subscriber.id)).toEqual({ ok: true });

    expect(calls.before).toEqual([]);
    expect(await outboxRowsFor(subscriber.id)).toEqual([]);
    expect(await auditActionsFor(subscriber.id)).toEqual(['newsletter.subscriber.subscribe', 'newsletter.subscriber.confirm']);
    expect(mailer.sent).toHaveLength(1);
  });
});
