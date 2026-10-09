/**
 * What **using** the demo left behind, withdrawn before anything else is.
 *
 * ## Why the composition's steps were not enough
 *
 * Every step in `composition.ts` withdraws what it applied, which is the whole
 * demo only while nobody has touched it. A demo exists to be touched: the buyer
 * signs in, saves an address, places an order on credit, asks for a quote — and
 * an administrator opens a Sales Opportunity for the demo organisation or hands
 * it an API key. From then on the demo organisation and its accounts are named
 * by rows no step created. Some of those references are foreign keys that
 * refuse the withdrawal (`credit_limit_reservations` → `credit_limits`,
 * `addresses` → `organizations`); most carry no foreign key at all, so a reset
 * that did go through left orders, carts and quote requests naming an
 * organisation that no longer existed.
 *
 * **They are deleted with the demo, never re-pointed.** A reset means the
 * instance is back to the one it was before the demo was seeded, and an order
 * kept without its organisation would break the rule every other row obeys —
 * the Organization is the one tenant concept and every transacting customer has
 * one.
 *
 * ## Whose rows, exactly
 *
 * The demo organisation is the one `organizations`' own demo data creates,
 * found by the tax id it is keyed on — the way every other withdrawal here
 * finds it. Its accounts are the customer accounts that belong to it. A row is
 * the demo's when it names that organisation, one of those accounts, or — for a
 * row that names neither — one of that organisation's orders, invoices, return
 * cases or credit limit. No predicate here is any wider than that: another
 * organisation on the same instance, and everything it owns, is never matched.
 *
 * ## One section per owning module, guarded by its tables
 *
 * Each section deletes from the tables of **one** module. It is raw SQL for
 * the reason the credit-limit step gives: most of these entities are
 * organisation-scoped, and a withdrawal that depended on the ambient tenant
 * would remove a different set under a different scope.
 *
 * **The guard is whether the tables exist — not whether the module is switched
 * on.** A composition *step* is guarded by effective presence (§5.4), because
 * it creates rows and a module that is off must receive none. A withdrawal of
 * rows that already exist is the other question. Operator activation is a
 * statement about a module's behaviour (Principle XVII: off is non-destructive,
 * the rows are still there), and a row that is still there still refers to the
 * demo organisation: an Opportunity of a switched-off CRM refuses the
 * organisation's deletion, and a return case of a switched-off `returns` would
 * be left naming an order that is gone — permanently, since the predicate that
 * finds it goes through the organisation this very run deletes. So a section
 * runs when every table it names is in this database, and is a reported skip
 * naming the missing ones when the module was never installed. The table list
 * is read off the statements themselves, so it cannot fall behind them.
 *
 * The order is children before parents, twice over: a foreign key refuses the
 * other order, and a section finds its rows *through* the orders, invoices and
 * accounts a later section deletes.
 *
 * ## Atomic, twice
 *
 * The sections run in one transaction of their own, so this withdrawal is
 * all-or-nothing wherever it is called from. Called by `demo reset` it is also
 * *inside* the transaction the whole reset is (the platform's
 * `demo/reset-transaction.ts`): a refusal later in the run — at the
 * organisation's own withdrawal, at a product's — rolls this back as well. The
 * alternative was measured in the issue this answers and again in its review:
 * the payment methods, the buyer and the orders were already gone by the time
 * the organisation refused to go.
 *
 * ## Financial records are not deleted unless the operator says so
 *
 * Before the first delete the withdrawal counts the demo organisation's
 * financial records ({@link DEMO_FINANCIAL_RECORDS}). If there are any and the
 * reset was not run with `--force-delete-financial-records`, it stops there:
 * nothing has been changed, and the message says what was found and names the
 * flag. With the flag they go with everything else. The flag reaches this file
 * as a parameter the dispatcher sets from the command line alone, and it
 * forces nothing but that: a foreign key that refuses the reset refuses it
 * with the flag as without.
 *
 * ## What is kept
 *
 * Records of things that happened: the audit trail, the e-mail delivery log and
 * the administrators' notification history. They are logs, not data of the
 * demo organisation, and they name what they are about by an id that is allowed
 * to outlive it.
 *
 * ## What this cannot see
 *
 * A table of a module that is not in this repository. If it holds a
 * restricting foreign key onto one of these rows, the reset is refused and
 * nothing is withdrawn; if it holds a bare `uuid`, its rows are left naming a
 * row that is gone, silently. There is no seam yet through which such a module
 * could contribute a section of its own: a module's demo body may not read
 * `organizations` to learn which organisation is the demo's, and an instance
 * loads one composition.
 */
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  DEMO_FORCE_DELETE_FINANCIAL_RECORDS_FLAG,
  DemoResetRefusedError,
  type DemoCompositionResult,
} from '@endora-commerce/platform/demo';

// ── whose rows ─────────────────────────────────────────────────────────────
//
// Every fragment is a sub-select and carries one `?` per mention of the demo
// organisation's tax id, and `:buyer_email` wherever the seeded buyer is told
// apart from the accounts that joined it; `bind` turns both into bound values
// in the order they occur, so a statement is written once and never beside a
// hand-maintained parameter list.

const ORGANIZATIONS = `(select id from organizations where tax_id = ?)`;
const ACCOUNTS = `(select id from customer_accounts where organization_id in ${ORGANIZATIONS})`;
const ORDERS = `(select id from orders where organization_id in ${ORGANIZATIONS})`;
const ORDER_ITEMS = `(select id from order_items where order_id in ${ORDERS})`;
const INVOICES = `(select id from invoices
   where organization_id in ${ORGANIZATIONS} or order_id in ${ORDERS})`;
const RETURN_CASES = `(select id from return_cases
   where organization_id in ${ORGANIZATIONS} or order_id in ${ORDERS}
      or customer_account_id in ${ACCOUNTS})`;
const CREDIT_LIMITS = `(select id from credit_limits where organization_id in ${ORGANIZATIONS})`;

/** The demo's own promotions: the ones an administrator restricted to the demo organisation. */
const OWN_PROMOTIONS = `(select id from promotions where organization_id in ${ORGANIZATIONS})`;
/** The redemptions the demo organisation, its accounts or its orders made. */
const USAGES = `promotion_usages redemption
   where (redemption.order_id in ${ORDERS} or redemption.organization_id in ${ORGANIZATIONS}
          or redemption.customer_account_id in ${ACCOUNTS})`;

/** One module's share of the withdrawal. */
export interface DemoUsageSection {
  /** What an operator reads in the report. */
  readonly name: string;
  readonly statements: readonly string[];
}

/**
 * One kind of **financial record**: what a reset counts before it starts, and
 * refuses over unless it was told to delete them (issue #143).
 */
export interface DemoFinancialRecordKind {
  /** What an operator reads beside the count. */
  readonly label: string;
  /** One `select count(*)::text as n …` per table of this kind. */
  readonly counts: readonly string[];
}

/**
 * The financial records a used demo can hold — the accounting, legal and
 * payment records of a transaction, as opposed to the transaction itself.
 *
 * ## Which tables, and which not
 *
 * **Financial**: `invoices` (every kind — pro formas and corrections are rows
 * of the same table — with their `invoice_lines` and
 * `invoice_external_attachments`), the three `invoice_ledger_*` tables (what
 * was delivered to an accounting system and how its documents and clients map
 * back, in either environment), `payments`, `refunds`, and
 * `credit_limit_return_topups` (a refund settled against a credit limit).
 *
 * **Not financial**, and withdrawn without being asked: orders and their
 * lines, comments and applied promotions; shipments; stock allocations;
 * `credit_limit_reservations` and the limit itself (the shop's own record of
 * credit in use, not of money that moved); promotion redemptions; return
 * cases; carts, quote requests, shopping lists, comparisons; addresses;
 * accounts, sessions and two-factor enrolments; API keys and webhooks;
 * subscriptions and analytics events; Sales Opportunities.
 *
 * **What this means in practice**: placing an order writes a `payments` row
 * and, while `invoices` is switched on, a pro-forma invoice. So a demo on
 * which one order was placed already holds financial records, and its reset
 * needs the flag.
 *
 * `demo-usage`'s own test holds this list to the sections: every table counted
 * here is one a section deletes.
 */
export const DEMO_FINANCIAL_RECORDS: readonly DemoFinancialRecordKind[] = [
  {
    label: 'invoices',
    counts: [`select count(*)::text as n from invoices where id in ${INVOICES}`],
  },
  {
    label: 'accounting-system records',
    counts: [
      `select count(*)::text as n from invoice_ledger_deliveries
        where organization_id in ${ORGANIZATIONS}`,
      `select count(*)::text as n from invoice_ledger_document_maps
        where organization_id in ${ORGANIZATIONS}`,
      `select count(*)::text as n from invoice_ledger_client_maps
        where organization_id in ${ORGANIZATIONS}`,
    ],
  },
  {
    label: 'payments',
    counts: [`select count(*)::text as n from payments where order_id in ${ORDERS}`],
  },
  {
    label: 'refunds',
    counts: [`select count(*)::text as n from refunds where return_case_id in ${RETURN_CASES}`],
  },
  {
    label: 'refunds settled against the credit limit',
    counts: [
      `select count(*)::text as n from credit_limit_return_topups
        where organization_id in ${ORGANIZATIONS}`,
    ],
  },
];

/**
 * The sections, in the order they run.
 *
 * The population was read off a migrated database's catalogue rather than off
 * entity files: every foreign key that reaches `organizations` or
 * `customer_accounts`, directly or through a table that does, and every `uuid`
 * column that names one of them, or one of their orders, with no foreign key.
 * `backend/test/integration/demo/demo-reset-after-use.test.ts` holds it there:
 * it asks every id column of every table whether it still names a row the
 * reset deleted, so a table that starts referencing the demo organisation
 * fails that file until it has a section here.
 */
export const DEMO_USAGE_SECTIONS: readonly DemoUsageSection[] = [
  {
    // Before the organisation, whose foreign key from `crm_opportunities` is
    // `on delete restrict`. The demo pipeline's own twelve are withdrawn by id
    // in their step; these are the ones an administrator opened since. History,
    // links, comments, events and reminders go through `crm`'s own cascades.
    name: 'Sales Opportunities opened for the demo organisation',
    statements: [`delete from crm_opportunities where organization_id in ${ORGANIZATIONS}`],
  },
  {
    name: 'return cases of the demo organisation',
    statements: [
      `delete from refunds where return_case_id in ${RETURN_CASES}`,
      `delete from return_case_attachments where return_case_id in ${RETURN_CASES}`,
      `delete from return_case_comments where return_case_id in ${RETURN_CASES}`,
      `delete from return_shipments where return_case_id in ${RETURN_CASES}`,
      `delete from return_case_items where return_case_id in ${RETURN_CASES}`,
      `delete from return_cases where id in ${RETURN_CASES}`,
    ],
  },
  {
    // No foreign key says `on delete` here at all, so the organisation's own
    // deletion is refused by each of these three.
    name: 'accounting-system records of the demo organisation',
    statements: [
      `delete from invoice_ledger_deliveries where organization_id in ${ORGANIZATIONS}`,
      `delete from invoice_ledger_document_maps where organization_id in ${ORGANIZATIONS}`,
      `delete from invoice_ledger_client_maps where organization_id in ${ORGANIZATIONS}`,
    ],
  },
  {
    // An invoice names its organisation only when one was known at issue, so
    // the order is the second way in. The number sequence is not rewound: a
    // number that was issued stays issued.
    name: 'invoices issued to the demo organisation',
    statements: [
      `delete from invoice_lines where invoice_id in ${INVOICES}`,
      `delete from invoices where id in ${INVOICES}`,
    ],
  },
  {
    // `promotions` keeps a counter per limit beside the redemptions it counts
    // (`promotion_usage_counters`, bumped by `finalizeUsage` inside the
    // placement), and the module has no operation that gives a use back. So
    // deleting the redemptions alone would leave a real promotion's global,
    // per-coupon or per-batch limit spent by orders that no longer exist. Each
    // redemption therefore returns exactly what `buildGuards` took for it —
    // the same three questions, in SQL — before it goes; the floor is for a
    // limit that was introduced after the redemption was made.
    name: 'promotion uses spent by the demo organisation',
    statements: [
      `update promotion_usage_counters
          set "count" = greatest(0, promotion_usage_counters."count" - spent.uses)
         from (select counted.scope_type, counted.scope_key, count(*)::int as uses
                 from (select case when coupon.limit_scope = 'per_coupon' then 'coupon'
                                   when coupon.limit_scope = 'shared_batch' then 'batch'
                                   else 'global' end as scope_type,
                              case when coupon.limit_scope = 'per_coupon' then coupon.id::text
                                   when coupon.limit_scope = 'shared_batch'
                                     then coalesce(coupon.batch_id, coupon.id)::text
                                   else promotion.id::text end as scope_key
                         from promotions promotion
                         join promotion_usages redemption on redemption.promotion_id = promotion.id
                         left join promotion_coupons coupon on coupon.id = redemption.coupon_id
                        where promotion.usage_limit_global is not null
                          and (redemption.order_id in ${ORDERS}
                               or redemption.organization_id in ${ORGANIZATIONS}
                               or redemption.customer_account_id in ${ACCOUNTS})) counted
                group by counted.scope_type, counted.scope_key) spent
        where promotion_usage_counters.scope_type = spent.scope_type
          and promotion_usage_counters.scope_key = spent.scope_key`,
      // The per-organisation and per-customer counters are keyed
      // `<promotion>:<organisation or account>`; the demo's own have nobody
      // left to count for.
      `delete from promotion_usage_counters
        where (scope_type = 'organization'
               and split_part(scope_key, ':', 2) in (select id::text from ${ORGANIZATIONS} demo))
           or (scope_type = 'customer'
               and split_part(scope_key, ':', 2) in (select id::text from ${ACCOUNTS} demo))`,
      // `promotion_usages.order_id` is `on delete restrict`.
      `delete from ${USAGES}`,
    ],
  },
  {
    // A promotion an administrator restricted to the demo organisation would
    // otherwise be offered to nobody. Its coupons and channel bindings go
    // through `promotions`' own cascades; its counters have no foreign key.
    name: 'promotions restricted to the demo organisation',
    statements: [
      `delete from promotion_usage_counters
        where split_part(scope_key, ':', 1) in (select id::text from ${OWN_PROMOTIONS} own)
           or scope_key in (select id::text from promotion_coupons
                             where promotion_id in ${OWN_PROMOTIONS})
           or scope_key in (select id::text from coupon_batches
                             where promotion_id in ${OWN_PROMOTIONS})`,
      `delete from promotion_usages where promotion_id in ${OWN_PROMOTIONS}`,
      `delete from promotions where organization_id in ${ORGANIZATIONS}`,
    ],
  },
  {
    name: "payments of the demo organisation's orders",
    statements: [`delete from payments where order_id in ${ORDERS}`],
  },
  {
    name: "shipments of the demo organisation's orders",
    statements: [`delete from shipments where order_id in ${ORDERS}`],
  },
  {
    // An allocation that was never released is stock still promised to an
    // order that is about to stop existing, so the promise is taken back first
    // — `releaseForOrderItems`' own arithmetic, floor included. It matters for
    // a product the operator added themselves; the demo catalogue's stock rows
    // are withdrawn whole by their own step.
    name: "stock held for the demo organisation's orders",
    statements: [
      `update stock_levels set reserved = greatest(0, stock_levels.reserved - held.quantity)
         from (select allocation.warehouse_id, item.product_id, item.variant_id,
                      sum(allocation.quantity)::int as quantity
                 from stock_allocations allocation
                 join order_items item on item.id = allocation.order_item_id
                where allocation.released_at is null and item.order_id in ${ORDERS}
                group by allocation.warehouse_id, item.product_id, item.variant_id) held
        where stock_levels.warehouse_id = held.warehouse_id
          and stock_levels.product_id = held.product_id
          and (stock_levels.variant_id = held.variant_id
               or (stock_levels.variant_id is null and held.variant_id is null))`,
      `delete from stock_allocations where order_item_id in ${ORDER_ITEMS}`,
    ],
  },
  {
    name: 'back-in-stock requests of the demo organisation',
    statements: [
      `delete from availability_notifications
        where organization_id in ${ORGANIZATIONS} or customer_account_id in ${ACCOUNTS}`,
    ],
  },
  {
    // The first of the two refusals the issue names: one order on credit and
    // the credit limit could no longer be withdrawn, released reservation or
    // not. The limit itself goes here too, though a step granted it: that
    // step's own withdrawal is skipped while `credit_limits` is switched off,
    // and the row's foreign key would then refuse the organisation.
    name: 'credit limit of the demo organisation, and what was drawn against it',
    statements: [
      `delete from credit_limit_reservations
        where credit_limit_id in ${CREDIT_LIMITS}
           or reserving_organization_id in ${ORGANIZATIONS} or order_id in ${ORDERS}`,
      `delete from credit_limit_return_topups where organization_id in ${ORGANIZATIONS}`,
      `delete from credit_limits where organization_id in ${ORGANIZATIONS}`,
    ],
  },
  {
    // Items and the approval trail go through `carts`' own cascades.
    name: 'carts of the demo organisation',
    statements: [
      `delete from carts
        where organization_id in ${ORGANIZATIONS} or customer_account_id in ${ACCOUNTS}`,
    ],
  },
  {
    // After everything that is found through an order. `orders` holds no
    // foreign key onto `organizations`, which is why these used to survive a
    // reset naming an organisation that was gone.
    name: 'orders placed by the demo organisation',
    statements: [
      `delete from order_comments where order_id in ${ORDERS}`,
      `delete from order_applied_promotions where order_id in ${ORDERS}`,
      `delete from order_placement_intents where organization_id in ${ORGANIZATIONS}`,
      `delete from orders where organization_id in ${ORGANIZATIONS}`,
    ],
  },
  {
    name: 'quote requests of the demo organisation',
    statements: [`delete from quote_requests where organization_id in ${ORGANIZATIONS}`],
  },
  {
    name: 'shopping lists of the demo organisation',
    statements: [
      `delete from shopping_lists
        where organization_id in ${ORGANIZATIONS} or customer_account_id in ${ACCOUNTS}`,
    ],
  },
  {
    name: 'product comparisons of the demo organisation',
    statements: [
      `delete from comparisons
        where organization_id in ${ORGANIZATIONS} or customer_account_id in ${ACCOUNTS}`,
    ],
  },
  {
    name: 'quick-order defaults of the demo organisation',
    statements: [
      `delete from quick_order_default_preferences
        where (scope = 'organization' and scope_id in ${ORGANIZATIONS})
           or (scope = 'customer' and scope_id in ${ACCOUNTS})`,
    ],
  },
  {
    // The second of the two refusals the issue names: one saved address and
    // the organisation could no longer be withdrawn.
    name: 'addresses saved by the demo organisation',
    statements: [`delete from addresses where organization_id in ${ORGANIZATIONS}`],
  },
  {
    name: "addresses saved by the demo organisation's accounts",
    statements: [`delete from customer_addresses where customer_account_id in ${ACCOUNTS}`],
  },
  {
    name: 'price lists and price display set for the demo organisation',
    statements: [
      `delete from price_list_assignments where organization_id in ${ORGANIZATIONS}`,
      `delete from price_display_mode_overrides
        where scope = 'organization' and target_id in ${ORGANIZATIONS}`,
    ],
  },
  {
    // `on delete restrict` from both the organisation and the account.
    name: 'API keys issued to the demo organisation',
    statements: [
      `delete from api_keys
        where organization_id in ${ORGANIZATIONS} or customer_account_id in ${ACCOUNTS}`,
    ],
  },
  {
    name: 'webhooks registered for the demo organisation',
    statements: [`delete from webhooks where organization_id in ${ORGANIZATIONS}`],
  },
  {
    name: 'analytics events of the demo organisation',
    statements: [
      `delete from analytics_events
        where organization_id in ${ORGANIZATIONS} or customer_account_id in ${ACCOUNTS}`,
    ],
  },
  {
    name: 'newsletter subscriptions of the demo organisation',
    statements: [
      `delete from newsletter_subscribers
        where organization_id in ${ORGANIZATIONS} or customer_account_id in ${ACCOUNTS}`,
    ],
  },
  {
    name: 'push subscriptions of the demo organisation',
    statements: [
      `delete from push_subscriptions
        where organization_id in ${ORGANIZATIONS} or customer_account_id in ${ACCOUNTS}`,
    ],
  },
  {
    name: 'two-factor enrolments of the demo organisation',
    statements: [
      `delete from mfa_enrolments where subject_type = 'customer' and subject_id in ${ACCOUNTS}`,
      `delete from mfa_social_identities
        where subject_type = 'customer' and subject_id in ${ACCOUNTS}`,
      `delete from mfa_organization_policies where organization_id in ${ORGANIZATIONS}`,
    ],
  },
  {
    name: "sessions of the demo organisation's accounts",
    statements: [`delete from sessions where customer_account_id in ${ACCOUNTS}`],
  },
  {
    // The buyer's own, which no foreign key removes with the account.
    name: "password resets of the demo organisation's accounts",
    statements: [`delete from password_reset_tokens where customer_account_id in ${ACCOUNTS}`],
  },
  {
    // Last, because every section above that reads `ACCOUNTS` finds its rows
    // through these. Everybody **but the seeded buyer**, whom the buyer step
    // created and withdraws: these are the colleagues the buyer invited and
    // the accounts an administrator added, and a second account was what
    // refused the organisation's deletion before.
    name: 'accounts that joined the demo organisation',
    statements: [
      `delete from customer_accounts
        where organization_id in ${ORGANIZATIONS} and email <> :buyer_email`,
    ],
  },
];

/** The section names, for a test that asserts the composition's shape. */
export const DEMO_USAGE_SECTION_NAMES: readonly string[] = DEMO_USAGE_SECTIONS.map(
  (section) => section.name,
);

/** What `bind` binds. */
interface DemoIdentity {
  /** The tax id `organizations`' demo row is keyed on. */
  readonly organizationTaxId: string;
  /** The seeded buyer's e-mail address — the one account a step withdraws itself. */
  readonly buyerEmail: string;
}

/** A statement with one bound value per placeholder it carries, in order. */
export function bind(statement: string, identity: DemoIdentity): [string, string[]] {
  const values: string[] = [];
  const sql = statement.replace(/\?|:buyer_email\b/g, (placeholder) => {
    values.push(placeholder === '?' ? identity.organizationTaxId : identity.buyerEmail);
    return '?';
  });
  return [sql, values];
}

/**
 * Every table a list of statements names, read off the statements.
 *
 * Derived so that the guard cannot fall behind the SQL it guards. A table is
 * what follows `from`, `join`, `update` or `into`; a sub-select follows them
 * with a parenthesis and names nothing itself.
 */
export function tablesOf(statements: readonly string[]): string[] {
  const tables = new Set<string>();
  for (const statement of statements) {
    for (const match of statement.matchAll(/\b(?:from|join|update|into)\s+([a-z_][a-z0-9_]*)/g)) {
      tables.add(match[1]!);
    }
  }
  return [...tables].sort();
}

/**
 * The demo organisation has organisations filed under it, and the reset will
 * not decide what happens to them.
 *
 * A sub-organisation is found by nothing this file is entitled to match — it
 * has its own tax id, or none — and `organizations.parent_id` is `on delete
 * restrict`, so the demo organisation cannot go while one exists. Deleting the
 * subtree would be this file widening its own predicate to an organisation an
 * operator may have moved there on purpose. So it stops, before anything is
 * withdrawn, and says what to do.
 */
export class DemoOrganizationHasBranchesError extends DemoResetRefusedError {
  constructor(readonly branches: number) {
    super(
      `[demo] the demo organisation has ${branches} sub-organisation(s) filed under it, and ` +
        `a demo reset withdraws the demo organisation only. Nothing has been changed. Detach ` +
        `them (Organizations → the sub-organisation → Parent) or delete them, then run the ` +
        `reset again.`,
    );
    this.name = 'DemoOrganizationHasBranchesError';
  }
}

/**
 * The demo organisation holds financial records and the reset was not told to
 * delete them.
 *
 * Counts per kind and never an id: the message is read on a terminal and in a
 * deployment log, and says how much there is, not whose.
 */
export class DemoOrganizationHoldsFinancialRecordsError extends DemoResetRefusedError {
  constructor(readonly found: readonly { readonly label: string; readonly rows: number }[]) {
    super(
      `[demo] the demo organisation holds financial records, and a demo reset does not ` +
        `delete those unless it is told to:\n` +
        found.map((kind) => `  ${kind.label}: ${kind.rows}\n`).join('') +
        `Nothing has been changed. They are records of transactions — an invoice may have ` +
        `been reported, a payment matched in somebody's books. If this instance's data is ` +
        `disposable, run the reset again with ${DEMO_FORCE_DELETE_FINANCIAL_RECORDS_FLAG} to ` +
        `delete them with the rest of the demo. The flag is read from the command line only, ` +
        `and deletes the kinds listed here and nothing else.`,
    );
    this.name = 'DemoOrganizationHoldsFinancialRecordsError';
  }
}

export interface DemoUsageWithdrawalDeps extends DemoIdentity {
  readonly em: EntityManager;
  /**
   * The operator passed `--force-delete-financial-records`. Without it, a demo
   * organisation that holds any of {@link DEMO_FINANCIAL_RECORDS} is refused
   * before a row is deleted.
   */
  readonly deleteFinancialRecords?: boolean;
}

/** The name the whole withdrawal is reported under when it cannot run at all. */
export const DEMO_USAGE_WITHDRAWAL_NAME = 'what using the demo left behind';

/**
 * Withdraw what using the demo left behind — every section whose tables are in
 * this database, in one transaction, or nothing.
 */
export async function withdrawDemoUsage(
  deps: DemoUsageWithdrawalDeps,
): Promise<DemoCompositionResult> {
  const applied: string[] = [];
  const skipped: { step: string; reason: string }[] = [];

  await deps.em.transactional(async (tx) => {
    const named = [
      ...new Set([
        ...DEMO_USAGE_SECTIONS.flatMap((section) => tablesOf(section.statements)),
        ...DEMO_FINANCIAL_RECORDS.flatMap((kind) => tablesOf(kind.counts)),
      ]),
    ];
    const found = await tx.execute<{ table_name: string }[]>(
      `select table_name from information_schema.tables
        where table_schema = current_schema()
          and table_name in (${named.map(() => '?').join(', ')})`,
      named,
    );
    const present = new Set(found.map((row) => row.table_name));

    const running: DemoUsageSection[] = [];
    for (const section of DEMO_USAGE_SECTIONS) {
      const missing = tablesOf(section.statements).filter((table) => !present.has(table));
      if (missing.length === 0) running.push(section);
      else {
        skipped.push({
          step: section.name,
          reason:
            `no table ${missing.map((table) => `'${table}'`).join(', ')} in this database — ` +
            `the module that owns ${missing.length === 1 ? 'it' : 'them'} is not installed`,
        });
      }
    }
    if (running.length === 0) return;

    // Every running section names `organizations`, so the table is there.
    const branches = await tx.execute<{ n: string }[]>(
      ...bind(
        `select count(*)::text as n from organizations where parent_id in ${ORGANIZATIONS}`,
        deps,
      ),
    );
    const count = Number(branches[0]?.n ?? '0');
    if (count > 0) throw new DemoOrganizationHasBranchesError(count);

    // The pre-flight: counted before a single row is deleted, so a refusal
    // has nothing to undo. A kind whose table is not in this database cannot
    // hold a row, and is not asked about.
    if (deps.deleteFinancialRecords !== true) {
      const held: { label: string; rows: number }[] = [];
      for (const kind of DEMO_FINANCIAL_RECORDS) {
        let rows = 0;
        for (const statement of kind.counts) {
          if (!tablesOf([statement]).every((table) => present.has(table))) continue;
          const counted = await tx.execute<{ n: string }[]>(...bind(statement, deps));
          rows += Number(counted[0]?.n ?? '0');
        }
        if (rows > 0) held.push({ label: kind.label, rows });
      }
      if (held.length > 0) throw new DemoOrganizationHoldsFinancialRecordsError(held);
    }

    for (const section of running) {
      for (const statement of section.statements) {
        await tx.execute(...bind(statement, deps));
      }
      applied.push(section.name);
    }
  });
  return { applied, skipped };
}
