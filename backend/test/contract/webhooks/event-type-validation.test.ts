import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  WEBHOOK_BUILT_IN_EVENT_TYPES,
  type WebhookEventRegistryPort,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { Webhook } from '../../helpers/package-entities.js';

/**
 * A webhook subscription may name only event types that are delivered
 * (issue #173).
 *
 * The API used to accept any non-empty string, so a subscription to an event
 * nothing bridges — or to a misspelled one — was saved and stayed silent
 * forever. A write is now refused with `WEBHOOK_EVENT_TYPE_NOT_DELIVERABLE`
 * unless every name is bridged by `webhooks` itself or contributed by a module
 * that is present.
 *
 * **Subscriptions stored before the rule keep working.** Validation is on write
 * only and only over the names a write *adds*: a stored row carrying a name
 * that is no longer deliverable is listed as it is, can be renamed, paused and
 * re-pointed, and can keep that name through an `eventTypes` update. Nothing is
 * migrated and nothing is deleted.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
const CODE = 'WEBHOOK_EVENT_TYPE_NOT_DELIVERABLE';
/**
 * Emitted on the bus, offered by nobody. `credit_limits` contributes
 * `credit_limit.adjusted.v1` and not this one, so it stands for every event
 * that exists in-process and does not leave the instance.
 */
const EMITTED_NOT_BRIDGED = 'credit_limit.granted.v1';
/** Emitted by nothing at all. */
const NEVER_EMITTED = 'payment.settled.v1';
/** An operator-switchable module to stand as the owner of a contributed type. */
const OWNER = 'quote_requests';
const CONTRIBUTED = 'webhooks_test.validation_contributed.v1';

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}
interface WebhookBody {
  data: { id: string; name: string; eventTypes: string[]; status: string };
}

describe('webhook admin CRUD — eventTypes must be deliverable (#173)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    h.container
      .resolve<WebhookEventRegistryPort>('webhookEventRegistry')
      .register({ ownerModuleId: OWNER, eventType: CONTRIBUTED });
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const create = async (eventTypes: unknown) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/webhooks',
      payload: { name: `Hook ${randomUUID().slice(0, 8)}`, url: 'https://receiver.example.com/hook', eventTypes },
      cookies: ADMIN,
    });

  const patch = async (id: string, payload: Record<string, unknown>) =>
    h.app.inject({ method: 'PATCH', url: `/api/v1/admin/webhooks/${id}`, payload, cookies: ADMIN });

  /** A row as it could have been written before the rule existed. */
  const storeLegacy = async (eventTypes: string[]): Promise<string> => {
    const em = h.em();
    const webhook = em.create(Webhook, {
      name: `Legacy ${randomUUID().slice(0, 8)}`,
      url: `https://receiver.example.com/${randomUUID()}`,
      secret: 'shhh',
      eventTypes,
      status: 'active',
      organizationId: null,
    });
    await em.flush();
    return webhook.id as string;
  };

  describe('create', () => {
    it('accepts every built-in event type', async () => {
      const res = await create([...WEBHOOK_BUILT_IN_EVENT_TYPES]);
      expect(res.statusCode, res.body).toBe(201);
      expect((res.json() as WebhookBody).data.eventTypes).toEqual([...WEBHOOK_BUILT_IN_EVENT_TYPES]);
    });

    it('accepts a type contributed by a module that is present', async () => {
      const res = await create([CONTRIBUTED]);
      expect(res.statusCode, res.body).toBe(201);
    });

    it.each([
      ['emitted on the bus but not bridged', EMITTED_NOT_BRIDGED],
      ['emitted by nothing', NEVER_EMITTED],
      ['misspelled', 'order.creatd.v1'],
    ])('refuses a type that is %s — 422 with a typed code', async (_label, eventType) => {
      const res = await create(['order.created.v1', eventType]);
      expect(res.statusCode, res.body).toBe(422);
      const body = res.json() as ErrorBody;
      expect(body.error.code).toBe(CODE);
      expect(body.error.details).toMatchObject({ eventTypes: eventType });
      // The sentence names the refused type and not the accepted one.
      expect(body.error.message).toContain(eventType);
      expect(body.error.message).not.toContain('order.created.v1');
    });

    it('stores nothing when it refuses', async () => {
      const before = await h.em().count(Webhook, {});
      await create([NEVER_EMITTED]);
      expect(await h.em().count(Webhook, {})).toBe(before);
    });

    it('refuses a contributed type while its owner is switched off, and accepts it again after', async () => {
      await withModuleOff(OWNER, 'deactivated', async () => {
        const res = await create([CONTRIBUTED]);
        expect(res.statusCode, res.body).toBe(422);
        expect((res.json() as ErrorBody).error.code).toBe(CODE);
      });
      expect((await create([CONTRIBUTED])).statusCode).toBe(201);
    });

    it('answers the refusal in the language the admin reads', async () => {
      const setPreferredLanguage = async (language: 'pl' | null): Promise<void> => {
        const res = await h.app.inject({
          method: 'PATCH',
          url: '/api/v1/admin/me/preferred-language',
          cookies: ADMIN,
          payload: { preferredLanguage: language },
        });
        expect(res.statusCode, res.body).toBe(200);
      };
      const english = ((await create([NEVER_EMITTED])).json() as ErrorBody).error;
      await setPreferredLanguage('pl');
      try {
        const polish = ((await create([NEVER_EMITTED])).json() as ErrorBody).error;
        expect(polish.code).toBe(CODE);
        expect(polish.message).toContain(NEVER_EMITTED);
        expect(polish.message).not.toBe(english.message);
      } finally {
        await setPreferredLanguage(null);
      }
    });
  });

  describe('update', () => {
    it('refuses to add an undeliverable type', async () => {
      const id = ((await create(['order.created.v1'])).json() as WebhookBody).data.id;
      const res = await patch(id, { eventTypes: ['order.created.v1', EMITTED_NOT_BRIDGED] });
      expect(res.statusCode, res.body).toBe(422);
      expect((res.json() as ErrorBody).error.code).toBe(CODE);
      expect((await h.em().findOneOrFail(Webhook, { id })).eventTypes).toEqual(['order.created.v1']);
    });

    it('accepts a deliverable set', async () => {
      const id = ((await create(['order.created.v1'])).json() as WebhookBody).data.id;
      const res = await patch(id, { eventTypes: ['order.status_changed.v1', CONTRIBUTED] });
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json() as WebhookBody).data.eventTypes).toEqual(['order.status_changed.v1', CONTRIBUTED]);
    });
  });

  describe('a subscription stored before the rule', () => {
    it('is listed with the types it carries', async () => {
      const id = await storeLegacy(['order.created.v1', EMITTED_NOT_BRIDGED, NEVER_EMITTED]);
      const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/webhooks', cookies: ADMIN });
      expect(res.statusCode, res.body).toBe(200);
      const row = (res.json() as { data: WebhookBody['data'][] }).data.find((w) => w.id === id);
      expect(row?.eventTypes).toEqual(['order.created.v1', EMITTED_NOT_BRIDGED, NEVER_EMITTED]);
    });

    it('can be paused, renamed and re-pointed without touching its types', async () => {
      const id = await storeLegacy([NEVER_EMITTED]);
      const res = await patch(id, { status: 'paused', name: 'Renamed', url: 'https://receiver.example.com/new' });
      expect(res.statusCode, res.body).toBe(200);
      const data = (res.json() as WebhookBody).data;
      expect(data).toMatchObject({ status: 'paused', name: 'Renamed', eventTypes: [NEVER_EMITTED] });
    });

    it('keeps a stale type through an eventTypes update, and can gain a deliverable one beside it', async () => {
      const id = await storeLegacy([EMITTED_NOT_BRIDGED]);
      const res = await patch(id, { eventTypes: [EMITTED_NOT_BRIDGED, 'order.created.v1'] });
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json() as WebhookBody).data.eventTypes).toEqual([EMITTED_NOT_BRIDGED, 'order.created.v1']);
    });

    it('can drop a stale type, and cannot have it back once dropped', async () => {
      const id = await storeLegacy([EMITTED_NOT_BRIDGED, 'order.created.v1']);
      expect((await patch(id, { eventTypes: ['order.created.v1'] })).statusCode).toBe(200);
      const back = await patch(id, { eventTypes: ['order.created.v1', EMITTED_NOT_BRIDGED] });
      expect(back.statusCode, back.body).toBe(422);
    });

    it('cannot gain a different undeliverable type', async () => {
      const id = await storeLegacy([EMITTED_NOT_BRIDGED]);
      const res = await patch(id, { eventTypes: [EMITTED_NOT_BRIDGED, NEVER_EMITTED] });
      expect(res.statusCode, res.body).toBe(422);
      expect((res.json() as ErrorBody).error.details).toMatchObject({ eventTypes: NEVER_EMITTED });
    });

    it('can be deleted', async () => {
      const id = await storeLegacy([NEVER_EMITTED]);
      const res = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/webhooks/${id}`, cookies: ADMIN });
      expect(res.statusCode, res.body).toBe(204);
    });
  });
});
