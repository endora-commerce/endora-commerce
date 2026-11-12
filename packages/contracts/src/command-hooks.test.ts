import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  COMMAND_HOOK_ERROR_CODES,
  HookableActionDeclarationSchema,
  OUTBOX_STRING_MAX_LENGTH,
  outboxDataViolations,
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

describe('outboxDataViolations (176 P3, FR-031)', () => {
  it('passes ids, codes, booleans, counts, dates, field names and arrays of them', () => {
    expect(
      outboxDataViolations({
        organizationId: '6f1c1f0e-9a3b-4c55-8f0e-1d2a3b4c5d6e',
        status: 'pending_review',
        isPersonal: false,
        lineCount: 3,
        committedAt: '2026-11-12T10:00:00.000Z',
        changedFields: ['name', 'extensions.acme_erp.changedFields'],
        parentId: null,
      }),
    ).toEqual([]);
  });

  it('names — never quotes — every key whose value is not list 1', () => {
    const violations = outboxDataViolations({
      nested: { name: 'Acme' } as never,
      nestedInArray: [{ a: 1 }] as never,
      name: 'Acme Trading Sp. z o.o.',
      long: 'x'.repeat(OUTBOX_STRING_MAX_LENGTH + 1),
      inArray: ['ok', 'two words'],
      notFinite: Number.NaN,
      ok: 'code',
    });
    expect(violations.map((violation) => violation.key)).toEqual([
      'inArray',
      'long',
      'name',
      'nested',
      'nestedInArray',
      'notFinite',
    ]);
    expect(JSON.stringify(violations)).not.toContain('Acme');
  });
});

describe('outboxDataViolations — e-mail (176 P3, architect ruling on #1060)', () => {
  it('refuses an @ in a string: an e-mail is the one personal datum that has a code’s shape', () => {
    expect(outboxDataViolations({ contact: 'jan.kowalski@example.com', ids: ['ok', 'a@b'] })).toEqual([
      { key: 'contact', issue: 'not-code-shaped' },
      { key: 'ids', issue: 'not-code-shaped' },
    ]);
  });
});
