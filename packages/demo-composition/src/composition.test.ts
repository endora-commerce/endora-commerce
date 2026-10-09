import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';

import {
  createDemoComposition,
  DEMO_COMPOSITION_STEP_NAMES,
  DEMO_FOUNDATION_STEP_NAMES,
} from './composition.js';
import { DEMO_USAGE_SECTION_NAMES, DEMO_USAGE_SECTIONS } from './demo-usage.js';

/**
 * What this package promises an instance with a **smaller** module set — the
 * property that let it leave the host at all (2026-10-01).
 *
 * The rows the steps write are `backend/test/integration/demo/`'s subject:
 * `demo-shop.test.ts` holds every table the seed moves to a recorded delta, and
 * `demo-instance-shape.test.ts` runs this package the way a CLI-scaffolded
 * instance does. Neither can say the two things below, because a database with
 * every module present never reaches them: that a step whose modules are absent
 * is a reported skip naming them (§5.4), and that reaching that answer imports
 * no module package at all — an instance that did not install `megamenu`
 * cannot import `@endora-commerce/mod-megamenu`, and a static import of it would
 * fail the whole composition before its first guard was asked.
 *
 * An `EntityManager` that throws on any use is the proof of the second: a step
 * that ran, or loaded a module's entities to decide not to, would reach it.
 */
const untouchable = new Proxy({} as EntityManager, {
  get(_target, property) {
    throw new Error(`the composition used the EntityManager (${String(property)}) with no module present`);
  },
});

describe('a composition over an instance with none of its modules', () => {
  const composition = createDemoComposition({ em: untouchable, isPresent: () => false });

  it('skips every wiring step, naming the modules each one needed', async () => {
    const result = await composition.apply();
    expect(result.applied).toEqual([]);
    expect(result.skipped.map((entry) => entry.step)).toEqual([...DEMO_COMPOSITION_STEP_NAMES]);
    const roles = result.skipped.find(
      (entry) => entry.step === 'demo administrators take their roles',
    );
    expect(roles?.reason).toContain('admin_users');
    expect(roles?.reason).toContain('admin_roles');
  });

  it('advertises no sign-in for an account it did not create', async () => {
    // The buyer's credentials are declared by the step that creates it, and a
    // skipped step must not print a password nobody can sign in with.
    expect((await composition.apply()).credentials).toBeUndefined();
  });

  it('withdraws nothing either, in the reverse order', async () => {
    const result = await composition.withdraw();
    expect(result.applied).toEqual([]);
    // What using the demo left behind is withdrawn before any step is unwound
    // (issue #143), so its sections are reported first.
    expect(result.skipped.map((entry) => entry.step)).toEqual([
      ...DEMO_USAGE_SECTION_NAMES,
      ...[...DEMO_COMPOSITION_STEP_NAMES].reverse(),
    ]);
  });
});

describe('what using the demo left behind (issue #143)', () => {
  it('is found through the demo organisation in every statement, and by nothing wider', () => {
    // The whole safety of this withdrawal is its predicate: a statement that
    // did not go through the demo organisation's tax id would be a delete over
    // somebody else's rows. Every `?` is bound to that one value.
    for (const section of DEMO_USAGE_SECTIONS) {
      for (const statement of section.statements) {
        expect(statement, section.name).toContain('from organizations where tax_id = ?');
        expect(statement, section.name).toMatch(/\bwhere\b/);
      }
    }
  });

  it('names the organisation module in every section, so none runs without its table', () => {
    for (const section of DEMO_USAGE_SECTIONS) {
      expect(section.modules, section.name).toContain('organizations');
    }
  });

  it('deletes the accounts last: every other section finds its rows through them', () => {
    expect(DEMO_USAGE_SECTION_NAMES.at(-1)).toBe('customer accounts of the demo organisation');
  });

  it('opens no transaction when none of its modules is present', async () => {
    // Only the two admin modules: no section can run, so the EntityManager —
    // which throws on any use — is never reached.
    const composition = createDemoComposition({
      em: untouchable,
      isPresent: (moduleId) => moduleId === 'admin_users' || moduleId === 'admin_roles',
    });
    const result = await composition.withdraw();
    expect(result.skipped.map((entry) => entry.step)).toEqual(
      expect.arrayContaining([...DEMO_USAGE_SECTION_NAMES]),
    );
  });

  it('runs every present section inside one transaction, and stops on sub-organisations', async () => {
    const executed: string[] = [];
    let transactions = 0;
    const tx = {
      execute: async (statement: string, params: readonly string[]) => {
        // One bound value per placeholder, all of them the same tax id.
        expect(params.length).toBe(statement.split('?').length - 1);
        expect(new Set(params).size).toBe(1);
        executed.push(statement);
        return statement.includes('parent_id') ? [{ n: branches }] : [];
      },
    };
    let branches = '0';
    const em = {
      transactional: async (work: (inner: typeof tx) => Promise<void>) => {
        transactions += 1;
        await work(tx);
      },
    } as unknown as EntityManager;
    const { withdrawDemoUsage } = await import('./demo-usage.js');
    const deps = {
      em,
      isPresent: (moduleId: string) => moduleId === 'organizations' || moduleId === 'addresses',
      organizationTaxId: 'PL0000000001',
      absenceReason: (absent: readonly string[]) => absent.join(','),
    };

    const result = await withdrawDemoUsage(deps);
    expect(transactions).toBe(1);
    expect(result.applied).toEqual(['addresses saved by the demo organisation']);
    expect(executed.at(-1)).toContain('delete from addresses');

    branches = '2';
    executed.length = 0;
    await expect(withdrawDemoUsage(deps)).rejects.toThrow(/2 sub-organisation/);
    // The count, and nothing after it.
    expect(executed).toHaveLength(1);
  });
});

describe('the step list is the demo shop the platform repository has always seeded', () => {
  it('keeps the role assignment and the channel bridges among its steps', () => {
    // The two whose absence was the reported defect: administrators with no
    // role, and products no channel sold.
    expect(DEMO_COMPOSITION_STEP_NAMES).toContain('demo administrators take their roles');
    expect(DEMO_COMPOSITION_STEP_NAMES).toContain('product↔category and channel↔product bridges');
  });

  it('pairs the administrators with their roles before any other step', () => {
    // An administrator without a role is refused everywhere, and every later
    // step can fail; the pairing depends on none of them.
    expect(DEMO_COMPOSITION_STEP_NAMES[0]).toBe('demo administrators take their roles');
  });

  it('keeps the sales channels as the one foundation step (§5.5a)', () => {
    expect(DEMO_FOUNDATION_STEP_NAMES).toEqual(["the demo's two sales channels"]);
  });
});

describe('withdrawing the composition never leaves an administrator without a role', () => {
  it('writes nothing for the role step: the accounts are deleted with their role on them', async () => {
    // Only the two admin modules are present, so the role step is the one step
    // that runs — over an EntityManager that throws on any use. A withdrawal
    // that unassigned the roles would reach it; the accounts' own module
    // removes them later in the same reset, and a reset that stops in between
    // must not leave them role-less.
    const composition = createDemoComposition({
      em: untouchable,
      isPresent: (moduleId) => moduleId === 'admin_users' || moduleId === 'admin_roles',
    });
    const result = await composition.withdraw();
    expect(result.applied).toEqual(['demo administrators take their roles']);
  });
});
