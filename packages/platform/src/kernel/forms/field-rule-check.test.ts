import { describe, expect, it } from 'vitest';
import {
  FIELD_RULE_CODES,
  PRESENTATION_OVERRIDES,
  defineFieldSet,
  hookableAction,
  type FieldOverride,
  type ModuleOrigin,
} from '@endora-commerce/contracts';
import { FIELD_CONDITION_VECTORS } from '@endora-commerce/contracts/admin-forms.vectors';
import type { CommandActor } from '../../commands/command.js';
import { HttpError } from '../../http/error-envelope.js';
import type { AdminPermissionChecker } from '../ports/require-admin.js';
import { fieldRuleCheckFor } from './field-rule-check.js';
import { formatValidator } from './formats.js';
import { sealForms } from './seal.js';
import type { FieldProjection, FieldScopedProjection, FieldSetWriter } from './types.js';

/**
 * `specs/193-admin-form-extensions/` T020 (FR-041 – FR-045, FR-124, D-300.3,
 * D-300.4; `contracts/field-rules.md` §5): the field-rule check holds a
 * writer's projection to the present modules' tightened rules.
 */

const SET = defineFieldSet({
  id: 'widget',
  ownerModuleId: 'widgets',
  fields: [
    { key: 'name', type: 'string', required: true, bounds: { maxLength: 100 }, accepts: ['label', 'validation'] },
    { key: 'code', type: 'string', required: false, bounds: { maxLength: 32 }, accepts: [...PRESENTATION_OVERRIDES, 'validation', 'requiredWhen', 'writePermission'] },
    { key: 'kind', type: 'enum', options: ['a', 'b', 'c'], required: false, accepts: ['validation', 'requiredWhen'] },
    { key: 'size', type: 'decimal', required: false, accepts: ['validation'] },
    { key: 'emails', type: 'string[]', required: false, accepts: ['validation', 'requiredWhen', 'writePermission'] },
    { key: 'secret', type: 'string', required: false, writePermission: 'widgets:secret', accepts: [] },
    { key: 'title', type: 'string', required: false, accepts: ['validation'] },
  ],
});

const CREATE = hookableAction<Record<string, unknown>>('widget.create', 'widget', ['beforeCommit']);
const UPDATE = hookableAction<{ after: Record<string, unknown>; changed: string[] }>('widget.update', 'widget', ['beforeCommit']);
const SCOPED = hookableAction<{ scopes: FieldScopedProjection[] }>('widget.scoped.save', 'widget', ['beforeCommit']);
const BULK = hookableAction<{ after: Record<string, unknown>; changed: string[] }>('widget.bulk.item', 'widget', ['beforeCommit']);
const KEYS = SET.fields.map((field) => field.key);

const WRITERS: FieldSetWriter[] = [
  { on: CREATE, mode: 'create', writes: KEYS, project: (data) => ({ before: null, after: data as Record<string, unknown> }) },
  { on: UPDATE, mode: 'update', writes: KEYS, project: (data) => data as FieldProjection },
  { on: SCOPED, mode: 'update', scoped: true, writes: ['title', 'code'], project: (data) => (data as { scopes: FieldScopedProjection[] }).scopes },
  { on: BULK, mode: 'update', ruleCheckOnly: true, writes: KEYS, project: (data) => data as FieldProjection },
];

const ORIGINS: Record<string, ModuleOrigin> = { widgets: 'core', acme: 'deployment', acme_two: 'deployment' };

type OverrideInput = { readonly moduleId: string; readonly override: Record<string, unknown> };

function sealed(overrides: readonly OverrideInput[], extra: { formats?: { moduleId: string; id: string; validate: (v: string) => boolean }[] } = {}) {
  return sealForms({
    fieldSets: [{ moduleId: 'widgets', set: SET }],
    adminForms: [],
    formOverrides: overrides.map(({ moduleId, override }) => ({ moduleId, override: { reason: 'Because.', ...override } as FieldOverride })),
    inputControls: [{ moduleId: 'acme_two', control: { id: 'acme_two.nip', outputType: 'string', format: 'acme_two.nip' } }],
    hookableActions: ['widget.create', 'widget.update', 'widget.scoped.save'].map((action) => ({ moduleId: 'widgets', action, objectType: 'widget', phases: ['beforeCommit' as const] })),
    moduleDependencies: { widgets: [], acme: ['widgets'], acme_two: ['widgets'] },
    permissionCodes: ['widgets:secret', 'acme:emails'],
    origins: ORIGINS,
    installedPackageNames: {},
    writers: [{ moduleId: 'widgets', set: SET, writers: WRITERS }],
    formats: extra.formats ?? [{ moduleId: 'acme_two', id: 'acme_two.nip', validate: (v) => /^\d{10}$/.test(v) }],
  });
}

const admin: CommandActor = { actorAdminUserId: 'admin-1', impersonatedCustomerAccountId: null, actorCustomerAccountId: null, kind: 'admin' };
const system: CommandActor = { actorAdminUserId: null, impersonatedCustomerAccountId: null, actorCustomerAccountId: null, kind: 'system' };
const buyer: CommandActor = { actorAdminUserId: null, impersonatedCustomerAccountId: null, actorCustomerAccountId: 'cust-1', kind: 'customer' };
const impersonating: CommandActor = { actorAdminUserId: 'admin-1', impersonatedCustomerAccountId: 'cust-1', actorCustomerAccountId: null, kind: 'customer' };
const apiKey: CommandActor = { actorAdminUserId: null, impersonatedCustomerAccountId: null, actorCustomerAccountId: null, kind: 'api_key' };

function checker(granted: readonly string[] = []): AdminPermissionChecker {
  return { hasPermission: async (_id, code) => granted.includes(code), isActiveAdministrator: async () => true };
}

interface Options {
  present?: (moduleId: string) => boolean;
  granted?: readonly string[];
  noChecker?: boolean;
}

function checkOf(overrides: Parameters<typeof sealed>[0], action: string, options: Options = {}, extra: Parameters<typeof sealed>[1] = {}) {
  const model = sealed(overrides, extra);
  return fieldRuleCheckFor(model.writersByAction.get(action) ?? [], {
    isPresent: options.present ?? (() => true),
    permissionChecker: () => (options.noChecker ? undefined : checker(options.granted)),
    validateFormat: formatValidator(model.formats),
  });
}

async function refusal(promise: Promise<unknown> | unknown): Promise<HttpError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpError) return error;
    throw error;
  }
  throw new Error('the check did not refuse');
}

const ctx = (action: string, data: unknown, actor: CommandActor = admin) => ({ action, objectType: 'widget', objectId: 'w-1', data, actor });
const detailsOf = (error: HttpError) => error.details as unknown as { path: string; code: string; params?: Record<string, unknown>; message: string }[];

describe('fieldRuleCheckFor — the codes (193 T020, FIELD_RULE_CODES)', () => {
  const overrides = [
    { moduleId: 'acme', override: { target: 'widget.code', validation: { required: true, minLength: 3, maxLength: 10, pattern: '^[A-Z0-9]+$' } } },
    { moduleId: 'acme', override: { target: 'widget.size', validation: { min: 1, max: 10 } } },
    { moduleId: 'acme', override: { target: 'widget.kind', validation: { options: ['a', 'b'] } } },
    { moduleId: 'acme', override: { target: 'widget.emails', validation: { format: 'email' } } },
  ];
  const cases: [string, Record<string, unknown>, string][] = [
    ['required', { name: 'N' }, 'code'],
    ['too_short', { name: 'N', code: 'AB' }, 'code'],
    ['too_long', { name: 'N', code: 'ABCDEFGHIJK' }, 'code'],
    ['pattern', { name: 'N', code: 'abc' }, 'code'],
    ['below_min', { name: 'N', code: 'ABC', size: 0 }, 'size'],
    ['above_max', { name: 'N', code: 'ABC', size: '11' }, 'size'],
    ['not_an_option', { name: 'N', code: 'ABC', kind: 'c' }, 'kind'],
    ['format', { name: 'N', code: 'ABC', emails: ['anna@example.com', 'anna'] }, 'emails'],
  ];

  it('covers every FIELD_RULE_CODES entry', () => {
    expect(cases.map(([code]) => code).sort()).toEqual([...FIELD_RULE_CODES].sort());
  });

  for (const [code, after, path] of cases) {
    it(`${code}`, async () => {
      const error = await refusal(checkOf(overrides, 'widget.create')!(ctx('widget.create', after)));
      expect(error).toMatchObject({ statusCode: 422, code: 'FIELD_RULE_VIOLATION' });
      expect(detailsOf(error)).toEqual([expect.objectContaining({ path, code })]);
      expect(detailsOf(error)[0]!.message.length).toBeGreaterThan(0);
    });
  }

  it('passes a value that keeps every rule', async () => {
    await expect(
      checkOf(overrides, 'widget.create')!(ctx('widget.create', { name: 'N', code: 'ABC1', size: 5, kind: 'a', emails: ['anna@example.com'] })),
    ).resolves.toBeUndefined();
  });

  it('reports every violation at once, with the limit', async () => {
    const error = await refusal(checkOf(overrides, 'widget.create')!(ctx('widget.create', { name: 'N', code: 'AB', size: 11 })));
    expect(detailsOf(error)).toEqual([
      { path: 'code', code: 'too_short', params: { limit: 3 }, message: expect.any(String) },
      { path: 'size', code: 'above_max', params: { limit: 10 }, message: expect.any(String) },
    ]);
  });

  it('uses the declaring module’s messageKey as the sentence key when one is declared', async () => {
    const check = checkOf([{ moduleId: 'acme', override: { target: 'widget.code', validation: { maxLength: 3, messageKey: 'rules.codeTooLong' } } }], 'widget.create')!;
    const error = await refusal(check(ctx('widget.create', { name: 'N', code: 'ABCD' })));
    expect(detailsOf(error)).toEqual([expect.objectContaining({ path: 'code', code: 'too_long', params: { limit: 3 } })]);
  });
});

describe('fieldRuleCheckFor — merging, conditions, presence (193 T020)', () => {
  it('merges two modules’ rules by conjunction: the tighter bound binds', async () => {
    const check = checkOf(
      [
        { moduleId: 'acme', override: { target: 'widget.code', validation: { maxLength: 10 } } },
        { moduleId: 'acme_two', override: { target: 'widget.code', validation: { maxLength: 5, pattern: '^A' } } },
      ],
      'widget.create',
    )!;
    const error = await refusal(check(ctx('widget.create', { name: 'N', code: 'BBBBBB' })));
    expect(detailsOf(error)).toEqual([
      expect.objectContaining({ path: 'code', code: 'too_long', params: { limit: 5 } }),
      expect.objectContaining({ path: 'code', code: 'pattern' }),
    ]);
  });

  it('requiredWhen: required while its condition holds over the after-state', async () => {
    const check = checkOf([{ moduleId: 'acme', override: { target: 'widget.emails', requiredWhen: { field: 'kind', op: 'equals', value: 'b' } } }], 'widget.create')!;
    await expect(check(ctx('widget.create', { name: 'N', kind: 'a' }))).resolves.toBeUndefined();
    const error = await refusal(check(ctx('widget.create', { name: 'N', kind: 'b', emails: [] })));
    expect(detailsOf(error)).toEqual([expect.objectContaining({ path: 'emails', code: 'required' })]);
  });

  it('evaluates requiredWhen with the shared condition vectors (SC-002)', async () => {
    for (const vector of FIELD_CONDITION_VECTORS) {
      const fields = new Set<string>();
      const walk = (c: unknown): void => {
        const node = c as Record<string, unknown>;
        if (Array.isArray(node['all'])) (node['all'] as unknown[]).forEach(walk);
        else if (Array.isArray(node['any'])) (node['any'] as unknown[]).forEach(walk);
        else if (node['not'] !== undefined) walk(node['not']);
        else fields.add(node['field'] as string);
      };
      walk(vector.condition);
      // The vectors name their own fields; a set declaring them is built per vector.
      const set = defineFieldSet({
        id: 'vector',
        ownerModuleId: 'vectors',
        fields: [
          { key: 'target', type: 'string', required: false, accepts: ['requiredWhen'] },
          ...[...fields].filter((f) => /^[a-z][a-zA-Z0-9]*$/.test(f)).map((key) => ({ key, type: 'string' as const, required: false, accepts: [] })),
        ],
      });
      const on = hookableAction<Record<string, unknown>>('vector.create', 'vector', ['beforeCommit']);
      const model = sealForms({
        fieldSets: [{ moduleId: 'vectors', set }],
        adminForms: [],
        formOverrides: [{ moduleId: 'acme_erp', override: { target: 'vector.target', requiredWhen: vector.condition, reason: 'Because.' } as FieldOverride }],
        inputControls: [],
        hookableActions: [{ moduleId: 'vectors', action: 'vector.create', objectType: 'vector', phases: ['beforeCommit'] }],
        moduleDependencies: { vectors: [], acme_erp: ['vectors'] },
        permissionCodes: [],
        origins: { vectors: 'core', acme_erp: 'deployment' },
        installedPackageNames: {},
        writers: [{ moduleId: 'vectors', set, writers: [{ on, mode: 'create', writes: set.fields.map((f) => f.key), project: (data) => ({ before: null, after: data as Record<string, unknown> }) }] }],
        formats: [],
      });
      const check = fieldRuleCheckFor(model.writersByAction.get('vector.create')!, {
        isPresent: () => true,
        permissionChecker: () => undefined,
        validateFormat: () => true,
      })!;
      const outcome = await Promise.resolve(check({ action: 'vector.create', objectType: 'vector', objectId: 'v', data: vector.values, actor: admin })).then(
        () => false,
        () => true,
      );
      expect(outcome, vector.name).toBe(vector.expected);
    }
  });

  it('skips a rule whose declaring module is switched off (FR-052) — the projection is not even run', async () => {
    let projected = 0;
    // The scoped writer writes no field with an owner writePermission, so the
    // only rule on it is the switched-off module's.
    const model = sealed([{ moduleId: 'acme', override: { target: 'widget.title', validation: { maxLength: 2 } } }]);
    const writers = model.writersByAction.get('widget.scoped.save')!.map((w) => ({
      ...w,
      writer: { ...w.writer, project: (data: unknown) => (projected++, w.writer.project(data)) },
    }));
    const check = fieldRuleCheckFor(writers, { isPresent: (id) => id !== 'acme', permissionChecker: () => undefined, validateFormat: () => true })!;
    await expect(check(ctx('widget.scoped.save', { scopes: [{ scope: null, after: { title: 'ABCD' }, changed: ['title'] }] }))).resolves.toBeUndefined();
    expect(projected).toBe(0);
  });

  it('does not enforce a control’s format while the control’s module is off (R-14)', async () => {
    const overrides = [{ moduleId: 'acme', override: { target: 'widget.code', control: 'acme_two.nip' } }];
    const on = checkOf(overrides, 'widget.create')!;
    expect(detailsOf(await refusal(on(ctx('widget.create', { name: 'N', code: '123' }))))).toEqual([expect.objectContaining({ path: 'code', code: 'format' })]);
    const off = checkOf(overrides, 'widget.create', { present: (id) => id !== 'acme_two' })!;
    await expect(off(ctx('widget.create', { name: 'N', code: '123' }))).resolves.toBeUndefined();
  });

  it('answers undefined for an action no rule applies to: the common case costs one lookup', () => {
    // The scoped writer writes `title` and `code`, neither carrying an owner writePermission.
    expect(checkOf([], 'widget.scoped.save')).toBeUndefined();
    expect(checkOf([{ moduleId: 'acme', override: { target: 'widget.code', labelKey: 'a.b' } }], 'widget.scoped.save')).toBeUndefined();
    expect(checkOf([{ moduleId: 'acme', override: { target: 'widget.emails', validation: { maxLength: 3 } } }], 'widget.scoped.save')).toBeUndefined();
    expect(checkOf([{ moduleId: 'acme', override: { target: 'widget.code', validation: { maxLength: 3 } } }], 'widget.unknown')).toBeUndefined();
  });

  it('is present for an owner writePermission alone', () => {
    expect(checkOf([], 'widget.update')).toBeDefined();
  });
});

describe('fieldRuleCheckFor — actors and retroactivity (193 T020, D-300.3, D-300.4)', () => {
  const required = [{ moduleId: 'acme', override: { target: 'widget.code', validation: { required: true, maxLength: 3 } } }];

  it('skips a buyer’s self-service write (D-300.3), and binds an impersonating administrator', async () => {
    const check = checkOf(required, 'widget.create')!;
    await expect(check(ctx('widget.create', { name: 'N' }, buyer))).resolves.toBeUndefined();
    await refusal(check(ctx('widget.create', { name: 'N' }, impersonating)));
  });

  it('binds an operator, a system and an API-key write', async () => {
    const check = checkOf(required, 'widget.create')!;
    for (const actor of [admin, system, apiKey]) {
      expect((await refusal(check(ctx('widget.create', { name: 'N' }, actor)))).code).toBe('FIELD_RULE_VIOLATION');
    }
  });

  it('checks required on create, and on an update only when it changes or clears the field (D-300.4)', async () => {
    const check = checkOf(required, 'widget.update')!;
    await expect(check(ctx('widget.update', { after: { name: 'Renamed' }, changed: ['name'] }))).resolves.toBeUndefined();
    const cleared = await refusal(check(ctx('widget.update', { after: { name: 'N', code: '' }, changed: ['code'] })));
    expect(detailsOf(cleared)).toEqual([expect.objectContaining({ path: 'code', code: 'required' })]);
  });

  it('holds an unchanged stored value to no new rule on an update (D-300.4)', async () => {
    const check = checkOf(required, 'widget.update')!;
    await expect(check(ctx('widget.update', { after: { name: 'N', code: 'TOO-LONG' }, changed: ['name'] }))).resolves.toBeUndefined();
    await refusal(check(ctx('widget.update', { after: { name: 'N', code: 'TOO-LONG' }, changed: ['code'] })));
  });

  it('derives changed from before and after when the projection carries a before-state', async () => {
    const model = sealed(required);
    const writers = model.writersByAction.get('widget.update')!.map((w) => ({
      ...w,
      writer: { ...w.writer, project: (data: unknown) => data as FieldProjection },
    }));
    const check = fieldRuleCheckFor(writers, { isPresent: () => true, permissionChecker: () => undefined, validateFormat: () => true })!;
    await expect(check(ctx('widget.update', { before: { name: 'A', code: 'LONGER' }, after: { name: 'B', code: 'LONGER' } }))).resolves.toBeUndefined();
    await refusal(check(ctx('widget.update', { before: { name: 'A', code: 'X' }, after: { name: 'A', code: 'LONGER' } })));
  });
});

describe('fieldRuleCheckFor — writePermission (193 T020, T026, FR-043, FR-060)', () => {
  const guarded = [{ moduleId: 'acme', override: { target: 'widget.emails', writePermission: 'acme:emails' } }];

  it('refuses an administrator without the permission a changed field needs — 403', async () => {
    const check = checkOf(guarded, 'widget.update')!;
    const error = await refusal(check(ctx('widget.update', { after: { emails: ['a@b.pl'] }, changed: ['emails'] })));
    expect(error).toMatchObject({ statusCode: 403, code: 'FIELD_WRITE_FORBIDDEN' });
    expect(error.details).toEqual([{ path: 'emails', permission: 'acme:emails', reason: 'missing-permission', message: expect.any(String) }]);
  });

  it('admits the administrator who holds it, and a write that leaves the field unchanged', async () => {
    await expect(checkOf(guarded, 'widget.update', { granted: ['acme:emails'] })!(ctx('widget.update', { after: { emails: ['a@b.pl'] }, changed: ['emails'] }))).resolves.toBeUndefined();
    await expect(checkOf(guarded, 'widget.update')!(ctx('widget.update', { after: { name: 'N', emails: ['a@b.pl'] }, changed: ['name'] }))).resolves.toBeUndefined();
  });

  it('enforces the owner’s own writePermission, with no override at all', async () => {
    const check = checkOf([], 'widget.create')!;
    expect(check).toBeDefined();
    const error = await refusal(check(ctx('widget.create', { name: 'N', secret: 's' })));
    expect(error.details).toEqual([expect.objectContaining({ path: 'secret', permission: 'widgets:secret' })]);
  });

  it('exempts the system actor', async () => {
    await expect(checkOf(guarded, 'widget.update')!(ctx('widget.update', { after: { emails: ['a@b.pl'] }, changed: ['emails'] }, system))).resolves.toBeUndefined();
  });

  it('refuses a bound API key: its scopes are not resolvable in a Command (T026, R-12)', async () => {
    const error = await refusal(checkOf(guarded, 'widget.update')!(ctx('widget.update', { after: { emails: ['a@b.pl'] }, changed: ['emails'] }, apiKey)));
    expect(error.details).toEqual([expect.objectContaining({ path: 'emails', reason: 'api-key-scopes-unresolved' })]);
  });

  it('fails closed when no permission checker is composed', async () => {
    const error = await refusal(checkOf(guarded, 'widget.update', { noChecker: true })!(ctx('widget.update', { after: { emails: ['a@b.pl'] }, changed: ['emails'] })));
    expect(error.statusCode).toBe(403);
  });

  it('answers 403 when a write is both forbidden and invalid', async () => {
    const check = checkOf([...guarded, { moduleId: 'acme', override: { target: 'widget.code', validation: { maxLength: 2 } } }], 'widget.update')!;
    const error = await refusal(check(ctx('widget.update', { after: { emails: ['x'], code: 'TOO' }, changed: ['emails', 'code'] })));
    expect(error.statusCode).toBe(403);
  });
});

describe('fieldRuleCheckFor — scoped and rule-check-only writers (193 T020, FR-113, FR-124)', () => {
  const rules = [{ moduleId: 'acme', override: { target: 'widget.title', validation: { required: true, maxLength: 5 } } }];

  it('holds bounds at every saved scope, and required at the global scope only', async () => {
    const check = checkOf(rules, 'widget.scoped.save')!;
    const scopes = (entries: FieldScopedProjection[]) => ctx('widget.scoped.save', { scopes: entries });
    // A channel value left empty inherits the global one: not a violation.
    await expect(check(scopes([{ scope: 'channel:b2b', after: { title: '' }, changed: ['title'] }]))).resolves.toBeUndefined();
    const global = await refusal(check(scopes([{ scope: null, after: { title: '' }, changed: ['title'] }])));
    expect(detailsOf(global)).toEqual([expect.objectContaining({ code: 'required' })]);
    const channel = await refusal(check(scopes([{ scope: null, after: { title: 'Ok' }, changed: ['title'] }, { scope: 'channel:b2b', after: { title: 'Too long' }, changed: ['title'] }])));
    expect(detailsOf(channel)).toEqual([expect.objectContaining({ path: 'title', code: 'too_long' })]);
  });

  it('runs on a rule-check-only writer as on any other', async () => {
    const check = checkOf(rules, 'widget.bulk.item')!;
    expect(detailsOf(await refusal(check(ctx('widget.bulk.item', { after: { title: 'Too long' }, changed: ['title'] }))))).toEqual([
      expect.objectContaining({ code: 'too_long' }),
    ]);
  });
});
