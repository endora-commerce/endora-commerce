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

  it('applies the foundation before the first module seed (§5.5a)', async () => {
    // The blocker feature 113's T226 was held on, as a sequence: a row a
    // module's own body **reads** has to exist before that body runs. Measured
    // in the shop rather than here: `inventory` enumerates every sales channel
    // and assigns its warehouse to each, so a channel created in `apply`
    // arrives after the read and loses its assignment with nothing failing.
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
      composition: {
        ...composition(calls),
        applyFoundation: async () => {
          calls.push('applyFoundation');
          return { applied: ["the demo's sales channels"], skipped: [] };
        },
        withdrawFoundation: async () => {
          calls.push('withdrawFoundation');
          return { applied: ["the demo's sales channels"], skipped: [] };
        },
      },
    });
    expect(calls).toEqual(['applyFoundation', 'catalog', 'apply']);
    // One list, in execution order: the two phases are reported as one result
    // because an operator reads a sequence.
    expect(result.composition?.applied).toEqual([
      "the demo's sales channels",
      'the megamenu over the category tree',
    ]);
  });

  it('withdraws the foundation after the last module reset (§5.5a)', async () => {
    // The exact reverse of the seed, and the position is what lets the
    // withdrawal be a filtered delete: taking the foundation away first would
    // remove rows the modules' rows reference, through the database's cascade
    // rather than through the module that owns them.
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
      composition: {
        ...composition(calls),
        applyFoundation: async () => {
          calls.push('applyFoundation');
          return { applied: [], skipped: [] };
        },
        withdrawFoundation: async () => {
          calls.push('withdrawFoundation');
          return { applied: [], skipped: [] };
        },
      },
    });
    expect(calls).toEqual(['withdraw', 'catalog', 'withdrawFoundation']);
  });

  it('leaves a composition that declares no foundation exactly as it was', async () => {
    // §5.5a is additive: the phase is optional, and a composition written
    // against the Phase-0 interface must produce the result it produced before
    // the phase existed — including the report's shape (§6.5).
    const calls: string[] = [];
    const result = await runDemo({
      mode: 'seed',
      entries: [],
      isPresent: present,
      contextFor,
      composition: composition(calls),
    });
    expect(calls).toEqual(['apply']);
    expect(result.composition).toEqual({
      applied: ['the megamenu over the category tree'],
      skipped: [],
    });
  });

  it('reports the credentials a composition created beside the modules\' own', async () => {
    // The demo buyer is created by a composition step and by nothing else —
    // `customer_accounts.organization_id` is `NOT NULL` (Principle XI) — so
    // until this field existed the composed report printed three of the four
    // sign-ins and said nothing about the fourth.
    const result = await runDemo({
      mode: 'seed',
      entries: [
        entry('admin_users', {
          summary: 'x',
          seed: async () => ({
            created: [],
            credentials: [{ label: 'Administrator', value: 'admin@demo.local / pw' }],
          }),
          reset: async () => ({ removed: [] }),
        }),
      ],
      isPresent: present,
      contextFor,
      composition: {
        apply: async () => ({
          applied: ['the buyer joins the organisation'],
          skipped: [],
          credentials: [{ label: 'Organization Admin', value: 'buyer@demo.example / pw' }],
        }),
        withdraw: async () => ({ applied: [], skipped: [] }),
      },
    });
    expect(result.credentials).toEqual([
      { label: 'Administrator', value: 'admin@demo.local / pw' },
      { label: 'Organization Admin', value: 'buyer@demo.example / pw' },
    ]);
    expect(formatDemoReport(result)).toContain('buyer@demo.example / pw');
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
