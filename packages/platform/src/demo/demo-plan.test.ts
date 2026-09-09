import { describe, expect, it } from 'vitest';
import { planDemoRun, type DemoManifestEntry } from './plan.js';
import type { ModuleDemoManifest } from '@endora-commerce/contracts';

/**
 * Feature 113 Phase 0 — `contracts/module-demo-data-layer.md` §3.5–§3.6 and §4.
 *
 * The plan is the half of the runner that has no database in it: which modules
 * contribute, in what order, and which are reported as skips. Every proof enters
 * at `planDemoRun` with entries and a presence oracle, which is the top of the
 * analysis — a fixture that entered at the sort would not catch a presence gate
 * that stopped running.
 */
function body(): Pick<ModuleDemoManifest<never>, 'summary' | 'seed' | 'reset'> {
  return {
    summary: 'demo rows',
    seed: async () => ({ created: [] }),
    reset: async () => ({ removed: [] }),
  };
}

function entry(
  id: string,
  options: {
    dependencies?: readonly string[];
    demo?: ModuleDemoManifest<never> | false | undefined;
  } = {},
): DemoManifestEntry {
  return {
    id,
    dependencies: options.dependencies ?? [],
    ...(options.demo === undefined ? {} : { demo: options.demo }),
  };
}

const present = (): boolean => true;

describe('planDemoRun — the order (§4.1, §4.2)', () => {
  it('orders declaring modules by the manifest dependency graph', () => {
    const plan = planDemoRun({
      mode: 'seed',
      entries: [
        entry('inventory', { dependencies: ['catalog'], demo: body() }),
        entry('catalog', { demo: body() }),
      ],
      isPresent: present,
    });
    expect(plan.steps.map((s) => s.moduleId)).toEqual(['catalog', 'inventory']);
  });

  it('breaks ties by module id, so the order is a pure function of the input', () => {
    const plan = planDemoRun({
      mode: 'seed',
      entries: [entry('taxes', { demo: body() }), entry('catalog', { demo: body() })],
      isPresent: present,
    });
    expect(plan.steps.map((s) => s.moduleId)).toEqual(['catalog', 'taxes']);
  });

  it('reverses the order for a reset', () => {
    const plan = planDemoRun({
      mode: 'reset',
      entries: [
        entry('inventory', { dependencies: ['catalog'], demo: body() }),
        entry('catalog', { demo: body() }),
      ],
      isPresent: present,
    });
    expect(plan.steps.map((s) => s.moduleId)).toEqual(['inventory', 'catalog']);
  });

  it('orders a non-declaring dependency out of the run without disturbing the rest', () => {
    // `auth` is in the graph and ships no demo data. It contributes no step and
    // its edge still orders the two modules that do.
    const plan = planDemoRun({
      mode: 'seed',
      entries: [
        entry('inventory', { dependencies: ['auth'], demo: body() }),
        entry('auth', { dependencies: [], demo: false }),
        entry('catalog', { dependencies: ['auth'], demo: body() }),
      ],
      isPresent: present,
    });
    expect(plan.steps.map((s) => s.moduleId)).toEqual(['catalog', 'inventory']);
  });
});

describe('planDemoRun — the advisory `after` list (§4.3–§4.5)', () => {
  it('orders a module after one the dependency graph does not', () => {
    // The measured case: `megamenu` does not declare `catalog` and must not
    // begin to (D-209). Without `after` the two are tied and sort by id, which
    // puts `catalog` second.
    const withoutAfter = planDemoRun({
      mode: 'seed',
      entries: [entry('megamenu', { demo: body() }), entry('catalog', { demo: body() })],
      isPresent: present,
    });
    expect(withoutAfter.steps.map((s) => s.moduleId)).toEqual(['catalog', 'megamenu']);

    const reversed = planDemoRun({
      mode: 'seed',
      entries: [
        entry('a_module', { demo: { ...body(), after: ['z_module'] } }),
        entry('z_module', { demo: body() }),
      ],
      isPresent: present,
    });
    expect(reversed.steps.map((s) => s.moduleId)).toEqual(['z_module', 'a_module']);
  });

  it('tolerates an `after` naming a module that is not installed (§4.4)', () => {
    const plan = planDemoRun({
      mode: 'seed',
      entries: [entry('megamenu', { demo: { ...body(), after: ['catalog'] } })],
      isPresent: present,
    });
    expect(plan.steps.map((s) => s.moduleId)).toEqual(['megamenu']);
    expect(plan.diagnostics).toEqual([]);
  });

  it('tolerates an `after` naming a module that is installed but switched off', () => {
    const plan = planDemoRun({
      mode: 'seed',
      entries: [
        entry('megamenu', { demo: { ...body(), after: ['catalog'] } }),
        entry('catalog', { demo: body() }),
      ],
      isPresent: (id) => id !== 'catalog',
    });
    expect(plan.steps.map((s) => s.moduleId)).toEqual(['megamenu']);
  });

  it('reports a cycle and does not stop the run (§4.5)', () => {
    const plan = planDemoRun({
      mode: 'seed',
      entries: [
        entry('a_module', { demo: { ...body(), after: ['b_module'] } }),
        entry('b_module', { demo: { ...body(), after: ['a_module'] } }),
      ],
      isPresent: present,
    });
    expect(plan.steps.map((s) => s.moduleId)).toEqual(['a_module', 'b_module']);
    expect(plan.diagnostics).toHaveLength(1);
    expect(plan.diagnostics[0]).toMatch(/a_module/);
    expect(plan.diagnostics[0]).toMatch(/b_module/);
  });
});

describe('planDemoRun — presence (§3.5, §3.6)', () => {
  it('reports a module that is not effectively present as a skip, never an error', () => {
    const plan = planDemoRun({
      mode: 'seed',
      entries: [entry('catalog', { demo: body() }), entry('megamenu', { demo: body() })],
      isPresent: (id) => id !== 'megamenu',
    });
    expect(plan.steps.map((s) => s.moduleId)).toEqual(['catalog']);
    expect(plan.skipped).toEqual([
      { moduleId: 'megamenu', reason: 'not-present' },
    ]);
  });

  it('asks about the declaring module and about nothing else', () => {
    const asked: string[] = [];
    planDemoRun({
      mode: 'seed',
      entries: [
        entry('catalog', { demo: body() }),
        entry('inventory', { dependencies: ['catalog'], demo: false }),
        entry('auth', {}),
      ],
      isPresent: (id) => {
        asked.push(id);
        return true;
      },
    });
    // Only the one module that declares a body. A module declaring `false` and
    // a module that has decided nothing contribute no step, so asking about
    // them would be asking a question with no consequence — and asking about a
    // dependency would be asking the owner's presence question twice (D-157.5).
    expect(asked).toEqual(['catalog']);
  });
});

describe('planDemoRun — the three states (§1.2)', () => {
  it('counts a module that declares `false` apart from one that has decided nothing', () => {
    const plan = planDemoRun({
      mode: 'seed',
      entries: [
        entry('catalog', { demo: body() }),
        entry('health_checks', { demo: false }),
        entry('orders', {}),
        entry('carts', {}),
      ],
      isPresent: present,
    });
    expect(plan.counts).toEqual({ declaredNone: 1, undecided: 2 });
  });

  it('says so over zero modules rather than failing', () => {
    // The state Phase 0 is measured against: the platform can run a demo seed
    // over no modules at all and report it.
    const plan = planDemoRun({ mode: 'seed', entries: [], isPresent: present });
    expect(plan.steps).toEqual([]);
    expect(plan.skipped).toEqual([]);
    expect(plan.counts).toEqual({ declaredNone: 0, undecided: 0 });
  });
});
