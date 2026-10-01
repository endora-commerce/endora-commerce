import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';

import {
  createDemoComposition,
  DEMO_COMPOSITION_STEP_NAMES,
  DEMO_FOUNDATION_STEP_NAMES,
} from './composition.js';

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
    expect(result.skipped.map((entry) => entry.step)).toEqual(
      [...DEMO_COMPOSITION_STEP_NAMES].reverse(),
    );
  });
});

describe('the step list is the demo shop the platform repository has always seeded', () => {
  it('keeps the role assignment and the channel bridges among its steps', () => {
    // The two whose absence was the reported defect: administrators with no
    // role, and products no channel sold.
    expect(DEMO_COMPOSITION_STEP_NAMES).toContain('demo administrators take their roles');
    expect(DEMO_COMPOSITION_STEP_NAMES).toContain('product↔category and channel↔product bridges');
  });

  it('keeps the sales channels as the one foundation step (§5.5a)', () => {
    expect(DEMO_FOUNDATION_STEP_NAMES).toEqual(["the demo's two sales channels"]);
  });
});
