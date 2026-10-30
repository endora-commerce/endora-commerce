import { describe, expect, it } from 'vitest';
import { galleryItemSchema, updateGalleryItemRequestSchema } from './catalog.js';

/**
 * Feature 163, rewritten by feature 168 (`contracts/scoped-values-api.md` §6) — the gallery item
 * route keeps position and labels; alt text, the hidden flag and the channel roles are scoped
 * fields written through `PUT …/products/:id/scoped-values`.
 */
const C = '11111111-1111-4111-8111-111111111111';
const I = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-10-26T10:00:00.000Z';

describe('updateGalleryItemRequestSchema', () => {
  it('accepts position and labels', () => {
    expect(updateGalleryItemRequestSchema.safeParse({ position: 2, labels: ['thumbnail'] }).success).toBe(true);
  });

  it('refuses 163 per-scope sub-fields (strict)', () => {
    expect(updateGalleryItemRequestSchema.safeParse({ altText: { 'pl-PL': 'Paleta' } }).success).toBe(false);
    expect(updateGalleryItemRequestSchema.safeParse({ altText: 'Paleta' }).success).toBe(false);
    expect(updateGalleryItemRequestSchema.safeParse({ hiddenInChannels: [C] }).success).toBe(false);
  });
});

describe('galleryItemSchema', () => {
  it('reads the Global alt text as one string and the Global hidden flag', () => {
    const parsed = galleryItemSchema.parse({
      id: I,
      productId: I,
      assetId: I,
      position: 0,
      labels: ['base_image'],
      altText: 'Paleta',
      hidden: false,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(parsed.altText).toBe('Paleta');
    expect(galleryItemSchema.safeParse({ ...parsed, altText: { pl: 'x' } }).success).toBe(false);
  });
});
