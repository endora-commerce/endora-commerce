import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { DocumentTemplateChoices, TransactionalEmailSendInput, TransactionalSendOutcome } from '@endora-commerce/contracts';
import type { CommandActor, CommandContext } from '@endora-commerce/platform/commands';
import { QuoteRequest } from '../entities/quote-request.entity.js';
import { QuoteRequestEvent } from '../entities/quote-request-event.entity.js';
import {
  makeSendDocumentCommand,
  makeSetDocumentTemplateCommand,
  QUOTE_REQUEST_PDF_EMAIL_CODE,
  type DocumentCommandDeps,
  type SendDocumentInput,
} from './document-template-commands.js';

/**
 * T034, T059 — the two audited writes of feature 153: remembering a quote's PDF
 * template (owner answer Q2) and sending the PDF by e-mail (owner answer Q4).
 * Exercised without the bus: what the bus does with `after` and `skipAudit` is
 * its own test's subject; the order inside `run` and the audit shape are this
 * file's.
 */

const QUOTE = '00000000-0000-4000-8000-00000000a001';
const ORG = '00000000-0000-4000-8000-00000000a0a1';
const REP = '00000000-0000-4000-8000-00000000b001';
const T1 = '00000000-0000-4000-8000-00000000d001';
const T2 = '00000000-0000-4000-8000-00000000d002';
const ADMIN: CommandActor = { actorAdminUserId: REP, impersonatedCustomerAccountId: null, kind: 'admin' };

function harness(options: {
  quote?: Record<string, unknown> | null;
  canSee?: boolean;
  templates?: string[];
  outcomes?: (TransactionalSendOutcome | Error)[];
  noSender?: boolean;
} = {}) {
  const log: string[] = [];
  const quote =
    options.quote === null
      ? null
      : {
          id: QUOTE,
          organizationId: ORG,
          salesChannelId: null,
          businessId: 'QR-9',
          documentTemplateId: null,
          version: 7,
          ...(options.quote ?? {}),
        };
  const created: Record<string, unknown>[] = [];
  const em = {
    findOne: vi.fn(async (entity: unknown) => {
      log.push(entity === QuoteRequest ? 'em.findOne:quote' : 'em.findOne:other');
      return entity === QuoteRequest ? quote : null;
    }),
    create: vi.fn((entity: unknown, data: Record<string, unknown>) => {
      log.push(entity === QuoteRequestEvent ? 'em.create:event' : 'em.create:other');
      created.push(data);
      return data;
    }),
    persist: vi.fn(() => log.push('em.persist')),
    flush: vi.fn(async () => {
      log.push('em.flush');
    }),
    nativeUpdate: vi.fn(() => {
      throw new Error('nativeUpdate bypasses the org write guard');
    }),
  };
  const sent: TransactionalEmailSendInput[] = [];
  const outcomes = [...(options.outcomes ?? [])];
  const sender = {
    send: vi.fn(async (input: TransactionalEmailSendInput): Promise<TransactionalSendOutcome> => {
      log.push(`send:${input.to}`);
      sent.push(input);
      const next = outcomes.shift() ?? { status: 'sent' };
      if (next instanceof Error) throw next;
      return next;
    }),
  };
  const choices: DocumentTemplateChoices = {
    templates: (options.templates ?? [T1, T2]).map((id) => ({ id, name: id, salesChannelId: null, languages: ['en-US'], isDefault: false })),
    effectiveDefaultId: null,
    builtInLanguages: ['en-US', 'pl-PL'],
  };
  const deps: DocumentCommandDeps = {
    isPlatformAdmin: () => false,
    salesRepScope: {
      canSeeOrganization: vi.fn(async () => {
        log.push('canSeeOrganization');
        return options.canSee ?? true;
      }),
    },
    listChoices: vi.fn(async () => {
      log.push('listChoices');
      return choices;
    }),
    sender: () => (options.noSender ? undefined : sender),
    log: vi.fn(),
  };
  const ctx: CommandContext = { em: em as unknown as EntityManager, actor: ADMIN };
  return { log, quote, created, deps, ctx, sender, sent, em };
}

async function refusal(promise: Promise<unknown>): Promise<{ statusCode: number; code: string; details?: Record<string, unknown> }> {
  return promise.then(
    () => {
      throw new Error('expected a refusal');
    },
    (error: { statusCode: number; code: string; details?: Record<string, unknown> }) => error,
  );
}

describe('quote_request.set_document_template', () => {
  it('remembers a selectable template, audited before → after, the offer version untouched', async () => {
    const h = harness();
    const command = makeSetDocumentTemplateCommand({ quoteRequestId: QUOTE, documentTemplateId: T1 }, h.deps);
    expect(command).toMatchObject({ action: 'quote_request.set_document_template', objectType: 'quote_request', objectId: QUOTE });
    const outcome = await command.run(h.ctx);
    expect(outcome).toMatchObject({
      result: { documentTemplateId: T1 },
      before: { documentTemplateId: null },
      after: { documentTemplateId: T1 },
    });
    expect(outcome.skipAudit).toBeUndefined();
    expect(h.quote!['documentTemplateId']).toBe(T1);
    expect(h.quote!['version']).toBe(7);
    expect(h.log).toEqual(['em.findOne:quote', 'canSeeOrganization', 'listChoices', 'em.flush']);
  });

  it('forgets (null) without asking for the choices', async () => {
    const h = harness({ quote: { documentTemplateId: T1 } });
    const outcome = await makeSetDocumentTemplateCommand({ quoteRequestId: QUOTE, documentTemplateId: null }, h.deps).run(h.ctx);
    expect(outcome.after).toEqual({ documentTemplateId: null });
    expect(h.deps.listChoices).not.toHaveBeenCalled();
  });

  it('the same template again writes nothing and skips the audit', async () => {
    const h = harness({ quote: { documentTemplateId: T1 } });
    const outcome = await makeSetDocumentTemplateCommand({ quoteRequestId: QUOTE, documentTemplateId: T1 }, h.deps).run(h.ctx);
    expect(outcome.skipAudit).toBe(true);
    expect(h.log).not.toContain('em.flush');
  });

  it('an invisible quote answers as an unknown one, before anything is written or asked', async () => {
    const h = harness({ canSee: false });
    const error = await refusal(makeSetDocumentTemplateCommand({ quoteRequestId: QUOTE, documentTemplateId: T1 }, h.deps).run(h.ctx));
    expect(error).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(h.log).toEqual(['em.findOne:quote', 'canSeeOrganization']);
    const gone = harness({ quote: null });
    expect(await refusal(makeSetDocumentTemplateCommand({ quoteRequestId: QUOTE, documentTemplateId: T1 }, gone.deps).run(gone.ctx))).toMatchObject({ statusCode: 404 });
  });

  it('a template of another type or channel — not in the choices — is refused', async () => {
    const h = harness({ templates: [T2] });
    const error = await refusal(makeSetDocumentTemplateCommand({ quoteRequestId: QUOTE, documentTemplateId: T1 }, h.deps).run(h.ctx));
    expect(error).toMatchObject({ statusCode: 422, code: 'DOCUMENT_TEMPLATE_NOT_SELECTABLE' });
    expect(h.log).not.toContain('em.flush');
  });
});

describe('quote_request.send_document', () => {
  const input = (over: Partial<SendDocumentInput> = {}): SendDocumentInput => ({
    quoteRequestId: QUOTE,
    sendId: 'send-1',
    pdf: { bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), fileName: 'QR-9.pdf', templateId: T1, templateName: 'With discounts' },
    language: 'pl-PL',
    salesChannelId: null,
    recipients: ['buyer@example.com', 'two@example.com'],
    message: 'Please see the offer.',
    roleLabel: 'Sales representative',
    variables: { 'quote.number': 'QR-9' },
    ...over,
  });

  it('sends one e-mail per recipient with the PDF attached, then records one pdf-sent event and the audit', async () => {
    const h = harness();
    const command = makeSendDocumentCommand(input(), h.deps);
    expect(command).toMatchObject({ action: 'quote_request.send_document', objectType: 'quote_request', objectId: QUOTE });
    const outcome = await command.run(h.ctx);
    expect(outcome.result).toEqual({ sent: ['buyer@example.com', 'two@example.com'], failed: [] });
    expect(h.sent).toHaveLength(2);
    expect(h.sent[0]).toMatchObject({
      code: QUOTE_REQUEST_PDF_EMAIL_CODE,
      to: 'buyer@example.com',
      language: 'pl-PL',
      salesChannelId: null,
      messageId: 'quote-request-pdf:send-1:1',
      document: { type: 'quote_request', id: QUOTE },
      variables: { 'quote.number': 'QR-9' },
      attachments: [{ filename: 'QR-9.pdf', contentType: 'application/pdf' }],
    });
    expect(h.sent[1]!.messageId).toBe('quote-request-pdf:send-1:2');
    expect(h.created).toEqual([
      expect.objectContaining({
        quoteRequestId: QUOTE,
        eventType: 'pdf-sent',
        actorAdminUserId: REP,
        actorRoleLabel: 'Sales representative',
        payload: {
          type: 'pdf-sent',
          recipients: ['buyer@example.com', 'two@example.com'],
          templateId: T1,
          templateName: 'With discounts',
          language: 'pl-PL',
          message: 'Please see the offer.',
        },
      }),
    ]);
    // How many, never the addresses: the pdf-sent event keeps those (D-288, #470).
    expect(outcome.after).toEqual({
      templateId: T1,
      language: 'pl-PL',
      recipientCount: 2,
      failedRecipientCount: 0,
    });
    expect(JSON.stringify(outcome.after)).not.toContain('@example.com');
    expect(JSON.stringify(outcome.after)).not.toContain('offer.');
    expect(h.quote!['version']).toBe(7);
    expect(h.log.indexOf('canSeeOrganization')).toBeLessThan(h.log.indexOf('send:buyer@example.com'));
  });

  it('an invisible quote is refused before anything is sent', async () => {
    const h = harness({ canSee: false });
    expect(await refusal(makeSendDocumentCommand(input(), h.deps).run(h.ctx))).toMatchObject({ statusCode: 404 });
    expect(h.sender.send).not.toHaveBeenCalled();
  });

  it.each([['deactivated'], ['no_transport'], ['no_definition']] as const)(
    'the e-mail answering %s refuses with that reason and records nothing',
    async (status) => {
      const h = harness({ outcomes: [{ status }] });
      const error = await refusal(makeSendDocumentCommand(input(), h.deps).run(h.ctx));
      expect(error).toMatchObject({ statusCode: 409, code: 'QUOTE_REQUEST_PDF_EMAIL_UNAVAILABLE', details: { code: status } });
      expect(h.sender.send).toHaveBeenCalledTimes(1);
      expect(h.created).toEqual([]);
    },
  );

  it('no sender at all is no transport', async () => {
    const h = harness({ noSender: true });
    expect(await refusal(makeSendDocumentCommand(input(), h.deps).run(h.ctx))).toMatchObject({
      statusCode: 409,
      details: { code: 'no_transport' },
    });
  });

  it('one recipient failing at the transport: the others are still sent, only the delivered are recorded', async () => {
    const h = harness({ outcomes: [new Error('550 mailbox unavailable'), { status: 'logged' }] });
    const outcome = await makeSendDocumentCommand(input(), h.deps).run(h.ctx);
    expect(outcome.result).toEqual({ sent: ['two@example.com'], failed: ['buyer@example.com'] });
    expect((h.created[0]!['payload'] as { recipients: string[] }).recipients).toEqual(['two@example.com']);
    expect(outcome.after).toMatchObject({ recipientCount: 1, failedRecipientCount: 1 });
  });

  it('every recipient failing: refused, nothing recorded', async () => {
    const h = harness({ outcomes: [new Error('down'), new Error('down')] });
    expect(await refusal(makeSendDocumentCommand(input(), h.deps).run(h.ctx))).toMatchObject({
      statusCode: 502,
      code: 'QUOTE_REQUEST_PDF_SEND_FAILED',
    });
    expect(h.created).toEqual([]);
  });
});
