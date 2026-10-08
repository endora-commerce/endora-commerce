/**
 * The demo sales pipeline — the composition step that fills CRM's board
 * (`specs/143-crm-sales-opportunities/research.md` N-DD1).
 *
 * A Sales Opportunity is `crm`'s row and almost nothing in it is `crm`'s alone:
 * it belongs to an Organization (`organizations`), is assigned to an
 * administrator and its notes are written by one (`admin_users`), names a
 * contact person (`customer_accounts`), is attributed to a Sales Channel (the
 * kernel's) and its texts mention Products (`catalog`). So the pipeline is a
 * composition step and no module's demo data (§5.1) — the same finding as the
 * demo buyer and the credit limit, one module over. What `crm` can own alone it
 * does: the tags, which its own demo body seeds and this step finds by name.
 *
 * It is a file of its own only because of its size; `composition.ts` holds the
 * step list and this file is one entry of it.
 *
 * ## The rows are written, not commanded
 *
 * Every Opportunity an operator creates goes through CRM's Commands, which
 * stamp `now` on it and audit the write. A pipeline that was all created in the
 * same second has no "time in status", no "won per month" and nothing for the
 * analytics to draw, so this step writes the rows — the Opportunity, one
 * status-history row per change, the comments and the index of what they
 * mention — with the dates a three-month-old pipeline would carry, counted back
 * from the moment of the seed. That is the licence every demo write in this
 * feature runs on (`endora demo seed` refuses a production database before
 * anything is composed), and it has one visible cost: the **History** tab of a
 * seeded Opportunity is empty, because that tab reads the audit log and no
 * Command ran.
 *
 * The number is the exception and is asked for, not written:
 * `nextOpportunityNumber` is `crm`'s own door to its sequence, so a demo
 * Opportunity and the next one an operator creates cannot collide.
 *
 * ## What is not here, because the demo has nothing to link
 *
 * No Opportunity is linked to an Order or a Quote Request: no module seeds
 * either and no composition step places one. One Opportunity is valued
 * "calculated from its documents" all the same — honestly at zero, in the start
 * status — so the mode is on show and an Order created from it moves the figure.
 * Nor does the step write Order-status mappings or value-counting statuses:
 * those are the operator's workflow configuration, and a reset could not tell a
 * mapping it wrote from one an operator re-saved.
 *
 * ## Idempotent per Opportunity, withdrawn by id
 *
 * Each Opportunity has a fixed id. One that is already there is left exactly as
 * it is — an operator may have moved it — and one that is missing is created
 * whole in one transaction. The withdrawal deletes by those ids and the
 * children go through the foreign keys of `crm`'s own schema.
 */
import type { Opt } from '@mikro-orm/postgresql';
import {
  formatOpportunityReferenceToken,
  type OpportunityReferenceToken,
} from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { entityNamed } from '@endora-commerce/platform/packages';
import type { CompositionStep } from './composition.js';

// ── the rows this step reads and writes ────────────────────────────────────
//
// The columns this file touches and nothing else, structural, in
// `composition.ts`' shape and for its reason (D-168).

interface CrmOpportunityRow {
  id: string;
  number: string;
  title: string;
  description?: string | null;
  organizationId: string;
  customerAccountId?: string | null;
  salesChannelId?: string | null;
  statusCode: string;
  assignedAdminUserId?: string | null;
  valueMode: Opt<string>;
  manualValue?: string | null;
  currency: string;
  expectedCloseDate?: string | null;
  closedAt?: Date | null;
  closedKind?: string | null;
  createdByAdminUserId?: string | null;
  createdAt: Opt<Date>;
  updatedAt: Opt<Date>;
}
interface CrmOpportunityStatusRow {
  id: Opt<string>;
  code: string;
  kind: string;
}
interface CrmOpportunityStatusHistoryRow {
  id: Opt<string>;
  opportunityId: string;
  fromStatusCode?: string | null;
  toStatusCode: string;
  changedAt: Opt<Date>;
  actorAdminUserId?: string | null;
  cause: string;
  reason?: string | null;
}
interface CrmTagRow {
  id: Opt<string>;
  name: string;
}
interface CrmOpportunityTagRow {
  opportunityId: string;
  tagId: string;
  createdAt: Opt<Date>;
}
interface CrmOpportunityCommentRow {
  id: string;
  opportunityId: string;
  kind: string;
  authorAdminUserId: string;
  body: string;
  createdAt: Opt<Date>;
}
interface CrmOpportunityReferenceRow {
  id: Opt<string>;
  opportunityId: string;
  sourceKind: string;
  sourceId?: string | null;
  targetType: string;
  targetId: string;
}
interface OrganizationRow {
  id: Opt<string>;
  taxId: string | null;
}
interface AdminUserRow {
  id: Opt<string>;
  email: string;
}
interface CustomerAccountRow {
  id: Opt<string>;
  organizationId: string;
  email: string;
}
interface ProductRow {
  id: Opt<string>;
  slug: string;
}

const CRM = '@endora-commerce/mod-crm/backend';
const ORGANIZATIONS = '@endora-commerce/mod-organizations/backend';
const ADMIN_USERS = '@endora-commerce/mod-admin-users/backend';
const CUSTOMER_ACCOUNTS = '@endora-commerce/mod-customer-accounts/backend';
const CATALOG = '@endora-commerce/mod-catalog/backend';

async function crmRows() {
  const { entities, nextOpportunityNumber } = await import('@endora-commerce/mod-crm/backend');
  return {
    CrmOpportunity: entityNamed<CrmOpportunityRow>(entities, 'CrmOpportunity', CRM),
    CrmOpportunityStatus: entityNamed<CrmOpportunityStatusRow>(entities, 'CrmOpportunityStatus', CRM),
    CrmOpportunityStatusHistory: entityNamed<CrmOpportunityStatusHistoryRow>(
      entities,
      'CrmOpportunityStatusHistory',
      CRM,
    ),
    CrmTag: entityNamed<CrmTagRow>(entities, 'CrmTag', CRM),
    CrmOpportunityTag: entityNamed<CrmOpportunityTagRow>(entities, 'CrmOpportunityTag', CRM),
    CrmOpportunityComment: entityNamed<CrmOpportunityCommentRow>(
      entities,
      'CrmOpportunityComment',
      CRM,
    ),
    CrmOpportunityReference: entityNamed<CrmOpportunityReferenceRow>(
      entities,
      'CrmOpportunityReference',
      CRM,
    ),
    nextOpportunityNumber,
  };
}

async function neighbourRows() {
  const [organizations, adminUsers, customerAccounts, catalog] = await Promise.all([
    import('@endora-commerce/mod-organizations/backend'),
    import('@endora-commerce/mod-admin-users/backend'),
    import('@endora-commerce/mod-customer-accounts/backend'),
    import('@endora-commerce/mod-catalog/backend'),
  ]);
  return {
    Organization: entityNamed<OrganizationRow>(organizations.entities, 'Organization', ORGANIZATIONS),
    AdminUser: entityNamed<AdminUserRow>(adminUsers.entities, 'AdminUser', ADMIN_USERS),
    CustomerAccount: entityNamed<CustomerAccountRow>(
      customerAccounts.entities,
      'CustomerAccount',
      CUSTOMER_ACCOUNTS,
    ),
    Product: entityNamed<ProductRow>(catalog.entities, 'Product', CATALOG),
  };
}

// ── the demo shop's own vocabulary ─────────────────────────────────────────
//
// The natural keys the other modules' demo data and the composition's earlier
// steps assign. Stated again here rather than imported: a composition joins by
// what is in the database, and none of these is published by its owner.

const DEMO_ORG_TAX_ID = 'PL5210000099';
const DEMO_BUYER_EMAIL = 'buyer@demo-org.example';
const DEMO_VIP_CHANNEL_CODE = 'pl_b2b_vip';
const DEMO_PRODUCT_SLUG_PREFIX = 'demo-';

/** The people of the demo, by the e-mail address `admin_users`' demo data gives each. */
const DEMO_PEOPLE = {
  admin: 'admin@demo.local',
  anna: 'sales-rep@demo.local',
  tomasz: 'sales-rep-other@demo.local',
} as const;
type DemoPerson = keyof typeof DEMO_PEOPLE;

/** The tags `crm`'s own demo data creates, which this step labels with. */
export const DEMO_PIPELINE_TAG_NAMES = ['Key account', 'Upsell', 'Tender'] as const;
type DemoTagName = (typeof DEMO_PIPELINE_TAG_NAMES)[number];

/**
 * One piece of a demo text: words, or something the text names.
 *
 * A Product is named by the leaf category its demo slug carries
 * (`demo-<leaf>-<index>`), a person by their key in {@link DEMO_PEOPLE}.
 * `otherwise` is what the sentence says when the target is not in this
 * database — an operator deleted the product, or removed the account — so the
 * text still reads and simply references nothing.
 */
export type DemoTextPart =
  | string
  | { readonly product: string; readonly otherwise: string }
  | { readonly person: string; readonly otherwise: string };

/** The ids a demo text's targets resolved to in this database. */
export interface DemoTextTargets {
  readonly products: ReadonlyMap<string, string>;
  readonly people: ReadonlyMap<string, string>;
}

/**
 * A demo text as CRM stores one: plain text carrying reference tokens, and the
 * targets it names — each once, in first-appearance order, which is what the
 * contracts package's own extraction answers for the same text.
 */
export function renderDemoText(
  parts: readonly DemoTextPart[],
  targets: DemoTextTargets,
): { text: string; references: OpportunityReferenceToken[] } {
  const references: OpportunityReferenceToken[] = [];
  const name = (type: OpportunityReferenceToken['type'], id: string): string => {
    if (!references.some((held) => held.type === type && held.id === id)) references.push({ type, id });
    return formatOpportunityReferenceToken(type, id);
  };
  const text = parts
    .map((part) => {
      if (typeof part === 'string') return part;
      if ('product' in part) {
        const id = targets.products.get(part.product);
        return id === undefined ? part.otherwise : name('product', id);
      }
      const id = targets.people.get(part.person);
      return id === undefined ? part.otherwise : name('admin_user', id);
    })
    .join('');
  return { text, references };
}

/** A note or an internal message on a demo Opportunity. */
export interface DemoOpportunityComment {
  readonly kind: 'note' | 'message';
  readonly author: DemoPerson;
  readonly daysAgo: number;
  readonly body: readonly DemoTextPart[];
}

/** One demo Opportunity. */
export interface DemoOpportunity {
  /** Fixed: what a second seed probes for and what the withdrawal deletes by. */
  readonly id: string;
  readonly title: string;
  readonly description?: readonly DemoTextPart[];
  /**
   * Every status the Opportunity has been in, oldest first, and how many days
   * before the seed it entered each. The first entry is its creation; the last
   * is where it stands.
   */
  readonly path: readonly { readonly status: string; readonly daysAgo: number }[];
  /** Why it was lost — recorded on the change that closed it. */
  readonly lostReason?: string;
  readonly assignee: Exclude<DemoPerson, 'admin'> | null;
  /** A manual figure in `currency`, or `'computed'` — calculated from linked documents. */
  readonly value: string;
  readonly tags: readonly DemoTagName[];
  /** Whether the demo buyer is its contact person. */
  readonly contact?: boolean;
  /** Attributed to the demo's VIP channel rather than the default one. */
  readonly vipChannel?: boolean;
  /** Expected close, in days from the seed. Open Opportunities only. */
  readonly closesInDays?: number;
  readonly comments?: readonly DemoOpportunityComment[];
}

/** The currency the demo trades in — its sales channels' default. */
const DEMO_CURRENCY = 'PLN';

const fixedId = (ordinal: number): string =>
  `0c2a0143-0000-4000-8000-${String(ordinal).padStart(12, '0')}`;

/**
 * The pipeline: two Opportunities in each of the six statuses `crm`'s init
 * migration seeds, created over the last three months.
 *
 * English, as the rest of the demo's prose is; the business is the Polish
 * industrial distributor the demo catalogue describes — fasteners, tools,
 * electronics and safety equipment.
 */
export const DEMO_OPPORTUNITIES: readonly DemoOpportunity[] = [
  {
    id: fixedId(1),
    title: 'Screw assortment for the new assembly line',
    description: [
      'The second production line starts in spring. The buyer asked for a framework price on ',
      { product: 'screws', otherwise: 'the screw assortment' },
      ' and a monthly delivery schedule.',
    ],
    path: [{ status: 'new', daysAgo: 4 }],
    assignee: 'anna',
    value: '42000.00',
    tags: ['Key account'],
    contact: true,
    closesInDays: 40,
  },
  {
    id: fixedId(2),
    title: 'Safety gear for seasonal warehouse staff',
    description: [
      'Came in by phone and nobody has picked it up yet. The value will follow the documents ' +
        'linked to it.',
    ],
    path: [{ status: 'new', daysAgo: 2 }],
    assignee: null,
    value: 'computed',
    tags: [],
    closesInDays: 30,
  },
  {
    id: fixedId(3),
    title: 'Wrench sets for the service fleet',
    path: [
      { status: 'new', daysAgo: 24 },
      { status: 'qualified', daysAgo: 15 },
    ],
    assignee: 'tomasz',
    value: '18500.00',
    tags: ['Upsell'],
    closesInDays: 21,
  },
  {
    id: fixedId(4),
    title: 'Sensor retrofit for the packaging hall',
    path: [
      { status: 'new', daysAgo: 33 },
      { status: 'qualified', daysAgo: 19 },
    ],
    assignee: 'anna',
    value: '96000.00',
    tags: ['Tender'],
    closesInDays: 45,
    comments: [
      {
        kind: 'note',
        author: 'anna',
        daysAgo: 18,
        body: [
          'Technical questionnaire returned. Two other suppliers are in the tender; the ' +
            'criteria are lead time and warranty, in that order.',
        ],
      },
    ],
  },
  {
    id: fixedId(5),
    title: 'Annual cabling framework agreement',
    description: [
      'A twelve-month framework for the whole cable range, with quarterly call-offs.',
    ],
    path: [
      { status: 'new', daysAgo: 52 },
      { status: 'qualified', daysAgo: 43 },
      { status: 'proposal', daysAgo: 26 },
    ],
    assignee: 'anna',
    value: '240000.00',
    tags: ['Key account', 'Tender'],
    contact: true,
    vipChannel: true,
    closesInDays: 14,
    comments: [
      {
        kind: 'note',
        author: 'anna',
        daysAgo: 25,
        body: [
          'Offer sent. The volume pricing is built around ',
          { product: 'cables', otherwise: 'the main cable line' },
          '; the buyer wants the first call-off before the end of the quarter.',
        ],
      },
      {
        kind: 'message',
        author: 'anna',
        daysAgo: 12,
        body: [
          { person: 'tomasz', otherwise: 'Tomasz' },
          ', can you confirm we can hold stock for the first call-off?',
        ],
      },
      {
        kind: 'message',
        author: 'tomasz',
        daysAgo: 11,
        body: ['Confirmed. The Kraków warehouse covers the first two deliveries.'],
      },
    ],
  },
  {
    id: fixedId(6),
    title: 'Helmets and gloves: yearly safety contract',
    path: [
      { status: 'new', daysAgo: 37 },
      { status: 'qualified', daysAgo: 29 },
      { status: 'proposal', daysAgo: 13 },
    ],
    assignee: 'tomasz',
    value: '62000.00',
    tags: [],
    closesInDays: 28,
  },
  {
    id: fixedId(7),
    title: 'Workshop tooling for the Poznań branch',
    path: [
      { status: 'new', daysAgo: 66 },
      { status: 'qualified', daysAgo: 57 },
      { status: 'proposal', daysAgo: 42 },
      { status: 'negotiation', daysAgo: 10 },
    ],
    assignee: 'tomasz',
    value: '131000.00',
    tags: ['Upsell'],
    contact: true,
    closesInDays: 10,
    comments: [
      {
        kind: 'note',
        author: 'tomasz',
        daysAgo: 9,
        body: [
          'They ask for delivery in two batches and 45-day payment terms. Checking the ' +
            'credit limit before we agree.',
        ],
      },
    ],
  },
  {
    id: fixedId(8),
    title: 'Bolt range consolidation',
    path: [
      { status: 'new', daysAgo: 74 },
      { status: 'qualified', daysAgo: 63 },
      { status: 'proposal', daysAgo: 45 },
      { status: 'negotiation', daysAgo: 21 },
    ],
    assignee: 'anna',
    value: '77400.00',
    tags: ['Key account'],
    vipChannel: true,
    closesInDays: 18,
  },
  {
    id: fixedId(9),
    title: 'Screw supply contract',
    path: [
      { status: 'new', daysAgo: 90 },
      { status: 'qualified', daysAgo: 81 },
      { status: 'proposal', daysAgo: 67 },
      { status: 'negotiation', daysAgo: 51 },
      { status: 'won', daysAgo: 35 },
    ],
    assignee: 'anna',
    value: '185000.00',
    tags: ['Key account'],
    contact: true,
    comments: [
      {
        kind: 'note',
        author: 'anna',
        daysAgo: 35,
        body: ['Signed. The first delivery is scheduled; handing over to order processing.'],
      },
    ],
  },
  {
    id: fixedId(10),
    title: 'Drill bit starter kits',
    path: [
      { status: 'new', daysAgo: 48 },
      { status: 'qualified', daysAgo: 41 },
      { status: 'proposal', daysAgo: 30 },
      { status: 'won', daysAgo: 17 },
    ],
    assignee: 'tomasz',
    value: '27900.00',
    tags: ['Upsell'],
  },
  {
    id: fixedId(11),
    title: 'Sensor calibration tender',
    path: [
      { status: 'new', daysAgo: 78 },
      { status: 'qualified', daysAgo: 70 },
      { status: 'proposal', daysAgo: 54 },
      { status: 'lost', daysAgo: 39 },
    ],
    lostReason: 'Lost on price to the incumbent supplier.',
    assignee: 'tomasz',
    value: '150000.00',
    tags: ['Tender'],
  },
  {
    id: fixedId(12),
    title: 'Glove subscription for cleaning crews',
    path: [
      { status: 'new', daysAgo: 44 },
      { status: 'qualified', daysAgo: 36 },
      { status: 'lost', daysAgo: 23 },
    ],
    lostReason: 'The customer postponed the purchase to next year.',
    assignee: 'anna',
    value: '12000.00',
    tags: [],
  },
];

/** The ids the withdrawal deletes by — derived from the rows, never a second list. */
export const DEMO_OPPORTUNITY_IDS: readonly string[] = DEMO_OPPORTUNITIES.map(
  (opportunity) => opportunity.id,
);

export const DEMO_PIPELINE_STEP_NAME = 'sales opportunities for the demo organisation';

/**
 * Every module whose rows the step reads or writes — the guard's whole input.
 *
 * All four neighbours are modules `crm` itself declares as dependencies and the
 * platform refuses to switch off, so in practice the one answer that varies is
 * `crm`'s own. They are named all the same: the guard is asked about every
 * module a step touches (§5.4), and the packages are imported only once it has
 * answered.
 */
export const DEMO_PIPELINE_MODULES: readonly string[] = [
  'crm',
  'organizations',
  'admin_users',
  'customer_accounts',
  'catalog',
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** `?, ?, ?` for a list bound one value at a time — `composition.ts`' helper, and its reason. */
function placeholders(count: number): string {
  return new Array(count).fill('?').join(', ');
}

/** The leaf categories the demo texts name a Product of. */
function productLeavesNamed(): string[] {
  const leaves = new Set<string>();
  for (const opportunity of DEMO_OPPORTUNITIES) {
    const texts = [
      opportunity.description ?? [],
      ...(opportunity.comments ?? []).map((comment) => comment.body),
    ];
    for (const part of texts.flat()) {
      if (typeof part !== 'string' && 'product' in part) leaves.add(part.product);
    }
  }
  return [...leaves];
}

export const demoSalesPipelineStep: CompositionStep = {
  name: DEMO_PIPELINE_STEP_NAME,
  modules: DEMO_PIPELINE_MODULES,
  async apply(em) {
    const [crm, neighbours] = await Promise.all([crmRows(), neighbourRows()]);
    const { Organization, AdminUser, CustomerAccount, Product } = neighbours;

    const organization = await em.findOne(Organization, { taxId: DEMO_ORG_TAX_ID });
    // No demo organisation, no pipeline: an Opportunity without an Organization
    // is not a state the schema has (Principle XI).
    if (organization === null) return;

    const held = new Set(
      (await em.find(crm.CrmOpportunity, { id: { $in: [...DEMO_OPPORTUNITY_IDS] } })).map(
        (opportunity) => opportunity.id,
      ),
    );
    const missing = DEMO_OPPORTUNITIES.filter((opportunity) => !held.has(opportunity.id));
    if (missing.length === 0) return;

    // ── what the pipeline joins, each by its owner's natural key ───────────
    const people = new Map<string, string>();
    for (const [person, email] of Object.entries(DEMO_PEOPLE)) {
      const account = await em.findOne(AdminUser, { email });
      if (account !== null) people.set(person, account.id);
    }
    const buyer = await em.findOne(CustomerAccount, {
      email: DEMO_BUYER_EMAIL,
      organizationId: organization.id,
    });
    const products = new Map<string, string>();
    for (const leaf of productLeavesNamed()) {
      const [first] = await em.find(
        Product,
        { slug: { $like: `${DEMO_PRODUCT_SLUG_PREFIX}${leaf}-%` } },
        { orderBy: { slug: 'asc' }, limit: 1 },
      );
      if (first !== undefined) products.set(leaf, first.id);
    }
    const defaultChannel = await em.findOne(SalesChannel, { systemDefault: true });
    const vipChannel = await em.findOne(SalesChannel, { code: DEMO_VIP_CHANNEL_CODE });
    const tagIds = new Map(
      (await em.find(crm.CrmTag, {})).map((tag) => [tag.name.toLowerCase(), tag.id]),
    );
    const statusKinds = new Map(
      (await em.find(crm.CrmOpportunityStatus, {})).map((status) => [status.code, status.kind]),
    );

    const now = Date.now();
    const ago = (days: number): Date => new Date(now - days * DAY_MS);
    const targets: DemoTextTargets = { products, people };

    for (const row of missing) {
      // The workflow is the operator's to reshape. An Opportunity whose walk
      // names a status that is no longer configured is left out rather than
      // written into a column the board does not have.
      if (!row.path.every((step) => statusKinds.has(step.status))) continue;

      const created = row.path[0]!;
      const current = row.path.at(-1)!;
      const kind = statusKinds.get(current.status)!;
      const closedKind = kind === 'won' || kind === 'lost' ? kind : null;
      const assignee = row.assignee === null ? null : (people.get(row.assignee) ?? null);
      // Somebody created it: its assignee, or the platform administrator for
      // the one nobody has picked up.
      const actor = assignee ?? people.get('admin') ?? null;
      const comments = (row.comments ?? []).filter((comment) => people.has(comment.author));
      const lastActivity = Math.min(current.daysAgo, ...comments.map((comment) => comment.daysAgo));
      const description =
        row.description === undefined ? null : renderDemoText(row.description, targets);

      // One transaction per Opportunity, so each arrives whole or not at all
      // and the probe above never finds half of one. The Opportunity is flushed
      // before what hangs on it: `crm`'s entities hold their parent's id by
      // value, so the unit of work knows no order between them and the foreign
      // keys do.
      await em.transactional(async (tx) => {
        tx.create(crm.CrmOpportunity, {
          id: row.id,
          number: await crm.nextOpportunityNumber(tx),
          title: row.title,
          description: description?.text ?? null,
          organizationId: organization.id,
          customerAccountId: row.contact === true ? (buyer?.id ?? null) : null,
          salesChannelId:
            (row.vipChannel === true ? (vipChannel ?? defaultChannel) : defaultChannel)?.id ?? null,
          statusCode: current.status,
          assignedAdminUserId: assignee,
          valueMode: row.value === 'computed' ? 'computed' : 'manual',
          manualValue: row.value === 'computed' ? null : row.value,
          currency: DEMO_CURRENCY,
          expectedCloseDate:
            closedKind === null && row.closesInDays !== undefined
              ? new Date(now + row.closesInDays * DAY_MS).toISOString().slice(0, 10)
              : null,
          closedAt: closedKind === null ? null : ago(current.daysAgo),
          closedKind,
          createdByAdminUserId: actor,
          createdAt: ago(created.daysAgo),
          updatedAt: ago(lastActivity),
        });
        await tx.flush();

        for (const [index, step] of row.path.entries()) {
          const closing = index === row.path.length - 1 && closedKind === 'lost';
          tx.create(crm.CrmOpportunityStatusHistory, {
            opportunityId: row.id,
            fromStatusCode: index === 0 ? null : row.path[index - 1]!.status,
            toStatusCode: step.status,
            changedAt: ago(step.daysAgo),
            actorAdminUserId: actor,
            cause: index === 0 ? 'created' : 'manual',
            reason: closing ? (row.lostReason ?? null) : null,
          });
        }

        for (const name of row.tags) {
          const tagId = tagIds.get(name.toLowerCase());
          // `crm`'s own demo data creates the tags; one an operator has since
          // deleted is simply not carried.
          if (tagId === undefined) continue;
          tx.create(crm.CrmOpportunityTag, {
            opportunityId: row.id,
            tagId,
            createdAt: ago(created.daysAgo),
          });
        }

        const indexReferences = (
          references: readonly OpportunityReferenceToken[],
          sourceKind: 'description' | 'comment',
          sourceId: string | null,
        ): void => {
          for (const reference of references) {
            tx.create(crm.CrmOpportunityReference, {
              opportunityId: row.id,
              sourceKind,
              sourceId,
              targetType: reference.type,
              targetId: reference.id,
            });
          }
        };
        if (description !== null) indexReferences(description.references, 'description', null);
        for (const comment of comments) {
          const rendered = renderDemoText(comment.body, targets);
          const commentId = crypto.randomUUID();
          tx.create(crm.CrmOpportunityComment, {
            id: commentId,
            opportunityId: row.id,
            kind: comment.kind,
            authorAdminUserId: people.get(comment.author)!,
            body: rendered.text,
            createdAt: ago(comment.daysAgo),
          });
          indexReferences(rendered.references, 'comment', commentId);
        }
      });
    }
  },
  async withdraw(em) {
    // By the ids this step assigned, in SQL rather than through the ORM:
    // `CrmOpportunity` is `@OrgScoped`, and a withdrawal that depended on the
    // ambient tenant would remove a different set on a different scope. The
    // history, the tag joins, the comments and the reference index follow
    // through `crm`'s own `on delete cascade` keys.
    await em
      .getConnection()
      .execute(
        `delete from crm_opportunities where id in (${placeholders(DEMO_OPPORTUNITY_IDS.length)})`,
        [...DEMO_OPPORTUNITY_IDS],
      );
  },
};
