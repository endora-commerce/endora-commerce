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
    externalId: 'doc-1',
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

  // T135 (`research.md` D21): an imported document is identified by its
  // source system and its id there, and the free contract names no vendor.
  it('requires a non-empty externalId, the source system’s own id', () => {
    const { externalId: _omitted, ...withoutId } = ref;
    expect(externalDocumentRefSchema.safeParse({ ...ref, system: 'comarch_xl' }).success).toBe(
      true,
    );
    expect(
      externalDocumentRefSchema.safeParse({ ...ref, system: 'comarch_xl', externalId: '' })
        .success,
    ).toBe(false);
    expect(
      externalDocumentRefSchema.safeParse({ ...withoutId, system: 'comarch_xl' }).success,
    ).toBe(false);
  });

  it('refuses a reference carrying only the pre-T135 xlSaleDocumentId', () => {
    const oldShape = {
      system: 'comarch_xl',
      xlSaleDocumentId: 'doc-1',
      xlDocumentNumber: 'FV/1',
      documentKind: 'invoice',
    };
    expect(externalDocumentRefSchema.safeParse(oldShape).success).toBe(false);
  });

  it('carries the source system’s document number as externalNumber', () => {
    expect(
      externalDocumentRefSchema.parse({ ...ref, system: 'comarch_xl', externalNumber: 'FV/1' })
        .externalNumber,
    ).toBe('FV/1');
  });

  it('names the attachment id externalAttachmentId in the upsert input', () => {
    const base = {
      organizationId: '00000000-0000-4000-8000-000000000001',
      externalDocumentRef: { ...ref, system: 'erp_fixture' },
      kind: 'invoice',
      number: 'FV/1',
      currency: 'PLN',
      issuedAt: '2026-09-14T10:00:00.000Z',
      grossTotal: '1.00',
    } as const;
    const parsed = erpSaleDocumentUpsertInputSchema.parse({
      ...base,
      attachments: [{ externalAttachmentId: 'att-1', fileName: 'a.pdf' }],
    });
    expect(parsed.attachments?.[0]?.externalAttachmentId).toBe('att-1');
    expect(
      erpSaleDocumentUpsertInputSchema.safeParse({
        ...base,
        attachments: [{ xlAttachmentId: 'att-1', fileName: 'a.pdf' }],
      }).success,
    ).toBe(false);
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
