import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { PromptActionTool } from '@b2b/contracts';
import { PromptActionToolRegistry } from './tool-registry.js';

/**
 * T018 — unit tests for the PromptActionToolRegistry port (feature 043,
 * data-model §4 / contracts tool-contribution rules).
 */

function tool(overrides: Partial<PromptActionTool> = {}): PromptActionTool {
  return {
    id: 'catalog.search_products',
    moduleId: 'catalog',
    kind: 'resolver',
    description: 'Search products by name fragment.',
    requiredPermission: 'catalog:read',
    paramsSchema: z.object({ q: z.string() }),
    execute: async () => [],
    ...overrides,
  } as PromptActionTool;
}

describe('PromptActionToolRegistry (T018)', () => {
  it('registers and lists tools', () => {
    const r = new PromptActionToolRegistry();
    r.register(tool());
    r.register(tool({ id: 'inventory.set_stock_level', moduleId: 'inventory', kind: 'mutation', preview: async () => ({ headline: '', affectedCount: 1 }) }));
    expect(r.list().map((t) => t.id).sort()).toEqual([
      'catalog.search_products',
      'inventory.set_stock_level',
    ]);
    expect(r.get('catalog.search_products')?.moduleId).toBe('catalog');
  });

  it('throws at registration time on a duplicate id', () => {
    const r = new PromptActionToolRegistry();
    r.register(tool());
    expect(() => r.register(tool())).toThrow(/duplicate/i);
  });

  it("rejects ids that don't follow '<moduleId>.<snake_case_name>'", () => {
    const r = new PromptActionToolRegistry();
    expect(() => r.register(tool({ id: 'searchProducts' }))).toThrow();
    expect(() => r.register(tool({ id: 'inventory.search_products' }))).toThrow(/moduleId/i);
  });

  it('rejects a mutation without a preview() hook', () => {
    const r = new PromptActionToolRegistry();
    expect(() =>
      r.register(tool({ id: 'catalog.assign_products_to_category', kind: 'mutation' })),
    ).toThrow(/preview/i);
  });

  it('visibleFor filters by module state and operator permission', async () => {
    const r = new PromptActionToolRegistry();
    r.register(tool()); // catalog:read
    r.register(
      tool({
        id: 'inventory.set_stock_level',
        moduleId: 'inventory',
        kind: 'mutation',
        requiredPermission: 'catalog:write',
        preview: async () => ({ headline: '', affectedCount: 1 }),
      }),
    );
    r.register(
      tool({ id: 'cms.search_pages', moduleId: 'cms', requiredPermission: 'cms.read' }),
    );

    const visible = await r.visibleFor({
      hasPermission: async (p) => p === 'catalog:read' || p === 'catalog:write',
      isModuleInstalled: async (m) => m !== 'cms', // cms disabled
    });
    expect(visible.map((t) => t.id).sort()).toEqual([
      'catalog.search_products',
      'inventory.set_stock_level',
    ]);
  });

  it('exposes a provider-facing JSON Schema derived from the Zod params schema', () => {
    const r = new PromptActionToolRegistry();
    r.register(tool());
    const def = r.toLlmToolDefinition(r.get('catalog.search_products')!);
    expect(def.name).toBe('catalog.search_products');
    expect(def.description).toContain('Search products');
    const schema = def.inputSchema as { type?: string; properties?: Record<string, unknown> };
    expect(schema.type).toBe('object');
    expect(schema.properties).toHaveProperty('q');
  });
});
