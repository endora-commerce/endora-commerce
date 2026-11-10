/**
 * `check:custom-field-writes` — the rule (`specs/175-buyer-input-custom-fields/`
 * research R-11, `contracts/admin-panel-and-check.md` §4; FR-043 – FR-045).
 *
 * Every custom-field host declares, beside its manifest, the admin write paths
 * that carry `customFieldValues` and the buyer input surfaces it serves; the
 * rule holds the declarations to the routes the module registers and to the
 * contracts those routes validate with. One red proof per finding kind, each
 * entering at **source text** — the manifest and the route file — with the
 * real built contracts as the schemas, so the literal reader, the route reader
 * and the Zod introspection all run. A clean fixture closes the file.
 */
import {
  adminApproveQuoteRequestSchema,
  createCategoryRequestSchema,
  customFieldValuesSchema,
  registerOrganizationRequestSchema,
  updateCategoryRequestSchema,
} from '@endora-commerce/contracts';
import { describe, expect, it } from 'vitest';

import {
  analyseCustomFieldWrites,
  readCustomFieldWrites,
  readInputSurfaceRegistry,
  type CustomFieldWritesFindingKind,
  type CustomFieldWritesInput,
  type ModuleWriteSources,
} from '../src/rules/custom-field-writes.js';

const SCHEMAS: Record<string, unknown> = {
  createCategoryRequestSchema,
  updateCategoryRequestSchema,
  customFieldValuesSchema,
  registerOrganizationRequestSchema,
  // An object schema with no `customFieldValues`.
  adminApproveQuoteRequestSchema,
};

const TEST_PATH = 'backend/test/contract/widgets/register.contract.test.ts';
const GOOD_TEST = "it('refuses with not_open_for_input on organization.register', () => {});";

/** A manifest whose `customFieldWrites` is `entries`, written as source text. */
function manifest(entries: string): string {
  return [
    "import type { CustomFieldWriteDeclaration } from '@endora-commerce/contracts';",
    "export const manifest = { id: 'widgets' };",
    `export const customFieldWrites = [${entries}] satisfies CustomFieldWriteDeclaration[];`,
  ].join('\n');
}

const CREATE = `{ entityType: 'category', kind: 'create', method: 'POST', path: '/api/v1/admin/widgets', body: 'createCategoryRequestSchema' }`;
const UPDATE = `{ entityType: 'category', kind: 'update', method: 'PATCH', path: '/api/v1/admin/widgets/:id', body: 'updateCategoryRequestSchema' }`;

const ROUTES = [
  "import type { FastifyInstance } from 'fastify';",
  'export function register(app: FastifyInstance) {',
  "  app.post('/api/v1/admin/widgets', { preHandler: requireAdmin('w:write'), schema: { body: createCategoryRequestSchema } }, h);",
  "  app.patch('/api/v1/admin/widgets/:id', { preHandler: requireAdmin('w:write'), schema: { body: updateCategoryRequestSchema } }, h);",
  '}',
  '',
].join('\n');

/** The create alone: no update route for the declarations to leave undeclared. */
const CREATE_ONLY = ROUTES.split('\n').filter((line) => !line.includes('app.patch')).join('\n');

function widgets(entries: string, routes: string = ROUTES): ModuleWriteSources {
  return {
    moduleId: 'widgets',
    manifestFile: 'packages/modules/widgets/src/manifest.ts',
    manifestText: manifest(entries),
    sources: new Map([['packages/modules/widgets/src/backend/routes.ts', routes]]),
  };
}

function input(modules: ModuleWriteSources[], overrides: Partial<CustomFieldWritesInput> = {}): CustomFieldWritesInput {
  return {
    entityTypes: ['category'],
    inputSurfaces: new Map([['category', []]]),
    modules,
    resolveSchema: (name) => SCHEMAS[name],
    valuesSchema: customFieldValuesSchema,
    readTest: (path) => (path === TEST_PATH ? GOOD_TEST : null),
    ...overrides,
  };
}

function kinds(result: ReturnType<typeof analyseCustomFieldWrites>): CustomFieldWritesFindingKind[] {
  return result.findings.map((finding) => finding.kind);
}

describe('custom-field-writes — one red proof per finding kind', () => {
  it('entity-type-undeclared: a supported type with no create, or no update/values, declaration', () => {
    const noUpdate = analyseCustomFieldWrites(input([widgets(CREATE, CREATE_ONLY)]));
    expect(kinds(noUpdate)).toEqual(['entity-type-undeclared']);
    expect(noUpdate.findings[0]?.entityType).toBe('category');
    expect(noUpdate.findings[0]?.message).toContain('update');

    const nothing = analyseCustomFieldWrites(input([widgets('')]));
    expect(kinds(nothing)).toEqual(['entity-type-undeclared', 'entity-type-undeclared']);
  });

  it('create-without-values: a create body that carries no customFieldValues', () => {
    const routes = ROUTES.replace(
      'schema: { body: createCategoryRequestSchema }',
      'schema: { body: adminApproveQuoteRequestSchema }',
    );
    const result = analyseCustomFieldWrites(
      input([widgets(`${CREATE.replace("'createCategoryRequestSchema'", "'adminApproveQuoteRequestSchema'")}, ${UPDATE}`, routes)]),
    );
    expect(kinds(result)).toEqual(['create-without-values']);
  });

  it('update-without-values: an update body without values and no values endpoint for the type', () => {
    const routes = ROUTES.replace(
      'schema: { body: updateCategoryRequestSchema }',
      'schema: { body: adminApproveQuoteRequestSchema }',
    );
    const result = analyseCustomFieldWrites(
      input([widgets(`${CREATE}, ${UPDATE.replace("'updateCategoryRequestSchema'", "'adminApproveQuoteRequestSchema'")}`, routes)]),
    );
    expect(kinds(result)).toEqual(['update-without-values']);
  });

  it('update-without-values: a values endpoint whose body is not the values record', () => {
    const routes = ROUTES.replace(
      "app.patch('/api/v1/admin/widgets/:id'",
      "app.patch('/api/v1/admin/widgets/:id/custom-fields'",
    );
    const values = `{ entityType: 'category', kind: 'values', method: 'PATCH', path: '/api/v1/admin/widgets/:id/custom-fields', body: 'updateCategoryRequestSchema' }`;
    expect(kinds(analyseCustomFieldWrites(input([widgets(`${CREATE}, ${values}`, routes)])))).toEqual([
      'update-without-values',
    ]);
  });

  it('declared-route-missing: a declared route the module does not register', () => {
    const result = analyseCustomFieldWrites(input([widgets(`${CREATE}, ${UPDATE.replace('/:id', '/:id/rename')}`)]));
    expect(kinds(result)).toContain('declared-route-missing');
    expect(result.findings.find((f) => f.kind === 'declared-route-missing')?.message).toContain(
      'PATCH /api/v1/admin/widgets/:id/rename',
    );
  });

  it('declared-route-missing: a declared route registered with another body schema', () => {
    const result = analyseCustomFieldWrites(
      input([widgets(`${CREATE.replace("'createCategoryRequestSchema'", "'updateCategoryRequestSchema'")}, ${UPDATE}`)]),
    );
    expect(kinds(result)).toEqual(['declared-route-missing']);
    expect(result.findings[0]?.message).toContain('createCategoryRequestSchema');
  });

  it('undeclared-write-route: a write at a declared create path or its child that nothing names', () => {
    const routes = ROUTES.replace(
      '}\n',
      "  app.put('/api/v1/admin/widgets/:widgetId', { preHandler: requireAdmin('w:write'), schema: { body: updateCategoryRequestSchema } }, h);\n}\n",
    );
    const result = analyseCustomFieldWrites(input([widgets(`${CREATE}, ${UPDATE}`, `${routes}\n`)]));
    expect(kinds(result)).toEqual(['undeclared-write-route']);
    expect(result.findings[0]?.message).toContain('PUT /api/v1/admin/widgets/:widgetId');
  });

  it('exemption-without-reason: an exemption whose reason is blank', () => {
    const result = analyseCustomFieldWrites(
      input([widgets(`${CREATE}, { entityType: 'category', kind: 'update', exempt: '   ' }`, CREATE_ONLY)]),
    );
    expect(kinds(result)).toEqual(['exemption-without-reason']);
  });

  it('surface-without-contract: a registry surface with no buyer-input declaration', () => {
    const result = analyseCustomFieldWrites(
      input([widgets(`${CREATE}, ${UPDATE}`)], { inputSurfaces: new Map([['category', ['organization.register']]]) }),
    );
    expect(kinds(result)).toEqual(['surface-without-contract']);
  });

  it('surface-without-contract: a buyer-input body with no values at the declared path', () => {
    const routes = ROUTES.replace(
      '}\n',
      "  app.post('/api/v1/widgets/register', { schema: { body: registerOrganizationRequestSchema } }, h);\n}\n",
    );
    const buyer = `{ entityType: 'category', kind: 'buyer-input', surface: 'organization.register', method: 'POST', path: '/api/v1/widgets/register', body: 'registerOrganizationRequestSchema', at: 'organization.notValues', test: '${TEST_PATH}' }`;
    const result = analyseCustomFieldWrites(
      input([widgets(`${CREATE}, ${UPDATE}, ${buyer}`, `${routes}\n`)], {
        inputSurfaces: new Map([['category', ['organization.register']]]),
      }),
    );
    expect(kinds(result)).toEqual(['surface-without-contract']);
    expect(result.findings[0]?.message).toContain('organization.notValues');
  });

  it('surface-without-test: the declared test is missing, or does not name the surface and the refusal', () => {
    const routes = ROUTES.replace(
      '}\n',
      "  app.post('/api/v1/widgets/register', { schema: { body: registerOrganizationRequestSchema } }, h);\n}\n",
    );
    const buyer = `{ entityType: 'category', kind: 'buyer-input', surface: 'organization.register', method: 'POST', path: '/api/v1/widgets/register', body: 'registerOrganizationRequestSchema', at: 'organization.customFieldValues', test: '${TEST_PATH}' }`;
    const surfaces = new Map([['category', ['organization.register']]]);
    const missing = analyseCustomFieldWrites(
      input([widgets(`${CREATE}, ${UPDATE}, ${buyer}`, `${routes}\n`)], { inputSurfaces: surfaces, readTest: () => null }),
    );
    expect(kinds(missing)).toEqual(['surface-without-test']);
    const silent = analyseCustomFieldWrites(
      input([widgets(`${CREATE}, ${UPDATE}, ${buyer}`, `${routes}\n`)], {
        inputSurfaces: surfaces,
        readTest: () => "it('registers', () => {});",
      }),
    );
    expect(kinds(silent)).toEqual(['surface-without-test']);
  });

  it('computed-declaration: customFieldWrites is not a literal array of literal objects', () => {
    for (const entries of [`...SHARED, ${CREATE}`, `${CREATE}, { ...UPDATE_BASE, kind: 'update' }`, `${CREATE}, { entityType: TYPE, kind: 'update', exempt: 'x' }`]) {
      const result = analyseCustomFieldWrites(input([widgets(entries)]));
      expect(kinds(result), entries).toContain('computed-declaration');
    }
    const computed: ModuleWriteSources = {
      ...widgets(''),
      manifestText: 'export const customFieldWrites = buildWrites();',
    };
    expect(kinds(analyseCustomFieldWrites(input([computed])))).toContain('computed-declaration');
  });
});

describe('custom-field-writes — a clean tree', () => {
  it('says nothing over a host whose declarations agree with its routes and contracts', () => {
    const routes = ROUTES.replace(
      '}\n',
      "  app.post('/api/v1/widgets/register', { schema: { body: registerOrganizationRequestSchema } }, h);\n}\n",
    );
    const buyer = `{ entityType: 'category', kind: 'buyer-input', surface: 'organization.register', method: 'POST', path: '/api/v1/widgets/register', body: 'registerOrganizationRequestSchema', at: 'organization.customFieldValues', test: '${TEST_PATH}' }`;
    const exempt = `{ entityType: 'product', kind: 'create', exempt: 'host-managed' }, { entityType: 'product', kind: 'update', exempt: 'host-managed' }`;
    const result = analyseCustomFieldWrites(
      input([widgets(`${CREATE}, ${UPDATE}, ${buyer}, ${exempt}`, `${routes}\n`)], {
        entityTypes: ['category', 'product'],
        inputSurfaces: new Map([
          ['category', ['organization.register']],
          ['product', []],
        ]),
      }),
    );
    expect(result.findings).toEqual([]);
    expect(result.declarations).toHaveLength(5);
    expect(result.exemptions.map((e) => `${e.entityType}:${e.kind}:${e.reason}`)).toEqual([
      'product:create:host-managed',
      'product:update:host-managed',
    ]);
  });

  it('accepts a values endpoint in place of an update, and a template path built from a constant', () => {
    const routes = [
      "import type { FastifyInstance } from 'fastify';",
      "const API = '/api/v1/admin/widgets';",
      'export function register(app: FastifyInstance) {',
      '  app.post(API, { schema: { body: createCategoryRequestSchema } }, h);',
      '  app.patch(`${API}/:id/custom-fields`, { schema: { body: customFieldValuesSchema } }, h);',
      '}',
    ].join('\n');
    const values = `{ entityType: 'category', kind: 'values', method: 'PATCH', path: '/api/v1/admin/widgets/:id/custom-fields', body: 'customFieldValuesSchema' }`;
    expect(analyseCustomFieldWrites(input([widgets(`${CREATE}, ${values}`, routes)])).findings).toEqual([]);
  });

  it('reads a module with no customFieldWrites export as declaring nothing', () => {
    expect(readCustomFieldWrites("export const manifest = { id: 'x' };")).toEqual({ declarations: [], computed: null, present: false });
  });
});

describe('custom-field-writes — the input-surface registry, read from source', () => {
  it('reads each entity type and the surfaces it opens', () => {
    const registry = readInputSurfaceRegistry(
      [
        'export const SUPPORTED_ENTITIES: Record<SupportedEntityType, SupportedEntityMeta> = {',
        "  category: { labelKey: 'a', orgOwned: false },",
        "  organization: { labelKey: 'b', orgOwned: false, customerInputSurfaces: ['organization.register'] },",
        "  'quote_request': { labelKey: 'c', orgOwned: true },",
        '};',
      ].join('\n'),
    );
    expect(Object.fromEntries(registry ?? [])).toEqual({
      category: [],
      organization: ['organization.register'],
      quote_request: [],
    });
  });

  it('answers null for a source with no registry it can read', () => {
    expect(readInputSurfaceRegistry('export const OTHER = {};')).toBeNull();
  });
});
