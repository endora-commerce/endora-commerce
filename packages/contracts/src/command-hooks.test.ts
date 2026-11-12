import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  COMMAND_HOOK_ERROR_CODES,
  HookableActionDeclarationSchema,
  hookableAction,
  toHookableActionDeclaration,
  type HookableActionRef,
} from './command-hooks.js';

describe('hookableAction (176 T020, FR-010)', () => {
  it('builds a frozen ref with the action, object type and phases', () => {
    const ref = hookableAction<{ id: string }>('widget.create', 'widget', ['beforeCommit']);
    expect(ref).toEqual({ action: 'widget.create', objectType: 'widget', phases: ['beforeCommit'] });
    expect(Object.isFrozen(ref)).toBe(true);
    expect(Object.isFrozen(ref.phases)).toBe(true);
  });

  it('carries its data types to a hook author through the phantom member', () => {
    const ref = hookableAction<{ id: string }, { widgetId: string }>('widget.create', 'widget', [
      'beforeCommit',
      'afterCommit',
    ]);
    expectTypeOf(ref).toEqualTypeOf<HookableActionRef<{ id: string }, { widgetId: string }>>();
    expectTypeOf<NonNullable<typeof ref.__types>['data']>().toEqualTypeOf<{ id: string }>();
  });

  it('refuses a malformed action, an empty phase list and a repeated phase', () => {
    expect(() => hookableAction('widget', 'widget', ['beforeCommit'])).toThrow();
    expect(() => hookableAction('Widget.Create', 'widget', ['beforeCommit'])).toThrow();
    expect(() => hookableAction('widget.create', 'widget', [])).toThrow();
    expect(() => hookableAction('widget.create', 'widget', ['beforeCommit', 'beforeCommit'])).toThrow();
  });

  it('accepts a multi-segment action, as `organization.tax_id.change` is spelled', () => {
    expect(hookableAction('organization.tax_id.change', 'organization', ['beforeCommit']).action).toBe(
      'organization.tax_id.change',
    );
  });
});

describe('toHookableActionDeclaration', () => {
  it('derives the manifest entry, which the declaration schema accepts', () => {
    const declaration = toHookableActionDeclaration(
      hookableAction('widget.update', 'widget', ['beforeCommit', 'afterCommit']),
    );
    expect(declaration).toEqual({
      action: 'widget.update',
      objectType: 'widget',
      phases: ['beforeCommit', 'afterCommit'],
    });
    expect(HookableActionDeclarationSchema.parse(declaration)).toEqual(declaration);
  });

  it('refuses an unknown phase and an extra key', () => {
    expect(() =>
      HookableActionDeclarationSchema.parse({ action: 'a.b', objectType: 'a', phases: ['duringCommit'] }),
    ).toThrow();
    expect(() =>
      HookableActionDeclarationSchema.parse({ action: 'a.b', objectType: 'a', phases: ['beforeCommit'], extra: 1 }),
    ).toThrow();
  });
});

describe('COMMAND_HOOK_ERROR_CODES', () => {
  it('names the three platform codes', () => {
    expect(Object.values(COMMAND_HOOK_ERROR_CODES).sort()).toEqual([
      'COMMAND_EXTENSION_UNCLAIMED',
      'COMMAND_HOOK_CYCLE',
      'COMMAND_HOOK_DATA_MISSING',
    ]);
  });
});
