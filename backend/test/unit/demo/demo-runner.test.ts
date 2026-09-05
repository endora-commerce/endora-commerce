import { describe, expect, it, vi } from 'vitest';
import {
  DemoRunFailedError,
  formatDemoReport,
  runDemo,
  type DemoComposition,
  type DemoManifestEntry,
} from '../../../src/demo/index.js';
import type { ModuleDemoManifest } from '@endora-commerce/contracts';

/**
 * Feature 113 Phase 0 — `contracts/module-demo-data-layer.md` §3.7, §3.8 and §5.5.
 *
 * The runner over a plan: what it invokes, what it hands the body, what it does
 * with a failure, and where the composition sits in the sequence. No database —
 * the bodies are fixtures and `contextFor` is a stub, which is what makes the
 * ordering, the presence filtering and the report testable without services.
 */
function entry(
  id: string,
  demo?: ModuleDemoManifest<never> | false,
  dependencies: readonly string[] = [],
): DemoManifestEntry {
  return { id, dependencies, ...(demo === undefined ? {} : { demo }) };
}

const contextFor = (moduleId: string): unknown => ({ moduleId });
const present = (): boolean => true;

describe('runDemo — invocation (§3.4, §3.5)', () => {
  it('hands each body its own module context', async () => {
    const seen: unknown[] = [];
    const result = await runDemo({
      mode: 'seed',
      entries: [
        entry('catalog', {
          summary: 'Categories and products.',
          seed: async (context) => {
            seen.push(context.ctx);
            return { created: [{ entity: 'Product', count: 200 }] };
          },
          reset: async () => ({ removed: [] }),
        }),
      ],
      isPresent: present,
      contextFor,
    });
    expect(seen).toEqual([{ moduleId: 'catalog' }]);
    expect(result.modules).toEqual([
      {
        moduleId: 'catalog',
        summary: 'Categories and products.',
        entities: [{ entity: 'Product', count: 200 }],
        notes: [],
      },
    ]);
  });

  it('builds no context for a module it does not run', async () => {
    // §3.5: presence is decided from the declaration, **before** a context is
    // built. A `contextFor` that ran for a switched-off module would mean the
    // gate is downstream of the work it is meant to prevent.
    const build = vi.fn(contextFor);
    await runDemo({
      mode: 'seed',
      entries: [
        entry('catalog', {
          summary: 'x',
          seed: async () => ({ created: [] }),
          reset: async () => ({ removed: [] }),
        }),
      ],
      isPresent: () => false,
      contextFor: build,
    });
    expect(build).not.toHaveBeenCalled();
  });

  it('collects credentials from every module that reports them', async () => {
    const result = await runDemo({
      mode: 'seed',
      entries: [
        entry('admin_users', {
          summary: 'An administrator.',
          seed: async () => ({
            created: [{ entity: 'AdminUser', count: 1 }],
            credentials: [{ label: 'admin', value: 'admin@example.com / demo' }],
          }),
          reset: async () => ({ removed: [] }),
        }),
      ],
      isPresent: present,
      contextFor,
    });
    expect(result.credentials).toEqual([{ label: 'admin', value: 'admin@example.com / demo' }]);
  });

  it('calls `reset` rather than `seed` in reset mode', async () => {
    const seed = vi.fn(async () => ({ created: [] }));
    const reset = vi.fn(async () => ({ removed: [{ entity: 'Product', count: 200 }] }));
    const result = await runDemo({
      mode: 'reset',
      entries: [entry('catalog', { summary: 'x', seed, reset })],
      isPresent: present,
      contextFor,
    });
    expect(seed).not.toHaveBeenCalled();
    expect(reset).toHaveBeenCalledTimes(1);
    expect(result.modules[0]?.entities).toEqual([{ entity: 'Product', count: 200 }]);
  });
});

describe('runDemo — failure (§3.8)', () => {
  it('fails the run naming the module, and keeps the original error as the cause', async () => {
    const boom = new Error('the demo warehouse already exists');
    await expect(
      runDemo({
        mode: 'seed',
        entries: [
          entry('inventory', {
            summary: 'x',
            seed: async () => {
              throw boom;
            },
            reset: async () => ({ removed: [] }),
          }),
        ],
        isPresent: present,
        contextFor,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof DemoRunFailedError &&
        error.moduleId === 'inventory' &&
        error.mode === 'seed' &&
        error.cause === boom,
    );
  });

  it('does not run a later module after a failure', async () => {
    const later = vi.fn(async () => ({ created: [] }));
    await expect(
      runDemo({
        mode: 'seed',
        entries: [
          entry(
            'a_module',
            {
              summary: 'x',
              seed: async () => {
                throw new Error('nope');
              },
              reset: async () => ({ removed: [] }),
            },
          ),
          entry('z_module', {
            summary: 'x',
            seed: later,
            reset: async () => ({ removed: [] }),
          }),
        ],
        isPresent: present,
        contextFor,
      }),
    ).rejects.toBeInstanceOf(DemoRunFailedError);
    expect(later).not.toHaveBeenCalled();
  });
});

describe('runDemo — the composition seam (§5.5)', () => {
  const composition = (calls: string[]): DemoComposition => ({
    apply: async () => {
      calls.push('apply');
      return { applied: ['the megamenu over the category tree'], skipped: [] };
    },
    withdraw: async () => {
      calls.push('withdraw');
      return { applied: [], skipped: [{ step: 'the bridges', reason: 'catalog is not present' }] };
    },
  });

  it('runs the composition after every module seed', async () => {
    const calls: string[] = [];
    const result = await runDemo({
      mode: 'seed',
      entries: [
        entry('catalog', {
          summary: 'x',
          seed: async () => {
            calls.push('catalog');
            return { created: [] };
          },
          reset: async () => ({ removed: [] }),
        }),
      ],
      isPresent: present,
      contextFor,
      composition: composition(calls),
    });
    expect(calls).toEqual(['catalog', 'apply']);
    expect(result.composition).toEqual({
      applied: ['the megamenu over the category tree'],
      skipped: [],
    });
  });

  it('withdraws the composition before any module reset', async () => {
    const calls: string[] = [];
    await runDemo({
      mode: 'reset',
      entries: [
        entry('catalog', {
          summary: 'x',
          seed: async () => ({ created: [] }),
          reset: async () => {
            calls.push('catalog');
            return { removed: [] };
          },
        }),
      ],
      isPresent: present,
      contextFor,
      composition: composition(calls),
    });
    expect(calls).toEqual(['withdraw', 'catalog']);
  });

  it('runs with no composition at all — Phase 0 over zero modules', async () => {
    const result = await runDemo({
      mode: 'seed',
      entries: [],
      isPresent: present,
      contextFor,
    });
    expect(result.modules).toEqual([]);
    expect(result.composition).toBeUndefined();
    expect(formatDemoReport(result)).toMatch(/no module/i);
  });
});

describe('formatDemoReport — §3.7', () => {
  it('names every module, every skip with its reason, and the credentials', async () => {
    const result = await runDemo({
      mode: 'seed',
      entries: [
        entry('catalog', {
          summary: 'Categories and 200 products.',
          seed: async () => ({
            created: [{ entity: 'Product', count: 200 }],
            credentials: [{ label: 'buyer', value: 'buyer@example.com / demo' }],
            notes: ['Images are generated placeholders.'],
          }),
          reset: async () => ({ removed: [] }),
        }),
        entry('megamenu', {
          summary: 'A demo menu.',
          seed: async () => ({ created: [] }),
          reset: async () => ({ removed: [] }),
        }),
        entry('health_checks', false),
        entry('orders'),
      ],
      isPresent: (id) => id !== 'megamenu',
      contextFor,
    });
    const report = formatDemoReport(result);
    expect(report).toContain('catalog');
    expect(report).toContain('Categories and 200 products.');
    expect(report).toContain('Product 200');
    expect(report).toContain('Images are generated placeholders.');
    expect(report).toContain('megamenu');
    expect(report).toMatch(/not present/i);
    expect(report).toContain('buyer@example.com / demo');
    // The two quiet states are counted, not listed: 57 lines saying "this
    // module has nothing to demonstrate" is a report nobody reads.
    expect(report).not.toContain('health_checks');
    expect(report).toMatch(/1 declares none/);
    expect(report).toMatch(/1 has not decided/);
  });

  it('prints a composition step it skipped, with the reason', async () => {
    const result = await runDemo({
      mode: 'seed',
      entries: [],
      isPresent: present,
      contextFor,
      composition: {
        apply: async () => ({
          applied: [],
          skipped: [{ step: 'the megamenu over the category tree', reason: 'megamenu is not present' }],
        }),
        withdraw: async () => ({ applied: [], skipped: [] }),
      },
    });
    const report = formatDemoReport(result);
    expect(report).toContain('the megamenu over the category tree');
    expect(report).toContain('megamenu is not present');
  });
});
