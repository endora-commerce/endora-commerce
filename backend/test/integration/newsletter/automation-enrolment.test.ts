import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MikroORM } from '@mikro-orm/postgresql';
import type { z } from 'zod';
import {
  defineModuleErrorCodes,
  NEWSLETTER_HOOKABLE_ACTIONS as NL,
  type AutomationStep,
  type AutomationTriggerType,
} from '@endora-commerce/contracts';
import { CommandBus, CommandHookRefusal } from '@endora-commerce/platform/commands';
import { AuditLogService } from '@endora-commerce/platform/composition';
import { EventBus } from '@endora-commerce/platform/events';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { sealedCommandHookRegistry } from '@endora-commerce/test-kit/command-hooks';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { customerAccountPortsFor } from '../../helpers/customer-account-ports.js';
import { newsletterTestCommandBus } from '../../helpers/newsletter-command-bus.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import { manifest } from '../../../../packages/modules/newsletter/src/manifest.js';
import { NewsletterTokenHelper } from '../../../../packages/modules/newsletter/src/backend/services/token.helper.js';
import { NewsletterOptInService } from '../../../../packages/modules/newsletter/src/backend/services/opt-in.service.js';
import { NewsletterContentService } from '../../../../packages/modules/newsletter/src/backend/services/content.service.js';
import { NewsletterAutomationService } from '../../../../packages/modules/newsletter/src/backend/services/automation.service.js';
import { NewsletterSubscriberService } from '../../../../packages/modules/newsletter/src/backend/services/subscriber.service.js';
import { InMemoryNewsletterProvider } from '../../../../packages/modules/newsletter/src/backend/services/provider/console-provider.js';
import type { SettingsService } from '../../../src/kernel/settings/settings.service.js';
import { NewsletterAutomationRun, NewsletterSubscriber, NewsletterTag } from '../../helpers/package-entities.js';

/**
 * Issue #1833 — an active automation enrols the subscribers its trigger
 * matches **through the public subscriber flow**, never through a direct
 * `enrol()` call:
 *
 *  - `all` enrols a subscriber the moment it becomes `active` — on a single
 *    opt-in subscribe, or on a double opt-in confirmation; a `pending` one is
 *    not enrolled;
 *  - `tag` / `tag_list` enrol an active subscriber that carries, or is newly
 *    given, one of the trigger's tags;
 *  - a subscriber that was already active and gains nothing the trigger asks
 *    for is not enrolled by re-submitting the form, and activating an
 *    automation does not back-fill the subscribers that already match;
 *  - a paused automation, a suppressed address and a rolled-back write enrol
 *    nobody.
 */

const STEPS: AutomationStep[] = [
  {
    type: 'send',
    subject: 'Welcome',
    content: { root: { props: {} }, content: [], zones: {} },
  },
];

class FakeSettings {
  mode: 'single' | 'double' = 'single';
  async get<T>(code: string, _channelId: string, schema: z.ZodType<T>): Promise<T> {
    if (code === 'newsletter.opt_in_mode') return schema.parse(this.mode);
    if (code === 'newsletter.confirm_ttl_hours') return schema.parse(168);
    return schema.parse('' as unknown);
  }
}

const ACME = defineModuleErrorCodes(['ACME_REFUSED']);

describe('newsletter automation enrolment (issue #1833)', () => {
  let db: TestDb;
  let settings: FakeSettings;
  let enqueued: Array<{ runId: string; stepIndex: number; delayMs: number }>;
  let automations: NewsletterAutomationService;
  const stamp = Date.now().toString(36);
  let seq = 0;
  const email = (): string => `e1833-${stamp}-${(seq += 1)}@example.test`;

  beforeAll(async () => {
    db = await setupTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.beginTx();
    // Another file's committed active automation would enrol these subscribers
    // too; inside this rolled-back transaction only this file's own count.
    await db.em().execute(`update "newsletter_automations" set "status" = 'paused' where "status" = 'active'`);
    settings = new FakeSettings();
    enqueued = [];
    const optIn = new NewsletterOptInService(settings as unknown as SettingsService, new NewsletterTokenHelper('s'));
    const provider = new InMemoryNewsletterProvider();
    automations = new NewsletterAutomationService({
      emFactory: () => db.em(),
      content: new NewsletterContentService(),
      optIn,
      links: { confirm: (t) => `c?${t}`, unsubscribe: (t) => `u?${t}` },
      resolveProvider: async () => provider,
      resolveSender: async () => ({ fromEmail: 'n@s.test', fromName: '' }),
      enqueueStep: async (runId, stepIndex, delayMs) => {
        enqueued.push({ runId, stepIndex, delayMs });
      },
    });
  });
  afterEach(async () => {
    await db.rollbackTx();
  });

  function subscriberService(commandBus: CommandBus = newsletterTestCommandBus(() => db.em())): NewsletterSubscriberService {
    return new NewsletterSubscriberService({
      emFactory: () => db.em(),
      optIn: new NewsletterOptInService(settings as unknown as SettingsService, new NewsletterTokenHelper('s')),
      resolveDefaultChannelId: async () => null,
      customerAccounts: customerAccountPortsFor(() => db.em()).read,
      links: { confirm: (t) => `c?${t}`, unsubscribe: (t) => `u?${t}` },
      mailer: new InMemoryMailer(),
      commandBus,
      enrolAutomations: (transition) => automations.enrolMatching(transition),
    });
  }

  /** A bus whose hook registry vetoes every subscribe in its `beforeCommit` phase. */
  function vetoingBus(): CommandBus {
    const registry = sealedCommandHookRegistry({
      hookableActions: (manifest.hookableActions ?? []).map((declaration) => ({ moduleId: 'newsletter', ...declaration })),
      moduleDependencies: { acme: ['newsletter'] },
      hooks: [
        {
          moduleId: 'acme',
          entries: [
            {
              id: 'refuse',
              on: NL.subscribe,
              phase: 'beforeCommit',
              handler: async () => {
                throw new CommandHookRefusal(409, ACME.ACME_REFUSED, 'Refused.');
              },
            },
          ],
        },
      ],
      isPresent: () => true,
    });
    const orm = { em: { fork: () => db.em() } } as unknown as MikroORM;
    const bus = new CommandBus(orm, new AuditLogService(() => db.em()), new EventBus(), { hooks: registry });
    return { run: (command) => withSystemScope('newsletter #1833 veto', () => bus.run(command)) } as CommandBus;
  }

  async function seedTag(suffix: string): Promise<{ id: string; code: string }> {
    const code = `e1833-${stamp}-${suffix}`;
    const tag = db.em().create(NewsletterTag, { code, name: code });
    await db.em().persist(tag).flush();
    return { id: tag.id, code };
  }

  async function activeAutomation(triggerType: AutomationTriggerType, triggerTagIds: string[] = []): Promise<string> {
    const created = await automations.create({
      name: `#1833 ${triggerType}`,
      triggerType,
      triggerTagIds,
      language: 'en-US',
      reentryPolicy: 'once',
      steps: STEPS,
    });
    await automations.activate(created.id, created.version);
    return created.id;
  }

  async function runsOf(automationId: string): Promise<string[]> {
    const runs = await db.em().find(NewsletterAutomationRun, { automationId });
    return runs.map((run) => run.subscriberId).sort();
  }

  async function idOf(address: string): Promise<string> {
    return (await db.em().findOneOrFail(NewsletterSubscriber, { email: address })).id;
  }

  it('`all` enrols a single opt-in subscriber at subscribe and enqueues step 0', async () => {
    const automationId = await activeAutomation('all');
    const address = email();

    expect(await subscriberService().subscribe({ email: address, salesChannelId: null })).toEqual({ status: 'active' });

    const subscriberId = await idOf(address);
    expect(await runsOf(automationId)).toEqual([subscriberId]);
    expect(enqueued).toEqual([{ runId: expect.any(String), stepIndex: 0, delayMs: 0 }]);
  });

  it('`all` does not enrol a pending double opt-in subscriber, and enrols it on confirmation', async () => {
    settings.mode = 'double';
    const automationId = await activeAutomation('all');
    const service = subscriberService();
    const address = email();

    expect(await service.subscribe({ email: address, salesChannelId: null })).toEqual({ status: 'pending' });
    expect(await runsOf(automationId)).toEqual([]);

    const subscriberId = await idOf(address);
    await service.confirm(subscriberId);
    expect(await runsOf(automationId)).toEqual([subscriberId]);

    // A re-clicked confirmation link enrols nobody a second time.
    await service.confirm(subscriberId);
    expect(await runsOf(automationId)).toEqual([subscriberId]);
    expect(enqueued).toHaveLength(1);
  });

  it('`tag` enrols on a subscribe that carries the tag, and not on one that does not', async () => {
    const offers = await seedTag('offers');
    const automationId = await activeAutomation('tag', [offers.id]);
    const service = subscriberService();
    const tagged = email();
    const untagged = email();

    await service.subscribe({ email: tagged, salesChannelId: null, tags: [offers.code] });
    await service.subscribe({ email: untagged, salesChannelId: null });

    expect(await runsOf(automationId)).toEqual([await idOf(tagged)]);
  });

  it('`tag_list` enrols an already active subscriber when a re-subscribe adds one of its tags', async () => {
    const offers = await seedTag('list-offers');
    const events = await seedTag('list-events');
    const other = await seedTag('list-other');
    const automationId = await activeAutomation('tag_list', [offers.id, events.id]);
    const service = subscriberService();
    const address = email();

    await service.subscribe({ email: address, salesChannelId: null, tags: [other.code] });
    expect(await runsOf(automationId)).toEqual([]);

    await service.subscribe({ email: address, salesChannelId: null, tags: [events.code] });
    expect(await runsOf(automationId)).toEqual([await idOf(address)]);
  });

  it('`tag` enrols on confirmation a pending subscriber whose tags already match', async () => {
    settings.mode = 'double';
    const offers = await seedTag('confirm-offers');
    const automationId = await activeAutomation('tag', [offers.id]);
    const service = subscriberService();
    const address = email();

    await service.subscribe({ email: address, salesChannelId: null, tags: [offers.code] });
    expect(await runsOf(automationId)).toEqual([]);

    const subscriberId = await idOf(address);
    await service.confirm(subscriberId);
    expect(await runsOf(automationId)).toEqual([subscriberId]);
  });

  it('does not back-fill: activation enrols nobody, and a re-subscribe that adds nothing matching enrols nobody', async () => {
    const offers = await seedTag('nobackfill');
    const service = subscriberService();
    const plain = email();
    const tagged = email();
    await service.subscribe({ email: plain, salesChannelId: null });
    await service.subscribe({ email: tagged, salesChannelId: null, tags: [offers.code] });

    const allId = await activeAutomation('all');
    const tagId = await activeAutomation('tag', [offers.id]);
    expect(await runsOf(allId)).toEqual([]);
    expect(await runsOf(tagId)).toEqual([]);

    await service.subscribe({ email: plain, salesChannelId: null });
    await service.subscribe({ email: tagged, salesChannelId: null, tags: [offers.code] });
    expect(await runsOf(allId)).toEqual([]);
    expect(await runsOf(tagId)).toEqual([]);
    expect(enqueued).toEqual([]);
  });

  it('enrols nobody into a paused automation', async () => {
    const automationId = await activeAutomation('all');
    const detail = await automations.get(automationId);
    await automations.pause(automationId, detail.version);

    await subscriberService().subscribe({ email: email(), salesChannelId: null });

    expect(await runsOf(automationId)).toEqual([]);
  });

  it('enrols nobody whose address is suppressed', async () => {
    const automationId = await activeAutomation('all');
    const service = subscriberService();
    const address = email();
    await service.suppress(address, 'bounce');

    expect(await service.subscribe({ email: address, salesChannelId: null })).toEqual({ status: 'active' });

    expect(await runsOf(automationId)).toEqual([]);
  });

  it('enrols nobody when the subscribe is rolled back', async () => {
    const automationId = await activeAutomation('all');
    const address = email();

    await expect(subscriberService(vetoingBus()).subscribe({ email: address, salesChannelId: null })).rejects.toMatchObject({
      statusCode: 409,
    });

    expect(await db.em().findOne(NewsletterSubscriber, { email: address })).toBeNull();
    expect(await runsOf(automationId)).toEqual([]);
    expect(enqueued).toEqual([]);
  });
});
