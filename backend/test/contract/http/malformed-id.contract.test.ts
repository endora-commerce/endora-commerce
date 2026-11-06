import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #781 — a path parameter that is not a UUID names no record, so every
 * id route answers it exactly as it answers a well-formed id that names
 * nothing: the route's own `404`, before any database read. It used to reach
 * PostgreSQL unchecked on most routes, which raised `invalid input syntax for
 * type uuid` and answered `500`; a route whose params schema demanded a UUID
 * answered `400` instead (owner ruling of 2026-11-05: `404`).
 *
 * Two tables, both asked of the composed application:
 *
 *  1. **The named routes** — the mutations the issue lists and the
 *     Organization role routes — each with a body its schema accepts, so the
 *     id is what the route is answering about, and the not-found code the
 *     route owns.
 *  2. **Every mounted route with a path parameter**, read from the route table
 *     Fastify built (the OpenAPI document), called twice: once with a
 *     malformed value in every parameter and once with a well-formed UUID that
 *     names nothing. The two answers must agree on status and code, and
 *     neither may be a `500`.
 *
 * ## What the sweep cannot see, stated rather than implied
 *
 *  - **A route whose body the sampler cannot satisfy.** The body is built from
 *    the request schema's required fields; where it still fails validation,
 *    both calls answer the same `400` and agree without reaching the id.
 *  - **A second actor.** Admin routes are called as the platform
 *    administrator, every other route as the seeded buyer; a route that
 *    refuses that buyer (`403`) refuses both calls alike.
 *  - **A parameter that is not an id** — a code, a slug, a key. The two values
 *    are then two unknown keys, and they agree for the same reason.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
const CUSTOMER = { b2b_session: 'stub-customer-session' };
const CHANNEL = { 'x-sales-channel': 'pl_retail' };
const MALFORMED = '1c0785cf';
const UNKNOWN_ID = '00000000-0000-4000-8000-00000000f781';
/** A well-formed id the sampler puts into a body field that asks for a UUID. */
const BODY_ID = '00000000-0000-4000-8000-00000000b781';

type Json = Record<string, unknown>;

function codeOf(body: string): string {
  try {
    return (JSON.parse(body) as { error?: { code?: string } }).error?.code ?? '';
  } catch {
    return '';
  }
}

/** The smallest value a JSON schema accepts, as far as a required-fields walk can tell. */
function sample(schema: Json | undefined, document: Json, depth = 0): unknown {
  if (!schema || depth > 8) return undefined;
  if (typeof schema.$ref === 'string') {
    let node: unknown = document;
    for (const part of schema.$ref.replace(/^#\//, '').split('/')) node = (node as Json | undefined)?.[part];
    return sample(node as Json | undefined, document, depth + 1);
  }
  if ('const' in schema) return schema.const;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  for (const key of ['anyOf', 'oneOf'] as const) {
    const options = schema[key] as Json[] | undefined;
    if (options?.length) {
      return sample(options.find((option) => option.type !== 'null') ?? options[0], document, depth + 1);
    }
  }
  if (Array.isArray(schema.allOf)) {
    return Object.assign({}, ...schema.allOf.map((part) => sample(part as Json, document, depth + 1)));
  }
  if ('default' in schema) return schema.default;
  const type = Array.isArray(schema.type) ? (schema.type as string[]).find((t) => t !== 'null') : schema.type;
  switch (type) {
    case 'object': {
      const properties = (schema.properties ?? {}) as Record<string, Json>;
      const out: Json = {};
      for (const key of (schema.required as string[] | undefined) ?? []) {
        out[key] = sample(properties[key], document, depth + 1);
      }
      return out;
    }
    case 'array':
      return Array.from({ length: (schema.minItems as number | undefined) ?? 0 }, () =>
        sample(schema.items as Json | undefined, document, depth + 1),
      );
    case 'string':
      if (schema.format === 'uuid') return BODY_ID;
      if (schema.format === 'date-time') return '2026-01-01T00:00:00.000Z';
      if (schema.format === 'date') return '2026-01-01';
      if (schema.format === 'email') return 'malformed-id@example.com';
      if (schema.format === 'uri') return 'https://example.com';
      return 'x'.repeat(Math.max((schema.minLength as number | undefined) ?? 1, 1));
    case 'integer':
    case 'number':
      return (schema.minimum as number | undefined) ?? 1;
    case 'boolean':
      return false;
    default:
      return undefined;
  }
}

interface NamedRoute {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** The path, with `:id` where the malformed value goes. */
  readonly path: string;
  readonly cookies: Record<string, string>;
  readonly payload?: Json;
  /** The route's own not-found code. */
  readonly code: string;
}

const NAMED: readonly NamedRoute[] = [
  { method: 'POST', path: '/api/v1/orders/:id/cancel', cookies: CUSTOMER, code: ERROR_CODES.ORDER_NOT_FOUND },
  { method: 'POST', path: '/api/v1/returns/:id/comments', cookies: CUSTOMER, payload: { body: 'Hello' }, code: ERROR_CODES.NOT_FOUND },
  {
    method: 'POST',
    path: '/api/v1/returns/:id/select-delivery-method',
    cookies: CUSTOMER,
    payload: { returnDeliveryMethodId: BODY_ID },
    code: ERROR_CODES.NOT_FOUND,
  },
  { method: 'POST', path: '/api/v1/returns/:id/cancel', cookies: CUSTOMER, code: ERROR_CODES.NOT_FOUND },
  { method: 'POST', path: '/api/v1/organization/carts/:id/approve', cookies: CUSTOMER, code: ERROR_CODES.NOT_FOUND },
  {
    method: 'POST',
    path: '/api/v1/organization/carts/:id/reject',
    cookies: CUSTOMER,
    payload: { reason: 'Not this quarter.' },
    code: ERROR_CODES.NOT_FOUND,
  },
  { method: 'POST', path: '/api/v1/admin/carts/:id/approve', cookies: ADMIN, code: ERROR_CODES.NOT_FOUND },
  {
    method: 'POST',
    path: '/api/v1/admin/carts/:id/reject',
    cookies: ADMIN,
    payload: { reason: 'Not this quarter.' },
    code: ERROR_CODES.NOT_FOUND,
  },
  { method: 'GET', path: '/api/v1/organizations/mine/roles/:id', cookies: CUSTOMER, code: ERROR_CODES.NOT_FOUND },
  {
    method: 'PATCH',
    path: '/api/v1/organizations/mine/roles/:id',
    cookies: CUSTOMER,
    payload: { expectedVersion: 1, name: 'Buyer' },
    code: ERROR_CODES.NOT_FOUND,
  },
  {
    method: 'DELETE',
    path: '/api/v1/organizations/mine/roles/:id',
    cookies: CUSTOMER,
    payload: { expectedVersion: 1 },
    code: ERROR_CODES.NOT_FOUND,
  },
  {
    method: 'PATCH',
    path: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/roles/:id`,
    cookies: ADMIN,
    payload: { expectedVersion: 1, name: 'Buyer' },
    code: ERROR_CODES.NOT_FOUND,
  },
  {
    method: 'DELETE',
    path: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/roles/:id`,
    cookies: ADMIN,
    payload: { expectedVersion: 1 },
    code: ERROR_CODES.NOT_FOUND,
  },
  { method: 'GET', path: '/api/v1/admin/organizations/:id/roles', cookies: ADMIN, code: ERROR_CODES.NOT_FOUND },
];

/**
 * Routes the sweep reports and this change does not fix, each with the issue that will.
 * Two-way: an entry the sweep no longer reports fails as loudly as a new
 * report, so the list cannot outlive what it describes.
 */
const CUSTOMER_GUARD =
  '`customers` checks the id ahead of every customer sub-resource and answers its own ' +
  '`CUSTOMER_NOT_FOUND` (issue #753); the sub-resource answers an unknown customer with its own ' +
  'code or an empty list. Not accepted behaviour: the guard is to check that the customer exists ' +
  'and answer both alike, issue #794.';
const UNKNOWN_FAILS =
  'A well-formed id that names nothing answers 500 here too, so this is not a malformed-id ' +
  'answer: a separate defect, issue #793.';

const KNOWN: Readonly<Record<string, string>> = {
  'PATCH /api/v1/admin/customers/{id}/custom-fields': CUSTOMER_GUARD,
  'POST /api/v1/admin/customers/{id}/impersonate': CUSTOMER_GUARD,
  'GET /api/v1/admin/customers/{id}/addresses': CUSTOMER_GUARD,
  'GET /api/v1/admin/customers/{id}/orders': CUSTOMER_GUARD,
  'GET /api/v1/admin/customers/{id}/quote-requests': CUSTOMER_GUARD,
  'GET /api/v1/admin/customers/{id}/carts': CUSTOMER_GUARD,
  'GET /api/v1/admin/modules/{id}/deactivation-impact': UNKNOWN_FAILS,
  'POST /api/v1/admin/seo/sitemap/{channelCode}/regenerate': UNKNOWN_FAILS,
  'GET /api/v1/admin/seo/sitemap/{channelCode}/xml': UNKNOWN_FAILS,
  'GET /api/v1/admin/organizations/{id}/restrictions': UNKNOWN_FAILS,
  'POST /api/v1/admin/organizations/{id}/vat-validations': UNKNOWN_FAILS,
};

describe('a malformed :id answers the route’s own 404 (issue #781)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const call = (route: NamedRoute, id: string) =>
    h.app.inject({
      method: route.method,
      url: route.path.replace(':id', encodeURIComponent(id)),
      cookies: route.cookies,
      headers: CHANNEL,
      ...(route.payload ? { payload: route.payload } : {}),
    });

  it.each(NAMED.map((route) => [`${route.method} ${route.path}`, route] as const))(
    '%s answers 404 for a malformed id, as for an unknown one',
    async (_name, route) => {
      const malformed = await call(route, MALFORMED);
      expect({ status: malformed.statusCode, code: codeOf(malformed.body) }).toEqual({ status: 404, code: route.code });
      const unknown = await call(route, UNKNOWN_ID);
      expect({ status: unknown.statusCode, code: codeOf(unknown.body) }).toEqual({ status: 404, code: route.code });
    },
  );

  it('every mounted route with a path parameter answers a malformed value as it answers an unknown id', async () => {
    const document = (await h.app.inject({ method: 'GET', url: '/api/v1/_openapi.json', cookies: ADMIN })).json() as Json & {
      paths: Record<string, Record<string, Json>>;
    };

    const routes: Array<{ key: string; method: string; path: string; payload: unknown; admin: boolean }> = [];
    for (const [path, operations] of Object.entries(document.paths)) {
      if (!path.includes('{')) continue;
      for (const [method, operation] of Object.entries(operations)) {
        const verb = method.toUpperCase();
        const content = ((operation.requestBody as Json | undefined)?.content ?? {}) as Record<string, { schema?: Json }>;
        const schema = content['application/json']?.schema;
        const payload = schema ? sample(schema, document) : verb === 'GET' || verb === 'DELETE' ? undefined : {};
        routes.push({ key: `${verb} ${path}`, method: verb, path, payload, admin: path.startsWith('/api/v1/admin/') });
      }
    }
    expect(routes.length).toBeGreaterThan(100);

    const disagreeing: string[] = [];
    const failing: string[] = [];
    for (const route of routes) {
      const params = [...route.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!);
      const ask = (malformed: string | null) =>
        h.app.inject({
          method: route.method as 'GET',
          // `null` asks with every parameter unknown; a name puts the malformed
          // value in that parameter alone, so a lookup keyed by two ids is
          // asked about each.
          url: route.path.replace(/\{([^}]+)\}/g, (_whole, name: string) =>
            malformed === name || malformed === '*' ? MALFORMED : UNKNOWN_ID,
          ),
          cookies: route.admin ? ADMIN : CUSTOMER,
          headers: CHANNEL,
          ...(route.payload === undefined ? {} : { payload: route.payload as Json }),
        });
      const unknown = await ask(null);
      const u = `${unknown.statusCode} ${codeOf(unknown.body)}`;
      if (unknown.statusCode >= 500) failing.push(`${route.key}: unknown ${u}`);
      for (const which of params.length > 1 ? ['*', ...params] : ['*']) {
        const malformed = await ask(which);
        const m = `${malformed.statusCode} ${codeOf(malformed.body)}`;
        const label = which === '*' ? route.key : `${route.key} [${which}]`;
        if (malformed.statusCode >= 500) failing.push(`${label}: malformed ${m}, unknown ${u}`);
        else if (m !== u && !(malformed.statusCode === 404 && unknown.statusCode === 400)) {
          // A route that checks the id ahead of the body answers the malformed
          // id `404` where the unknown one, which passes the check, meets the
          // body's `400` — the id is still answered before any read.
          disagreeing.push(`${label}: malformed ${m}, unknown ${u}`);
        }
      }
    }

    // eslint-disable-next-line no-console -- the read size of a sweep is part of its result.
    console.log(`[malformed-id] routes=${routes.length} failing=${failing.length} disagreeing=${disagreeing.length}`);
    const reported = [...failing, ...disagreeing];
    const keyOf = (line: string) => line.slice(0, line.indexOf(': '));
    expect(
      failing.filter((line) => !(keyOf(line) in KNOWN)),
      'routes that answered 500',
    ).toEqual([]);
    expect(
      disagreeing.filter((line) => !(keyOf(line) in KNOWN)),
      'routes that answer a malformed value unlike an unknown id',
    ).toEqual([]);
    expect(
      Object.keys(KNOWN).filter((key) => !reported.some((line) => keyOf(line) === key)),
      'known entries the sweep no longer reports',
    ).toEqual([]);
  }, 1_200_000);
});
