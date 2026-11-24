import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { NewsletterAutomationRun, NewsletterSubscriber } from '../../helpers/package-entities.js';

/**
 * Issue #1833 — automation enrolment on the composed platform, and while the
 * module is off (Constitution XVII).
 *
 * Enrolment is driven by the subscriber flow's own routes — the storefront
 * subscribe and the confirmation link — so a switched-off `newsletter` refuses
 * the request before anything could enrol: no subscriber is taken, a pending
 * one is not confirmed, and no automation run is created. Switched back on,
 * the same confirmation link enrols the subscriber, which is also the proof
 * that the composition wires the subscriber service to the automation engine
 * (the service-level cases are `automation-enrolment.test.ts`).
 *
 * The harness's opt-in mode is the manifest default, `double`.
 */
describe('newsletter automation enrolment through the routes, and off (issue #1833)', () => {
  let h: BackendServerHandle;
  const mailer = new InMemoryMailer();
  const run = `e1833_${randomUUID().slice(0, 8)}`;
  const automationId = randomUUID();
  const channel = { 'x-sales-channel': 'default' };

  beforeAll(async () => {
    h = await setupBackendServer({ organizationsMailer: mailer });
    await h
      .em()
      .fork()
      .getConnection()
      .execute(
        `insert into "newsletter_automations"
           ("id", "name", "status", "trigger_type", "trigger_tag_ids", "language", "reentry_policy", "steps", "version", "created_at", "updated_at")
         values (?, ?, 'active', 'all', '[]', 'en-US', 'once', ?::jsonb, 1, now(), now())`,
        [
          automationId,
          `#1833 ${run}`,
          JSON.stringify([{ type: 'send', subject: 'Welcome', content: { root: { props: {} }, content: [], zones: {} } }]),
        ],
      );
  });

  afterAll(async () => {
    const em = h.em().fork();
    await em.getConnection().execute(`delete from "newsletter_automations" where "id" = ?`, [automationId]);
    await em.nativeDelete(NewsletterSubscriber, { email: { $like: `${run}%` } });
    await teardownBackendServer(h);
  });

  async function runsOfAutomation(): Promise<string[]> {
    const runs = await h.em().fork().find(NewsletterAutomationRun, { automationId });
    return runs.map((r) => r.subscriberId);
  }

  function confirmUrlSentTo(address: string): string {
    const message = mailer.sent.find((m) => m.to === address);
    const match = message?.text?.match(/https?:\/\/\S+\/api\/v1\/newsletter\/confirm\?token=\S+/);
    if (!match) throw new Error(`no confirmation link was sent to ${address}`);
    const url = new URL(match[0]);
    return `${url.pathname}${url.search}`;
  }

  it('takes no subscriber and enrols nobody while off', async () => {
    const address = `${run}-off@example.test`;
    await withModuleOff('newsletter', 'deactivated', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/newsletter/subscribe',
        headers: channel,
        payload: { email: address, channelCode: 'default' },
      });
      expect(res.statusCode, res.body).toBe(503);
    });

    expect(await h.em().fork().findOne(NewsletterSubscriber, { email: address })).toBeNull();
    expect(await runsOfAutomation()).toEqual([]);
  });

  it('does not enrol on a confirmation link followed while off, and enrols on the same link once restored', async () => {
    const address = `${run}-confirm@example.test`;
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/newsletter/subscribe',
      headers: channel,
      payload: { email: address, channelCode: 'default' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: { status: string } }).data.status).toBe('pending');
    const subscriber = await h.em().fork().findOneOrFail(NewsletterSubscriber, { email: address });
    expect(await runsOfAutomation()).toEqual([]);
    const confirm = confirmUrlSentTo(address);

    await withModuleOff('newsletter', 'deactivated', async () => {
      const off = await h.app.inject({ method: 'GET', url: confirm });
      expect(off.statusCode, off.body).toBe(503);
    });
    expect((await h.em().fork().findOneOrFail(NewsletterSubscriber, { id: subscriber.id })).status).toBe('pending');
    expect(await runsOfAutomation()).toEqual([]);

    const on = await h.app.inject({ method: 'GET', url: confirm });
    expect(on.statusCode, on.body).toBe(302);
    expect((await h.em().fork().findOneOrFail(NewsletterSubscriber, { id: subscriber.id })).status).toBe('active');
    expect(await runsOfAutomation()).toEqual([subscriber.id]);
  });
});
