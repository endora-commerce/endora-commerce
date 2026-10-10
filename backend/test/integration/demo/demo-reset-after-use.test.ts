/**
 * `demo reset` withdraws a demo that has been used (issue #143).
 *
 * ## What `demo-shop.test.ts` cannot see
 *
 * That file seeds and resets a shop nobody has touched, so the withdrawal only
 * ever meets the rows the seed wrote. A demo exists to be used: the buyer signs
 * in, saves an address, places an order on credit — and from then on the demo
 * organisation is referenced by rows no seed created. Two of those references
 * are foreign keys that refuse the withdrawal outright, and the rest carry no
 * foreign key at all, so a reset that did go through left them naming an
 * organisation that no longer existed.
 *
 * ## What this file asserts
 *
 *  1. **A used demo resets, exit 0** — through the dispatcher the CLI runs,
 *     over this file's own database.
 *  2. **Nothing still names what the reset deleted** — derived, not listed: the
 *     ids of every row the reset removed are collected by diffing the database
 *     before and after, and then *every* id column of *every* table is asked
 *     whether it still holds one. A reference this file did not think of is
 *     found by existing. The columns allowed to keep one are a recorded ledger
 *     below, each with its reason.
 *  3. **A real customer on the same instance loses nothing** — a second
 *     organisation is given the same usage rows, table for table, and every one
 *     of them is still there afterwards.
 *  4. **A refusal part-way leaves the instance as it found it** — a foreign key
 *     this repository knows nothing about refuses the withdrawal, and not one
 *     table's row count has moved; the buyer can still check out.
 *  5. **`demo seed` afterwards gives a working shop back** — the buyer signs in
 *     and places an order on credit again.
 *  6. **A sub-organisation stops the reset before it starts** — the withdrawal
 *     matches the demo organisation and nothing filed under it.
 *
 * The reset in (1)–(3) runs with `crm` and `returns` **switched off**. Off is
 * the operator's decision about a module's behaviour, not about whether its
 * rows exist: an Opportunity of the demo organisation still refuses that
 * organisation's deletion, and a return case still names its order. So the
 * withdrawal asks whether a module's tables are there, not whether the module
 * is active — one module of each kind, a foreign key that refuses and a column
 * that silently dangles, is switched off to hold that.
 *
 * The refusal in (4) is asked three times, at three depths of the run: a
 * foreign key onto an order, onto the organisation and onto a product. The
 * last two are refused by a **module's own** withdrawal, long after the
 * composition's — which is what makes "as it found it" a property of the whole
 * reset rather than of its first step.
 *
 * ## How the demo is used
 *
 * The address and the order are the buyer's own requests against the composed
 * HTTP surface — a real sign-in, `POST /organizations/mine/addresses`, a cart
 * line, `POST /orders` with the credit-limit method — because those are the two
 * the issue names and the path decides what else is written beside them (stock
 * allocations, the reservation, the payment, the session). Every further table
 * that can come to reference the demo organisation or one of its accounts gets
 * one row, written directly: the population was read off this database's own
 * foreign-key catalogue and its `uuid` columns, and reaching each through its
 * own route would be forty features' fixtures in one file.
 *
 * ## Why it is in-process
 *
 * `demo-shop.test.ts` spawns the CLI against a database of its own. This file
 * needs the composed application on the *same* database between the seed and
 * the reset, to act as the buyer, so it drives `dispatchCli` — the function the
 * CLI entry point calls — with the harness's composition. The exit code is the
 * dispatcher's own.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDemoComposition,
  DEMO_BUYER_EMAIL,
  DEMO_BUYER_PASSWORD,
} from '@endora-commerce/demo-composition';
import { cliFailureExitCode, dispatchCli, type CliComposition } from '@endora-commerce/platform/cli';
import {
  DEMO_FORCE_DELETE_FINANCIAL_RECORDS_FLAG as FORCE,
  type DemoComposition,
  type DemoCompositionInput,
} from '@endora-commerce/platform/demo';
import { resolvedManifestEntries } from '../../../src/lifecycle/registered-manifests.js';
import { deploymentRoot } from '../../../src/overlay/overlay-roots.js';
import { withModulesDeactivated } from '../../helpers/modules-deactivated.js';
import { promotionServiceFor } from '../../helpers/promotion-service.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

const SUITE_TIMEOUT_MS = 900_000;

/** The demo organisation's tax id — `organizations`' own demo row is keyed on it. */
const DEMO_ORG_TAX_ID = 'PL5210000099';
/** The kinds a refusal counts, as it prints them. */
const INVOICES = 'invoices and corrections, or invoices of any kind with an external reference';
const PAYMENTS = 'payments that were paid or refunded';
const LEDGER = 'accounting-system records';
const ALL_KINDS = [INVOICES, PAYMENTS, LEDGER, 'refunds', 'refunds settled against the credit limit'];
/** What a reset stopped by `STOP_AFTER_PREFLIGHT` says once the pre-flight has let it through. */
const PREFLIGHT_PASSED = 'the financial pre-flight let this reset through';

/** The organisation standing in for a real customer on the same instance. */
const REAL_ORG_TAX_ID = 'PL7777777777';

/**
 * The `uuid` columns that may still hold the id of a row the reset deleted.
 *
 * Each is a **record of something that happened**, kept on purpose: deleting it
 * would be rewriting history rather than withdrawing data. Anything else that
 * turns up fails the test — re-record an entry only with its reason.
 *
 * Two-way: an entry nothing produces any more fails as well.
 */
const KEPT_REFERENCES: Readonly<Record<string, string>> = {
  // The audit trail is append-only: it names what a write was made to and who
  // it was made for, whether or not either still exists.
  'audit_log_entries.object_id': 'append-only audit trail',
  'audit_log_entries.impersonated_customer_account_id': 'append-only audit trail',
  // A log of messages that were really sent, and of bell entries an
  // administrator was really shown.
  'email_deliveries.document_id': 'delivery log of messages already sent',
  'admin_notifications.subject_id': 'notification history of events that happened',
};

interface ColumnInfo {
  readonly table_name: string;
  readonly column_name: string;
  readonly data_type: string;
  readonly udt_name: string;
  readonly is_nullable: 'YES' | 'NO';
  readonly column_default: string | null;
  readonly character_maximum_length: number | null;
}

/** Whose rows a batch of usage is written for. */
interface Tenant {
  readonly organizationId: string;
  readonly customerAccountId: string;
  readonly orderId: string;
  readonly orderItemId: string;
  readonly creditLimitId: string;
}

/**
 * Whose a row is: the demo organisation's, a real customer's, or **nobody's** —
 * a guest's cart, an anonymous subscriber, an instance-wide webhook. The last
 * is what a predicate that matched "no organisation" would take with it.
 */
type Owner = 'demo' | 'real' | 'nobody';

/** One row this file wrote, as the predicate that finds it again. */
interface TrackedRow {
  readonly table: string;
  readonly where: Readonly<Record<string, unknown>>;
}

describe('demo reset on a demo that has been used (issue #143)', () => {
  let h: BackendServerHandle;
  let db: Client;
  let columns: ColumnInfo[];

  // ── the database, read generically ───────────────────────────────────────

  async function query<Row extends Record<string, unknown>>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<Row[]> {
    return (await db.query(text, [...params])).rows as Row[];
  }

  function columnsOf(table: string): ColumnInfo[] {
    const found = columns.filter((column) => column.table_name === table);
    if (found.length === 0) throw new Error(`no table '${table}' in this database`);
    return found;
  }

  /** A value for a `NOT NULL` column nobody gave one — typed, and otherwise meaningless. */
  function filler(column: ColumnInfo): unknown {
    const name = column.column_name;
    if (name === 'currency') return 'PLN';
    if (name === 'country') return 'PL';
    if (name === 'email') return `u${randomBytes(6).toString('hex')}@usage.example`;
    switch (column.data_type) {
      case 'uuid':
        return randomUUID();
      case 'character varying':
      case 'text':
      case 'character': {
        const value = `u${randomBytes(8).toString('hex')}`;
        return column.character_maximum_length === null
          ? value
          : value.slice(0, column.character_maximum_length);
      }
      case 'integer':
      case 'smallint':
      case 'bigint':
        return 1;
      case 'numeric':
      case 'double precision':
        return '0';
      case 'boolean':
        return false;
      case 'jsonb':
      case 'json':
        return '{}';
      case 'timestamp with time zone':
      case 'timestamp without time zone':
      case 'date':
        return new Date();
      case 'inet':
        return '127.0.0.1';
      case 'bytea':
        return randomBytes(12);
      case 'ARRAY':
        return '{}';
      default:
        throw new Error(
          `no filler for ${column.table_name}.${column.column_name} (${column.data_type})`,
        );
    }
  }

  /** The operator's own product each tenant has three units of on order. */
  const ownProducts = new Map<'demo' | 'real', string>();

  const tracked = new Map<Owner, TrackedRow[]>([
    ['demo', []],
    ['real', []],
    ['nobody', []],
  ]);

  /**
   * Insert one row, giving every `NOT NULL` column without a default a typed
   * filler, and remember how to find it.
   *
   * `given` is what makes the row *this tenant's* — the references under test —
   * plus whatever a check constraint insists on.
   */
  async function insert(
    owner: Owner,
    table: string,
    given: Readonly<Record<string, unknown>>,
  ): Promise<string> {
    const values: Record<string, unknown> = {};
    for (const column of columnsOf(table)) {
      if (column.column_name in given) {
        values[column.column_name] = given[column.column_name];
      } else if (column.column_name === 'id' && column.data_type === 'uuid') {
        values['id'] = randomUUID();
      } else if (column.is_nullable === 'NO' && column.column_default === null) {
        values[column.column_name] = filler(column);
      }
    }
    for (const name of Object.keys(given)) {
      if (!(name in values)) throw new Error(`'${table}' has no column '${name}'`);
    }
    const names = Object.keys(values);
    try {
      await db.query(
        `insert into "${table}" (${names.map((name) => `"${name}"`).join(', ')})
         values (${names.map((_, index) => `$${index + 1}`).join(', ')})`,
        names.map((name) => values[name]),
      );
    } catch (error) {
      throw new Error(`usage row for '${table}' was refused: ${(error as Error).message}`);
    }
    const where = 'id' in values ? { id: values['id'] } : { ...given };
    tracked.get(owner)!.push({ table, where });
    return String(values['id'] ?? '');
  }

  async function countOf(row: TrackedRow): Promise<number> {
    const names = Object.keys(row.where);
    const rows = await query<{ n: string }>(
      `select count(*)::text as n from "${row.table}"
        where ${names.map((name, index) => `"${name}" = $${index + 1}`).join(' and ')}`,
      names.map((name) => row.where[name]),
    );
    return Number(rows[0]!.n);
  }

  /** Every tracked row that is (or is not) still there, as `table {where}`. */
  async function trackedRows(owner: Owner, present: boolean): Promise<string[]> {
    const found: string[] = [];
    for (const row of tracked.get(owner)!) {
      if (((await countOf(row)) > 0) === present) {
        found.push(`${row.table} ${JSON.stringify(row.where)}`);
      }
    }
    return found.sort();
  }

  async function tableCounts(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const table of new Set(columns.map((column) => column.table_name))) {
      // The escape-hatch rows are an access log every composed run appends to.
      const rows = await query<{ n: string }>(
        table === 'audit_log_entries'
          ? `select count(*)::text as n from audit_log_entries where action <> 'tenant.escape_hatch'`
          : `select count(*)::text as n from "${table}"`,
      );
      counts[table] = Number(rows[0]!.n);
    }
    return counts;
  }

  /** The id of every row that has one, per table. */
  async function idsByTable(): Promise<Map<string, Set<string>>> {
    const result = new Map<string, Set<string>>();
    for (const column of columns) {
      if (column.column_name !== 'id' || column.data_type !== 'uuid') continue;
      const rows = await query<{ id: string }>(`select id from "${column.table_name}"`);
      result.set(column.table_name, new Set(rows.map((row) => row.id)));
    }
    return result;
  }

  /**
   * Every column still holding the id of a row that is gone, with how many
   * rows hold one — over the whole database, by no naming convention: every
   * `uuid` column, and every textual `…_id` column, which is how a polymorphic
   * reference (`document_type` / `document_id`) is usually stored.
   */
  async function referencesTo(deleted: readonly string[]): Promise<Record<string, number>> {
    const found: Record<string, number> = {};
    if (deleted.length === 0) return found;
    for (const column of columns) {
      const textual =
        (column.data_type === 'character varying' || column.data_type === 'text') &&
        column.column_name.endsWith('_id');
      if (column.data_type !== 'uuid' && !textual) continue;
      const rows = await query<{ n: string }>(
        `select count(*)::text as n from "${column.table_name}"
          where "${column.column_name}"::text = any($1::text[])`,
        [deleted],
      );
      const n = Number(rows[0]!.n);
      if (n > 0) found[`${column.table_name}.${column.column_name}`] = n;
    }
    return found;
  }

  // ── the demo, run the way the CLI runs it ────────────────────────────────

  interface DemoRun {
    readonly code: number;
    readonly out: string;
    readonly err: string;
  }

  /** What a test changes about one run: the composition it is given, and how long it may wait. */
  interface RunVariation {
    readonly composition?: (
      built: DemoComposition,
      input: DemoCompositionInput,
    ) => DemoComposition;
    readonly bounds?: { lockTimeoutMs: number; idleTimeoutMs: number };
  }

  async function demo(verb: 'seed' | 'reset', ...flags: string[]): Promise<DemoRun> {
    return await demoVaried({}, verb, ...flags);
  }

  async function demoVaried(
    variation: RunVariation,
    verb: 'seed' | 'reset',
    ...flags: string[]
  ): Promise<DemoRun> {
    let out = '';
    let err = '';
    const composition: CliComposition = {
      container: h.container,
      contextFor: () => ({ cradle: () => h.container.cradle }),
      resolvedModules: [],
      orm: h.orm,
      // The composition is the harness's, torn down once in `afterAll`.
      dispose: async () => {},
    } as unknown as CliComposition;
    try {
      const code = await dispatchCli({
        deploymentRoot: deploymentRoot(),
        argv: ['demo', verb, ...flags],
        resolveEntries: resolvedManifestEntries,
        compose: async () => composition,
        demoComposition: async (input) => {
          const built = createDemoComposition(input);
          return {
            found: true,
            composition: variation.composition?.(built, input) ?? built,
          };
        },
        ...(variation.bounds === undefined ? {} : { demoResetBounds: variation.bounds }),
        out: (chunk) => (out += chunk),
        err: (chunk) => (err += chunk),
      });
      return { code, out, err };
    } catch (thrown) {
      // What `runCli` does with a throw: the exit code an operator's shell sees.
      const code = cliFailureExitCode(thrown, (chunk) => (err += chunk));
      return { code, out, err };
    }
  }

  /** A run, and every column still naming a row it deleted. */
  async function scanned(
    run: () => Promise<DemoRun>,
  ): Promise<{ run: DemoRun; leftBehind: Record<string, number> }> {
    const before = await idsByTable();
    const outcome = await run();
    const after = await idsByTable();
    const deleted: string[] = [];
    for (const [table, ids] of before) {
      const kept = after.get(table) ?? new Set<string>();
      for (const id of ids) if (!kept.has(id)) deleted.push(id);
    }
    return { run: outcome, leftBehind: await referencesTo(deleted) };
  }

  /** One row that is, or is not, a financial record — and what the refusal counts for it. */
  interface FinancialCase {
    readonly name: string;
    /** Bring the record into being; answers with how to take it away again. */
    readonly make: () => Promise<() => Promise<void>>;
    /** Count per kind the refusal names; empty for a row that is not financial. */
    readonly counted: Record<string, number>;
    run?: DemoRun;
    unchanged?: boolean;
  }

  /** The demo the cases are made on: its organisation, one order, and the two pro formas placement issued. */
  interface FinancialSubject {
    readonly organizationId: string;
    readonly orderId: string;
    readonly proformaId: string;
    readonly otherProformaId: string;
  }

  function financialCasesFor(subject: FinancialSubject): FinancialCase[] {
    /** A new row of `table`. */
    const row =
      (table: string, given: Record<string, unknown>) => async (): Promise<() => Promise<void>> => {
        const id = await insert('demo', table, given);
        return async () => void (await db.query(`delete from "${table}" where id = $1`, [id]));
      };
    /** An external life given to a pro forma that placement issued — one per order and kind, so it cannot be a new row. */
    const stamped =
      (invoiceId: string, column: string, value: string) => async (): Promise<() => Promise<void>> => {
        await db.query(`update invoices set "${column}" = $2 where id = $1`, [invoiceId, value]);
        return async () =>
          void (await db.query(`update invoices set "${column}" = null where id = $1`, [invoiceId]));
      };
    const payment = (status: string) => row('payments', { order_id: subject.orderId, status });
    const invoice = (kind: string) =>
      row('invoices', {
        organization_id: subject.organizationId,
        order_id: subject.orderId,
        origin: 'platform',
        kind,
      });
    return [
      { name: 'a paid payment', make: payment('paid'), counted: { [PAYMENTS]: 1 } },
      { name: 'a refunded payment', make: payment('refunded'), counted: { [PAYMENTS]: 1 } },
      {
        name: 'a partially refunded payment',
        make: payment('partially_refunded'),
        counted: { [PAYMENTS]: 1 },
      },
      { name: 'a final invoice', make: invoice('invoice'), counted: { [INVOICES]: 1 } },
      { name: 'a correction', make: invoice('correction'), counted: { [INVOICES]: 1 } },
      {
        name: 'a pro forma with a KSeF reference number',
        make: stamped(subject.proformaId, 'ksef_reference_number', 'KSEF-1'),
        counted: { [INVOICES]: 1 },
      },
      {
        name: 'a pro forma with an external document reference',
        make: stamped(
          subject.otherProformaId,
          'external_document_ref',
          '{"system":"erp","externalId":"1"}',
        ),
        counted: { [INVOICES]: 1 },
      },
      // The row itself, and the placement's own pro forma it is about — which
      // has just acquired an external life.
      {
        name: 'an accounting-system row',
        make: row('invoice_ledger_document_maps', {
          organization_id: subject.organizationId,
          invoice_id: subject.proformaId,
          environment: 'sandbox',
        }),
        counted: { [LEDGER]: 1, [INVOICES]: 1 },
      },
      // And two that are not: an attempt that moved nothing, a delivery note.
      { name: 'a failed payment', make: payment('failed'), counted: {} },
      { name: 'a delivery note', make: invoice('wz'), counted: {} },
    ];
  }

  /**
   * A composition that lets the usage withdrawal — and so the pre-flight — run
   * for real, and then stops the reset: the transaction rolls back, and a case
   * that the pre-flight let through leaves the demo exactly as it was.
   */
  const STOP_AFTER_PREFLIGHT: RunVariation = {
    composition: (built) => ({
      ...built,
      withdraw: async () => {
        await built.withdraw();
        throw new Error(PREFLIGHT_PASSED);
      },
    }),
  };

  // ── the demo, used the way a visitor uses it ─────────────────────────────

  async function signInAsBuyer(): Promise<{ cookies: Record<string, string> }> {
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: { email: DEMO_BUYER_EMAIL, password: DEMO_BUYER_PASSWORD },
    });
    expect(response.statusCode, response.body).toBe(200);
    const header = response.headers['set-cookie'];
    const session = (Array.isArray(header) ? header : [String(header ?? '')])
      .map((cookie) => /^b2b_session=([^;]+)/.exec(cookie)?.[1])
      .find((value) => value !== undefined && value !== '');
    if (session === undefined) throw new Error('the sign-in set no b2b_session cookie');
    return { cookies: { b2b_session: decodeURIComponent(session) } };
  }

  async function saveAddress(
    buyer: { cookies: Record<string, string> },
    kind: 'delivery' | 'billing',
  ): Promise<string> {
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/mine/addresses',
      payload: {
        kind,
        recipientName: 'Demo Buyer',
        street: 'ul. Testowa 1',
        city: 'Warszawa',
        postalCode: '00-001',
        country: 'PL',
      },
      ...buyer,
    });
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as { data: { id: string } }).data.id;
  }

  /** Sign in, save two addresses, and place a one-line order on credit. */
  async function buyOnCredit(): Promise<string> {
    return await buy('credit_limit');
  }

  /** The same, paying by the demo payment method with this code. */
  async function buy(paymentMethodCode: 'credit_limit' | 'bank_transfer'): Promise<string> {
    const buyer = await signInAsBuyer();
    const deliveryAddressId = await saveAddress(buyer, 'delivery');
    const billingAddressId = await saveAddress(buyer, 'billing');
    const [product] = await query<{ id: string }>(
      `select id from products where slug like 'demo-screws-%' order by slug limit 1`,
    );
    const [deliveryMethod] = await query<{ id: string }>(
      `select id from delivery_methods where code = 'in_person_pickup'`,
    );
    const [paymentMethod] = await query<{ id: string }>(
      `select id from payment_methods where code = $1`,
      [paymentMethodCode],
    );
    const added = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: product!.id, quantity: 1 },
      ...buyer,
    });
    expect(added.statusCode, added.body).toBe(200);
    const placed = await h.app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      payload: {
        deliveryAddressId,
        billingAddressId,
        deliveryMethodId: deliveryMethod!.id,
        paymentMethodId: paymentMethod!.id,
      },
      ...buyer,
    });
    expect(placed.statusCode, placed.body).toBe(201);
    return (placed.json() as { data: { id: string } }).data.id;
  }

  /**
   * One row in every table that can come to reference a tenant's organisation,
   * its accounts or its orders — the same set for the demo and for the real
   * customer, which is what makes the second a control for the first.
   */
  async function useEverythingElse(owner: 'demo' | 'real', tenant: Tenant): Promise<void> {
    const { organizationId, customerAccountId, orderId, orderItemId, creditLimitId } = tenant;
    const add = (table: string, given: Record<string, unknown>): Promise<string> =>
      insert(owner, table, given);
    const [channel] = await query<{ id: string }>(
      `select id from sales_channels where system_default limit 1`,
    );
    const salesChannelId = channel!.id;
    const [priceList] = await query<{ id: string }>(`select id from price_lists limit 1`);
    const [warehouse] = await query<{ id: string }>(
      `select id from warehouses where code <> 'pl-krk' order by created_at limit 1`,
    );

    // ── a colleague in the same organisation ───────────────────────────────
    const colleagueId = await add('customer_accounts', {
      organization_id: organizationId,
      role: 'regular_user',
    });
    await add('organization_invitations', {
      organization_id: organizationId,
      invited_by_customer_account_id: customerAccountId,
      role: 'regular_user',
    });
    await add('organization_sales_rep_assignments', { organization_id: organizationId });
    await add('sales_channel_organizations', {
      organization_id: organizationId,
      sales_channel_id: salesChannelId,
    });
    await add('sales_channel_customer_accounts', {
      customer_account_id: customerAccountId,
      sales_channel_id: salesChannelId,
    });

    // ── the account's own belongings ───────────────────────────────────────
    for (const accountId of [customerAccountId, colleagueId]) {
      await add('sessions', { customer_account_id: accountId });
      await add('customer_addresses', { customer_account_id: accountId, kind: 'delivery' });
    }
    await add('password_reset_tokens', { customer_account_id: customerAccountId });
    await add('email_verification_tokens', { customer_account_id: customerAccountId });
    const enrolmentId = await add('mfa_enrolments', {
      subject_type: 'customer',
      subject_id: customerAccountId,
      status: 'confirmed',
    });
    await add('mfa_recovery_codes', { enrolment_id: enrolmentId });
    await add('mfa_social_identities', {
      subject_type: 'customer',
      subject_id: customerAccountId,
      provider: 'google',
    });
    await add('mfa_organization_policies', { organization_id: organizationId });

    // ── addresses and the preferences that name them ───────────────────────
    const addressId = await add('addresses', { organization_id: organizationId, kind: 'delivery' });
    await add('quick_order_default_preferences', {
      scope: 'organization',
      scope_id: organizationId,
      default_shipping_address_id: addressId,
    });
    await add('quick_order_default_preferences', {
      scope: 'customer',
      scope_id: customerAccountId,
    });
    await add('price_display_mode_overrides', {
      scope: 'organization',
      target_id: organizationId,
      mode: 'net_only',
    });
    await add('price_list_assignments', {
      organization_id: organizationId,
      price_list_id: priceList!.id,
    });

    // ── carts, lists, comparisons, quote requests ──────────────────────────
    const quoteRequestId = await add('quote_requests', {
      organization_id: organizationId,
      customer_account_id: customerAccountId,
      sales_channel_id: salesChannelId,
      status: 'Pending',
    });
    await add('quote_request_items', { quote_request_id: quoteRequestId });
    const quoteEventId = await add('quote_request_events', {
      quote_request_id: quoteRequestId,
      actor_customer_account_id: customerAccountId,
      event_type: 'created',
    });
    await add('quote_request_revisions', {
      quote_request_id: quoteRequestId,
      created_by_customer_account_id: customerAccountId,
    });
    await add('quote_request_notification_events', {
      quote_request_id: quoteRequestId,
      source_event_id: quoteEventId,
      recipient_customer_account_id: customerAccountId,
      channel: 'email',
      status: 'queued',
    });
    const cartId = await add('carts', {
      organization_id: organizationId,
      customer_account_id: customerAccountId,
      sales_channel_id: salesChannelId,
      status: 'completed',
      approval_status: 'not_required',
      completed_order_id: orderId,
      source_quote_request_id: quoteRequestId,
    });
    await add('cart_items', { cart_id: cartId });
    await add('cart_audit_entries', {
      cart_id: cartId,
      actor_id: customerAccountId,
      actor_type: 'customer',
    });
    const listId = await add('shopping_lists', {
      organization_id: organizationId,
      customer_account_id: customerAccountId,
    });
    await add('shopping_list_items', { shopping_list_id: listId });
    await add('comparisons', {
      organization_id: organizationId,
      customer_account_id: customerAccountId,
      sales_channel_id: salesChannelId,
    });

    // ── what hangs off an order ────────────────────────────────────────────
    await add('order_comments', { order_id: orderId, author_customer_account_id: customerAccountId });
    await add('order_applied_promotions', { order_id: orderId });
    await add('order_transition_effects', {
      order_id: orderId,
      organization_id: organizationId,
      effect: 'stock.release',
      origin: 'transition',
      reason: 'order_cancelled',
    });
    await add('payments', { order_id: orderId, status: 'paid' });
    await add('shipments', { order_id: orderId, status: 'pending' });
    // A second line, for a product the operator added themselves: three units
    // promised to this order and not released. The stock row is the
    // operator's, so it is not tracked as either tenant's.
    const ownProductId = randomUUID();
    ownProducts.set(owner, ownProductId);
    await db.query(
      `insert into stock_levels (id, product_id, warehouse_id, on_hand, reserved, created_at, updated_at)
       values ($1, $2, $3, 10, 3, now(), now())`,
      [randomUUID(), ownProductId, warehouse!.id],
    );
    const heldItemId = await add('order_items', { order_id: orderId, product_id: ownProductId });
    await add('stock_allocations', {
      order_item_id: heldItemId,
      warehouse_id: warehouse!.id,
      quantity: 3,
    });
    await add('credit_limit_reservations', {
      credit_limit_id: creditLimitId,
      order_id: orderId,
      reserving_organization_id: organizationId,
      status: 'released',
    });
    const promotionId = await add('promotions', { organization_id: organizationId });
    await add('promotion_usages', {
      promotion_id: promotionId,
      order_id: orderId,
      organization_id: organizationId,
      customer_account_id: customerAccountId,
      sales_channel_id: salesChannelId,
    });
    const invoiceId = await add('invoices', {
      organization_id: organizationId,
      order_id: orderId,
      sales_channel_id: salesChannelId,
      origin: 'platform',
      kind: 'invoice',
    });
    await add('invoice_lines', { invoice_id: invoiceId, order_item_id: orderItemId });
    await add('invoice_external_attachments', { invoice_id: invoiceId });
    await add('invoice_ledger_client_maps', {
      organization_id: organizationId,
      environment: 'sandbox',
    });
    await add('invoice_ledger_deliveries', {
      organization_id: organizationId,
      invoice_id: invoiceId,
      environment: 'sandbox',
      kind: 'invoice',
      ksef_routing: 'native',
      numbering_mode: 'endora',
      status: 'queued',
    });
    await add('invoice_ledger_document_maps', {
      organization_id: organizationId,
      invoice_id: invoiceId,
      environment: 'sandbox',
    });

    // ── returns ────────────────────────────────────────────────────────────
    const returnCaseId = await add('return_cases', {
      organization_id: organizationId,
      customer_account_id: customerAccountId,
      order_id: orderId,
      sales_channel_id: salesChannelId,
    });
    const returnItemId = await add('return_case_items', {
      return_case_id: returnCaseId,
      order_item_id: orderItemId,
    });
    await add('return_case_comments', {
      return_case_id: returnCaseId,
      author_customer_account_id: customerAccountId,
    });
    await add('return_case_attachments', {
      return_case_id: returnCaseId,
      return_case_item_id: returnItemId,
    });
    await add('return_shipments', { return_case_id: returnCaseId });
    await add('refunds', {
      return_case_id: returnCaseId,
      corrective_invoice_id: invoiceId,
      corrective_invoice_outcome: 'issued',
    });
    await add('credit_limit_return_topups', {
      organization_id: organizationId,
      return_case_id: returnCaseId,
    });

    // ── the integration surface ────────────────────────────────────────────
    const apiKeyId = await add('api_keys', {
      organization_id: organizationId,
      customer_account_id: customerAccountId,
      sales_channel_id: salesChannelId,
    });
    await add('order_placement_intents', {
      organization_id: organizationId,
      api_key_id: apiKeyId,
      order_id: orderId,
    });
    const webhookId = await add('webhooks', { organization_id: organizationId });
    await add('webhook_deliveries', { webhook_id: webhookId });

    // ── marketing and measurement ──────────────────────────────────────────
    await add('analytics_events', {
      organization_id: organizationId,
      customer_account_id: customerAccountId,
      sales_channel_id: salesChannelId,
    });
    await add('availability_notifications', {
      organization_id: organizationId,
      customer_account_id: customerAccountId,
      status: 'queued',
    });
    await add('newsletter_subscribers', {
      organization_id: organizationId,
      customer_account_id: customerAccountId,
      sales_channel_id: salesChannelId,
    });
    await add('push_subscriptions', {
      organization_id: organizationId,
      customer_account_id: customerAccountId,
      sales_channel_id: salesChannelId,
      status: 'active',
    });

    // ── CRM: an Opportunity an administrator opened, linked to the order ───
    const [status] = await query<{ code: string }>(
      `select code from crm_opportunity_statuses order by code limit 1`,
    );
    const opportunityId = await add('crm_opportunities', {
      organization_id: organizationId,
      customer_account_id: customerAccountId,
      sales_channel_id: salesChannelId,
      status_code: status!.code,
      source: 'manual',
      value_mode: 'manual',
    });
    const historyId = await add('crm_opportunity_status_history', {
      opportunity_id: opportunityId,
      to_status_code: status!.code,
      cause_order_id: orderId,
      cause: 'manual',
    });
    await add('crm_opportunity_links', {
      opportunity_id: opportunityId,
      document_kind: 'order',
      document_id: orderId,
      link_source: 'manual',
    });
    await add('crm_opportunity_references', {
      opportunity_id: opportunityId,
      target_type: 'order',
      target_id: orderId,
      source_kind: 'comment',
    });
    await add('crm_status_propagations', {
      opportunity_id: opportunityId,
      order_id: orderId,
      status_history_id: historyId,
      direction: 'order_to_opportunity',
      outcome: 'applied',
    });
    await add('crm_opportunity_comments', { opportunity_id: opportunityId, kind: 'note' });
    await add('crm_opportunity_events', {
      opportunity_id: opportunityId,
      starts_at: new Date(Date.now() + 3_600_000),
      ends_at: new Date(Date.now() + 7_200_000),
    });

    // ── the records that are kept ──────────────────────────────────────────
    await add('email_deliveries', { document_type: 'order', document_id: orderId });
    await add('admin_notifications', {
      subject_type: 'order',
      subject_id: orderId,
      audience: 'all_admins',
    });
  }

  /** Every usage counter of `promotions`, as `<scope type> <scope key>` → count. */
  async function promotionCounters(): Promise<Record<string, number>> {
    const rows = await query<{ scope_type: string; scope_key: string; count: number }>(
      `select scope_type, scope_key, count from promotion_usage_counters`,
    );
    return Object.fromEntries(
      rows.map((row) => [`${row.scope_type} ${row.scope_key}`, Number(row.count)]),
    );
  }

  /**
   * One row with **no organisation** in every table whose scoping column is
   * nullable — the control for a predicate that goes wider than the demo
   * organisation by matching the absence of one.
   */
  async function useWithoutAnOrganization(real: Tenant): Promise<void> {
    const add = (table: string, given: Record<string, unknown>): Promise<string> =>
      insert('nobody', table, given);
    const [channel] = await query<{ id: string }>(
      `select id from sales_channels where system_default limit 1`,
    );
    const salesChannelId = channel!.id;
    const [priceList] = await query<{ id: string }>(`select id from price_lists limit 1`);
    const token = (): string => randomBytes(12).toString('hex');

    // A guest's cart and comparison.
    const cartId = await add('carts', {
      sales_channel_id: salesChannelId,
      status: 'active',
      approval_status: 'not_required',
      anonymous_cart_token: token(),
    });
    await add('cart_items', { cart_id: cartId });
    await add('comparisons', { sales_channel_id: salesChannelId, anonymous_token: token() });
    // Anonymous sign-ups and measurements.
    await add('newsletter_subscribers', { sales_channel_id: salesChannelId });
    await add('push_subscriptions', { sales_channel_id: salesChannelId, status: 'active' });
    await add('analytics_events', { sales_channel_id: salesChannelId });
    await add('availability_notifications', { status: 'queued', email: 'guest@usage.example' });
    // Instance-wide configuration.
    await add('webhooks', {});
    await add('api_keys', {});
    await add('promotions', {});
    await add('price_list_assignments', { price_list_id: priceList!.id });
    // An administrator's session names no customer account.
    await add('sessions', {});
    // Documents that name an order and no organisation of their own.
    await add('invoices', { order_id: real.orderId, origin: 'platform' });
    await add('return_cases', {
      order_id: real.orderId,
      customer_account_id: real.customerAccountId,
      sales_channel_id: salesChannelId,
    });
  }

  /** The demo organisation as the seed and the buyer's order left it. */
  async function demoTenant(orderId: string): Promise<Tenant> {
    const [organization] = await query<{ id: string }>(
      `select id from organizations where tax_id = $1`,
      [DEMO_ORG_TAX_ID],
    );
    const [buyer] = await query<{ id: string }>(
      `select id from customer_accounts where email = $1`,
      [DEMO_BUYER_EMAIL],
    );
    const [item] = await query<{ id: string }>(
      `select id from order_items where order_id = $1 limit 1`,
      [orderId],
    );
    const [limit] = await query<{ id: string }>(
      `select id from credit_limits where organization_id = $1`,
      [organization!.id],
    );
    return {
      organizationId: organization!.id,
      customerAccountId: buyer!.id,
      orderId,
      orderItemId: item!.id,
      creditLimitId: limit!.id,
    };
  }

  /** The demo organisation and its buyer, on a demo nobody has ordered from. */
  async function demoTenantWithoutOrder(): Promise<Pick<Tenant, 'organizationId' | 'customerAccountId'>> {
    const [organization] = await query<{ id: string }>(
      `select id from organizations where tax_id = $1`,
      [DEMO_ORG_TAX_ID],
    );
    const [buyer] = await query<{ id: string }>(
      `select id from customer_accounts where email = $1`,
      [DEMO_BUYER_EMAIL],
    );
    return { organizationId: organization!.id, customerAccountId: buyer!.id };
  }

  /** A second organisation with a buyer, a credit limit and an order of its own. */
  async function realTenant(): Promise<Tenant> {
    const organizationId = await insert('real', 'organizations', {
      tax_id: REAL_ORG_TAX_ID,
      name: 'A real customer',
      status: 'active',
    });
    await db.query(`update organizations set path = '/' || id || '/' where id = $1`, [
      organizationId,
    ]);
    const customerAccountId = await insert('real', 'customer_accounts', {
      organization_id: organizationId,
      role: 'organization_admin',
    });
    const creditLimitId = await insert('real', 'credit_limits', {
      organization_id: organizationId,
    });
    const orderId = await insert('real', 'orders', {
      organization_id: organizationId,
      placed_by_customer_account_id: customerAccountId,
    });
    const orderItemId = await insert('real', 'order_items', { order_id: orderId });
    return { organizationId, customerAccountId, orderId, orderItemId, creditLimitId };
  }

  // ── the run ──────────────────────────────────────────────────────────────

  let seeded: DemoRun;
  let demoOrderId: string;
  let operatorPromotionId: string;
  let realTenantIds: Tenant;
  let refusals: Record<
    string,
    {
      run: DemoRun;
      countsBefore: Record<string, number>;
      countsAfter: Record<string, number>;
      tookMs?: number;
    }
  >;
  let orderAfterRefusal: string;
  let countersBeforeReset: Record<string, number>;
  let countersAfterReset: Record<string, number>;
  let nobodysRowsMissing: string[];
  let reset: DemoRun;
  let leftBehind: Record<string, number>;
  let demoRowsStillThere: string[];
  let realRowsMissing: string[];
  let demoOrganizationsAfterReset: number;
  let reservedAfterReset: Record<string, number>;
  let reseeded: DemoRun;
  let orderAfterReseed: string;
  let countsBeforeBranchRefusal: Record<string, number>;
  let refusedOverBranch: DemoRun;
  let countsAfterBranchRefusal: Record<string, number>;
  let raced: DemoRun;
  let latePaymentSurvived: boolean;
  let racedLeftEverythingElse: boolean;
  let placedButUnpaid: { what: string; n: string }[];
  let financialCases: FinancialCase[];
  let unforced: { run: DemoRun; leftBehind: Record<string, number> };
  let demoRowsAfterUnforcedReset: number;
  let refusedOverEverything: DemoRun;
  let forced: { run: DemoRun; leftBehind: Record<string, number> };
  let financialRowsAfterForcedReset: number;

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    db = new Client({ connectionString: process.env['DATABASE_URL'] });
    await db.connect();
    columns = await query<ColumnInfo & Record<string, unknown>>(
      `select c.table_name, c.column_name, c.data_type, c.udt_name, c.is_nullable,
              c.column_default, c.character_maximum_length
         from information_schema.columns c
         join information_schema.tables t
           on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
          and c.table_name <> 'mikro_orm_migrations'
        order by c.table_name, c.ordinal_position`,
    );

    seeded = await demo('seed');
    if (seeded.code !== 0) return;

    // The operator's own promotion, with every kind of usage limit, applied to
    // every cart — so each order below spends one use of it through the real
    // placement path, counters included.
    const promotions = promotionServiceFor(h);
    operatorPromotionId = (
      await promotions.upsert({
        name: 'An operator promotion with limits',
        action: { type: 'percentage_off_cart', percent: 5 },
        rule: { kind: 'all' },
        usageLimitGlobal: 100,
        usageLimitPerOrganization: 50,
        usageLimitPerCustomer: 50,
      })
    ).id;

    // The demo is used, and so is the instance around it.
    demoOrderId = await buyOnCredit();
    const demoIs = await demoTenant(demoOrderId);
    await useEverythingElse('demo', demoIs);
    const real = await realTenant();
    await useEverythingElse('real', real);
    await useWithoutAnOrganization(real);
    const [channel] = await query<{ id: string }>(
      `select id from sales_channels where system_default limit 1`,
    );
    await h.em().transactional((tx) =>
      promotions.finalizeUsage(tx, {
        orderId: real.orderId,
        currency: 'PLN',
        ctx: {
          organizationId: real.organizationId,
          customerAccountId: real.customerAccountId,
          customerGroupId: null,
          salesChannelId: channel!.id,
        },
        applied: [{ promotionId: operatorPromotionId, couponId: null, amount: 1 }],
      }),
    );

    // A table this repository has never heard of — an installed module's, a
    // deployment's own — holding a restricting foreign key onto a row the
    // reset deletes. Three times, at three depths of the run: an order (what
    // using the demo left), the organisation (a module's own withdrawal, long
    // after the composition's) and a product (another module's again).
    const [demoProduct] = await query<{ id: string }>(
      `select id from products where slug like 'demo-screws-%' order by slug limit 1`,
    );
    refusals = {};
    for (const [parent, id] of [
      ['orders', demoOrderId],
      ['organizations', demoIs.organizationId],
      ['products', demoProduct!.id],
    ] as const) {
      await db.query(
        `create table "issue_143_foreign_table" (
           "parent_id" uuid not null references "${parent}" ("id")
         )`,
      );
      await db.query(`insert into "issue_143_foreign_table" ("parent_id") values ($1)`, [id]);
      const countsBefore = await tableCounts();
      // With the forcing flag, which forces the deletion of financial records
      // and nothing else: a foreign key still refuses.
      const run = await demo('reset', FORCE);
      const countsAfter = await tableCounts();
      await db.query(`drop table "issue_143_foreign_table"`);
      // The table itself is the same before and after; it is not in `columns`.
      refusals[parent] = { run, countsBefore, countsAfter };
    }
    // And once more with nothing in its way but what the demo's own orders
    // wrote: every placement opens a payment and a pro-forma invoice.
    {
      const countsBefore = await tableCounts();
      const run = await demo('reset');
      refusals['financial records'] = { run, countsBefore, countsAfter: await tableCounts() };
    }
    // ── a composition written for the reset that was not one transaction ────
    // Three shapes of it, each over the real composition so that the rows it
    // touches are really locked by the time it misbehaves.
    const outside = `delete from organizations where tax_id = '${DEMO_ORG_TAX_ID}'`;
    const variations: Record<string, RunVariation> = {
      // It says nothing about transactions at all — the 0.104 composition.
      'an undeclared composition': {
        composition: (built) => ({
          apply: () => built.apply(),
          withdraw: () => built.withdraw(),
        }),
      },
      // It claims to, and sends a statement through the bare connection: the
      // pattern every withdrawal in this repository used until this issue.
      'a statement on the bare connection': {
        composition: (built, input) => ({
          ...built,
          withdraw: async () => {
            const result = await built.withdraw();
            await input.em.getConnection().execute(outside);
            return result;
          },
        }),
      },
      // It brings a database client of its own, which no pool can see. The
      // statement waits on rows the reset has deleted while the reset waits
      // for the statement: the hang, bounded here to three seconds.
      'a client of its own': {
        bounds: { lockTimeoutMs: 3_000, idleTimeoutMs: 3_000 },
        composition: (built) => ({
          ...built,
          withdraw: async () => {
            const result = await built.withdraw();
            await db.query(outside);
            return result;
          },
        }),
      },
    };
    for (const [name, variation] of Object.entries(variations)) {
      const countsBefore = await tableCounts();
      const started = Date.now();
      const run = await demoVaried(variation, 'reset', FORCE);
      refusals[name] = {
        run,
        countsBefore,
        countsAfter: await tableCounts(),
        tookMs: Date.now() - started,
      };
    }

    orderAfterRefusal = await buyOnCredit();
    countersBeforeReset = await promotionCounters();

    // The reset that counts, with two modules switched off by the operator:
    // `crm`, whose rows hold a foreign key that refuses the organisation's
    // deletion, and `returns`, whose rows hold none and would be left naming
    // an order that is gone.
    const before = await idsByTable();
    reset = await withModulesDeactivated(['crm', 'returns'], () => demo('reset', FORCE));
    const after = await idsByTable();
    countersAfterReset = await promotionCounters();
    realTenantIds = real;
    const deleted: string[] = [];
    for (const [table, ids] of before) {
      const kept = after.get(table) ?? new Set<string>();
      for (const id of ids) if (!kept.has(id)) deleted.push(id);
    }
    leftBehind = await referencesTo(deleted);
    demoRowsStillThere = await trackedRows('demo', true);
    realRowsMissing = await trackedRows('real', false);
    nobodysRowsMissing = await trackedRows('nobody', false);
    demoOrganizationsAfterReset = Number(
      (
        await query<{ n: string }>(
          `select count(*)::text as n from organizations where tax_id = $1`,
          [DEMO_ORG_TAX_ID],
        )
      )[0]!.n,
    );

    reservedAfterReset = {};
    for (const [owner, productId] of ownProducts) {
      const [level] = await query<{ reserved: number }>(
        `select reserved from stock_levels where product_id = $1`,
        [productId],
      );
      reservedAfterReset[owner] = Number(level!.reserved);
    }

    reseeded = await demo('seed');
    if (reseeded.code !== 0) return;
    orderAfterReseed = await buyOnCredit();

    // An organisation filed under the demo one — an administrator's doing.
    const [demoOrganization] = await query<{ id: string }>(
      `select id from organizations where tax_id = $1`,
      [DEMO_ORG_TAX_ID],
    );
    const branchId = randomUUID();
    await db.query(
      `insert into organizations (id, name, tax_id, status, vat_status, registered_address,
                                  parent_id, path, created_at, updated_at)
       select $1::uuid, 'A branch', 'PL8888888888', status, vat_status, registered_address,
              id, path || $1::text || '/', now(), now()
         from organizations where id = $2`,
      [branchId, demoOrganization!.id],
    );
    countsBeforeBranchRefusal = await tableCounts();
    refusedOverBranch = await demo('reset', FORCE);
    countsAfterBranchRefusal = await tableCounts();

    // ── a demo with no financial record resets without being told anything ──
    await db.query(`delete from organizations where id = $1`, [branchId]);
    const cleared = await demo('reset', FORCE);
    const again = await demo('seed');
    if (cleared.code !== 0 || again.code !== 0) return;
    // Three orders through the real placement path, two on credit and one by
    // bank transfer, with invoicing on and nothing paid: a `deferred` payment
    // or an `awaiting_payment` one, and a pro-forma invoice, each.
    const creditOrderId = await buy('credit_limit');
    await buy('credit_limit');
    await buy('bank_transfer');
    const fresh = await demoTenantWithoutOrder();
    placedButUnpaid = await query<{ what: string; n: string }>(
      `select 'payment ' || status as what, count(*)::text as n from payments
        where order_id in (select id from orders where organization_id = $1) group by status
       union all
       select 'invoice ' || kind, count(*)::text from invoices
        where order_id in (select id from orders where organization_id = $1) group by kind
       order by 1`,
      [fresh.organizationId],
    );
    const [proforma] = await query<{ id: string }>(
      `select id from invoices where order_id = $1 and kind = 'proforma'`,
      [creditOrderId],
    );

    // A payment another session commits while the reset is already running —
    // after its snapshot, so after its pre-flight has counted none.
    const lateCounts = await tableCounts();
    let latePaymentId = '';
    raced = await demoVaried(
      {
        composition: (built) => ({
          ...built,
          withdraw: async () => {
            latePaymentId = await insert('demo', 'payments', {
              order_id: creditOrderId,
              status: 'paid',
            });
            return await built.withdraw();
          },
        }),
      },
      'reset',
    );
    const [late] = await query<{ n: string }>(
      `select count(*)::text as n from payments where id = $1`,
      [latePaymentId],
    );
    latePaymentSurvived = late!.n === '1';
    await db.query(`delete from payments where id = $1`, [latePaymentId]);
    racedLeftEverythingElse =
      JSON.stringify(await tableCounts()) === JSON.stringify(lateCounts);

    // ── each financial record alone ─────────────────────────────────────────
    const [otherProforma] = await query<{ id: string }>(
      `select id from invoices
        where kind = 'proforma' and id <> $2
          and order_id in (select id from orders where organization_id = $1)
        order by created_at limit 1`,
      [fresh.organizationId, proforma!.id],
    );
    financialCases = financialCasesFor({
      organizationId: fresh.organizationId,
      orderId: creditOrderId,
      proformaId: proforma!.id,
      otherProformaId: otherProforma!.id,
    });
    for (const financial of financialCases) {
      const undo = await financial.make();
      const countsBefore = await tableCounts();
      // A case that is not financial would be withdrawn; it is asked through a
      // composition that stops after the pre-flight instead, so that every
      // case leaves the same demo behind for the next.
      financial.run = await demoVaried(STOP_AFTER_PREFLIGHT, 'reset');
      financial.unchanged =
        JSON.stringify(await tableCounts()) === JSON.stringify(countsBefore);
      await undo();
    }

    // ── placed, unpaid, uninvoiced: resets without the flag ─────────────────
    unforced = await scanned(() => demo('reset'));
    demoRowsAfterUnforcedReset = Number(
      (
        await query<{ n: string }>(
          `select (select count(*) from orders where organization_id = $1)
                + (select count(*) from payments where order_id = $2)
                + (select count(*) from invoices where order_id = $2)
                + (select count(*) from addresses where organization_id = $1)
                + (select count(*) from organizations where id = $1) as n`,
          [fresh.organizationId, creditOrderId],
        )
      )[0]!.n,
    );

    // ── every financial record at once: withdrawn with the flag ─────────────
    if ((await demo('seed')).code !== 0) return;
    const lastOrderId = await buy('credit_limit');
    await buy('credit_limit');
    await buy('bank_transfer');
    const last = await demoTenantWithoutOrder();
    const [lastProforma] = await query<{ id: string }>(
      `select id from invoices where order_id = $1 and kind = 'proforma'`,
      [lastOrderId],
    );
    const [lastOtherProforma] = await query<{ id: string }>(
      `select id from invoices
        where kind = 'proforma' and id <> $2
          and order_id in (select id from orders where organization_id = $1)
        order by created_at limit 1`,
      [last.organizationId, lastProforma!.id],
    );
    for (const financial of financialCasesFor({
      organizationId: last.organizationId,
      orderId: lastOrderId,
      proformaId: lastProforma!.id,
      otherProformaId: lastOtherProforma!.id,
    })) {
      await financial.make();
    }
    refusedOverEverything = await demo('reset');
    forced = await scanned(() => demo('reset', FORCE));
    financialRowsAfterForcedReset = Number(
      (
        await query<{ n: string }>(
          `select (select count(*) from payments where order_id = $1)
                + (select count(*) from invoices where order_id = $1)
                + (select count(*) from invoice_ledger_document_maps where organization_id = $2)
                + (select count(*) from organizations where id = $2) as n`,
          [lastOrderId, last.organizationId],
        )
      )[0]!.n,
    );
  }, SUITE_TIMEOUT_MS);

  afterAll(async () => {
    if (db !== undefined) {
      await db.query(`drop table if exists "issue_143_foreign_table"`);
      await db.end();
    }
    if (h !== undefined) await teardownBackendServer(h);
  }, SUITE_TIMEOUT_MS);

  it('seeds a demo the buyer can sign in to and buy from on credit', () => {
    expect(seeded.code, seeded.err).toBe(0);
    expect(demoOrderId).toMatch(/^[0-9a-f-]{36}$/);
  });

  describe.each(['orders', 'organizations', 'products'])(
    'a reset refused by a foreign key onto %s',
    (parent) => {
      it('exits non-zero and says which constraint refused it — the forcing flag forces nothing here', () => {
        expect(refusals[parent]!.run.code).toBe(1);
        expect(refusals[parent]!.run.err).toContain('issue_143_foreign_table');
      });

      it('leaves every table exactly as it found it', () => {
        expect(refusals[parent]!.countsAfter).toEqual(refusals[parent]!.countsBefore);
      });

      it('is told as a refusal — that nothing changed, and no stack — wherever in the run it came', () => {
        // The first is refused in the composition's withdrawal, the other two
        // in a module's own; an operator reads the same thing for all three.
        expect(refusals[parent]!.run.err).toContain('the database refused the demo reset');
        expect(refusals[parent]!.run.err).toContain('Nothing has been changed');
        expect(refusals[parent]!.run.err).not.toMatch(/^\s+at /m);
      });
    },
  );

  describe('a reset body written for the reset that was not one transaction', () => {
    it('is refused before it starts when its composition does not declare the contract', () => {
      const { run, countsBefore, countsAfter } = refusals['an undeclared composition']!;
      expect(run.code).toBe(1);
      expect(run.err).toContain('withdrawsInsideTransaction');
      expect(run.err).toContain('Nothing has been changed');
      expect(countsAfter).toEqual(countsBefore);
    });

    it('is refused on the spot when it sends a statement through the bare connection', () => {
      const { run, countsBefore, countsAfter, tookMs } =
        refusals['a statement on the bare connection']!;
      expect(run.code).toBe(1);
      expect(run.err).toContain('wrote outside the reset transaction');
      expect(run.err).toContain('Nothing has been changed');
      expect(run.err).not.toMatch(/^\s+at /m);
      expect(countsAfter).toEqual(countsBefore);
      // Not by waiting for anything: the statement is never sent.
      expect(tookMs).toBeLessThan(60_000);
    });

    it('does not hang when it brings a client of its own: the reset is ended at the bound', () => {
      const { run, countsBefore, countsAfter, tookMs } = refusals['a client of its own']!;
      expect(run.code).toBe(1);
      expect(run.err).toContain('did nothing for more than 3 s');
      expect(run.err).toContain('wrote outside the reset transaction');
      expect(countsAfter).toEqual(countsBefore);
      // The default bound is two minutes and no bound is for ever.
      expect(tookMs).toBeLessThan(90_000);
    });
  });

  describe('a reset of a demo that holds financial records, not told to delete them', () => {
    it('exits non-zero, saying what it found, that nothing changed, and how to force it', () => {
      const { run } = refusals['financial records']!;
      expect(run.code).toBe(1);
      // Exactly the one paid payment and the one final invoice written
      // directly. The order placed over HTTP opened a payment (`deferred`) and
      // a pro-forma invoice of its own, and neither is counted.
      expect(run.err).toMatch(/^ {2}invoices and corrections[^\n]*: 1$/m);
      expect(run.err).toMatch(/^ {2}payments that were paid or refunded: 1$/m);
      expect(run.err).toMatch(/^ {2}accounting-system records: 3$/m);
      expect(run.err).toMatch(/^ {2}refunds: 1$/m);
      expect(run.err).toContain('Nothing has been changed');
      expect(run.err).toContain('--force-delete-financial-records');
    });

    it('is a refusal, not a crash: no stack trace and no row id', () => {
      const { run } = refusals['financial records']!;
      expect(run.err).not.toMatch(/^\s+at /m);
      expect(run.err).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    });

    it('leaves every table exactly as it found it', () => {
      const { countsBefore, countsAfter } = refusals['financial records']!;
      expect(countsAfter).toEqual(countsBefore);
    });
  });

  describe('after seven refused resets', () => {
    it('leaves checkout working: the buyer places another order on credit', () => {
      expect(orderAfterRefusal).toMatch(/^[0-9a-f-]{36}$/);
      expect(orderAfterRefusal).not.toBe(demoOrderId);
    });
  });

  describe('the reset of a used demo', () => {
    it('exits 0', () => {
      expect(reset.code, reset.err).toBe(0);
    });

    it('withdraws every section: no table it needs is missing from a full instance', () => {
      expect(reset.out).not.toContain('is not installed');
      // The two switched-off modules included.
      expect(reset.out).toMatch(/^ {2}Sales Opportunities opened for the demo organisation$/m);
      expect(reset.out).toMatch(/^ {2}return cases of the demo organisation$/m);
    });

    it('removes the demo organisation', () => {
      expect(demoOrganizationsAfterReset).toBe(0);
    });

    it('leaves no column anywhere naming a row it deleted, beyond the kept records', () => {
      expect(Object.keys(leftBehind).sort()).toEqual(Object.keys(KEPT_REFERENCES).sort());
    });

    it('removes every row the demo organisation and its accounts were used to create', () => {
      // The kept records are rows about the demo's order, not rows of it.
      expect(demoRowsStillThere.map((row) => row.split(' ')[0])).toEqual([
        'admin_notifications',
        'email_deliveries',
      ]);
    });

    it('removes nothing that belongs to another organisation on the same instance', () => {
      expect(realRowsMissing).toEqual([]);
    });

    it('removes nothing that belongs to no organisation at all', () => {
      // A guest's cart, an anonymous subscriber, an instance-wide webhook: the
      // rows a predicate reading "no organisation" as "the demo's" would take.
      expect(nobodysRowsMissing).toEqual([]);
    });

    it("gives the operator's promotion back the uses the demo spent, and only those", () => {
      const promotion = operatorPromotionId;
      // Two demo orders and the real customer's one, each counted three ways.
      expect(countersBeforeReset[`global ${promotion}`]).toBe(3);
      expect(Object.keys(countersBeforeReset)).toHaveLength(5);
      expect(countersAfterReset).toEqual({
        [`global ${promotion}`]: 1,
        [`organization ${promotion}:${realTenantIds.organizationId}`]: 1,
        [`customer ${promotion}:${realTenantIds.customerAccountId}`]: 1,
      });
    });

    it("gives back the stock its orders held, and nobody else's", () => {
      // Three units of the operator's own product were promised to each
      // tenant's order. The demo's order is gone, so its three are free again;
      // the real customer's order stands, and so does its hold.
      expect(reservedAfterReset).toEqual({ demo: 0, real: 3 });
    });
  });

  describe('seeding again afterwards', () => {
    it('exits 0', () => {
      expect(reseeded.code, reseeded.err).toBe(0);
    });

    it('gives back a shop the buyer can buy from on credit', () => {
      expect(orderAfterReseed).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('a payment committed by another session while the reset is running', () => {
    it('is not deleted behind the pre-flight that never saw it: the reset is refused', () => {
      expect(raced.code).toBe(1);
      expect(latePaymentSurvived).toBe(true);
      expect(racedLeftEverythingElse).toBe(true);
    });

    it('is refused by the database, over the one snapshot the reset reads and deletes from', () => {
      // Not by the count — which ran before the payment existed for it — but
      // by the payment's foreign key onto the order the reset then removes.
      expect(raced.err).not.toContain('holds financial records');
      expect(raced.err).toMatch(/payments/);
      expect(raced.err).toContain('Nothing has been changed');
    });
  });

  describe('orders placed and nothing paid: two on credit and one by bank transfer, invoicing on', () => {
    it('hold deferred and awaiting payments and a pro forma per order, as placement left them', () => {
      expect(placedButUnpaid).toEqual([
        { what: 'invoice proforma', n: '3' },
        { what: 'payment awaiting_payment', n: '1' },
        { what: 'payment deferred', n: '2' },
      ]);
    });

    it('reset without the flag', () => {
      expect(unforced.run.code, unforced.run.err).toBe(0);
      expect(demoRowsAfterUnforcedReset).toBe(0);
    });

    it('leave nothing naming a deleted row beyond the kept records', () => {
      for (const column of Object.keys(unforced.leftBehind)) {
        expect(Object.keys(KEPT_REFERENCES), column).toContain(column);
      }
    });
  });

  describe('one financial record alone, on that same demo', () => {
    // `financialCases` is filled in `beforeAll`; the names are the table.
    const names = [
      'a paid payment',
      'a refunded payment',
      'a partially refunded payment',
      'a final invoice',
      'a correction',
      'a pro forma with a KSeF reference number',
      'a pro forma with an external document reference',
      'an accounting-system row',
    ];
    const byName = (name: string): FinancialCase =>
      financialCases.find((financial) => financial.name === name)!;

    it('is every case this file runs', () => {
      expect(financialCases.filter((c) => Object.keys(c.counted).length > 0).map((c) => c.name)).toEqual(names);
    });

    it.each(names)('%s refuses the reset, counted under its own kind and no other', (name) => {
      const financial = byName(name);
      expect(financial.run!.code).toBe(1);
      expect(financial.run!.err).toContain('--force-delete-financial-records');
      expect(financial.run!.err).toContain('Nothing has been changed');
      for (const kind of ALL_KINDS) {
        const line = `  ${kind}: ${String(financial.counted[kind] ?? 0)}\n`;
        if (kind in financial.counted) expect(financial.run!.err).toContain(line);
        else expect(financial.run!.err).not.toContain(`  ${kind}: `);
      }
    });

    it.each(names)('%s leaves every table as it was', (name) => {
      expect(byName(name).unchanged).toBe(true);
    });

    it.each(['a failed payment', 'a delivery note'])(
      '%s is not a financial record: the pre-flight lets the reset through',
      (name) => {
        const financial = byName(name);
        expect(financial.run!.err).toContain(PREFLIGHT_PASSED);
        expect(financial.run!.err).not.toContain('holds financial records');
        expect(financial.unchanged).toBe(true);
      },
    );
  });

  describe('every financial record at once', () => {
    it('refuses without the flag, each kind counted', () => {
      expect(refusedOverEverything.code).toBe(1);
      // Three payments; a final invoice, a correction and the two pro formas
      // that were given an external reference (one of them ledgered as well).
      expect(refusedOverEverything.err).toContain(`  ${PAYMENTS}: 3\n`);
      expect(refusedOverEverything.err).toContain(`  ${INVOICES}: 4\n`);
      expect(refusedOverEverything.err).toContain(`  ${LEDGER}: 1\n`);
    });

    it('is withdrawn with the flag, and nothing is left naming a deleted row', () => {
      expect(forced.run.code, forced.run.err).toBe(0);
      expect(financialRowsAfterForcedReset).toBe(0);
      for (const column of Object.keys(forced.leftBehind)) {
        expect(Object.keys(KEPT_REFERENCES), column).toContain(column);
      }
    });
  });

  describe('a demo organisation with a sub-organisation filed under it', () => {
    it('is not withdrawn: the reset stops and says what to do', () => {
      expect(refusedOverBranch.code).toBe(1);
      expect(refusedOverBranch.err).toContain('1 sub-organisation');
    });

    it('stops before anything has gone', () => {
      expect(countsAfterBranchRefusal).toEqual(countsBeforeBranchRefusal);
    });
  });
});
