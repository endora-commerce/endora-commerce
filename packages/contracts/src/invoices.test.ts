import { describe, expect, it } from 'vitest';
import {
  INVOICE_ATTACHMENT_FETCH_REGISTRY,
  externalDocumentRefSchema,
  erpSaleDocumentUpsertInputSchema,
} from './invoices.js';

/**
 * Feature 134, T061/T065 — `invoices`' ERP-import contract names no connector.
 *
 * The external document reference carries the source system an imported
 * document came from, and that value is what a connector's attachment fetch
 * provider is registered under. It used to be `z.literal('comarch_xl')`, which
 * made one connector the only source system the free contract could describe.
 */
describe('externalDocumentRefSchema', () => {
  const ref = {
    xlSaleDocumentId: 'doc-1',
    documentKind: 'invoice',
  } as const;

  it('accepts the system a stored reference already carries', () => {
    expect(externalDocumentRefSchema.parse({ ...ref, system: 'comarch_xl' }).system).toBe(
      'comarch_xl',
    );
  });

  it('accepts any other source system', () => {
    expect(externalDocumentRefSchema.parse({ ...ref, system: 'erp_fixture' }).system).toBe(
      'erp_fixture',
    );
  });

  it('refuses an empty source system, which no provider can be registered under', () => {
    expect(externalDocumentRefSchema.safeParse({ ...ref, system: '' }).success).toBe(false);
    expect(externalDocumentRefSchema.safeParse({ ...ref }).success).toBe(false);
  });

  it('flows through the upsert input', () => {
    const parsed = erpSaleDocumentUpsertInputSchema.parse({
      organizationId: '00000000-0000-4000-8000-000000000001',
      externalDocumentRef: { ...ref, system: 'erp_fixture' },
      kind: 'invoice',
      number: 'FV/1',
      currency: 'PLN',
      issuedAt: '2026-09-14T10:00:00.000Z',
      grossTotal: '1.00',
    });
    expect(parsed.externalDocumentRef.system).toBe('erp_fixture');
  });
});

describe('INVOICE_ATTACHMENT_FETCH_REGISTRY', () => {
  it('is the container name `invoices` registers its attachment fetch seam under', () => {
    expect(INVOICE_ATTACHMENT_FETCH_REGISTRY).toBe('invoiceAttachmentFetchRegistry');
  });
});
