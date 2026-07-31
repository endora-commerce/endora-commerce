import { describe, expect, it, vi } from 'vitest';
import { PageBuilderRegistry } from '../../../src/modules/cms/services/page-builder-registry.js';

describe('PageBuilderRegistry', () => {
  it('registers a component and exposes it via describe()', async () => {
    const reg = new PageBuilderRegistry();
    reg.register('cms', {
      components: {
        Row: { fields: { gap: { type: 'number' } }, contexts: ['cms'] },
      },
    });
    const desc = await reg.describe();
    expect(desc.components).toHaveLength(1);
    expect(desc.components[0]!.name).toBe('Row');
    expect(desc.components[0]!.ownerModule).toBe('cms');
    expect(desc.components[0]!.contexts).toEqual(['cms']);
    expect(desc.breakpoints).toEqual({ tabletMin: 768, desktopMin: 1024 });
    expect(desc.colorPalette).toEqual([]);
  });

  it('merges registrations from multiple modules', async () => {
    const reg = new PageBuilderRegistry();
    reg.register('cms', { components: { Row: { fields: {} } } });
    reg.register('catalog', { components: { ProductCard: { fields: { productId: { type: 'uuid' } } } } });
    const names = (await reg.describe()).components.map((c) => c.name).sort();
    expect(names).toEqual(['ProductCard', 'Row']);
  });

  it('warns and last-writer-wins on a name collision', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const reg = new PageBuilderRegistry();
      reg.register('cms', { components: { Row: { fields: { v: { type: 'number' } } } } });
      reg.register('test-ext', { components: { Row: { fields: { v: { type: 'text' } } } } });
      const row = (await reg.describe()).components.find((c) => c.name === 'Row')!;
      expect(row.ownerModule).toBe('test-ext');
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('isComponentRegistered + knownNames behave as expected', () => {
    const reg = new PageBuilderRegistry();
    reg.register('cms', { components: { Row: { fields: {} }, Text: { fields: {} } } });
    expect(reg.isComponentRegistered('Row')).toBe(true);
    expect(reg.isComponentRegistered('Missing')).toBe(false);
    expect(Array.from(reg.knownNames()).sort()).toEqual(['Row', 'Text']);
  });

  it('includes color palette from resolver', async () => {
    const reg = new PageBuilderRegistry();
    reg.setColorPaletteResolver(async () => [
      { id: '00000000-0000-0000-0000-000000000001', name: 'Brand', hex: '#112233' },
    ]);
    const desc = await reg.describe();
    expect(desc.colorPalette).toEqual([
      { id: '00000000-0000-0000-0000-000000000001', name: 'Brand', hex: '#112233' },
    ]);
  });
});
