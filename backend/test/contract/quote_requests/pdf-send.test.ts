import { randomUUID } from 'node:crypto';
import { asValue, type Resolver } from 'awilix';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { slugify, QUOTE_REQUEST_DOCUMENT_TYPE, quoteRequestHistorySchema } from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { ADMIN_COOKIES, TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { ensureAdminWithRole } from '../../helpers/admin-search-fixtures.js';
import { withModuleOff } from '../../helpers/off-state.js';
import {
  InMemoryMailer,
  type MailerSendInput,
  type MailerSendOutcome,
} from '../../../../packages/modules/email/src/backend/services/mailer.js';

/**
 * `specs/153-quote-request-pdf-template/` T061 — *Send PDF to customer*, route
 * Q4 (owner answer Q4, FR-090–FR-099): the gate ahead of validation, the body's
 * limits, visibility, one e-mail per recipient with the PDF attached in the
 * chosen language, the remembered template, the History entry and one audit
 * row, the e-mail switched off, a transport failing for one or every
 * recipient, the attachment limit, the facility off, and the offer's version
 * untouched.
 *
 * The rate limit (FR-098) needs the limiter on, which the shared harness boots
 * without; it is `test/integration/quote_requests/pdf-send-rate-limit.test.ts`.
 */

/** Delivers to every address except those containing `bounce`, which the "server" refuses. */
class BouncingMailer extends InMemoryMailer {
  override async send(input: MailerSendInput): Promise<MailerSendOutcome> {
    if (input.to.includes('bounce')) throw new Error('550 mailbox unavailable (test)');
    return super.send(input);
  }
}

const ADMIN = { b2b_session: 'stub-admin-session' };
const CUSTOMER = { b2b_session: 'stub-customer-session' };
const QR = '/api/v1/admin/quote-requests';
const EMAILS = '/api/v1/admin/transactional-emails';
const stamp = Date.now();
const NONE_ID = '00000000-0000-4000-8000-0000001530b2';
const NONE_SESSION = `stub-153-send-none-${stamp}`;

describe('quote request PDF — Send PDF to customer, route Q4 (spec 153, owner answer Q4)', () => {
  let h: BackendServerHandle;
  let mailer: BouncingMailer;
  let quote: string;
  let businessId: string;

  const send = (id: string, payload: Record<string, unknown>, cookies: Record<string, string> = ADMIN) =>
    h.app.inject({ method: 'POST', url: `${QR}/${id}/pdf/send`, cookies, payload });
  const sql = (query: string, params: unknown[] = []) => h.em().getConnection().execute(query, params);
  const sendAudits = () =>
    h.em().find(AuditLogEntry, { objectType: 'quote_request', objectId: quote, action: 'quote_request.send_document' }, { orderBy: { actedAt: 'asc' } });
  const pdfEvents = async () =>
    (await sql(`select payload from quote_request_events where quote_request_id = ? and event_type = 'pdf-sent' order by created_at`, [quote])) as {
      payload: Record<string, unknown>;
    }[];
  const versionOf = async () => ((await sql(`select version from quote_requests where id = ?`, [quote]))[0] as { version: number }).version;
  const mailsTo = (address: string) => mailer.sent.filter((mail) => mail.to === address);

  beforeAll(async () => {
    mailer = new BouncingMailer();
    h = await setupBackendServer({ organizationsMailer: mailer });
    await sql(`delete from document_templates where document_type = ?`, [QUOTE_REQUEST_DOCUMENT_TYPE]);
    await ensureAdminWithRole(h, NONE_ID, 'quote_pdf_send_none', ['orders:read']);
    ADMIN_COOKIES[NONE_SESSION] = { adminUserId: NONE_ID };
    const res = await h.app.inject({
      method: 'POST',
      url: QR,
      cookies: ADMIN,
      payload: {
        organizationId: TEST_ORGANIZATION_ID,
        customerAccountId: TEST_CUSTOMER_ID,
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 3, agreedUnitPrice: 8 }],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    ({ id: quote, businessId } = (res.json() as { data: { id: string; businessId: string } }).data);
  }, 60_000);

  afterAll(async () => {
    delete ADMIN_COOKIES[NONE_SESSION];
    await sql(`delete from document_templates where document_type = ?`, [QUOTE_REQUEST_DOCUMENT_TYPE]);
    await h.app.inject({ method: 'POST', url: `${EMAILS}/quote_request_pdf/activation`, cookies: ADMIN, payload: { active: true } });
    await teardownBackendServer(h);
  });

  it('401 / 403 ahead of validation; 400 for a body outside the limits; 404 for an unknown quote', async () => {
    expect((await send(quote, { nonsense: true }, {})).statusCode).toBe(401);
    expect((await send(quote, { nonsense: true }, { b2b_session: NONE_SESSION })).statusCode).toBe(403);
    for (const payload of [
      { recipients: [] },
      { recipients: ['not-an-address'] },
      { recipients: ['a@x.pl', 'b@x.pl', 'c@x.pl', 'd@x.pl', 'e@x.pl', 'f@x.pl'] },
      { recipients: ['a@x.pl'], message: 'x'.repeat(2001) },
      { recipients: ['a@x.pl'], templateId: 'nope' },
    ]) {
      const res = await send(quote, payload);
      expect(res.statusCode, JSON.stringify(payload).slice(0, 80)).toBe(400);
    }
    expect((await send(randomUUID(), { recipients: ['a@example.com'] })).statusCode).toBe(404);
    expect(mailer.sent).toHaveLength(0);
  });

  it('Q1 preselects the requester’s address', async () => {
    const res = await h.app.inject({ method: 'GET', url: `${QR}/${quote}/document-templates`, cookies: ADMIN });
    expect((res.json() as { data: { requesterEmail: string | null } }).data.requesterEmail).toMatch(/@/);
  });

  it('sends one e-mail per recipient, the PDF attached, in the chosen language; records one History entry and one audit row', async () => {
    const versionBefore = await versionOf();
    const res = await send(quote, {
      recipients: ['buyer@example.com', ' Second@Example.com ', 'second@example.com'],
      message: 'As agreed on the phone.',
      language: 'pl-PL',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: unknown }).data).toEqual({
      sent: ['buyer@example.com', 'Second@Example.com'],
      failed: [],
      templateId: null,
      templateSource: 'built_in',
      requestedTemplateMissing: false,
    });

    const [mail] = mailsTo('buyer@example.com');
    expect(mailsTo('Second@Example.com')).toHaveLength(1);
    expect(mail).toBeDefined();
    expect(mail!.kind).toBe('quote_request_pdf');
    expect(mail!.subject).toBe(`Oferta ${businessId}`);
    expect(mail!.text).toContain('As agreed on the phone.');
    expect(mail!.attachments).toHaveLength(1);
    expect(mail!.attachments![0]!.filename).toBe(`${slugify(businessId, { preserve: '_', maxLength: 120, fallback: 'quote-request' })}.pdf`);
    expect(mail!.attachments![0]!.contentType).toBe('application/pdf');
    expect(Buffer.from(mail!.attachments![0]!.content.subarray(0, 5)).toString('utf8')).toBe('%PDF-');
    expect(mail!.document).toEqual({ type: 'quote_request', id: quote });

    expect(await pdfEvents()).toEqual([
      {
        payload: {
          type: 'pdf-sent',
          recipients: ['buyer@example.com', 'Second@Example.com'],
          templateId: null,
          templateName: null,
          language: 'pl-PL',
          message: 'As agreed on the phone.',
        },
      },
    ]);
    const history = quoteRequestHistorySchema.parse(
      ((await h.app.inject({ method: 'GET', url: `${QR}/${quote}/history`, cookies: ADMIN })).json() as { data: unknown }).data,
    );
    expect(history.entries.at(-1)).toMatchObject({
      kind: 'pdf_sent',
      actor: { kind: 'admin' },
      delivery: { recipients: ['buyer@example.com', 'Second@Example.com'], templateName: null, language: 'pl-PL' },
    });

    const audits = await sendAudits();
    expect(audits).toHaveLength(1);
    // How many it went to, never the addresses: the History keeps those (D-288, #470).
    expect(audits[0]!.stateAfter).toEqual({
      templateId: null,
      language: 'pl-PL',
      recipientCount: 2,
      failedRecipientCount: 0,
    });
    expect(JSON.stringify(audits[0])).not.toContain('As agreed');

    // The platform audit log, as `audit_log:read` reads it: no address.
    const read = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/audit-log?filter[objectId]=${quote}&filter[action]=quote_request.send_document`,
      cookies: ADMIN,
    });
    expect(read.statusCode, read.body).toBe(200);
    const rows = (read.json() as { data: Array<{ stateBefore: unknown; stateAfter: unknown }> }).data;
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows.map((row) => [row.stateBefore, row.stateAfter])).toLowerCase()).not.toContain('example.com');
    expect(await versionOf()).toBe(versionBefore);
  });

  it('a customer never sees the send on their own quote reply', async () => {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/quote-requests/${quote}`, cookies: CUSTOMER });
    if (res.statusCode === 200) {
      const events = (res.json() as { data: { events: { eventType: string }[] } }).data.events;
      expect(events.map((e) => e.eventType)).not.toContain('pdf-sent');
    } else {
      expect(res.statusCode).toBe(404);
    }
  });

  it('a template chosen for the send is remembered, as for a download', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/document-templates',
      cookies: ADMIN,
      payload: { documentType: QUOTE_REQUEST_DOCUMENT_TYPE, name: 'Send template', salesChannelId: null, source: { kind: 'built_in' }, setDefault: false },
    });
    const templateId = (created.json() as { data: { id: string } }).data.id;
    const res = await send(quote, { recipients: ['buyer@example.com'], templateId });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: { templateId: string } }).data.templateId).toBe(templateId);
    const [row] = await sql(`select document_template_id from quote_requests where id = ?`, [quote]);
    expect((row as { document_template_id: string }).document_template_id).toBe(templateId);
    expect((await pdfEvents()).at(-1)!.payload).toMatchObject({ templateId, templateName: 'Send template', language: 'en-US' });
  });

  it('one recipient bouncing: the others are sent, and only they are recorded', async () => {
    const events = (await pdfEvents()).length;
    const res = await send(quote, { recipients: ['bounce@example.com', 'ok@example.com'] });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: { sent: string[]; failed: string[] } }).data).toMatchObject({
      sent: ['ok@example.com'],
      failed: ['bounce@example.com'],
    });
    const all = await pdfEvents();
    expect(all).toHaveLength(events + 1);
    expect(all.at(-1)!.payload['recipients']).toEqual(['ok@example.com']);
  });

  it('every recipient bouncing: 502, and nothing is recorded', async () => {
    const [events, audits] = [(await pdfEvents()).length, (await sendAudits()).length];
    const res = await send(quote, { recipients: ['bounce@example.com', 'bounce2@example.com'] });
    expect(res.statusCode).toBe(502);
    expect((res.json() as { error: { code: string } }).error.code).toBe('QUOTE_REQUEST_PDF_SEND_FAILED');
    expect(await pdfEvents()).toHaveLength(events);
    expect(await sendAudits()).toHaveLength(audits);
  });

  it('the e-mail switched off: 409 naming the reason, nothing sent, nothing recorded (FR-097)', async () => {
    const off = await h.app.inject({ method: 'POST', url: `${EMAILS}/quote_request_pdf/activation`, cookies: ADMIN, payload: { active: false } });
    expect(off.statusCode, off.body).toBe(200);
    const [sent, events] = [mailer.sent.length, (await pdfEvents()).length];
    try {
      const res = await send(quote, { recipients: ['buyer@example.com'] });
      expect(res.statusCode, res.body).toBe(409);
      expect((res.json() as { error: { code: string; details: { code: string } } }).error).toMatchObject({
        code: 'QUOTE_REQUEST_PDF_EMAIL_UNAVAILABLE',
        details: { code: 'deactivated' },
      });
      expect(mailer.sent).toHaveLength(sent);
      expect(await pdfEvents()).toHaveLength(events);
    } finally {
      await h.app.inject({ method: 'POST', url: `${EMAILS}/quote_request_pdf/activation`, cookies: ADMIN, payload: { active: true } });
    }
  });

  it('a PDF over the attachment limit is refused before anything is sent', async () => {
    const original = h.container.registrations['quoteRequestPdfMaxAttachmentBytes'] as Resolver<unknown>;
    h.container.register({ quoteRequestPdfMaxAttachmentBytes: asValue(100) });
    const sent = mailer.sent.length;
    try {
      const res = await send(quote, { recipients: ['buyer@example.com'] });
      expect(res.statusCode).toBe(422);
      expect((res.json() as { error: { code: string; details: { maxBytes: number } } }).error).toMatchObject({
        code: 'QUOTE_REQUEST_PDF_TOO_LARGE',
        details: { maxBytes: 100 },
      });
      expect(mailer.sent).toHaveLength(sent);
    } finally {
      h.container.register('quoteRequestPdfMaxAttachmentBytes', original);
    }
  });

  it('refused with 503 while document templates are off', async () => {
    await withModuleOff('document_templates', 'deactivated', async () => {
      const res = await send(quote, { recipients: ['buyer@example.com'] });
      expect(res.statusCode).toBe(503);
    });
  });
});
