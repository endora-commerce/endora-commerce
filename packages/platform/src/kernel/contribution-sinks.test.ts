import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '../events/index.js';
import { createRootContainer, registerValues } from './container.js';
import {
  resetDeclaredContributionsForTesting,
  provideDeclaredContributions,
} from './contribution-sinks.js';
import {
  createModuleContext,
  createModuleRegistrationSink,
  type ModuleContext,
} from './module-context.js';

/**
 * **A contribution to a registry that was never registered is dropped**
 * (owner ruling, 2026-09-12; feature 117, A4).
 *
 * One proof per shape the mechanism claims, and — more importantly — one per
 * shape it claims **not** to touch. The value of this file is almost entirely
 * in the second set: "an unregistered name resolves to something" would be a
 * catastrophe, turning every typo and every genuinely missing dependency into
 * a silent `undefined`, and the only thing standing between this mechanism and
 * that is the conjunction asserted below.
 *
 * The fixtures enter at the top of the analysis (issue #130): a real container,
 * a real `ModuleContext`, and the declaration set supplied the way the
 * lifecycle supplies it. Nothing here is handed a pre-computed verdict.
 */

const MODULE_ID = 'fixture_contributor';
const SINK_NAME = 'fixtureToolRegistry';

function contextFor(
  moduleId: string,
  container = createRootContainer(),
): { ctx: ModuleContext; container: ReturnType<typeof createRootContainer> } {
  const ctx = createModuleContext({
    module: { id: moduleId, version: '1.0.0' },
    container,
    eventBus: new EventBus(),
    sink: createModuleRegistrationSink(),
    log: { info: () => {}, warn: () => {}, error: () => {} },
  });
  return { ctx, container };
}

afterEach(() => {
  resetDeclaredContributionsForTesting();
});

describe('a declared contribution whose registry is absent', () => {
  it('resolves to a sink whose methods are no-ops, instead of throwing', () => {
    provideDeclaredContributions(() => [{ moduleId: MODULE_ID, name: SINK_NAME }]);
    const { ctx } = contextFor(MODULE_ID);

    const registry = ctx.cradle<{ [SINK_NAME]: { register: (tool: unknown) => void } }>()[
      SINK_NAME
    ];

    // The defect this replaces: the read above was an `AwilixResolutionError`
    // that `runBootHooks` re-threw as `ModuleCompositionError`, exiting 1.
    expect(registry).toBeDefined();
    expect(() => registry.register({ name: 'a_tool' })).not.toThrow();
  });

  it('drops a call of any shape, because the platform cannot know the interface', () => {
    provideDeclaredContributions(() => [{ moduleId: MODULE_ID, name: SINK_NAME }]);
    const { ctx } = contextFor(MODULE_ID);
    const registry = ctx.cradle<Record<string, Record<string, (...a: unknown[]) => unknown>>>()[
      SINK_NAME
    ]!;

    // `promptActionBulkProgressRegistry.register(moduleId, reader)` is a
    // two-argument call under the same declaration kind as the one-argument
    // `promptActionToolRegistry.register(tool)`. The registry class belongs to
    // a module and the platform may not import one (D-52/D-53), so the sink
    // answers the *contract* — push-only — rather than a known shape.
    expect(registry['register']!('catalog', { read: () => undefined })).toBeUndefined();
    expect(registry['anythingElse']!()).toBeUndefined();
  });
});

describe('what the mechanism deliberately does not touch', () => {
  it('still throws for an unregistered name this module did not declare', () => {
    provideDeclaredContributions(() => [{ moduleId: MODULE_ID, name: SINK_NAME }]);
    const { ctx } = contextFor(MODULE_ID);

    // The narrowness that makes the whole thing safe. A typo, a genuinely
    // missing dependency, a port whose owner is absent — all unchanged.
    expect(() => ctx.cradle<Record<string, unknown>>()['somethingElseEntirely']).toThrow();
    expect(() => ctx.cradle<Record<string, unknown>>()['fixtureToolRegistryy']).toThrow();
  });

  it('still throws for a name another module declared', () => {
    provideDeclaredContributions(() => [{ moduleId: 'some_other_module', name: SINK_NAME }]);
    const { ctx } = contextFor(MODULE_ID);

    // Keyed on `(module, name)`, so a module gets the drop only for an edge its
    // own manifest declares. Otherwise one module's declaration would silence
    // every other module's missing dependency of the same name.
    expect(() => ctx.cradle<Record<string, unknown>>()[SINK_NAME]).toThrow();
  });

  it('still throws when no manifest set has been supplied at all', () => {
    // Fail-closed, and not the same state as an empty declaration set: a
    // process that never established manifests must not have its resolutions
    // quietly answered from nothing. This is the pre-ruling behaviour, kept for
    // exactly that case.
    const { ctx } = contextFor(MODULE_ID);
    expect(() => ctx.cradle<Record<string, unknown>>()[SINK_NAME]).toThrow();
  });

  it('leaves a registered name alone, declaration or not', () => {
    provideDeclaredContributions(() => [{ moduleId: MODULE_ID, name: SINK_NAME }]);
    const container = createRootContainer();
    const pushed: unknown[] = [];
    registerValues(container, {
      [SINK_NAME]: { register: (tool: unknown) => pushed.push(tool) },
    });
    const { ctx } = contextFor(MODULE_ID, container);

    // The other direction of the ruling, and the one a careless implementation
    // breaks: dropping unconditionally would empty the assistant's catalogue in
    // every complete composition while passing every test above.
    ctx
      .cradle<{ [SINK_NAME]: { register: (tool: unknown) => void } }>()
      [SINK_NAME].register({ name: 'a_tool' });
    expect(pushed).toEqual([{ name: 'a_tool' }]);
  });
});
