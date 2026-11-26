import { describe, expect, it } from 'vitest';
import type { CommandMiddlewareDeclaration, ModuleOrigin } from '@endora-commerce/contracts';
import {
  CommandMiddlewareOrderContradictionError,
  CommandMiddlewareOriginError,
  CommandMiddlewarePhaseMismatchError,
  DuplicateCommandMiddlewareError,
  StaleCommandMiddlewareOrderError,
  UndeclaredCommandMiddlewareError,
  UnorderedCommandMiddlewareError,
  UnregisteredCommandMiddlewareError,
} from './errors.js';
import { CommandMiddlewareRegistry, type CommandMiddlewareCompositionInput } from './registry.js';
import type { CommandMiddlewareEntry } from './types.js';

/**
 * `specs/189-command-middleware/` T010 (FR-002, FR-004, FR-031): registering
 * and sealing the command-middleware registry, and every composition refusal of
 * `contracts/command-middleware-api.md` §5.
 */

type Declared = CommandMiddlewareDeclaration & { readonly moduleId: string };

const admit = (id: string): CommandMiddlewareEntry => ({ id, phase: 'admit', admit: () => undefined });
const observe = (id: string): CommandMiddlewareEntry => ({ id, phase: 'observe', observe: () => undefined });

function input(
  declarations: readonly Declared[],
  extra: Partial<CommandMiddlewareCompositionInput> = {},
): CommandMiddlewareCompositionInput {
  const origins: Record<string, ModuleOrigin> = {};
  for (const declaration of declarations) origins[declaration.moduleId] = 'core';
  return { declarations, moduleDependencies: {}, origins, ...extra, ...(extra.origins ? { origins: { ...origins, ...extra.origins } } : {}) };
}

function catchError(fn: () => void): Error {
  try {
    fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected a throw');
}

describe('CommandMiddlewareRegistry — register and seal (189 T010)', () => {
  it('seals a matching declaration and registration, and plans it', () => {
    const registry = new CommandMiddlewareRegistry();
    registry.register('acme_hold', [admit('hold'), observe('timing')]);
    registry.seal(
      input([
        { moduleId: 'acme_hold', id: 'hold', phase: 'admit', actions: ['organization.'] },
        { moduleId: 'acme_hold', id: 'timing', phase: 'observe', actions: '*' },
      ]),
    );
    expect(registry.isSealed).toBe(true);
    expect(registry.plan()).toEqual([
      { moduleId: 'acme_hold', id: 'hold', phase: 'admit', origin: 'core', position: 1, actions: ['organization.'] },
      { moduleId: 'acme_hold', id: 'timing', phase: 'observe', origin: 'core', position: null, actions: '*' },
    ]);
  });

  it('refuses a registration after sealing, and a second seal', () => {
    const registry = new CommandMiddlewareRegistry();
    registry.seal(input([]));
    expect(() => registry.register('acme_hold', [admit('hold')])).toThrow(/sealed.*acme_hold.*hold/);
    expect(() => registry.seal(input([]))).toThrow(/already sealed/);
  });

  it('refuses a non-kebab id at registration', () => {
    const registry = new CommandMiddlewareRegistry();
    expect(() => registry.register('acme_hold', [admit('Hold_It')])).toThrow(/acme_hold.*Hold_It.*kebab/);
  });

  it('refuses one id registered twice by a module', () => {
    const registry = new CommandMiddlewareRegistry();
    const error = catchError(() => registry.register('acme_hold', [admit('hold'), observe('hold')]));
    expect(error).toBeInstanceOf(DuplicateCommandMiddlewareError);
    expect(error.message).toMatch(/acme_hold.*hold/);
  });

  it('refuses a registration with no declaration', () => {
    const registry = new CommandMiddlewareRegistry();
    registry.register('acme_hold', [admit('hold')]);
    const error = catchError(() => registry.seal(input([], { origins: { acme_hold: 'core' } })));
    expect(error).toBeInstanceOf(UndeclaredCommandMiddlewareError);
    expect(error.message).toMatch(/acme_hold.*hold.*commandMiddleware/);
  });

  it('refuses a declaration with no registration', () => {
    const registry = new CommandMiddlewareRegistry();
    const error = catchError(() =>
      registry.seal(input([{ moduleId: 'acme_hold', id: 'hold', phase: 'admit', actions: '*' }])),
    );
    expect(error).toBeInstanceOf(UnregisteredCommandMiddlewareError);
    expect(error.message).toMatch(/acme_hold.*hold.*ctx\.commandMiddleware/);
  });

  it('ignores the declaration of a module this composition does not compose', () => {
    const registry = new CommandMiddlewareRegistry();
    expect(() =>
      registry.seal({
        declarations: [{ moduleId: 'acme_absent', id: 'hold', phase: 'admit', actions: '*' }],
        moduleDependencies: {},
        origins: {},
      }),
    ).not.toThrow();
  });

  it('refuses a phase mismatch between declaration and registration', () => {
    const registry = new CommandMiddlewareRegistry();
    registry.register('acme_hold', [observe('hold')]);
    const error = catchError(() =>
      registry.seal(input([{ moduleId: 'acme_hold', id: 'hold', phase: 'admit', actions: '*' }])),
    );
    expect(error).toBeInstanceOf(CommandMiddlewarePhaseMismatchError);
    expect(error.message).toMatch(/acme_hold.*hold.*admit.*observe/);
  });

  it('refuses an admit declared by a module of origin package, citing D-296.3', () => {
    const registry = new CommandMiddlewareRegistry();
    registry.register('acme_pkg', [admit('hold')]);
    const error = catchError(() =>
      registry.seal(
        input([{ moduleId: 'acme_pkg', id: 'hold', phase: 'admit', actions: '*' }], { origins: { acme_pkg: 'package' } }),
      ),
    );
    expect(error).toBeInstanceOf(CommandMiddlewareOriginError);
    expect(error.message).toMatch(/acme_pkg.*hold.*D-296\.3/);
  });

  it('accepts an observe from a package, and an admit from a deployment overlay', () => {
    const registry = new CommandMiddlewareRegistry();
    registry.register('acme_pkg', [observe('timing')]);
    registry.register('acme_overlay', [admit('hold')]);
    registry.seal(
      input(
        [
          { moduleId: 'acme_pkg', id: 'timing', phase: 'observe', actions: '*' },
          { moduleId: 'acme_overlay', id: 'hold', phase: 'admit', actions: '*' },
        ],
        { origins: { acme_pkg: 'package', acme_overlay: 'deployment' } },
      ),
    );
    expect(registry.plan().map((entry) => [entry.moduleId, entry.origin])).toEqual([
      ['acme_overlay', 'deployment'],
      ['acme_pkg', 'package'],
    ]);
  });
});

describe('CommandMiddlewareRegistry — admit order (189 T010, FR-030, FR-031)', () => {
  function twoAdmits(
    a: CommandMiddlewareDeclaration['actions'],
    b: CommandMiddlewareDeclaration['actions'],
    extra: Partial<CommandMiddlewareCompositionInput> = {},
  ): CommandMiddlewareRegistry {
    const registry = new CommandMiddlewareRegistry();
    registry.register('acme_b', [admit('rule')]);
    registry.register('acme_a', [admit('rule')]);
    registry.seal(
      input(
        [
          { moduleId: 'acme_a', id: 'rule', phase: 'admit', actions: a },
          { moduleId: 'acme_b', id: 'rule', phase: 'admit', actions: b },
        ],
        extra,
      ),
    );
    return registry;
  }

  it('refuses two overlapping admits from modules with no dependency path, naming both and the remedy', () => {
    const error = catchError(() => twoAdmits('*', ['quote.convert']));
    expect(error).toBeInstanceOf(UnorderedCommandMiddlewareError);
    expect(error.message).toMatch(/acme_a#rule.*acme_b#rule/);
    expect(error.message).toMatch(/commandMiddlewareOrder/);
    expect(error.message).toMatch(/divergence\.ts/);
  });

  it('detects overlap between a prefix and an action under it', () => {
    expect(() => twoAdmits(['organization.'], ['organization.admin_patch'])).toThrow(UnorderedCommandMiddlewareError);
  });

  it('accepts two disjoint admits with no order, deterministically by module id', () => {
    const registry = twoAdmits(['organization.'], ['quote.']);
    expect(registry.plan().map((entry) => entry.moduleId)).toEqual(['acme_a', 'acme_b']);
  });

  it('orders by the deployment tie-break, first runs first', () => {
    const registry = twoAdmits('*', '*', { commandMiddlewareOrder: ['acme_b', 'acme_a'] });
    expect(registry.plan().map((entry) => [entry.moduleId, entry.position])).toEqual([
      ['acme_b', 1],
      ['acme_a', 2],
    ]);
  });

  it('orders by the dependency graph, and refuses an order entry that contradicts it', () => {
    const registry = twoAdmits('*', '*', { moduleDependencies: { acme_a: ['acme_b'], acme_b: [] } });
    expect(registry.plan().map((entry) => entry.moduleId)).toEqual(['acme_b', 'acme_a']);
    const error = catchError(() =>
      twoAdmits('*', '*', { moduleDependencies: { acme_a: ['acme_b'], acme_b: [] }, commandMiddlewareOrder: ['acme_a', 'acme_b'] }),
    );
    expect(error).toBeInstanceOf(CommandMiddlewareOrderContradictionError);
    expect(error.message).toMatch(/acme_b.*acme_a/);
  });

  it('refuses a stale order entry naming a module that contributes no admit', () => {
    const error = catchError(() => twoAdmits('*', '*', { commandMiddlewareOrder: ['acme_a', 'acme_b', 'acme_gone'] }));
    expect(error).toBeInstanceOf(StaleCommandMiddlewareOrderError);
    expect(error.message).toMatch(/acme_gone/);
  });

  it('never orders observers: listed by module id, then registration order', () => {
    const registry = new CommandMiddlewareRegistry();
    registry.register('acme_z', [observe('one')]);
    registry.register('acme_y', [observe('two'), observe('one')]);
    registry.seal(
      input([
        { moduleId: 'acme_z', id: 'one', phase: 'observe', actions: '*' },
        { moduleId: 'acme_y', id: 'one', phase: 'observe', actions: '*' },
        { moduleId: 'acme_y', id: 'two', phase: 'observe', actions: '*' },
      ]),
    );
    expect(registry.plan().map((entry) => `${entry.moduleId}#${entry.id}`)).toEqual(['acme_y#two', 'acme_y#one', 'acme_z#one']);
  });
});
