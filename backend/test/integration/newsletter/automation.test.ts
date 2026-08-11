import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { NewsletterTokenHelper } from '../../../src/modules/newsletter/services/token.helper.js';
import { NewsletterOptInService } from '../../../src/modules/newsletter/services/opt-in.service.js';
import { NewsletterContentService } from '../../../src/modules/newsletter/services/content.service.js';
import { NewsletterAutomationService } from '../../../src/modules/newsletter/services/automation.service.js';
import { InMemoryNewsletterProvider } from '../../../src/modules/newsletter/services/provider/console-provider.js';
import type { SettingsService } from '../../../src/kernel/settings/settings.service.js';
import { NewsletterSubscriber } from '../../../src/modules/newsletter/entities/newsletter-subscriber.entity.js';
import { NewsletterAutomationRun } from '../../../src/modules/newsletter/entities/newsletter-automation-run.entity.js';
import type { AutomationStep } from '@b2b/contracts';

function tree(text: string): Record<string, unknown> {
  return { root: { props: {} }, content: [{ type: 'EmailText', props: { id: 't', text } }], zones: {} };
}
const STEPS: AutomationStep[] = [
  { type: 'send', subject: 'A', content: tree('Email A') },
  { type: 'wait', days: 3 },
  { type: 'send', subject: 'B', content: tree('Email B') },
];

describe('newsletter automations (US4)', () => {
  let db: TestDb;
  let provider: InMemoryNewsletterProvider;
  let svc: NewsletterAutomationService;
  let pending: Array<{ runId: string; stepIndex: number; delayMs: number }>;

  beforeAll(async () => {
    db = await setupTestDb();
  });
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await db.beginTx();
    provider = new InMemoryNewsletterProvider();
    pending = [];
    const optIn = new NewsletterOptInService({} as unknown as SettingsService, new NewsletterTokenHelper('s'));
    svc = new NewsletterAutomationService({
      emFactory: () => db.em(),
      content: new NewsletterContentService(),
      optIn,
      links: { confirm: (t) => `c?${t}`, unsubscribe: (t) => `u?${t}` },
      resolveProvider: async () => provider,
      resolveSender: async () => ({ fromEmail: 'n@s.test', fromName: '' }),
      enqueueStep: async (runId, stepIndex, delayMs) => {
        pending.push({ runId, stepIndex, delayMs });
      },
    });
  });
  afterEach(async () => {
    await db.rollbackTx();
  });

  async function makeActive(): Promise<string> {
    const detail = await svc.create({
      name: 'Welcome',
      triggerType: 'all',
      language: 'en-US',
      reentryPolicy: 'once',
      steps: STEPS,
    });
    await svc.activate(detail.id, detail.version);
    return detail.id;
  }

  it('rejects activation of an invalid automation', async () => {
    const bad = await svc.create({
      name: 'Bad',
      triggerType: 'tag',
      triggerTagIds: [],
      language: 'en-US',
      reentryPolicy: 'once',
      steps: [{ type: 'wait', days: 1 }],
    });
    await expect(svc.activate(bad.id, bad.version)).rejects.toMatchObject({ statusCode: 422 });
  });

  it('runs send -> wait N days -> send, honouring the delay', async () => {
    const aid = await makeActive();
    const sub = db.em().create(NewsletterSubscriber, { email: 'a@x.test', status: 'active' });
    await db.em().flush();

    const runId = await svc.enrol(aid, sub.id);
    expect(runId).not.toBeNull();
    expect(pending).toEqual([{ runId, stepIndex: 0, delayMs: 0 }]);

    // Drain step 0 (send A) -> enqueues step 1 with no delay.
    pending = [];
    await svc.processStep(runId!, 0);
    expect(provider.sent.map((m) => m.subject)).toEqual(['A']);
    expect(pending).toEqual([{ runId, stepIndex: 1, delayMs: 0 }]);

    // Drain step 1 (wait 3 days) -> enqueues step 2 with a 3-day delay.
    pending = [];
    await svc.processStep(runId!, 1);
    expect(provider.sent).toHaveLength(1);
    expect(pending).toEqual([{ runId, stepIndex: 2, delayMs: 3 * 86_400_000 }]);

    // Drain step 2 (send B) -> completes.
    pending = [];
    await svc.processStep(runId!, 2);
    expect(provider.sent.map((m) => m.subject)).toEqual(['A', 'B']);
    expect(pending).toEqual([]);

    db.em().clear();
    const run = await db.em().findOneOrFail(NewsletterAutomationRun, { id: runId! });
    expect(run.status).toBe('completed');
  });

  it('is idempotent — re-processing an already-advanced step is a no-op', async () => {
    const aid = await makeActive();
    const sub = db.em().create(NewsletterSubscriber, { email: 'b@x.test', status: 'active' });
    await db.em().flush();
    const runId = await svc.enrol(aid, sub.id);

    await svc.processStep(runId!, 0);
    await svc.processStep(runId!, 0); // re-delivery
    expect(provider.sent).toHaveLength(1);
  });

  it('enrols once (re-entry policy)', async () => {
    const aid = await makeActive();
    const sub = db.em().create(NewsletterSubscriber, { email: 'c@x.test', status: 'active' });
    await db.em().flush();
    expect(await svc.enrol(aid, sub.id)).not.toBeNull();
    expect(await svc.enrol(aid, sub.id)).toBeNull();
  });

  it('stops the sequence when the subscriber unsubscribes mid-run', async () => {
    const aid = await makeActive();
    const sub = db.em().create(NewsletterSubscriber, { email: 'd@x.test', status: 'active' });
    await db.em().flush();
    const runId = await svc.enrol(aid, sub.id);
    await svc.processStep(runId!, 0); // sends A, advances to step 1

    // Subscriber unsubscribes before the delayed step 2 fires.
    sub.status = 'unsubscribed';
    await db.em().flush();

    await svc.processStep(runId!, 1);
    expect(provider.sent.map((m) => m.subject)).toEqual(['A']); // no B
    db.em().clear();
    const run = await db.em().findOneOrFail(NewsletterAutomationRun, { id: runId! });
    expect(run.status).toBe('cancelled');
  });
});
