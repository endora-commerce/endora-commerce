// Issue #89 — an operator switches one transactional email off.
//
// The business decision behind this file: the `transactional_emails` module
// itself is non-deactivatable (issue #88), because the granularity worth having
// is the individual email. `TransactionalEmail.active` has been honoured on the
// send path since feature 047; what was missing was any way for an operator to
// write it. These cases pin the whole round trip — the flip, its effect on a
// real send, its reversal, and the codes that may never be flipped at all.
//
// The protected set is declared by the module that *sends* the email, in the
// EmailDefaultsRegistry, so nothing here (and nothing in the admin app) holds a
// list of codes.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import { TransactionalEmailService } from '../../../../packages/modules/transactional_emails/src/backend/services/transactional-email.service.js';
import { ContentResolver } from '../../../../packages/modules/transactional_emails/src/backend/services/content-resolver.js';
import { BrandingService } from '../../../../packages/modules/transactional_emails/src/backend/services/branding.service.js';
import { EmbedResolver } from '../../../../packages/modules/transactional_emails/src/backend/services/embed-resolver.js';
import { EmailDefaultsRegistry } from '../../../../packages/modules/transactional_emails/src/backend/services/email-defaults-registry.js';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import {
  SettingNotRegistered,
  type SettingsService,
} from '../../../src/kernel/settings/settings.service.js';
import { TransactionalEmail } from '../../helpers/package-entities.js';

const ADMIN = { b2b_admin_session: 'stub-admin-session' };
const BASE = '/api/v1/admin/transactional-emails';
const ACTION = 'transactional_email.activation.set';
const CHANNEL = '00000000-0000-0000-0000-0000000000aa';

/** Ordinary email — an operator may legitimately not want stock chatter. */
const ORDINARY = 'availability_back_in_stock';
/** Required to finish creating an account. */
const PROTECTED = 'email_verification';

const fakeSettings = {
  // D-48 — a *real* settings condition, not a bare `Error`. `BrandingService`
  // degrades on the two conditions with a defined fallback and propagates the
  // rest now (composition rule 7), so a stub throwing a generic error asserts a
  // behaviour the service no longer has.
  get: async (code: string) => {
    throw new SettingNotRegistered(code);
  },
} as unknown as SettingsService;

function sender(mailer: InMemoryMailer, h: BackendServerHandle): TransactionalEmailService {
  return new TransactionalEmailService({
    emFactory: h.em,
    contentResolver: new ContentResolver(),
    branding: new BrandingService(fakeSettings),
    embeds: new EmbedResolver(),
    defaults: new EmailDefaultsRegistry(),
    mailer,
  });
}

describe('transactional emails — per-email activation (issue #89)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  afterEach(async () => {
    const em = h.em();
    await em.nativeDelete(AuditLogEntry, { action: ACTION });
    await em.nativeUpdate(TransactionalEmail, {}, { active: true });
    em.clear();
  });

  async function flip(code: string, active: boolean, cookies = ADMIN) {
    return h.app.inject({
      method: 'POST',
      url: `${BASE}/${code}/activation`,
      cookies,
      payload: { active },
    });
  }

  async function send(code: string, mailer: InMemoryMailer, messageId: string) {
    return sender(mailer, h).send({
      code,
      salesChannelId: CHANNEL,
      language: 'en-US',
      to: 'buyer@example.com',
      messageId,
      variables: { product: { name: 'Widget' } },
    });
  }

  it('switches an email off and stops its send', async () => {
    const before = new InMemoryMailer();
    expect(await send(ORDINARY, before, 'act:before')).toEqual({ status: 'sent' });

    const res = await flip(ORDINARY, false);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ code: ORDINARY, active: false });

    const after = new InMemoryMailer();
    expect(await send(ORDINARY, after, 'act:off')).toEqual({ status: 'deactivated' });
    expect(after.sent).toHaveLength(0);
  });

  it('switches it back on and restores the send', async () => {
    expect((await flip(ORDINARY, false)).statusCode).toBe(200);
    const res = await flip(ORDINARY, true);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ active: true });

    const mailer = new InMemoryMailer();
    expect(await send(ORDINARY, mailer, 'act:on')).toEqual({ status: 'sent' });
    expect(mailer.sent).toHaveLength(1);
  });

  it('writes exactly one audit row naming the actor and both states', async () => {
    expect((await flip(ORDINARY, false)).statusCode).toBe(200);

    const em = h.em();
    em.clear();
    const entries = await em.find(AuditLogEntry, { action: ACTION });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.objectType).toBe('transactional_email');
    expect(entries[0]!.objectId).toBe(ORDINARY);
    expect(entries[0]!.actorAdminUserId).not.toBeNull();
    expect(entries[0]!.stateBefore).toMatchObject({ active: true });
    expect(entries[0]!.stateAfter).toMatchObject({ active: false });
  });

  it('refuses to switch off an email required to create an account', async () => {
    const res = await flip(PROTECTED, false);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('TRANSACTIONAL_EMAIL_NOT_DEACTIVATABLE');
    // The owning module's own sentence, carried rather than restated here.
    expect(res.json().error.message.length).toBeGreaterThan(0);

    const em = h.em();
    em.clear();
    const row = await em.findOneOrFail(TransactionalEmail, { code: PROTECTED });
    expect(row.active).toBe(true);
  });

  it('refuses a protected code in the switch-on direction too', async () => {
    // Same reading as the module door: there is nothing here to switch, ever.
    // Answering 200 would teach an operator that the control exists.
    const res = await flip(PROTECTED, true);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('TRANSACTIONAL_EMAIL_NOT_DEACTIVATABLE');
  });

  it('leaves no audit row behind when it refuses', async () => {
    expect((await flip(PROTECTED, false)).statusCode).toBe(409);
    const em = h.em();
    em.clear();
    expect(await em.find(AuditLogEntry, { action: ACTION })).toHaveLength(0);
  });

  it('reports the protection on the list and the detail', async () => {
    const list = await h.app.inject({ method: 'GET', url: BASE, cookies: ADMIN });
    expect(list.statusCode).toBe(200);
    const items = (
      list.json() as {
        data: {
          items: Array<{ code: string; deactivatable: boolean; nonDeactivatableReason: string | null }>;
        };
      }
    ).data.items;

    const guarded = items.find((i) => i.code === PROTECTED);
    expect(guarded?.deactivatable).toBe(false);
    expect(guarded?.nonDeactivatableReason).toBeTruthy();

    const ordinary = items.find((i) => i.code === ORDINARY);
    expect(ordinary?.deactivatable).toBe(true);
    expect(ordinary?.nonDeactivatableReason).toBeNull();

    const detail = await h.app.inject({
      method: 'GET',
      url: `${BASE}/${PROTECTED}?language=en-US`,
      cookies: ADMIN,
    });
    expect(detail.json().data.deactivatable).toBe(false);
    expect(detail.json().data.nonDeactivatableReason).toBe(guarded?.nonDeactivatableReason);
  });

  it('answers 404 for a code no module declares', async () => {
    const res = await flip('no_such_email_code', false);
    expect(res.statusCode).toBe(404);
  });

  it('rejects a body that is not { active: boolean }', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `${BASE}/${ORDINARY}/activation`,
      cookies: ADMIN,
      payload: { active: 'yes' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires the transactional_emails:write permission', async () => {
    const res = await flip(ORDINARY, false, { b2b_admin_session: 'stub-restricted-admin-session' });
    expect(res.statusCode).toBe(403);
  });
});
