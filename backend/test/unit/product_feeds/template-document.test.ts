import { describe, expect, it } from 'vitest';
import { feedTemplateDocumentSchema } from '@b2b/contracts';
import {
  buildTemplateDocument,
  serializeTemplateDocument,
  templateDocumentFilename,
} from '../../../src/modules/product_feeds/services/feed-template-io.service.js';

/**
 * Feature 067 / T094 — the template portability document (FR-012, FR-013).
 *
 * The single property that makes this document useful across installations is
 * that it carries **nothing local**. A uuid means nothing on the target, a
 * timestamp makes two exports of the same template differ, and a token in a
 * file an integrator e-mails around is a leak. So the test is literal: export
 * twice, compare bytes, and grep the payload for anything installation-shaped.
 */

/**
 * Deliberately typed by inference rather than by `ExportableTemplateField`:
 * the rows carry the local columns a database read would hand over (`id`,
 * `unbound`), and the point of the test below is that none of them reaches the
 * document. Annotating them away would remove the thing under test.
 */
const FIELDS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    outputName: 'g:brand',
    sourceKind: 'attribute' as const,
    sourceKey: 'brand',
    constantValue: null,
    fallbackValue: 'Generic',
    providerRequired: true,
    transform: 'trim' as const,
    transformArg: null,
    sortOrder: 5,
    helpKey: 'templateHelp.google.brand',
    unbound: false,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    outputName: 'g:id',
    sourceKind: 'sku' as const,
    sourceKey: null,
    constantValue: null,
    fallbackValue: null,
    providerRequired: true,
    transform: null,
    transformArg: null,
    sortOrder: 0,
    helpKey: 'templateHelp.google.id',
    unbound: false,
  },
];

const TEMPLATE = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Google Merchant Center (PL)',
  description: null,
  providerCode: 'google_merchant' as const,
  outputFormat: 'xml' as const,
  itemGranularity: 'variant' as const,
  isSystem: true,
  systemCode: 'google_merchant_v1',
  version: 7,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-07-30T09:15:00.000Z'),
};

describe('feed template document [unit]', () => {
  it('produces a document the contract schema accepts', () => {
    const document = buildTemplateDocument(TEMPLATE, FIELDS, 'google_merchant');
    expect(() => feedTemplateDocumentSchema.parse(document)).not.toThrow();
    expect(document.formatVersion).toBe(1);
    expect(document.template.name).toBe('Google Merchant Center (PL)');
    expect(document.template.taxonomyProviderCode).toBe('google_merchant');
  });

  it('is byte-identical across two exports of an unchanged template (FR-013)', () => {
    const first = serializeTemplateDocument(
      buildTemplateDocument(TEMPLATE, FIELDS, 'google_merchant'),
    );
    const second = serializeTemplateDocument(
      buildTemplateDocument(TEMPLATE, FIELDS, 'google_merchant'),
    );
    expect(first).toBe(second);
  });

  it('is byte-identical however the field rows arrive from the database', () => {
    const shuffled = [...FIELDS].reverse();
    expect(serializeTemplateDocument(buildTemplateDocument(TEMPLATE, FIELDS, null))).toBe(
      serializeTemplateDocument(buildTemplateDocument(TEMPLATE, shuffled, null)),
    );
  });

  it('orders fields by sortOrder, then by outputName as a total tie-break', () => {
    const tied = [
      { ...FIELDS[0]!, outputName: 'zzz', sortOrder: 3 },
      { ...FIELDS[1]!, outputName: 'aaa', sortOrder: 3 },
    ];
    const document = buildTemplateDocument(TEMPLATE, tied, null);
    expect(document.template.fields.map((field) => field.outputName)).toEqual(['aaa', 'zzz']);
  });

  it('carries no uuid, timestamp, version, system flag or token (FR-013)', () => {
    const payload = serializeTemplateDocument(
      buildTemplateDocument(TEMPLATE, FIELDS, 'google_merchant'),
    );
    expect(payload).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(payload).not.toContain('2026-');
    expect(payload).not.toContain('exportedAt');
    expect(payload).not.toContain('isSystem');
    expect(payload).not.toContain('systemCode');
    expect(payload).not.toContain('token');
    expect(payload).not.toContain('"version"');
    expect(payload).not.toContain('"unbound"');
  });

  it('carries the gloss key so an imported template still explains itself', () => {
    const document = buildTemplateDocument(TEMPLATE, FIELDS, null);
    const brand = document.template.fields.find((field) => field.outputName === 'g:brand');
    expect(brand?.helpKey).toBe('templateHelp.google.brand');
  });

  it('serializes with an explicit key order, not whatever the object literal had', () => {
    const payload = serializeTemplateDocument(buildTemplateDocument(TEMPLATE, FIELDS, null));
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(['formatVersion', 'template']);
    expect(Object.keys((parsed as { template: Record<string, unknown> }).template)).toEqual([
      'name',
      'description',
      'providerCode',
      'outputFormat',
      'itemGranularity',
      'taxonomyProviderCode',
      'fields',
    ]);
    const [field] = (parsed as { template: { fields: Array<Record<string, unknown>> } }).template
      .fields;
    expect(Object.keys(field!)).toEqual([
      'outputName',
      'sourceKind',
      'sourceKey',
      'constantValue',
      'fallbackValue',
      'providerRequired',
      'transform',
      'transformArg',
      'sortOrder',
      'helpKey',
    ]);
  });

  it('names the download after the template, never after its id', () => {
    expect(templateDocumentFilename('Google Merchant Center (PL)')).toBe(
      'google-merchant-center-pl.feed-template.json',
    );
    // A name made entirely of characters a filename cannot carry still yields
    // something an operating system will accept.
    expect(templateDocumentFilename('  ///  ')).toBe('feed-template.feed-template.json');
  });
});
