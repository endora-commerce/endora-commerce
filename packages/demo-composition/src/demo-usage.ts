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
 * ## One section per owning module
 *
 * Each section deletes from the tables of **one** module, is guarded by an
 * effective-presence question about that module and every module whose rows it
 * reads to find its own (§5.4), and is a reported skip when one of them is
 * absent. It is raw SQL for the reason the credit-limit step gives: most of
 * these entities are organisation-scoped, and a withdrawal that depended on the
 * ambient tenant would remove a different set under a different scope.
 *
 * The order is children before parents, twice over: a foreign key refuses the
 * other order, and a section finds its rows *through* the orders, invoices and
 * accounts a later section deletes.
 *
 * ## One transaction, and first
 *
 * A demo run is not one transaction — it is this, then every other step, then
 * every module's own body. So the part that can be refused runs **first** and
 * **atomically**: a foreign key nobody here has heard of (an installed module's
 * table referencing `orders`, say) fails the run before a single row has gone,
 * and the instance is exactly as it was — the buyer can still check out. The
 * alternative order was measured in the issue this answers: the payment
 * methods, the delivery methods and the credit limit were already withdrawn by
 * the time the organisation refused to go.
 *
 * ## What is kept
 *
 * Records of things that happened: the audit trail, the e-mail delivery log and
 * the administrators' notification history. They are logs, not data of the
 * demo organisation, and they name what they are about by an id that is allowed
 * to outlive it.
 */
import type { EntityManager } from '@mikro-orm/postgresql';
import type { DemoCompositionResult } from '@endora-commerce/platform/demo';

// ── whose rows ─────────────────────────────────────────────────────────────
//
// Every fragment is a sub-select and carries one `?` per mention of the demo
// organisation's tax id; `bind` counts them, so a statement is written once and
// never beside a hand-maintained parameter list.

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

/** One module's share of the withdrawal. */
export interface DemoUsageSection {
  /** What an operator reads in the report. */
  readonly name: string;
  /**
   * The module that owns the tables written, then every module whose tables
   * the statements read to find them. The guard's whole input (§5.4).
   */
  readonly modules: readonly string[];
  readonly statements: readonly string[];
}

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
    modules: ['crm', 'organizations'],
    statements: [`delete from crm_opportunities where organization_id in ${ORGANIZATIONS}`],
  },
  {
    name: 'return cases of the demo organisation',
    modules: ['returns', 'orders', 'customer_accounts', 'organizations'],
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
    modules: ['invoice_ledger', 'organizations'],
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
    modules: ['invoices', 'orders', 'organizations'],
    statements: [
      `delete from invoice_lines where invoice_id in ${INVOICES}`,
      `delete from invoices where id in ${INVOICES}`,
    ],
  },
  {
    // The usages first — `promotion_usages.order_id` is `on delete restrict` —
    // then any promotion an administrator restricted to the demo organisation,
    // which would otherwise be offered to nobody.
    name: 'promotions used by, or restricted to, the demo organisation',
    modules: ['promotions', 'orders', 'customer_accounts', 'organizations'],
    statements: [
      `delete from promotion_usages
        where order_id in ${ORDERS} or organization_id in ${ORGANIZATIONS}
           or customer_account_id in ${ACCOUNTS}`,
      `delete from promotions where organization_id in ${ORGANIZATIONS}`,
    ],
  },
  {
    name: "payments of the demo organisation's orders",
    modules: ['payments', 'orders', 'organizations'],
    statements: [`delete from payments where order_id in ${ORDERS}`],
  },
  {
    name: "shipments of the demo organisation's orders",
    modules: ['shipments', 'orders', 'organizations'],
    statements: [`delete from shipments where order_id in ${ORDERS}`],
  },
  {
    // An allocation that was never released is stock still promised to an
    // order that is about to stop existing, so the promise is taken back first
    // — `releaseForOrderItems`' own arithmetic, floor included. It matters for
    // a product the operator added themselves; the demo catalogue's stock rows
    // are withdrawn whole by their own step.
    name: "stock held for the demo organisation's orders",
    modules: ['inventory', 'orders', 'organizations'],
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
          and stock_levels.variant_id is not distinct from held.variant_id`,
      `delete from stock_allocations where order_item_id in ${ORDER_ITEMS}`,
    ],
  },
  {
    name: 'back-in-stock requests of the demo organisation',
    modules: ['inventory', 'customer_accounts', 'organizations'],
    statements: [
      `delete from availability_notifications
        where organization_id in ${ORGANIZATIONS} or customer_account_id in ${ACCOUNTS}`,
    ],
  },
  {
    // The first of the two refusals the issue names: one order on credit and
    // the credit limit could no longer be withdrawn, released reservation or
    // not. The limit row itself is the credit-limit step's and stays for it.
    name: "credit drawn against the demo organisation's limit",
    modules: ['credit_limits', 'orders', 'organizations'],
    statements: [
      `delete from credit_limit_reservations
        where credit_limit_id in ${CREDIT_LIMITS}
           or reserving_organization_id in ${ORGANIZATIONS} or order_id in ${ORDERS}`,
      `delete from credit_limit_return_topups where organization_id in ${ORGANIZATIONS}`,
    ],
  },
  {
    // Items and the approval trail go through `carts`' own cascades.
    name: 'carts of the demo organisation',
    modules: ['carts', 'customer_accounts', 'organizations'],
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
    modules: ['orders', 'organizations'],
    statements: [
      `delete from order_comments where order_id in ${ORDERS}`,
      `delete from order_applied_promotions where order_id in ${ORDERS}`,
      `delete from order_placement_intents where organization_id in ${ORGANIZATIONS}`,
      `delete from orders where organization_id in ${ORGANIZATIONS}`,
    ],
  },
  {
    name: 'quote requests of the demo organisation',
    modules: ['quote_requests', 'organizations'],
    statements: [`delete from quote_requests where organization_id in ${ORGANIZATIONS}`],
  },
  {
    name: 'shopping lists of the demo organisation',
    modules: ['shopping_lists', 'customer_accounts', 'organizations'],
    statements: [
      `delete from shopping_lists
        where organization_id in ${ORGANIZATIONS} or customer_account_id in ${ACCOUNTS}`,
    ],
  },
  {
    name: 'product comparisons of the demo organisation',
    modules: ['comparisons', 'customer_accounts', 'organizations'],
    statements: [
      `delete from comparisons
        where organization_id in ${ORGANIZATIONS} or customer_account_id in ${ACCOUNTS}`,
    ],
  },
  {
    name: 'quick-order defaults of the demo organisation',
    modules: ['quick_order', 'customer_accounts', 'organizations'],
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
    modules: ['addresses', 'organizations'],
    statements: [`delete from addresses where organization_id in ${ORGANIZATIONS}`],
  },
  {
    name: "addresses saved by the demo organisation's accounts",
    modules: ['customers', 'customer_accounts', 'organizations'],
    statements: [`delete from customer_addresses where customer_account_id in ${ACCOUNTS}`],
  },
  {
    name: 'price lists and price display set for the demo organisation',
    modules: ['price_lists', 'organizations'],
    statements: [
      `delete from price_list_assignments where organization_id in ${ORGANIZATIONS}`,
      `delete from price_display_mode_overrides
        where scope = 'organization' and target_id in ${ORGANIZATIONS}`,
    ],
  },
  {
    // `on delete restrict` from both the organisation and the account.
    name: 'API keys issued to the demo organisation',
    modules: ['api_keys', 'customer_accounts', 'organizations'],
    statements: [
      `delete from api_keys
        where organization_id in ${ORGANIZATIONS} or customer_account_id in ${ACCOUNTS}`,
    ],
  },
  {
    name: 'webhooks registered for the demo organisation',
    modules: ['webhooks', 'organizations'],
    statements: [`delete from webhooks where organization_id in ${ORGANIZATIONS}`],
  },
  {
    name: 'analytics events of the demo organisation',
    modules: ['analytics', 'customer_accounts', 'organizations'],
    statements: [
      `delete from analytics_events
        where organization_id in ${ORGANIZATIONS} or customer_account_id in ${ACCOUNTS}`,
    ],
  },
  {
    name: 'newsletter subscriptions of the demo organisation',
    modules: ['newsletter', 'customer_accounts', 'organizations'],
    statements: [
      `delete from newsletter_subscribers
        where organization_id in ${ORGANIZATIONS} or customer_account_id in ${ACCOUNTS}`,
    ],
  },
  {
    name: 'push subscriptions of the demo organisation',
    modules: ['pwa', 'customer_accounts', 'organizations'],
    statements: [
      `delete from push_subscriptions
        where organization_id in ${ORGANIZATIONS} or customer_account_id in ${ACCOUNTS}`,
    ],
  },
  {
    name: 'two-factor enrolments of the demo organisation',
    modules: ['mfa', 'customer_accounts', 'organizations'],
    statements: [
      `delete from mfa_enrolments where subject_type = 'customer' and subject_id in ${ACCOUNTS}`,
      `delete from mfa_social_identities
        where subject_type = 'customer' and subject_id in ${ACCOUNTS}`,
      `delete from mfa_organization_policies where organization_id in ${ORGANIZATIONS}`,
    ],
  },
  {
    name: "sessions of the demo organisation's accounts",
    modules: ['auth', 'customer_accounts', 'organizations'],
    statements: [`delete from sessions where customer_account_id in ${ACCOUNTS}`],
  },
  {
    // Last, because every section above that reads `ACCOUNTS` finds its rows
    // through these. The buyer is among them, so the buyer step that follows
    // finds nothing left to do; a colleague the buyer invited is one too, and
    // was what refused the organisation's deletion before.
    name: 'customer accounts of the demo organisation',
    modules: ['customer_accounts', 'organizations'],
    statements: [
      `delete from password_reset_tokens where customer_account_id in ${ACCOUNTS}`,
      `delete from customer_accounts where organization_id in ${ORGANIZATIONS}`,
    ],
  },
];

/** The section names, for a test that asserts the composition's shape. */
export const DEMO_USAGE_SECTION_NAMES: readonly string[] = DEMO_USAGE_SECTIONS.map(
  (section) => section.name,
);

/** A statement with one bound value per `?` it carries. */
function bind(statement: string, value: string): [string, string[]] {
  const mentions = statement.split('?').length - 1;
  return [statement, new Array<string>(mentions).fill(value)];
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
export class DemoOrganizationHasBranchesError extends Error {
  constructor(readonly branches: number) {
    super(
      `[demo] the demo organisation has ${branches} sub-organisation(s) filed under it, and ` +
        `a demo reset withdraws the demo organisation only. Nothing was withdrawn. Detach ` +
        `them (Organizations → the sub-organisation → Parent) or delete them, then run the ` +
        `reset again.`,
    );
    this.name = 'DemoOrganizationHasBranchesError';
  }
}

export interface DemoUsageWithdrawalDeps {
  readonly em: EntityManager;
  readonly isPresent: (moduleId: string) => boolean;
  /** The tax id `organizations`' demo row is keyed on. */
  readonly organizationTaxId: string;
  /** The sentence a skipped section is reported with, given the absent modules. */
  readonly absenceReason: (absent: readonly string[]) => string;
}

/**
 * Withdraw what using the demo left behind — every present section, in one
 * transaction, or nothing.
 */
export async function withdrawDemoUsage(
  deps: DemoUsageWithdrawalDeps,
): Promise<DemoCompositionResult> {
  const skipped: { step: string; reason: string }[] = [];
  const running: DemoUsageSection[] = [];
  for (const section of DEMO_USAGE_SECTIONS) {
    const absent = section.modules.filter((moduleId) => !deps.isPresent(moduleId));
    if (absent.length > 0) skipped.push({ step: section.name, reason: deps.absenceReason(absent) });
    else running.push(section);
  }
  // Nothing to run means nothing is opened: an instance holding none of these
  // modules is an ordinary instance, and this must not be its first query.
  if (running.length === 0) return { applied: [], skipped };

  await deps.em.transactional(async (tx) => {
    // Every running section names `organizations`, so the table is there.
    const branches = await tx.execute<{ n: string }[]>(
      ...bind(
        `select count(*)::text as n from organizations where parent_id in ${ORGANIZATIONS}`,
        deps.organizationTaxId,
      ),
    );
    const count = Number(branches[0]?.n ?? '0');
    if (count > 0) throw new DemoOrganizationHasBranchesError(count);

    for (const section of running) {
      for (const statement of section.statements) {
        await tx.execute(...bind(statement, deps.organizationTaxId));
      }
    }
  });
  return { applied: running.map((section) => section.name), skipped };
}
