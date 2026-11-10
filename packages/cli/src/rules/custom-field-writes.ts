/**
 * CI check — every custom-field host declares its write paths, and the
 * declarations agree with the routes it registers and the contracts those routes
 * validate with (`specs/175-buyer-input-custom-fields/` research R-11,
 * `contracts/admin-panel-and-check.md` §4; FR-043 – FR-045).
 *
 * ## Why declarations, and why they are read as text
 *
 * The generic core may not know a host's routes (Principle XIV): `custom_fields`
 * validates a bag, the host owns the record, the route and the screen. So each
 * host states, beside its manifest, which admin create and update — or
 * dedicated values endpoint — carries `customFieldValues`, which write it
 * exempts and why, and which buyer input surfaces it serves:
 *
 * ```ts
 * export const customFieldWrites = [ … ] satisfies CustomFieldWriteDeclaration[];
 * ```
 *
 * The export is read as **literal source**, never imported, in the
 * `packageLicense` precedent: an imported value would answer about the previous
 * build (D-164), and a computed one could not be checked against anything. A
 * declaration that is not a literal array of literal objects is itself a
 * finding (`computed-declaration`), never a skip.
 *
 * ## The nine findings
 *
 *  - `entity-type-undeclared` — a supported entity type with no `create`
 *    declaration or exemption, or none for `update`/`values`.
 *  - `create-without-values` — a declared create whose body has no
 *    `customFieldValues`.
 *  - `update-without-values` — a declared update whose body has none while no
 *    `values` endpoint exists for the type; or a `values` endpoint whose body is
 *    not the values record itself.
 *  - `declared-route-missing` — the declaring module registers no such method
 *    and path, registers it with another `schema.body`, or names a body that is
 *    not an export of the contracts.
 *  - `undeclared-write-route` — a `POST` at a declared create's path, or a
 *    `PATCH`/`PUT` at its `/:id` child, that no declaration names. This is the
 *    discovery scope the owner accepted on 2026-11-06: an endpoint under a
 *    wholly new path is invisible until it is declared.
 *  - `exemption-without-reason` — `exempt` empty or whitespace.
 *  - `surface-without-contract` — a surface the custom-field registry opens for
 *    a type with no `buyer-input` declaration (or the reverse), or a body with
 *    no values at the declared `at` path.
 *  - `surface-without-test` — the declared test file is missing, or does not
 *    mention both the surface and `not_open_for_input`.
 *  - `computed-declaration` — above.
 *
 * ## What it reads
 *
 * Routes through `action-route-permissions`' reader (one reconstruction, not
 * two), widened to every `/api/v1` path because a buyer surface is not an admin
 * route. Schemas through the **built** `@endora-commerce/contracts`, unwrapped
 * structurally (Zod 4's `_zod.def`), so `.extend()`, `.partial()` and
 * `.superRefine()` derivations need no re-implementation in AST. The rule takes
 * every input as an argument; the repository host
 * (`backend/scripts/check-custom-field-writes.ts`) resolves roots, floors and
 * the read line.
 */
import ts from 'typescript';

import { findAdminRoutes, type AdminRoute } from './action-route-permissions.js';

/** Every route this rule may compare a declaration against starts here. */
const API_PREFIX = '/api/v1';

/** The refusal code a buyer-input surface's test must exercise. */
const NOT_OPEN = 'not_open_for_input';

const ROUTE_KINDS = new Set(['create', 'update', 'values']);
const EXEMPTABLE_KINDS = new Set(['create', 'update']);
const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT']);

export type CustomFieldWritesFindingKind =
  | 'entity-type-undeclared'
  | 'create-without-values'
  | 'update-without-values'
  | 'declared-route-missing'
  | 'undeclared-write-route'
  | 'exemption-without-reason'
  | 'surface-without-contract'
  | 'surface-without-test'
  | 'computed-declaration';

export interface CustomFieldWritesFinding {
  readonly kind: CustomFieldWritesFindingKind;
  /** The declaring module, or `null` for a finding about the population. */
  readonly moduleId: string | null;
  readonly entityType: string | null;
  readonly message: string;
}

/** One declaration as read from source — the shapes of `CustomFieldWriteDeclaration`. */
export type ReadDeclaration =
  | {
      readonly shape: 'route';
      readonly entityType: string;
      readonly kind: 'create' | 'update' | 'values';
      readonly method: string;
      readonly path: string;
      readonly body: string;
    }
  | { readonly shape: 'exempt'; readonly entityType: string; readonly kind: 'create' | 'update'; readonly exempt: string }
  | {
      readonly shape: 'buyer-input';
      readonly entityType: string;
      readonly kind: 'buyer-input';
      readonly surface: string;
      readonly method: string;
      readonly path: string;
      readonly body: string;
      readonly at: string;
      readonly test: string;
    };

/** A declaration and the module that made it. */
export type OwnedDeclaration = ReadDeclaration & { readonly moduleId: string };

/** An exemption the run honoured — printed, with its reason. */
export interface HonouredExemption {
  readonly moduleId: string;
  readonly entityType: string;
  readonly kind: string;
  readonly reason: string;
}

export interface ModuleWriteSources {
  readonly moduleId: string;
  /** Where the manifest lives, for messages. */
  readonly manifestFile: string;
  /** The manifest's source text, or `null` when the module has none. */
  readonly manifestText: string | null;
  /** The module's route sources, keyed by a path for messages. */
  readonly sources: ReadonlyMap<string, string>;
}

export interface CustomFieldWritesInput {
  /** The supported entity types — `supportedEntityTypeSchema.options`. */
  readonly entityTypes: readonly string[];
  /** The input surfaces the custom-field registry opens, per entity type. */
  readonly inputSurfaces: ReadonlyMap<string, readonly string[]>;
  readonly modules: readonly ModuleWriteSources[];
  /** A contracts export by name, or `undefined`. */
  readonly resolveSchema: (name: string) => unknown;
  /** `customFieldValuesSchema` — what a `values` endpoint's body must be. */
  readonly valuesSchema: unknown;
  /** A repository-relative file's text, or `null` when it does not exist. */
  readonly readTest: (path: string) => string | null;
}

export interface CustomFieldWritesResult {
  readonly findings: readonly CustomFieldWritesFinding[];
  readonly declarations: readonly OwnedDeclaration[];
  readonly exemptions: readonly HonouredExemption[];
  /** Route files opened, summed over the modules that declare anything. */
  readonly routeFiles: number;
}

// ---------------------------------------------------------------------------
// Reading the declarations
// ---------------------------------------------------------------------------

export interface DeclarationReading {
  readonly declarations: readonly ReadDeclaration[];
  /** Why the export could not be read as literal declarations, or `null`. */
  readonly computed: string | null;
  /** Whether the manifest exports `customFieldWrites` at all. */
  readonly present: boolean;
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isSatisfiesExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** A literal string — `'x'`, `` `x` `` or `'a' + 'b'` — or `null`. */
function literalText(node: ts.Expression): string | null {
  const inner = unwrap(node);
  if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) return inner.text;
  if (ts.isBinaryExpression(inner) && inner.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = literalText(inner.left);
    const right = literalText(inner.right);
    return left === null || right === null ? null : left + right;
  }
  return null;
}

function exportedInitializer(sf: ts.SourceFile, name: string): ts.Expression | null | undefined {
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const exported = statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
    if (!exported) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
        return declaration.initializer ?? null;
      }
    }
  }
  return undefined;
}

function readEntry(element: ts.Expression): ReadDeclaration | string {
  const node = unwrap(element);
  if (!ts.isObjectLiteralExpression(node)) return 'an entry that is not an object literal';
  const fields = new Map<string, string>();
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) return 'an entry with a spread, a shorthand or a method';
    const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : null;
    if (name === null) return 'an entry with a computed property name';
    const value = literalText(property.initializer);
    if (value === null) return `\`${name}\` is not a literal string`;
    fields.set(name, value);
  }
  const entityType = fields.get('entityType');
  const kind = fields.get('kind');
  if (entityType === undefined || kind === undefined) return 'an entry without `entityType` and `kind`';
  if (fields.has('exempt')) {
    if (!EXEMPTABLE_KINDS.has(kind)) return `an exemption of kind \`${kind}\`, which only \`create\` and \`update\` may have`;
    return { shape: 'exempt', entityType, kind: kind as 'create' | 'update', exempt: fields.get('exempt') ?? '' };
  }
  const method = fields.get('method');
  const path = fields.get('path');
  const body = fields.get('body');
  if (method === undefined || path === undefined || body === undefined) {
    return 'a route declaration without `method`, `path` and `body`';
  }
  if (!WRITE_METHODS.has(method)) return `a method \`${method}\` that is not a write`;
  if (kind === 'buyer-input') {
    const surface = fields.get('surface');
    const at = fields.get('at');
    const test = fields.get('test');
    if (surface === undefined || at === undefined || test === undefined) {
      return 'a buyer-input declaration without `surface`, `at` and `test`';
    }
    return { shape: 'buyer-input', entityType, kind, surface, method, path, body, at, test };
  }
  if (!ROUTE_KINDS.has(kind)) return `a kind \`${kind}\` the declaration type does not have`;
  return { shape: 'route', entityType, kind: kind as 'create' | 'update' | 'values', method, path, body };
}

/**
 * The `customFieldWrites` export of a manifest's source text.
 *
 * `present: false` is a module that declares nothing — the population check
 * decides whether that is a finding. `computed` names what could not be read;
 * the declarations read before it are not returned, because a half-read list
 * would be judged as if it were the whole one.
 */
export function readCustomFieldWrites(text: string, file = 'manifest.ts'): DeclarationReading {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const initializer = exportedInitializer(sf, 'customFieldWrites');
  if (initializer === undefined) return { declarations: [], computed: null, present: false };
  if (initializer === null) return { declarations: [], computed: 'it has no initialiser', present: true };
  const array = unwrap(initializer);
  if (!ts.isArrayLiteralExpression(array)) {
    return { declarations: [], computed: 'it is not an array literal', present: true };
  }
  const declarations: ReadDeclaration[] = [];
  for (const element of array.elements) {
    if (ts.isSpreadElement(element)) return { declarations: [], computed: 'it spreads another array', present: true };
    const read = readEntry(element);
    if (typeof read === 'string') return { declarations: [], computed: read, present: true };
    declarations.push(read);
  }
  return { declarations, computed: null, present: true };
}

/**
 * `SUPPORTED_ENTITIES` of `custom_fields`' registry, as entity type → the input
 * surfaces it opens; `null` where the source holds no registry it can read.
 */
export function readInputSurfaceRegistry(text: string): Map<string, readonly string[]> | null {
  const sf = ts.createSourceFile('custom-field-registry.ts', text, ts.ScriptTarget.Latest, true);
  const initializer = exportedInitializer(sf, 'SUPPORTED_ENTITIES');
  if (initializer === undefined || initializer === null) return null;
  const object = unwrap(initializer);
  if (!ts.isObjectLiteralExpression(object)) return null;
  const registry = new Map<string, readonly string[]>();
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) return null;
    const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : null;
    const meta = unwrap(property.initializer);
    if (name === null || !ts.isObjectLiteralExpression(meta)) return null;
    let surfaces: string[] = [];
    for (const field of meta.properties) {
      if (!ts.isPropertyAssignment(field) || field.name.getText() !== 'customerInputSurfaces') continue;
      const list = unwrap(field.initializer);
      if (!ts.isArrayLiteralExpression(list)) return null;
      const read = list.elements.map((element) => literalText(element));
      if (read.some((value) => value === null)) return null;
      surfaces = read as string[];
    }
    registry.set(name, surfaces);
  }
  return registry;
}

// ---------------------------------------------------------------------------
// Reading the contracts
// ---------------------------------------------------------------------------

interface ZodDefLike {
  readonly type?: string;
  readonly shape?: Record<string, unknown> | (() => Record<string, unknown>);
  readonly innerType?: unknown;
  readonly in?: unknown;
  readonly left?: unknown;
  readonly right?: unknown;
  readonly getter?: () => unknown;
}

function defOf(schema: unknown): ZodDefLike | null {
  if (schema === null || typeof schema !== 'object') return null;
  const zod = (schema as { _zod?: { def?: ZodDefLike } })._zod;
  return zod?.def ?? null;
}

/** The wrappers a body schema is unwrapped through to reach its object. */
const PASS_THROUGH = new Set(['optional', 'nullable', 'default', 'prefault', 'readonly', 'catch', 'nonoptional']);

/** Each schema a body is on its way to its object: itself, then each unwrapping. */
function unwrappings(schema: unknown): unknown[] {
  const out: unknown[] = [];
  let current: unknown = schema;
  for (let depth = 0; depth < 16 && current !== undefined; depth += 1) {
    out.push(current);
    const def = defOf(current);
    if (def === null) break;
    if (def.type !== undefined && PASS_THROUGH.has(def.type)) current = def.innerType;
    else if (def.type === 'pipe') current = def.in;
    else if (def.type === 'lazy' && def.getter) current = def.getter();
    else break;
  }
  return out;
}

/** The keys of an object schema, through wrappers and intersections, or `null`. */
function shapeOf(schema: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 8) return null;
  const chain = unwrappings(schema);
  const def = defOf(chain[chain.length - 1]);
  if (def === null) return null;
  if (def.type === 'object') {
    const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
    return shape ?? null;
  }
  if (def.type === 'intersection') {
    const left = shapeOf(def.left, depth + 1);
    const right = shapeOf(def.right, depth + 1);
    return left === null && right === null ? null : { ...(left ?? {}), ...(right ?? {}) };
  }
  return null;
}

/** Whether `schema` has an object member at the dotted `path`. */
export function schemaHasPath(schema: unknown, path: readonly string[]): boolean {
  let current: unknown = schema;
  for (const segment of path) {
    const shape = shapeOf(current);
    if (shape === null || !Object.prototype.hasOwnProperty.call(shape, segment)) return false;
    current = shape[segment];
  }
  return true;
}

// ---------------------------------------------------------------------------
// The analysis
// ---------------------------------------------------------------------------

/** A path with its parameter names erased, so `:id` and `:widgetId` compare equal. */
const normalised = (path: string): string => path.replace(/:[^/]+/g, ':');

const routeKey = (method: string, path: string): string => `${method.toUpperCase()} ${normalised(path)}`;

export function analyseCustomFieldWrites(input: CustomFieldWritesInput): CustomFieldWritesResult {
  const findings: CustomFieldWritesFinding[] = [];
  const declarations: OwnedDeclaration[] = [];
  const exemptions: HonouredExemption[] = [];
  const knownTypes = new Set(input.entityTypes);
  const routesByModule = new Map<string, readonly AdminRoute[]>();
  let routeFiles = 0;

  const find = (
    kind: CustomFieldWritesFindingKind,
    moduleId: string | null,
    entityType: string | null,
    message: string,
  ): void => {
    findings.push({ kind, moduleId, entityType, message });
  };

  // 1. Read every module's declarations.
  for (const module of input.modules) {
    if (module.manifestText === null) continue;
    const reading = readCustomFieldWrites(module.manifestText, module.manifestFile);
    if (!reading.present) continue;
    if (reading.computed !== null) {
      find(
        'computed-declaration',
        module.moduleId,
        null,
        `${module.manifestFile}: \`customFieldWrites\` must be a literal array of literal objects, ` +
          `and ${reading.computed}. A computed declaration cannot be checked against the routes.`,
      );
      continue;
    }
    const unknown = reading.declarations.filter((d) => !knownTypes.has(d.entityType));
    if (unknown.length > 0) {
      find(
        'computed-declaration',
        module.moduleId,
        null,
        `${module.manifestFile}: \`customFieldWrites\` names ${unknown.map((d) => `\`${d.entityType}\``).join(', ')}, ` +
          'which no supported entity type is.',
      );
      continue;
    }
    for (const declaration of reading.declarations) declarations.push({ ...declaration, moduleId: module.moduleId });
    if (reading.declarations.some((d) => d.shape !== 'exempt')) {
      routeFiles += module.sources.size;
      routesByModule.set(module.moduleId, findAdminRoutes({ sources: module.sources, pathPrefix: API_PREFIX }).routes);
    }
  }

  const valuesTypes = new Set(
    declarations.filter((d) => d.shape === 'route' && d.kind === 'values').map((d) => d.entityType),
  );

  // 2. Each declaration against its module's routes and the contracts.
  for (const declaration of declarations) {
    const { moduleId, entityType } = declaration;
    if (declaration.shape === 'exempt') {
      if (declaration.exempt.trim() === '') {
        find(
          'exemption-without-reason',
          moduleId,
          entityType,
          `${moduleId} exempts the ${declaration.kind} of \`${entityType}\` without a reason. Say why the write ` +
            'carries no custom-field values.',
        );
      } else {
        exemptions.push({ moduleId, entityType, kind: declaration.kind, reason: declaration.exempt });
      }
      continue;
    }

    const label = `${declaration.method} ${declaration.path}`;
    const routes = (routesByModule.get(moduleId) ?? []).filter(
      (route) => routeKey(route.method, route.path) === routeKey(declaration.method, declaration.path),
    );
    if (routes.length === 0) {
      find(
        'declared-route-missing',
        moduleId,
        entityType,
        `${moduleId} declares ${label} for \`${entityType}\`, and registers no such route.`,
      );
      continue;
    }
    if (!routes.some((route) => route.body === declaration.body)) {
      const registered = [...new Set(routes.map((route) => route.body ?? '(none it can read)'))].join(', ');
      find(
        'declared-route-missing',
        moduleId,
        entityType,
        `${moduleId} declares ${label} with body \`${declaration.body}\`; the route validates with ${registered}.`,
      );
      continue;
    }
    const schema = input.resolveSchema(declaration.body);
    if (schema === undefined) {
      find(
        'declared-route-missing',
        moduleId,
        entityType,
        `${moduleId} declares ${label} with body \`${declaration.body}\`, which is not an export of ` +
          '@endora-commerce/contracts.',
      );
      continue;
    }

    if (declaration.shape === 'buyer-input') {
      if (!schemaHasPath(schema, declaration.at.split('.'))) {
        find(
          'surface-without-contract',
          moduleId,
          entityType,
          `${moduleId} declares the \`${declaration.surface}\` input of \`${entityType}\` at ` +
            `\`${declaration.at}\`, and \`${declaration.body}\` has no such member.`,
        );
      }
      const text = input.readTest(declaration.test);
      if (text === null) {
        find(
          'surface-without-test',
          moduleId,
          entityType,
          `${moduleId} names ${declaration.test} as the test of the \`${declaration.surface}\` input, and it does not exist.`,
        );
      } else if (!text.includes(declaration.surface) || !text.includes(NOT_OPEN)) {
        find(
          'surface-without-test',
          moduleId,
          entityType,
          `${declaration.test} is named as the test of the \`${declaration.surface}\` input and does not ` +
            `mention both \`${declaration.surface}\` and \`${NOT_OPEN}\` — it is not the test of that surface's refusals.`,
        );
      }
      continue;
    }

    if (declaration.kind === 'values') {
      if (!unwrappings(schema).includes(input.valuesSchema)) {
        find(
          'update-without-values',
          moduleId,
          entityType,
          `${moduleId} declares ${label} as the values endpoint of \`${entityType}\`; its body ` +
            `\`${declaration.body}\` is not the custom-field values record.`,
        );
      }
      continue;
    }
    if (schemaHasPath(schema, ['customFieldValues'])) continue;
    if (declaration.kind === 'create') {
      find(
        'create-without-values',
        moduleId,
        entityType,
        `${moduleId} declares ${label} as the create of \`${entityType}\`, and \`${declaration.body}\` has no ` +
          '`customFieldValues`.',
      );
    } else if (!valuesTypes.has(entityType)) {
      find(
        'update-without-values',
        moduleId,
        entityType,
        `${moduleId} declares ${label} as the update of \`${entityType}\`; \`${declaration.body}\` has no ` +
          '`customFieldValues` and no values endpoint is declared for the type.',
      );
    }
  }

  // 3. Writes at a declared create's path, or its `/:id` child, that nothing names.
  for (const [moduleId, routes] of routesByModule) {
    const owned = declarations.filter((d) => d.moduleId === moduleId);
    const named = new Set(owned.flatMap((d) => (d.shape === 'exempt' ? [] : [routeKey(d.method, d.path)])));
    const createPaths = new Set(
      owned.flatMap((d) => (d.shape === 'route' && d.kind === 'create' ? [normalised(d.path)] : [])),
    );
    const reported = new Set<string>();
    for (const route of routes) {
      const method = route.method.toUpperCase();
      const path = normalised(route.path);
      const atCreate = method === 'POST' && createPaths.has(path);
      const atChild =
        (method === 'PATCH' || method === 'PUT') && [...createPaths].some((create) => path === `${create}/:`);
      const key = routeKey(method, route.path);
      if (!(atCreate || atChild) || named.has(key) || reported.has(key)) continue;
      reported.add(key);
      find(
        'undeclared-write-route',
        moduleId,
        null,
        `${moduleId} registers ${method} ${route.path} (${route.file}:${route.line}) beside a declared create, ` +
          'and no `customFieldWrites` entry names it. Declare it, or exempt the write with a reason.',
      );
    }
  }

  // 4. The population: every supported type, both halves.
  for (const entityType of input.entityTypes) {
    const own = declarations.filter((d) => d.entityType === entityType);
    if (!own.some((d) => d.kind === 'create')) {
      find(
        'entity-type-undeclared',
        null,
        entityType,
        `No module declares the admin create of \`${entityType}\`, or exempts it with a reason.`,
      );
    }
    if (!own.some((d) => d.kind === 'update' || d.kind === 'values')) {
      find(
        'entity-type-undeclared',
        null,
        entityType,
        `No module declares the admin update (or values endpoint) of \`${entityType}\`, or exempts it with a reason.`,
      );
    }
  }

  // 5. Every surface the registry opens has its declaration, and the reverse.
  for (const [entityType, surfaces] of input.inputSurfaces) {
    for (const surface of surfaces) {
      const declared = declarations.some(
        (d) => d.shape === 'buyer-input' && d.entityType === entityType && d.surface === surface,
      );
      if (!declared) {
        find(
          'surface-without-contract',
          null,
          entityType,
          `The custom-field registry opens \`${surface}\` for \`${entityType}\`, and no module declares the ` +
            'buyer-input write that carries its values.',
        );
      }
    }
  }
  for (const declaration of declarations) {
    if (declaration.shape !== 'buyer-input') continue;
    if (!(input.inputSurfaces.get(declaration.entityType) ?? []).includes(declaration.surface)) {
      find(
        'surface-without-contract',
        declaration.moduleId,
        declaration.entityType,
        `${declaration.moduleId} declares the \`${declaration.surface}\` input of \`${declaration.entityType}\`, ` +
          'which the custom-field registry does not open for that type.',
      );
    }
  }

  return { findings, declarations, exemptions, routeFiles };
}
