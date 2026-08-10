import { describe, it, expect } from 'vitest';
import { analyzeSource } from '../../../scripts/check-channel-resolution.js';

/**
 * Self-test for the FR-011 channel-resolution CI check (feature 053).
 * Pure static analysis — no DB. Guards the guard: the detectors must flag the
 * two forbidden signals and must NOT flag legitimate property reads.
 */
describe('check-channel-resolution / analyzeSource', () => {
  const SURFACE = 'modules/catalog/routes.public.ts';
  const NON_SURFACE = 'modules/catalog/services/some-other.service.ts';
  const RESOLVER = 'modules/sales_channels/services/sales-channels.service.ts';
  const KERNEL_RESOLVER = 'kernel/sales-channels/sales-channel-resolver.middleware.ts';

  it('flags a raw x-sales-channel header read (global scope)', () => {
    const v = analyzeSource(
      `const code = request.headers['x-sales-channel'];`,
      NON_SURFACE,
    );
    expect(v).toHaveLength(1);
    expect(v[0]!.kind).toBe('raw-channel-header');
  });

  it('flags the x-sales-channel-id UUID alias header read', () => {
    const v = analyzeSource(`const id = headers['x-sales-channel-id'];`, SURFACE);
    expect(v.some((x) => x.kind === 'raw-channel-header')).toBe(true);
  });

  it('flags findOne(SalesChannel, …) re-resolution inside a storefront surface', () => {
    const v = analyzeSource(
      `const ch = await em.findOne(SalesChannel, { code });`,
      SURFACE,
    );
    expect(v).toHaveLength(1);
    expect(v[0]!.kind).toBe('request-channel-reresolution');
  });

  it('flags a raw `from sales_channels` SQL string inside a storefront surface', () => {
    const v = analyzeSource(
      "const rows = await conn.execute(`select id from sales_channels where code = ? and active = true`, [code]);",
      'modules/cms/services/storefront-resolver.ts',
    );
    expect(v.some((x) => x.kind === 'request-channel-reresolution')).toBe(true);
  });

  it('does NOT flag reading channel.isPublic off an already-resolved channel', () => {
    const v = analyzeSource(
      `const showPrice = channel?.isPublic ?? true; const c = request.salesChannel;`,
      SURFACE,
    );
    expect(v).toHaveLength(0);
  });

  it('does NOT flag a SalesChannel query outside a storefront surface (admin CRUD ok)', () => {
    const v = analyzeSource(
      `const ch = await em.findOne(SalesChannel, { id });`,
      NON_SURFACE,
    );
    expect(v).toHaveLength(0);
  });

  it('never flags anything inside the sales_channels module (resolver owns resolution)', () => {
    const v = analyzeSource(
      `const h = request.headers['x-sales-channel']; const ch = await em.findOne(SalesChannel, { code });`,
      RESOLVER,
    );
    expect(v).toHaveLength(0);
  });

  it('never flags the relocated kernel resolver (feature 072 T019)', () => {
    const v = analyzeSource(
      `const h = request.headers['x-sales-channel']; const ch = await em.findOne(SalesChannel, { code });`,
      KERNEL_RESOLVER,
    );
    expect(v).toHaveLength(0);
  });

  it('still flags a raw channel-header read elsewhere in the kernel', () => {
    // The exemption is the resolver's directory, not the kernel as a whole:
    // moving the resolver in must not turn the kernel into a blind spot.
    const v = analyzeSource(
      `const h = request.headers['x-sales-channel'];`,
      'kernel/scope.ts',
    );
    expect(v).toHaveLength(1);
    expect(v[0]!.kind).toBe('raw-channel-header');
  });
});
