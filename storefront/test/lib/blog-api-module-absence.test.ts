import { describe, expect, it, vi } from 'vitest';

/**
 * Feature 171 (FR-072) — a switched-off `blog` is an absence on every blog read, not
 * only on the index: a post, a category or a tag URL then renders "not found" rather
 * than a render error, as the routes behind the operator's prefix must when the
 * module that served them is gone (Principle XVII).
 */

vi.mock('../../lib/api/client', async (importActual) => {
  const actual = await importActual<typeof import('../../lib/api/client')>();
  return {
    ...actual,
    apiGet: vi.fn(async () => {
      throw new actual.StorefrontApiError(503, 'MODULE_DISABLED', 'Module blog is currently disabled.');
    }),
  };
});

const { getBlogBySlug, getBlogTagByCode } = await import('../../lib/api/blog');

describe('a switched-off blog is an absence on every read (feature 171)', () => {
  it('answers null for a post or category slug and for a tag', async () => {
    await expect(getBlogBySlug('porady', {}, undefined)).resolves.toBeNull();
    await expect(getBlogTagByCode('diy', {}, undefined)).resolves.toBeNull();
  });
});
