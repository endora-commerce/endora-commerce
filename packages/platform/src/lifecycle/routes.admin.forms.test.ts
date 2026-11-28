import { EventEmitter } from 'node:events';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EffectiveFormsResponseSchema,
  FORM_LAYOUT_CHANGED_CHANNEL,
  PRESENTATION_OVERRIDES,
  defineAdminForm,
  defineFieldSet,
  hookableAction,
  type FieldOverride,
  type FormLayoutOverrideRow,
  type ModuleOrigin,
} from '@endora-commerce/contracts';
import { buildServer } from '../composition/index.js';
import { FormRegistry } from '../kernel/forms/registry.js';
import type { FormSealInput } from '../kernel/forms/seal.js';
import type { RequireAdminFactory } from '../kernel/ports/require-admin.js';
import { registerEffectiveFormsRoutes, watchFormLayoutChanges } from './routes.admin.js';

/**
 * `specs/193-admin-form-extensions/` T024 (FR-023, FR-024, FR-052, FR-094,
 * `contracts/field-overrides.md` §2, `operator-form-layout.md` §3 – §4):
 * `GET /api/v1/admin/effective-forms` serves every present form's effective fields,
 * layered core → deployment code → operator, behind an authenticated admin
 * with no permission code, with an ETag, from a memo that changes when
 * presence changes and when `b2b:form-layout:changed` is announced.
 */

const SET = defineFieldSet({
  id: 'widget',
  ownerModuleId: 'widgets',
  fields: [
    { key: 'name', type: 'string', required: true, bounds: { maxLength: 100 }, accepts: ['label', 'help', 'placeholder', 'position', 'readOnly', 'validation'] },
    { key: 'code', type: 'string', required: false, bounds: { maxLength: 32 }, accepts: [...PRESENTATION_OVERRIDES, 'validation', 'requiredWhen', 'writePermission'] },
    { key: 'kind', type: 'enum', options: ['a', 'b'], required: false, accepts: [...PRESENTATION_OVERRIDES] },
    { key: 'note', type: 'string', required: false, accepts: ['label'] },
  ],
});
const CREATE = defineAdminForm({ id: 'widget.create', fieldSet: 'widget', mode: 'create', sections: [{ key: 'main', keys: ['name', 'code'] }, { key: 'more', keys: ['kind', 'note'] }] });
const EDIT = defineAdminForm({ id: 'widget.edit', fieldSet: 'widget', mode: 'edit', sections: [{ key: 'main', keys: ['name', 'code', 'kind', 'note'] }] });
const UPDATE = hookableAction<Record<string, unknown>>('widget.update', 'widget', ['beforeCommit']);
const ORIGINS: Record<string, ModuleOrigin> = { widgets: 'core', acme: 'deployment', acme_ui: 'deployment' };

const override = (moduleId: string, value: Omit<FieldOverride, 'reason'>) => ({ moduleId, override: { reason: 'Because.', ...value } as FieldOverride });

function sealInput(): Omit<FormSealInput, 'writers' | 'formats'> {
  return {
    fieldSets: [{ moduleId: 'widgets', set: SET }],
    adminForms: [
      { moduleId: 'widgets', form: CREATE },
      { moduleId: 'widgets', form: EDIT },
    ],
    formOverrides: [
      override('acme', { target: 'widget.code', labelKey: 'widget.code.label', validation: { maxLength: 10 }, writePermission: 'acme:code' }),
      override('acme', { target: 'widget.kind', forms: ['widget.create'], hidden: true, position: { section: 'main' } }),
      override('acme_ui', { target: 'widget.code', control: 'acme_ui.code' }),
    ],
    inputControls: [{ moduleId: 'acme_ui', control: { id: 'acme_ui.code', outputType: 'string' } }],
    hookableActions: [{ moduleId: 'widgets', action: 'widget.update', objectType: 'widget', phases: ['beforeCommit'] }],
    moduleDependencies: { widgets: [], acme: ['widgets'], acme_ui: ['widgets'] },
    permissionCodes: ['acme:code'],
    origins: ORIGINS,
    installedPackageNames: {},
  };
}

const row = (value: Partial<FormLayoutOverrideRow> & Pick<FormLayoutOverrideRow, 'formId' | 'fieldKey'>): FormLayoutOverrideRow => ({
  id: `row-${value.formId}-${value.fieldKey}`,
  labels: null,
  helps: null,
  placeholders: null,
  section: null,
  before: null,
  after: null,
  hidden: false,
  readOnly: false,
  version: 1,
  updatedAt: new Date('2026-11-27T00:00:00Z'),
  ...value,
});

interface Harness {
  app: FastifyInstance;
  registry: FormRegistry;
  present: Set<string>;
  bumpPresence(): void;
  rows: FormLayoutOverrideRow[];
  listed: () => number;
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function serve(options: { rows?: FormLayoutOverrideRow[]; requireAdmin?: RequireAdminFactory } = {}): Promise<Harness> {
  const present = new Set(['widgets', 'acme', 'acme_ui']);
  let version = 1;
  let listed = 0;
  const rows = options.rows ?? [];
  const registry = new FormRegistry({
    isPresent: (moduleId) => present.has(moduleId),
    presenceVersion: () => version,
    operatorLayer: () => ({
      listAll: async () => {
        listed += 1;
        return rows;
      },
    }),
  });
  registry.registerFieldSets('widgets', [{ set: SET, writers: [{ on: UPDATE, mode: 'update', writes: ['name', 'code'], project: (data) => ({ after: data as Record<string, unknown>, changed: ['code'] }) }] }]);
  registry.seal(sealInput());
  const requireAdmin: RequireAdminFactory = options.requireAdmin ?? (() => async () => {});
  app = await buildServer({
    sessionCookieSecret: 'test-secret-do-not-use-in-production',
    openApi: { title: 'forms test', version: 'test', serverUrl: 'http://localhost' },
    disableRateLimit: true,
    modules: [(instance): void => registerEffectiveFormsRoutes(instance, { registry, requireAdmin })],
  });
  await app.ready();
  return { app, registry, present, rows, bumpPresence: () => void (version += 1), listed: () => listed };
}

const get = (h: Harness, headers: Record<string, string> = {}) => h.app.inject({ method: 'GET', url: '/api/v1/admin/effective-forms', headers });
const fieldOf = (body: unknown, formId: string, key: string) =>
  EffectiveFormsResponseSchema.parse(body).forms.find((form) => form.id === formId)?.fields.find((field) => field.key === key);

describe('GET /api/v1/admin/effective-forms (193 T024)', () => {
  it('answers the response schema, behind requireAdmin() with no code', async () => {
    const codes: (string | undefined)[] = [];
    const h = await serve({ requireAdmin: (code) => (codes.push(code), async () => {}) });
    const res = await get(h);
    expect(res.statusCode).toBe(200);
    const body = EffectiveFormsResponseSchema.parse(res.json());
    expect(body.forms.map((form) => form.id)).toEqual(['widget.create', 'widget.edit']);
    expect(codes).toEqual([undefined]);
  });

  it('lays out each form: sections, order, position overrides', async () => {
    const h = await serve();
    const body = EffectiveFormsResponseSchema.parse((await get(h)).json());
    const create = body.forms.find((form) => form.id === 'widget.create')!;
    expect(create.fields.map((field) => [field.key, field.section, field.order])).toEqual([
      ['name', 'main', 0],
      ['code', 'main', 1],
      ['kind', 'main', 2],
      ['note', 'more', 3],
    ]);
  });

  it('layers core → code: label, control, merged validation, writePermission, overriddenBy', async () => {
    const h = await serve();
    const body = (await get(h)).json();
    expect(fieldOf(body, 'widget.edit', 'code')).toEqual({
      key: 'code',
      label: { source: 'code', module: 'acme', key: 'widget.code.label' },
      section: 'main',
      order: 1,
      readOnly: false,
      hidden: false,
      control: 'acme_ui.code',
      validation: { maxLength: 10 },
      writePermission: 'acme:code',
      overriddenBy: [
        { module: 'acme', origin: 'deployment', kinds: ['label', 'validation', 'writePermission'] },
        { module: 'acme_ui', origin: 'deployment', kinds: ['control'] },
      ],
      operatorKinds: [],
    });
    // Narrowed to the create form: hidden there and not on edit.
    expect(fieldOf(body, 'widget.create', 'kind')).toMatchObject({ hidden: true });
    expect(fieldOf(body, 'widget.edit', 'kind')).toMatchObject({ hidden: false, overriddenBy: [] });
    // Untouched fields carry the core answer.
    expect(fieldOf(body, 'widget.edit', 'note')).toEqual({
      key: 'note', section: 'main', order: 3, readOnly: false, hidden: false, control: null, overriddenBy: [], operatorKinds: [],
    });
  });

  it('layers the operator above code: text per language, position, hidden and read-only only add (FR-094)', async () => {
    const h = await serve({
      rows: [
        row({ formId: 'widget.edit', fieldKey: 'code', labels: { en: 'Customer code', pl: 'Kod klienta' }, after: 'note' }),
        row({ formId: 'widget.edit', fieldKey: 'name', readOnly: true }),
        // A kind the field does not accept: the whole row is ignored (no-longer-accepted).
        row({ formId: 'widget.edit', fieldKey: 'note', hidden: true }),
        // An owner-absent or unknown form is ignored.
        row({ formId: 'gadget.edit', fieldKey: 'name', hidden: true }),
      ],
    });
    const body = (await get(h)).json();
    expect(fieldOf(body, 'widget.edit', 'code')).toMatchObject({
      label: { source: 'operator', text: { en: 'Customer code', pl: 'Kod klienta' } },
      order: 3,
      operatorKinds: ['label', 'position'],
    });
    expect(fieldOf(body, 'widget.edit', 'name')).toMatchObject({ readOnly: true, operatorKinds: ['readOnly'] });
    expect(fieldOf(body, 'widget.edit', 'note')).toMatchObject({ hidden: false, operatorKinds: [] });
    expect(fieldOf(body, 'widget.create', 'code')?.operatorKinds).toEqual([]);
  });

  it('falls back to the code position when the operator’s anchor is not on the form', async () => {
    const h = await serve({ rows: [row({ formId: 'widget.edit', fieldKey: 'code', before: 'missing' })] });
    expect(fieldOf((await get(h)).json(), 'widget.edit', 'code')).toMatchObject({ order: 1 });
  });

  it('omits a switched-off module everywhere: its overrides, its control, and an absent owner’s forms (FR-052)', async () => {
    const h = await serve();
    h.present.delete('acme_ui');
    h.bumpPresence();
    expect(fieldOf((await get(h)).json(), 'widget.edit', 'code')).toMatchObject({ control: null, overriddenBy: [expect.objectContaining({ module: 'acme' })] });
    h.present.delete('acme');
    h.bumpPresence();
    expect(fieldOf((await get(h)).json(), 'widget.edit', 'code')).toEqual(expect.objectContaining({ control: null, overriddenBy: [] }));
    expect(fieldOf((await get(h)).json(), 'widget.edit', 'code')).not.toHaveProperty('label');
    h.present.delete('widgets');
    h.bumpPresence();
    expect(EffectiveFormsResponseSchema.parse((await get(h)).json()).forms).toEqual([]);
  });

  it('answers an ETag, and 304 for a matching If-None-Match', async () => {
    const h = await serve();
    const first = await get(h);
    const etag = first.headers['etag'];
    expect(typeof etag).toBe('string');
    const again = await get(h, { 'if-none-match': String(etag) });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');
  });

  it('tells the browser to revalidate every time, and keeps the body out of shared caches (D-300.21)', async () => {
    const h = await serve();
    const first = await get(h);
    expect(first.headers['cache-control']).toBe('private, no-cache');
    const again = await get(h, { 'if-none-match': String(first.headers['etag']) });
    expect(again.headers['cache-control']).toBe('private, no-cache');
  });

  it('memoises per presence snapshot and layout generation', async () => {
    const h = await serve();
    const first = (await get(h)).headers['etag'];
    await get(h);
    expect(h.listed()).toBe(1);
    // A presence change recomputes, and the body follows.
    h.present.delete('acme_ui');
    h.bumpPresence();
    const second = (await get(h)).headers['etag'];
    expect(h.listed()).toBe(2);
    expect(second).not.toBe(first);
    // A layout announcement recomputes too.
    h.rows.push(row({ formId: 'widget.edit', fieldKey: 'code', labels: { en: 'Code', pl: 'Kod' } }));
    const subscriber = Object.assign(new EventEmitter(), { status: 'ready', subscribe: async () => 1 });
    await watchFormLayoutChanges(subscriber, h.registry);
    subscriber.emit('message', 'b2b:other', '{}');
    await get(h);
    expect(h.listed()).toBe(2);
    subscriber.emit('message', FORM_LAYOUT_CHANGED_CHANNEL, JSON.stringify({ formId: 'widget.edit' }));
    const third = (await get(h)).headers['etag'];
    expect(h.listed()).toBe(3);
    expect(third).not.toBe(second);
  });

  it('serves code and core when the operator layer cannot be read (presentation only)', async () => {
    const h = await serve();
    const failing = new FormRegistry({
      isPresent: () => true,
      presenceVersion: () => 1,
      operatorLayer: () => ({
        listAll: async () => {
          throw new Error('custom_fields unreachable');
        },
      }),
    });
    failing.registerFieldSets('widgets', [{ set: SET, writers: [{ on: UPDATE, mode: 'update', writes: ['name', 'code'], project: () => ({ after: {}, changed: [] }) }] }]);
    failing.seal(sealInput());
    const { response } = await failing.effectiveForms();
    expect(response.forms).toHaveLength(2);
    void h;
  });
});
