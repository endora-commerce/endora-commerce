import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import {
  captureReturnsNotificationJobs,
  overrideReturnsSetting,
  processReturnsNotification,
  type CapturedReturnsJob,
} from './notification-jobs.js';
import {
  GUEST_SETTING,
  OTHER_CHANNEL,
  allowGuests,
  availability,
  emailHashOf,
  freshEmail,
  leave,
  nextIp,
  openGuestSession,
  redeem,
  requestLink,
  verificationTokenOf,
  verificationsOf,
} from './guest-fixtures.js';
import { insertRows } from '../../helpers/sql-rows.js';

/**
 * `specs/181-guest-complaints/` T017 (US1; FR-020 – FR-025; research R-3, R-4, R-8):
 * the e-mail verification that starts a guest session.
 *
 * - The request answers one 202 whatever happened: an address with or without an
 *   account, the per-address throttle, the honeypot. Only an accepted request writes a
 *   row and enqueues a `guest_verification` job; a newer request supersedes the
 *   address's earlier links.
 * - The worker's e-mail carries the link, and the account sentence only for an
 *   account's address.
 * - The link redeems once, within 60 minutes, on its own channel; every refusal is
 *   one 410. The session lives 24 hours and ends when the visitor leaves.
 * - The client address is throttled (429), and the setting gates it all (403).
 */
describe('returns — guest e-mail verification and session', () => {
  let h: BackendServerHandle;
  let mailer: InMemoryMailer;
  let undo: () => Promise<void>;
  const jobs: CapturedReturnsJob[] = [];

  const ACCOUNT_EMAIL = 'stub-customer@example.com';
  const ACCEPTED = { data: { linkValidMinutes: 60 } };

  const jobsFor = async (email: string): Promise<CapturedReturnsJob[]> => {
    const ids = new Set((await verificationsOf(h, email)).map((r) => r.id));
    return jobs.filter((j) => j.kind === 'guest_verification' && ids.has(j.verificationId));
  };

  beforeAll(async () => {
    mailer = new InMemoryMailer();
    h = await setupBackendServer({
      enableRateLimit: true,
      organizationsMailer: mailer,
      moduleOverrides: captureReturnsNotificationJobs(jobs),
    });
    undo = await allowGuests(h);
  });
  afterAll(async () => {
    await undo();
    await teardownBackendServer(h);
  });

  describe('the request (G2)', () => {
    it('answers the same 202 for an account’s address, an unknown one, a throttled one and a honeypot hit', async () => {
      const throttled = freshEmail();
      for (let i = 0; i < 3; i += 1) expect((await requestLink(h, { email: throttled })).statusCode).toBe(202);

      const answers = [
        await requestLink(h, { email: ACCOUNT_EMAIL }),
        await requestLink(h, { email: freshEmail() }),
        await requestLink(h, { email: throttled }),
        await requestLink(h, { email: freshEmail(), hp: 'https://spam.example' }),
      ];
      for (const res of answers) {
        expect(res.statusCode, res.body).toBe(202);
        expect(res.json()).toEqual(ACCEPTED);
      }
      expect(new Set(answers.map((r) => r.body)).size).toBe(1);
    });

    it('writes a row and enqueues a job only for a request neither throttled nor a bot', async () => {
      const person = freshEmail();
      await requestLink(h, { email: person, language: 'pl' });
      const rows = await verificationsOf(h, person);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.email).toBe(person);
      expect(rows[0]!.language).toBe('pl');
      expect(rows[0]!.sales_channel_id).toBe(await systemDefaultSalesChannelId(h.em()));
      expect(await jobsFor(person)).toEqual([{ kind: 'guest_verification', verificationId: rows[0]!.id }]);

      const bot = freshEmail();
      await requestLink(h, { email: bot, hp: 'x' });
      expect(await verificationsOf(h, bot)).toHaveLength(0);

      const hourly = freshEmail();
      for (let i = 0; i < 4; i += 1) await requestLink(h, { email: hourly });
      expect(await verificationsOf(h, hourly)).toHaveLength(3);
      expect(await jobsFor(hourly)).toHaveLength(3);
    });

    it('stays silent past 10 requests a day for one address', async () => {
      const daily = freshEmail();
      const channelId = await systemDefaultSalesChannelId(h.em());
      const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
      for (let i = 0; i < 10; i += 1) {
        await insertRows(h.em(), 'return_guest_verifications', {
          id: randomUUID(),
          sales_channel_id: channelId,
          email: daily,
          email_hash: emailHashOf(daily),
          language: 'en',
          link_expires_at: twoHoursAgo,
          created_at: twoHoursAgo,
        });
      }
      const res = await requestLink(h, { email: daily });
      expect(res.json()).toEqual(ACCEPTED);
      expect(await verificationsOf(h, daily)).toHaveLength(10);
    });

    it('counts the address case-insensitively', async () => {
      const email = freshEmail();
      await requestLink(h, { email });
      await requestLink(h, { email: email.toUpperCase() });
      expect(await verificationsOf(h, email)).toHaveLength(2);
    });

    it('lets a new request supersede the address’s earlier links', async () => {
      const email = freshEmail();
      await requestLink(h, { email });
      await requestLink(h, { email });
      const [first, second] = await verificationsOf(h, email);
      expect(first!.link_expires_at.getTime()).toBeLessThanOrEqual(Date.now());
      expect((await redeem(h, verificationTokenOf(h, first!.id))).statusCode).toBe(410);
      expect((await redeem(h, verificationTokenOf(h, second!.id))).statusCode).toBe(201);
    });

    it('refuses a malformed address with 400', async () => {
      const res = await requestLink(h, { email: 'not-an-address' });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });
  });

  describe('the e-mail (the guest_verification job)', () => {
    const mailFor = (verificationId: string) =>
      mailer.sent.find((m) => m.meta?.['kind'] === 'return_guest_verification' && m.meta?.['verificationId'] === verificationId);

    async function sendFor(email: string): Promise<string> {
      await requestLink(h, { email });
      const rows = await verificationsOf(h, email);
      const id = rows[rows.length - 1]!.id;
      await processReturnsNotification(h, { kind: 'guest_verification', verificationId: id });
      return id;
    }

    it('sends the link to the address, with no account sentence for an address without an account', async () => {
      const email = freshEmail();
      const id = await sendFor(email);
      const mail = mailFor(id);
      expect(mail?.to).toBe(email);
      expect(mail!.text).toContain(`/returns/guest/verify?token=${verificationTokenOf(h, id)}`);
      expect(mail!.text).not.toMatch(/sign in/i);
    });

    it('adds the account sentence only for an account’s address', async () => {
      const id = await sendFor(ACCOUNT_EMAIL);
      const mail = mailFor(id);
      expect(mail?.to).toBe(ACCOUNT_EMAIL);
      expect(mail!.text).toMatch(/sign in/i);
    });

    it('sends nothing for a link already superseded', async () => {
      const email = freshEmail();
      await requestLink(h, { email });
      await requestLink(h, { email });
      const [first] = await verificationsOf(h, email);
      await processReturnsNotification(h, { kind: 'guest_verification', verificationId: first!.id });
      expect(mailFor(first!.id)).toBeUndefined();
    });
  });

  describe('the redeem (G3) and the session (G4)', () => {
    it('redeems once into a 24-hour session bound to the address', async () => {
      const email = freshEmail();
      await requestLink(h, { email });
      const [row] = await verificationsOf(h, email);
      expect(row!.link_expires_at.getTime() - row!.created_at.getTime()).toBeGreaterThan(59 * 60_000);
      expect(row!.link_expires_at.getTime() - row!.created_at.getTime()).toBeLessThanOrEqual(60 * 60_000 + 1000);

      const token = verificationTokenOf(h, row!.id);
      const res = await redeem(h, token);
      expect(res.statusCode, res.body).toBe(201);
      const data = (res.json() as { data: { sessionToken: string; email: string; expiresAt: string } }).data;
      expect(data.email).toBe(email);
      expect(data.sessionToken.length).toBeGreaterThanOrEqual(40);
      const lifetime = new Date(data.expiresAt).getTime() - Date.now();
      expect(lifetime).toBeGreaterThan(24 * 3_600_000 - 60_000);
      expect(lifetime).toBeLessThanOrEqual(24 * 3_600_000);

      const stored = (await h.em().execute('select "session_token_hash" from "return_guest_verifications" where "id" = ?', [
        row!.id,
      ])) as Array<{ session_token_hash: string }>;
      expect(stored[0]!.session_token_hash).not.toContain(data.sessionToken);
      expect(stored[0]!.session_token_hash).toMatch(/^[0-9a-f]{64}$/);

      const again = await redeem(h, token);
      expect(again.statusCode).toBe(410);
    });

    it('gives the same 410 for an unknown, altered, used, superseded, expired or other-channel link', async () => {
      const used = await openGuestSession(h);
      const superseded = freshEmail();
      await requestLink(h, { email: superseded });
      await requestLink(h, { email: superseded });
      const [old] = await verificationsOf(h, superseded);
      const expired = freshEmail();
      await requestLink(h, { email: expired });
      const [late] = await verificationsOf(h, expired);
      await h.em().execute('update "return_guest_verifications" set "link_expires_at" = now() - interval \'1 second\' where "id" = ?', [late!.id]);
      const elsewhere = freshEmail();
      await requestLink(h, { email: elsewhere });
      const [other] = await verificationsOf(h, elsewhere);
      const good = verificationTokenOf(h, randomUUID());

      // One language for all: the other channel would otherwise answer in its own.
      const en = { headers: { 'accept-language': 'en' } };
      const answers = [
        await redeem(h, good, en),
        await redeem(h, `${good.slice(0, -2)}${good.endsWith('AA') ? 'BB' : 'AA'}`, en),
        await redeem(h, 'garbage', en),
        await redeem(h, verificationTokenOf(h, used.verificationId), en),
        await redeem(h, verificationTokenOf(h, old!.id), en),
        await redeem(h, verificationTokenOf(h, late!.id), en),
        await redeem(h, verificationTokenOf(h, other!.id), { ...en, channel: OTHER_CHANNEL }),
      ];
      for (const res of answers) {
        expect(res.statusCode, res.body).toBe(410);
        expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.RETURN_GUEST_LINK_INVALID);
      }
      // One answer, but for the request id every envelope carries.
      const withoutRequestId = (body: string): string => {
        const { error } = JSON.parse(body) as { error: Record<string, unknown> };
        const { requestId: _requestId, ...rest } = error;
        return JSON.stringify(rest);
      };
      expect(new Set(answers.map((r) => withoutRequestId(r.body))).size).toBe(1);
      // The other-channel refusal did not use the link up.
      expect((await redeem(h, verificationTokenOf(h, other!.id))).statusCode).toBe(201);
    });

    it('ends the session on leave, and then answers 401', async () => {
      const { sessionToken, verificationId } = await openGuestSession(h);
      const res = await leave(h, sessionToken);
      expect(res.statusCode, res.body).toBe(204);
      const rows = (await h.em().execute('select "ended_at" from "return_guest_verifications" where "id" = ?', [verificationId])) as Array<{
        ended_at: unknown;
      }>;
      expect(rows[0]!.ended_at).not.toBeNull();
      const again = await leave(h, sessionToken);
      expect(again.statusCode).toBe(401);
      expect((again.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.RETURN_GUEST_SESSION_REQUIRED);
    });

    it('answers 401 for a missing, unknown, expired or other-channel session', async () => {
      const { sessionToken, verificationId } = await openGuestSession(h);
      expect((await leave(h, null)).statusCode).toBe(401);
      expect((await leave(h, 'not-a-session')).statusCode).toBe(401);
      expect((await leave(h, sessionToken, { channel: OTHER_CHANNEL })).statusCode).toBe(401);
      await h.em().execute(
        'update "return_guest_verifications" set "session_expires_at" = now() - interval \'1 second\' where "id" = ?',
        [verificationId],
      );
      expect((await leave(h, sessionToken)).statusCode).toBe(401);
    });
  });

  describe('throttling and the setting', () => {
    it('answers 429 to the sixth request from one client address in 10 minutes', async () => {
      const ip = nextIp();
      for (let i = 0; i < 5; i += 1) {
        expect((await requestLink(h, { email: freshEmail() }, { ip })).statusCode).toBe(202);
      }
      const sixth = await requestLink(h, { email: freshEmail() }, { ip });
      expect(sixth.statusCode).toBe(429);
    });

    it('refuses verification and redeem with 403 while guest complaints are off, and says so in G1', async () => {
      const email = freshEmail();
      await requestLink(h, { email });
      const [row] = await verificationsOf(h, email);
      expect((await availability(h)).enabled).toBe(true);

      const restore = await overrideReturnsSetting(h, GUEST_SETTING, false);
      try {
        expect(await availability(h)).toEqual({ statusCode: 200, enabled: false });
        const refused = await requestLink(h, { email: freshEmail() }, { headers: { 'accept-language': 'pl' } });
        expect(refused.statusCode).toBe(403);
        const error = (refused.json() as { error: { code: string; message: string } }).error;
        expect(error.code).toBe(ERROR_CODES.RETURN_GUEST_COMPLAINTS_DISABLED);
        expect(error.message).toMatch(/konta/);
        const redeemed = await redeem(h, verificationTokenOf(h, row!.id));
        expect(redeemed.statusCode).toBe(403);
      } finally {
        await restore();
      }
      expect((await redeem(h, verificationTokenOf(h, row!.id))).statusCode).toBe(201);
    });
  });
});
