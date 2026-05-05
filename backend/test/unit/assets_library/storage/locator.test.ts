import { describe, expect, it } from 'vitest';
import { computeLocator } from '../../../../src/modules/assets_library/services/storage/locator.js';

describe('computeLocator', () => {
  it('shards by first two and next two hex chars of the assetId', () => {
    const id = 'aabbccdd-1111-2222-3333-444455556666';
    expect(computeLocator({ assetId: id, originalFilename: 'hero.JPG' })).toBe(
      `aa/bb/${id}.JPG`,
    );
  });

  it('lowercases the assetId in the path but keeps the original extension casing', () => {
    const id = 'AABBCCDD-1111-2222-3333-444455556666';
    expect(computeLocator({ assetId: id, originalFilename: 'photo.PNG' })).toBe(
      `aa/bb/${id.toLowerCase()}.PNG`,
    );
  });

  it('falls back to the `bin` extension when the original filename has none', () => {
    const id = 'aabbccdd-1111-2222-3333-444455556666';
    expect(computeLocator({ assetId: id, originalFilename: 'no-extension' })).toBe(
      `aa/bb/${id}.bin`,
    );
  });

  it('throws on an assetId shorter than four characters', () => {
    expect(() => computeLocator({ assetId: 'abc', originalFilename: 'x.bin' })).toThrow();
  });

  it('is pure — same input always yields the same output', () => {
    const id = 'aabbccdd-1111-2222-3333-444455556666';
    const a = computeLocator({ assetId: id, originalFilename: 'hero.jpg' });
    const b = computeLocator({ assetId: id, originalFilename: 'hero.jpg' });
    expect(a).toBe(b);
  });
});
