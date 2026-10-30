import { describe, expect, it } from 'vitest';
import {
  adminAttributeResponseSchema,
  createAttachmentRequestSchema,
  createPackagingUnitRequestSchema,
  packagingUnitSchema,
  productAttachmentSchema,
  updateAttachmentRequestSchema,
  updatePackagingUnitRequestSchema,
} from './catalog.js';

/**
 * Feature 163, rewritten by feature 168 (`contracts/scoped-values-api.md` §6, `readers.md` §2) —
 * the attachment and packaging-unit routes keep their collection operations and Global values;
 * every per-scope sub-field (163's translation maps and hidden-channel lists) is gone from them —
 * those scopes are written through `PUT …/products/:id/scoped-values`.
 */
const C = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-10-26T10:00:00.000Z';

describe('attachment shapes', () => {
  it('create and update take the Global name and description', () => {
    expect(
      createAttachmentRequestSchema.safeParse({ assetId: ID, attachmentTypeId: ID, name: 'Data sheet' }).success,
    ).toBe(true);
    expect(updateAttachmentRequestSchema.safeParse({ name: 'Data sheet', description: null }).success).toBe(true);
    expect(updateAttachmentRequestSchema.safeParse({ name: 'x'.repeat(161) }).success).toBe(false);
  });

  it('refuses 163 per-scope sub-fields (strict)', () => {
    expect(updateAttachmentRequestSchema.safeParse({ nameTranslations: { pl: 'Karta' } }).success).toBe(false);
    expect(updateAttachmentRequestSchema.safeParse({ descriptionTranslations: { pl: 'Opis' } }).success).toBe(false);
    expect(updateAttachmentRequestSchema.safeParse({ hiddenInChannels: [C] }).success).toBe(false);
    expect(
      createAttachmentRequestSchema.safeParse({ assetId: ID, attachmentTypeId: ID, name: 'x', hiddenInChannels: [C] })
        .success,
    ).toBe(false);
  });

  it('the admin DTO carries the Global hidden flag, not translations', () => {
    const parsed = productAttachmentSchema.parse({
      id: ID,
      productId: ID,
      assetId: ID,
      attachmentTypeId: ID,
      name: 'Data sheet',
      description: null,
      position: 0,
      hidden: true,
      nameTranslations: { pl: 'ignored' },
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(parsed.hidden).toBe(true);
    expect('nameTranslations' in parsed).toBe(false);
  });
});

describe('packaging-unit shapes', () => {
  it('create and update take the Global name and refuse translations (strict)', () => {
    expect(createPackagingUnitRequestSchema.safeParse({ name: 'Carton', baseQuantity: 12 }).success).toBe(true);
    expect(
      createPackagingUnitRequestSchema.safeParse({ name: 'Carton', baseQuantity: 12, nameTranslations: { pl: 'Karton' } })
        .success,
    ).toBe(false);
    expect(updatePackagingUnitRequestSchema.safeParse({ nameTranslations: { pl: '' } }).success).toBe(false);
    expect(updatePackagingUnitRequestSchema.safeParse({ hiddenInChannels: [C] }).success).toBe(false);
  });

  it('the admin DTO carries no name translations', () => {
    const parsed = packagingUnitSchema.parse({
      id: ID,
      productId: ID,
      name: 'Carton',
      baseQuantity: 12,
      position: 0,
      isDefault: false,
      minOrderUnits: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect('nameTranslations' in parsed).toBe(false);
  });
});

describe('adminAttributeResponseSchema', () => {
  it('declares the scope flag and the derived levels (R15), not the two 163 flags', () => {
    const shape = adminAttributeResponseSchema.shape;
    expect(shape).toHaveProperty('scopable');
    expect(shape).toHaveProperty('scopeLevels');
    expect(shape).not.toHaveProperty('channelScoped');
    expect(shape).not.toHaveProperty('languageScoped');
    expect(shape.scopeLevels.safeParse(['G', 'C', 'CL']).success).toBe(true);
    expect(shape.scopeLevels.safeParse(['L']).success).toBe(false);
  });
});
