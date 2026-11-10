import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { inputSurfaceFieldsResponseSchema, type SupportedEntityType } from '@endora-commerce/contracts';
import { registerCustomFieldsPublicRoutes } from './routes.public.js';
import type { CachedDefinition } from './services/custom-field-definitions-cache.js';

/**
 * `specs/175-buyer-input-custom-fields/contracts/input-surface-read.md` (FR-029,
 * FR-030) — `GET /api/v1/custom-fields/input-surfaces/:surface`: the fields open
 * on a surface, per entity type in display order, labels in the request's
 * language, and nothing else about them. No database: the definition source is
 * stubbed, and the language is read off `Accept-Language` the way the platform's
 * decoration resolves it.
 */

const SURFACE = 'organization.register';
const URL = `/api/v1/custom-fields/input-surfaces/${SURFACE}`;

interface Def {
  key: string;
  valueType: string;
  sortOrder: number;
  required?: boolean;
  open?: boolean;
  audience?: 'customer' | 'internal';
  label?: Record<string, string>;
  labelDefault?: string;
  adminAccess?: 'edit' | 'read' | 'hidden';
  config?: Record<string, unknown>;
  options?: Array<{ value: string; label?: Record<string, string>; labelDefault: string; sortOrder?: number }>;
}

function cached(defs: Def[]): CachedDefinition[] {
  return defs.map((d) => ({
    definition: {
      key: d.key,
      valueType: d.valueType,
      sortOrder: d.sortOrder,
      required: d.required ?? false,
      audience: d.audience ?? 'customer',
      customerInput: d.open === false ? [] : [SURFACE],
      adminAccess: d.adminAccess ?? 'edit',
      label: d.label ?? {},
      labelDefault: d.labelDefault ?? d.key,
      config: d.config ?? {},
    } as unknown as CachedDefinition['definition'],
    options: (d.options ?? []).map(
      (o, i) =>
        ({ value: o.value, label: o.label ?? {}, labelDefault: o.labelDefault, sortOrder: o.sortOrder ?? i }) as
          CachedDefinition['options'][number],
    ),
  }));
}

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function serve(byType: Partial<Record<SupportedEntityType, Def[]>>): Promise<FastifyInstance> {
  app = Fastify();
  app.decorateRequest('responseLanguage', async function (this: FastifyRequest) {
    return String(this.headers['accept-language'] ?? '').startsWith('pl') ? 'pl' : 'en';
  });
  await registerCustomFieldsPublicRoutes(app, {
    definitions: { listForEntity: async (entityType) => cached(byType[entityType] ?? []) },
  });
  return app;
}

describe('GET /api/v1/custom-fields/input-surfaces/:surface', () => {
  it('answers only the open fields per entity type, in sortOrder', async () => {
    const server = await serve({
      organization: [
        { key: 'size', valueType: 'number', sortOrder: 20 },
        { key: 'credit_limit', valueType: 'number', sortOrder: 5, open: false },
        { key: 'source', valueType: 'text', sortOrder: 10, required: true },
      ],
      customer: [{ key: 'phone', valueType: 'text', sortOrder: 1 }],
      order: [{ key: 'po', valueType: 'text', sortOrder: 0 }],
    });
    const res = await server.inject({ method: 'GET', url: URL });
    expect(res.statusCode, res.body).toBe(200);
    const body = inputSurfaceFieldsResponseSchema.parse(res.json());
    expect(body.data.surface).toBe(SURFACE);
    expect(body.data.entities.organization?.map((f) => f.key)).toEqual(['source', 'size']);
    expect(body.data.entities.organization?.[0]).toMatchObject({ required: true, valueType: 'text' });
    expect(body.data.entities.customer?.map((f) => f.key)).toEqual(['phone']);
    // A type that offers no surface is never answered, whatever its rows say.
    expect(Object.keys(body.data.entities).sort()).toEqual(['customer', 'organization']);
  });

  it('never answers an internal or page_builder field even if it is marked open', async () => {
    const server = await serve({
      customer: [
        { key: 'score', valueType: 'number', sortOrder: 0, audience: 'internal' },
        { key: 'guide', valueType: 'page_builder', sortOrder: 1 },
        { key: 'phone', valueType: 'text', sortOrder: 2 },
      ],
    });
    const body = inputSurfaceFieldsResponseSchema.parse((await server.inject({ method: 'GET', url: URL })).json());
    expect(body.data.entities.customer?.map((f) => f.key)).toEqual(['phone']);
  });

  it('resolves field and option labels in the request language, with labelDefault as fallback', async () => {
    const server = await serve({
      organization: [
        {
          key: 'source',
          valueType: 'select',
          sortOrder: 0,
          label: { pl: 'Skąd o nas wiesz?', en: 'How did you hear about us?' },
          labelDefault: 'Source',
          options: [
            { value: 'trade_fair', label: { pl: 'Targi' }, labelDefault: 'Trade fair' },
            { value: 'web', labelDefault: 'Web' },
          ],
        },
        { key: 'size', valueType: 'number', sortOrder: 1, label: { en: 'Size' }, labelDefault: 'Company size' },
      ],
    });
    const pl = inputSurfaceFieldsResponseSchema.parse(
      (await server.inject({ method: 'GET', url: URL, headers: { 'accept-language': 'pl' } })).json(),
    );
    expect(pl.data.entities.organization).toEqual([
      {
        key: 'source',
        valueType: 'select',
        required: false,
        label: 'Skąd o nas wiesz?',
        sortOrder: 0,
        options: [
          { value: 'trade_fair', label: 'Targi' },
          { value: 'web', label: 'Web' },
        ],
      },
      { key: 'size', valueType: 'number', required: false, label: 'Company size', sortOrder: 1, options: [] },
    ]);
    const en = inputSurfaceFieldsResponseSchema.parse(
      (await server.inject({ method: 'GET', url: URL, headers: { 'accept-language': 'en' } })).json(),
    );
    expect(en.data.entities.organization?.map((f) => f.label)).toEqual(['How did you hear about us?', 'Size']);
    expect(en.data.entities.organization?.[0]?.options.map((o) => o.label)).toEqual(['Trade fair', 'Web']);
  });

  it('answers 200 with no entities for an unknown surface', async () => {
    const server = await serve({ organization: [{ key: 'source', valueType: 'text', sortOrder: 0 }] });
    const res = await server.inject({ method: 'GET', url: '/api/v1/custom-fields/input-surfaces/checkout' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { surface: 'checkout', entities: {} } });
  });

  it('answers no stored value, audience, admin access or config', async () => {
    const server = await serve({
      organization: [
        { key: 'source', valueType: 'text', sortOrder: 0, adminAccess: 'read', config: { secret: true } },
      ],
    });
    const field = (await server.inject({ method: 'GET', url: URL })).json().data.entities.organization[0];
    expect(Object.keys(field).sort()).toEqual(['key', 'label', 'options', 'required', 'sortOrder', 'valueType']);
  });
});
