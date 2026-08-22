import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueInvoiceResponseSchema, type InvoiceDetail } from '@endora-commerce/contracts';
import { registerInvoicesAdminRoutes } from '../../../src/modules/invoices/routes.admin.js';
import type {
  InvoiceEmailDispatcher,
  InvoicesAdminDeps,
} from '../../../src/modules/invoices/routes.admin.js';
import type { InvoiceService } from '../../../src/modules/invoices/services/invoice-service.js';
import type { InvoicePdfRenderer } from '../../../src/modules/invoices/services/invoice-pdf-renderer.js';
import type { InvoiceTemplateService } from '../../../src/modules/invoices/services/invoice-template-service.js';

/**
 * Issue #149 — the send-on-issue route reports what became of the e-mail.
 *
 * `await deps.emailDispatcher.dispatch(detail.id)` dropped an
 * `InvoiceEmailDispatchResult` that distinguishes delivery from suppression
 * across seven named reasons, so an operator who clicked "issue and send" got
 * the same 201 whether the message went out or was suppressed. This is the last
 * site of the #67/#78/#115 family.
 *
 * The dispatcher is a stub here rather than the real one: every one of the five
 * outcomes below is a state of the *e-mail* stack — a missing template, an
 * absent transport, an operator's off switch — and reproducing five of them
 * through a live sender would decide by accident which one an assertion sees.
 * What is under test is the route's obligation to carry the answer out.
 */

const ORDER_ID = '11111111-0000-4000-8000-000000000001';
const INVOICE_ID = '22222222-0000-4000-8000-000000000002';
const CHANNEL_ID = '33333333-0000-4000-8000-000000000003';

const DETAIL = {
  id: INVOICE_ID,
  orderId: ORDER_ID,
  orderBusinessId: 'ORD-1',
  salesChannelId: CHANNEL_ID,
  kind: 'invoice',
  number: 'FV 1/2026',
  status: 'ready',
  currency: 'PLN',
  issuedAt: new Date('2026-08-17T10:00:00.000Z').toISOString(),
  saleDate: null,
  paymentDueDate: null,
  paymentMethod: null,
  netTotal: 100,
  taxTotal: 23,
  grossTotal: 123,
  paidTotal: 0,
  amountDue: 123,
  total: 123,
  originalInvoiceId: null,
  templateId: null,
  pdfAssetId: null,
  ksefReferenceNumber: null,
  ksefProcessedAt: null,
  lines: [],
  vatSummary: [],
  seller: {
    legalName: 'Seller',
    addressLine1: 'Street 1',
    addressLine2: '',
    postalCode: '00-000',
    city: 'City',
    country: 'PL',
    taxId: '1234567890',
    bankName: '',
    bankAccount: '',
    swift: '',
    email: '',
    phone: '',
  },
  buyer: {
    name: 'Buyer',
    taxId: '',
    addressLine1: '',
    addressLine2: '',
    postalCode: '',
    city: '',
    country: '',
  },
} satisfies InvoiceDetail;

function buildDeps(dispatcher?: InvoiceEmailDispatcher): InvoicesAdminDeps {
  const deps: InvoicesAdminDeps = {
    emFactory: (() => {
      throw new Error('the issue route must not touch the database in this test');
    }) as unknown as InvoicesAdminDeps['emFactory'],
    orderReadPort: new Proxy({} as InvoicesAdminDeps['orderReadPort'], {
      get() {
        throw new Error('the issue route must not read orders in this test');
      },
    }),
    requireAdmin: () => async () => undefined,
    invoiceService: { issue: vi.fn(async () => DETAIL) } as unknown as InvoiceService,
    pdfRenderer: {} as InvoicePdfRenderer,
    templateService: {} as InvoiceTemplateService,
  };
  return dispatcher ? { ...deps, emailDispatcher: dispatcher } : deps;
}

async function issue(deps: InvoicesAdminDeps): Promise<{ statusCode: number; body: unknown }> {
  const app: FastifyInstance = Fastify();
  // The same pair `src/http/server.ts` installs: these routes declare Zod
  // bodies, so without them the registration fails before a handler can run.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await registerInvoicesAdminRoutes(app, deps);
  await app.ready();
  try {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${ORDER_ID}/invoices`,
      payload: { kind: 'invoice' },
    });
    return { statusCode: res.statusCode, body: res.json() };
  } finally {
    await app.close();
  }
}

describe('invoices — the issue route reports the send-on-issue outcome (#149)', () => {
  let dispatch: ReturnType<typeof vi.fn>;
  let sendOnIssueEnabled: ReturnType<typeof vi.fn>;
  let dispatcher: InvoiceEmailDispatcher;

  beforeEach(() => {
    dispatch = vi.fn(async () => ({ sent: true }));
    sendOnIssueEnabled = vi.fn(async () => true);
    dispatcher = {
      dispatch,
      sendOnIssueEnabled,
    } as unknown as InvoiceEmailDispatcher;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('says the e-mail was sent', async () => {
    const { statusCode, body } = await issue(buildDeps(dispatcher));

    expect(statusCode).toBe(201);
    const parsed = issueInvoiceResponseSchema.parse(body);
    expect(parsed.email).toEqual({ status: 'sent' });
    expect(dispatch).toHaveBeenCalledWith(INVOICE_ID);
  });

  it('names the reason a suppressed e-mail did not go out, and still issues', async () => {
    dispatch.mockResolvedValue({ sent: false, reason: 'deactivated' });

    const { statusCode, body } = await issue(buildDeps(dispatcher));

    // A suppressed notification must not roll the issuance back: the document
    // was drawn and numbered, and 201 is the truthful answer about it.
    expect(statusCode).toBe(201);
    const parsed = issueInvoiceResponseSchema.parse(body);
    expect(parsed.data.id).toBe(INVOICE_ID);
    expect(parsed.email).toEqual({ status: 'not_sent', reason: 'deactivated' });
  });

  it('names a failed send without failing the issuance', async () => {
    dispatch.mockResolvedValue({ sent: false, reason: 'failed' });

    const { statusCode, body } = await issue(buildDeps(dispatcher));

    expect(statusCode).toBe(201);
    expect(issueInvoiceResponseSchema.parse(body).email).toEqual({
      status: 'not_sent',
      reason: 'failed',
    });
  });

  it('separates "the operator switched send-on-issue off" from a suppressed send', async () => {
    sendOnIssueEnabled.mockResolvedValue(false);

    const { statusCode, body } = await issue(buildDeps(dispatcher));

    expect(statusCode).toBe(201);
    expect(issueInvoiceResponseSchema.parse(body).email).toEqual({ status: 'not_requested' });
    expect(dispatch, 'nothing was dispatched, so nothing may be reported as suppressed').not.toHaveBeenCalled();
  });

  it('names the composition with no sender at all', async () => {
    const { statusCode, body } = await issue(buildDeps());

    expect(statusCode).toBe(201);
    expect(issueInvoiceResponseSchema.parse(body).email).toEqual({
      status: 'not_sent',
      reason: 'no_sender',
    });
  });
});
