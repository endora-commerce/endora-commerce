import { describe, expect, it, vi } from 'vitest';
import { DemoPackageShapeError, createDemoPackageResolver, demoBodyFromPackage, type DemoPackageResolver } from './packages.js';
import { type DemoManifestEntry } from './plan.js';
import { formatDemoReport } from './report.js';
import { DemoRunFailedError, runDemo, type DemoComposition, unwrapDemoFailure } from './runner.js';
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


/**
 * The escape hatch (feature 113, T235 —
 * `contracts/module-demo-data-layer.md` §6).
 *
 * §6.3 requires **three** answers and forbids collapsing the second into the
 * third, and §6.4 requires the probe to happen before the import. Both are
 * asserted here rather than inferred from the code's shape, because the whole
 * defect the clause is written against — a broken demo package reading as an
 * absent one — is invisible in a run that has no broken package in it.
 */
function body(summary: string): ModuleDemoManifest<never> {
  return {
    summary,
    seed: async () => ({ created: [{ entity: 'Declared', count: 1 }] }),
    reset: async () => ({ removed: [] }),
  };
}

/** A module whose demo data lives in a package. */
function delegating(id: string, packageName: string): DemoManifestEntry {
  return { id, dependencies: [], demo: { ...body('the declaration'), package: packageName } };
}

const PACKAGE_BODY = {
  demo: {
    summary: "the package's own demo data",
    seed: async () => ({ created: [{ entity: 'FromPackage', count: 7 }] }),
    reset: async () => ({ removed: [{ entity: 'FromPackage', count: 7 }] }),
  },
};

function resolver(over: Partial<DemoPackageResolver>): DemoPackageResolver {
  return {
    isInstalled: () => true,
    load: async () => PACKAGE_BODY,
    ...over,
  };
}

describe('demo.package — the escape hatch (§6.3, §6.4)', () => {
  it('runs the package’s body instead of the declaration’s when it loads', async () => {
    const result = await runDemo({
      mode: 'seed',
      entries: [delegating('catalog', '@endora-commerce/mod-catalog-demo')],
      isPresent: present,
      contextFor,
      demoPackages: resolver({}),
    });
    // §6.3's first row in its own words: *"the module's demo data is the
    // package's"*. The declaration's `seed` would have reported `Declared 1`,
    // and it must not run at all — §6.2 bars the module's own sources from
    // naming the package, so the declared body could not reach the data.
    expect(result.modules).toEqual([
      {
        moduleId: 'catalog',
        summary: "the package's own demo data",
        entities: [{ entity: 'FromPackage', count: 7 }],
        notes: [],
      },
    ]);
    expect(result.skipped).toEqual([]);
  });

  it('reports an uninstalled package by name, and the run continues', async () => {
    const loads = vi.fn(async () => PACKAGE_BODY);
    const build = vi.fn(contextFor);
    const result = await runDemo({
      mode: 'seed',
      entries: [
        delegating('catalog', '@endora-commerce/mod-catalog-demo'),
        entry('taxes', body('the VAT rule')),
      ],
      isPresent: present,
      contextFor: build,
      demoPackages: resolver({ isInstalled: (name) => !name.endsWith('-demo'), load: loads }),
    });
    // §6.3's second row: a skip, never an error, and never a silence. The
    // second module still runs — *"the run continues"* is the clause.
    expect(result.skipped).toEqual([
      {
        moduleId: 'catalog',
        reason: 'demo-package-not-installed',
        package: '@endora-commerce/mod-catalog-demo',
      },
    ]);
    expect(result.modules.map((module) => module.moduleId)).toEqual(['taxes']);
    // Nothing was imported and nothing was built for it: the probe is upstream
    // of both (§6.4, and §3.5's reasoning one field over).
    expect(loads).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalledWith('catalog');
  });

  it('fails the run when the package is installed and throws on load', async () => {
    // §6.3's third row, and the whole reason §6.4 exists: this state and the
    // one above are *different answers*, and a single `catch` around a bare
    // import would report this one as "not installed" and continue.
    const broken = new Error('Cannot find module ./rows.js');
    const run = runDemo({
      mode: 'seed',
      entries: [delegating('catalog', '@endora-commerce/mod-catalog-demo')],
      isPresent: present,
      contextFor,
      demoPackages: resolver({
        load: async () => {
          throw broken;
        },
      }),
    });
    await expect(run).rejects.toThrow(DemoRunFailedError);
    await expect(run).rejects.toThrow(/catalog/);
    // The original survives as the `cause`, unmodified, so an entry point's
    // existing discrimination sees what it saw before this layer existed.
    await expect(run.catch((error: unknown) => unwrapDemoFailure(error))).resolves.toBe(broken);
  });

  it('refuses a package that loads but carries no demo body', async () => {
    const run = runDemo({
      mode: 'seed',
      entries: [delegating('catalog', '@endora-commerce/mod-catalog-demo')],
      isPresent: present,
      contextFor,
      demoPackages: resolver({ load: async () => ({ notDemo: true }) }),
    });
    await expect(run).rejects.toThrow(DemoRunFailedError);
    // Its own error, so the message names the field to fix rather than being a
    // `TypeError` from the first call.
    await expect(
      run.catch((error: unknown) => unwrapDemoFailure(error)),
    ).resolves.toBeInstanceOf(DemoPackageShapeError);
  });

  it('withdraws through the package too', async () => {
    const result = await runDemo({
      mode: 'reset',
      entries: [delegating('catalog', '@endora-commerce/mod-catalog-demo')],
      isPresent: present,
      contextFor,
      demoPackages: resolver({}),
    });
    // §6.5: taking the hatch changes nothing else, and `reset` is not an
    // exception — the package's `reset` is what runs.
    expect(result.modules[0]?.entities).toEqual([{ entity: 'FromPackage', count: 7 }]);
  });

  it('tells the operator to install a package rather than to switch a module on', async () => {
    const result = await runDemo({
      mode: 'seed',
      entries: [
        delegating('catalog', '@endora-commerce/mod-catalog-demo'),
        entry('megamenu', body('a demo menu')),
      ],
      isPresent: (id) => id !== 'megamenu',
      contextFor,
      demoPackages: resolver({ isInstalled: () => false }),
    });
    const report = formatDemoReport(result);
    // The two skips ask for two different actions, and a report that merged
    // them would send an operator to the module screen, where `catalog` is on
    // and nothing is wrong.
    expect(report).toContain('@endora-commerce/mod-catalog-demo');
    expect(report).toMatch(/catalog — its demo data lives in/);
    expect(report).toMatch(/megamenu — not present/);
  });
});

describe('demoBodyFromPackage — what a demo package owes (§6.1)', () => {
  it('takes the summary, seed and reset, and nothing else', () => {
    const taken = demoBodyFromPackage(PACKAGE_BODY, 'catalog', '@endora-commerce/mod-catalog-demo');
    expect(Object.keys(taken).sort()).toEqual(['reset', 'seed', 'summary']);
  });

  it('refuses each incomplete shape, naming what is wrong', () => {
    const cases: readonly [unknown, RegExp][] = [
      [{}, /exports no `demo`/],
      [{ demo: 'yes' }, /not an object/],
      [{ demo: { seed: () => {}, reset: () => {} } }, /no `summary`/],
      [{ demo: { summary: 'x', seed: () => {} } }, /not a function/],
    ];
    for (const [loaded, message] of cases) {
      expect(() =>
        demoBodyFromPackage(loaded, 'catalog', '@endora-commerce/mod-catalog-demo'),
      ).toThrow(message);
    }
  });

  it('does not read the package’s own `after`', () => {
    // Ordering is `planDemoRun`'s, decided from the declarations before
    // anything is loaded — a package's `after` would arrive after the sequence
    // it wants to change.
    const taken = demoBodyFromPackage(
      { demo: { ...PACKAGE_BODY.demo, after: ['inventory'] } },
      'catalog',
      '@endora-commerce/mod-catalog-demo',
    );
    expect(taken.after).toBeUndefined();
  });
});

describe('createDemoPackageResolver — the default (§6.4)', () => {
  it('probes without evaluating, and answers false for a package that is not there', () => {
    const resolve = createDemoPackageResolver();
    // A real probe against this checkout: `vitest` is installed here and a
    // package by this name is not, so the two answers are decided by
    // resolution alone and neither evaluates anything.
    expect(resolve.isInstalled('vitest')).toBe(true);
    expect(resolve.isInstalled('@endora-commerce/mod-nothing-demo')).toBe(false);
  });
});
