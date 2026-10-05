/**
 * A17's measurement — who a served request runs as, read through the routes a
 * client would use (Principle XI).
 *
 * `instance-tenancy-probe.ts` asks the guard, in a process of its own. This
 * asks the thing that process cannot: what tenant context the **running
 * instance** gives a request once somebody is signed in. So it is HTTP against
 * the boot A4 started, and it stays in this process — there is no package to
 * resolve from the instance, only an address to call.
 *
 * ## The fixture is made the way an operator would make it, except the orders
 *
 * Two organizations are registered through the public route, a member is added
 * to each through the admin route, and the API key is created through the admin
 * route — every one of them a request the instance itself serves and audits.
 *
 * The orders are the exception and are written as rows. Placing one through
 * the API needs a product, a price, a delivery method and a payment method, and
 * the module set `endora new instance` writes ships no delivery or payment
 * adapter to configure one with — so the alternative is an assertion that needs
 * modules the default instance does not have. The row is derived from the
 * table's own definition ({@link seedOrder}): the three columns that decide who
 * owns it are set, and every other required column takes a value of its
 * declared type. Nothing else about an order is this assertion's subject.
 */

import { randomUUID } from 'node:crypto';

import { ADMIN_SESSION_COOKIE_NAME } from '@endora-commerce/contracts';

import {
  ADMIN_LOGIN_PATH,
  ADMIN_ORDERS_PATH,
  CUSTOMER_ORDERS_PATH,
  EXTERNAL_ORDERS_PATH,
  type ActorOrderReads,
  type ActorScopeObservation,
} from './instance-assertions.js';

const CUSTOMER_LOGIN_PATH = '/api/v1/auth/customer/login';
const REGISTER_PATH = '/api/v1/organizations/register';
const ADMIN_ORGANIZATIONS_PATH = '/api/v1/admin/organizations';
const ADMIN_API_KEYS_PATH = '/api/v1/admin/api-keys';

/** This run's own; the database it is written to is created and dropped by the run. */
const MEMBER_PASSWORD = 'Acceptance-Member-1!';

/** Thrown for "the fixture could not be built", never for "the scope was wrong". */
class SetupFailure extends Error {}

interface Answer {
  readonly status: number;
  readonly body: unknown;
  readonly text: string;
  readonly cookies: readonly string[];
}

async function call(
  base: string,
  method: string,
  path: string,
  options: { readonly body?: unknown; readonly cookie?: string; readonly bearer?: string } = {},
): Promise<Answer> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
      ...(options.bearer === undefined ? {} : { authorization: `Bearer ${options.bearer}` }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON is still an answer; the status is what the caller reads.
  }
  return { status: response.status, body, text, cookies: response.headers.getSetCookie?.() ?? [] };
}

/** `name=value` pairs out of a response's `Set-Cookie` headers, as a `Cookie` header. */
function cookieHeader(cookies: readonly string[]): string {
  return cookies.map((cookie) => cookie.split(';')[0]).join('; ');
}

function dataOf(answer: Answer): Record<string, unknown> {
  const data = (answer.body as { data?: unknown } | null)?.data;
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
}

function expectStatus(answer: Answer, status: number, what: string): void {
  if (answer.status !== status) {
    throw new SetupFailure(`${what} answered ${String(answer.status)}: ${answer.text.slice(0, 240)}`);
  }
}

function stringAt(record: Record<string, unknown>, path: readonly string[], what: string): string {
  let value: unknown = record;
  for (const key of path) value = (value as Record<string, unknown> | undefined)?.[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new SetupFailure(`${what} carried no ${path.join('.')}`);
  }
  return value;
}

/** The slice of a `pg` client the fixture writes through. */
export interface PgClient {
  query<Row>(text: string, values?: readonly unknown[]): Promise<{ rows: Row[] }>;
}

/**
 * One order row owned by `organizationId`, written from the table's own
 * definition: every required column with no default takes a value of its
 * declared type, and the three ownership columns take the ones given.
 */
export async function seedOrder(
  client: PgClient,
  owner: { readonly organizationId: string; readonly customerAccountId: string },
  salesChannelId: string,
): Promise<string> {
  const columns = await client.query<{ column_name: string; data_type: string }>(
    'select column_name, data_type from information_schema.columns ' +
      "where table_schema = current_schema() and table_name = 'orders' " +
      "and is_nullable = 'NO' and column_default is null order by ordinal_position",
  );
  if (columns.rows.length === 0) {
    throw new SetupFailure('this instance has no `orders` table to read across organizations in');
  }
  const id = randomUUID();
  const given: Readonly<Record<string, string>> = {
    id,
    organization_id: owner.organizationId,
    placed_by_customer_account_id: owner.customerAccountId,
    sales_channel_id: salesChannelId,
  };
  const names: string[] = [];
  const values: unknown[] = [];
  for (const column of columns.rows) {
    const type = column.data_type.toLowerCase();
    let value: unknown;
    if (Object.hasOwn(given, column.column_name)) value = given[column.column_name];
    else if (type === 'uuid') value = randomUUID();
    else if (/json/.test(type)) value = '{}';
    else if (/numeric|decimal|integer|bigint|smallint|double|real/.test(type)) value = 0;
    else if (/bool/.test(type)) value = false;
    else if (/timestamp|date/.test(type)) value = new Date();
    else if (/char|text/.test(type)) {
      // A three-letter value is a currency code where the column is one, and a
      // unique-enough label everywhere else.
      value = column.column_name === 'currency' ? 'EUR' : `a17-${id.slice(0, 8)}`;
    } else {
      throw new SetupFailure(
        `orders.${column.column_name} is a required ${column.data_type} this run will not ` +
          'invent a value for',
      );
    }
    names.push(`"${column.column_name}"`);
    values.push(value);
  }
  for (const required of Object.keys(given)) {
    if (!names.includes(`"${required}"`)) {
      throw new SetupFailure(
        `the \`orders\` table has no required \`${required}\` column, so a row's owner cannot ` +
          'be set the way this assertion needs',
      );
    }
  }
  await client.query(
    `insert into "orders" (${names.join(', ')}) values (${values.map((_, index) => `$${String(index + 1)}`).join(', ')})`,
    values,
  );
  return id;
}

async function orderReads(
  base: string,
  listPath: string,
  credentials: { readonly cookie?: string; readonly bearer?: string },
  ownOrderId: string,
  foreignOrderId: string,
): Promise<ActorOrderReads> {
  const own = await call(base, 'GET', `${listPath}/${ownOrderId}`, credentials);
  const foreign = await call(base, 'GET', `${listPath}/${foreignOrderId}`, credentials);
  const list = await call(base, 'GET', listPath, credentials);
  const rows = (list.body as { data?: unknown } | null)?.data;
  const listedOrganizations = Array.isArray(rows)
    ? [
        ...new Set(
          rows
            .map((row) => (row as { organizationId?: unknown }).organizationId)
            .filter((value): value is string => typeof value === 'string'),
        ),
      ].sort()
    : [];
  return {
    ownStatus: own.status,
    foreignStatus: foreign.status,
    listStatus: list.status,
    listedOrganizations,
  };
}

const NOT_ASKED: Omit<ActorScopeObservation, 'setupFailure'> = {
  ownOrganizationId: null,
  customer: null,
  apiKey: null,
  reparent: null,
  audit: null,
  twoSessions: null,
};

/**
 * Ask A17's readings of the instance serving at `base`.
 *
 * `administrator` is the one A15 created with the instance's own CLI, so the
 * admin half is asked as the administrator a client would have.
 */
export async function measureActorScope(
  base: string,
  dsn: string,
  administrator: { readonly email: string; readonly password: string },
): Promise<ActorScopeObservation> {
  const { Client } = await import('pg');
  const client = new Client({ connectionString: dsn });
  try {
    await client.connect();
    const run = randomUUID().slice(0, 8);

    const adminLogin = await call(base, 'POST', ADMIN_LOGIN_PATH, { body: administrator });
    expectStatus(adminLogin, 200, `POST ${ADMIN_LOGIN_PATH}`);
    const adminCookie = cookieHeader(
      adminLogin.cookies.filter((cookie) => cookie.startsWith(`${ADMIN_SESSION_COOKIE_NAME}=`)),
    );
    const adminUserId = stringAt(dataOf(adminLogin), ['adminUser', 'id'], 'the admin login');

    // Two organizations, each with a member who administers it.
    const tenants: { organizationId: string; customerAccountId: string; email: string }[] = [];
    for (const label of ['one', 'two']) {
      const registered = await call(base, 'POST', REGISTER_PATH, {
        body: {
          organization: {
            name: `A17 ${label} ${run}`,
            taxId: `A17${run}${label}`.slice(0, 32),
            registeredAddress: { street: 'A17', city: 'A17', postalCode: '00-001', country: 'PL' },
          },
          firstUser: {
            email: `a17-first-${label}-${run}@instance.acceptance.invalid`,
            password: MEMBER_PASSWORD,
            firstName: 'Acceptance',
            lastName: label,
          },
          acceptedTermsVersion: '1',
        },
      });
      expectStatus(registered, 201, `POST ${REGISTER_PATH}`);
      const organizationId = stringAt(dataOf(registered), ['organization', 'id'], 'the registration');
      const email = `a17-member-${label}-${run}@instance.acceptance.invalid`;
      const member = await call(base, 'POST', `${ADMIN_ORGANIZATIONS_PATH}/${organizationId}/members`, {
        cookie: adminCookie,
        body: {
          email,
          firstName: 'Acceptance',
          lastName: label,
          password: MEMBER_PASSWORD,
          // The role whose order list is scoped by the ambient tenant filter
          // alone (see `evaluateA17`).
          role: 'organization_admin',
        },
      });
      expectStatus(member, 201, `POST ${ADMIN_ORGANIZATIONS_PATH}/:id/members`);
      tenants.push({
        organizationId,
        customerAccountId: stringAt(dataOf(member), ['id'], 'the new member'),
        email,
      });
    }
    const [own, other] = tenants as [(typeof tenants)[number], (typeof tenants)[number]];

    const channel = await client.query<{ id: string }>(
      'select id from sales_channels order by created_at asc limit 1',
    );
    const salesChannelId = channel.rows[0]?.id;
    if (salesChannelId === undefined) {
      throw new SetupFailure('the instance has no sales channel to place an order or bind a key in');
    }
    const ownOrderId = await seedOrder(client, own, salesChannelId);
    const foreignOrderId = await seedOrder(client, other, salesChannelId);

    // The customer.
    const customerLogin = await call(base, 'POST', CUSTOMER_LOGIN_PATH, {
      body: { email: own.email, password: MEMBER_PASSWORD },
    });
    expectStatus(customerLogin, 200, `POST ${CUSTOMER_LOGIN_PATH}`);
    const customerCookie = cookieHeader(customerLogin.cookies);
    const customer = await orderReads(
      base,
      CUSTOMER_ORDERS_PATH,
      { cookie: customerCookie },
      ownOrderId,
      foreignOrderId,
    );

    // One browser signed in to both: every request below carries the admin
    // session and the customer session, and the route decides which of them
    // it runs as. Read before the re-parent, like the readings above.
    const bothCookies = `${adminCookie}; ${customerCookie}`;
    const customerRouteWithBoth = await orderReads(
      base,
      CUSTOMER_ORDERS_PATH,
      { cookie: bothCookies },
      ownOrderId,
      foreignOrderId,
    );
    const adminRouteWithBoth = await orderReads(
      base,
      ADMIN_ORDERS_PATH,
      { cookie: bothCookies },
      ownOrderId,
      foreignOrderId,
    );

    // The API key, bound to the same organization.
    const key = await call(base, 'POST', ADMIN_API_KEYS_PATH, {
      cookie: adminCookie,
      body: {
        name: `a17-${run}`,
        scopes: ['orders:read'],
        binding: {
          organizationId: own.organizationId,
          salesChannelId,
          customerAccountId: own.customerAccountId,
        },
      },
    });
    expectStatus(key, 201, `POST ${ADMIN_API_KEYS_PATH}`);
    const apiKey = await orderReads(
      base,
      EXTERNAL_ORDERS_PATH,
      { bearer: stringAt(dataOf(key), ['bearerToken'], 'the new API key') },
      ownOrderId,
      foreignOrderId,
    );

    // The administrator, last: the re-parent changes the tree the readings
    // above were taken over.
    // The database's own clock, so "written by the re-parent" is not a
    // comparison between two machines' times.
    const before = (await client.query<{ now: Date }>('select now() as now')).rows[0]?.now;
    const reparent = await call(
      base,
      'POST',
      `${ADMIN_ORGANIZATIONS_PATH}/${other.organizationId}/parent`,
      { cookie: adminCookie, body: { parentId: own.organizationId } },
    );
    const audit = await client.query<{ action: string; actor_admin_user_id: string | null }>(
      'select action, actor_admin_user_id from audit_log_entries ' +
        'where object_id = $1 and acted_at >= $2 order by acted_at asc',
      [other.organizationId, before],
    );

    // The second re-parent, with both cookies: the organization moved above is
    // detached again. It is its own Command with its own audit rows, read from
    // the database's clock after the first one's.
    const beforeDetach = (await client.query<{ now: Date }>('select now() as now')).rows[0]?.now;
    const detach = await call(
      base,
      'POST',
      `${ADMIN_ORGANIZATIONS_PATH}/${other.organizationId}/parent`,
      { cookie: bothCookies, body: { parentId: null } },
    );
    const detachAudit = await client.query<{ action: string; actor_admin_user_id: string | null }>(
      'select action, actor_admin_user_id from audit_log_entries ' +
        'where object_id = $1 and acted_at >= $2 order by acted_at asc',
      [other.organizationId, beforeDetach],
    );

    return {
      setupFailure: null,
      ownOrganizationId: own.organizationId,
      customer,
      apiKey,
      reparent: { status: reparent.status, body: reparent.text },
      audit: {
        adminUserId,
        entries: audit.rows.map((row) => ({
          action: row.action,
          actorAdminUserId: row.actor_admin_user_id,
        })),
      },
      twoSessions: {
        otherOrganizationId: other.organizationId,
        adminRoute: {
          listStatus: adminRouteWithBoth.listStatus,
          listedOrganizations: adminRouteWithBoth.listedOrganizations,
        },
        customerRoute: customerRouteWithBoth,
        reparent: { status: detach.status, body: detach.text },
        auditEntries: detachAudit.rows.map((row) => ({
          action: row.action,
          actorAdminUserId: row.actor_admin_user_id,
        })),
      },
    };
  } catch (error) {
    // A fixture that could not be built and a transport that failed are both
    // "this run could not ask", and are reported as that — never as a verdict
    // on the scope.
    return {
      ...NOT_ASKED,
      setupFailure: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}
