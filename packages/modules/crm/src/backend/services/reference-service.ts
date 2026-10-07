import type {
  AdminUserReadPort,
  CatalogProductReadPort,
  OpportunityReference,
  OpportunityReferenceToken,
  OrderReadPort,
} from '@endora-commerce/contracts';
import { getTenantContext } from '@endora-commerce/platform/tenancy';
import { referenceTokensOf } from '../domain/reference-tokens.js';
import type { CrmReferenceSourceKind } from '../entities/crm-opportunity-reference.entity.js';
import { isActiveAdministrator } from './opportunity-assignment-service.js';
import type { OwnerReadChecks } from './owner-read-permissions.js';

export interface ReferenceServiceDeps {
  /** Ports of other modules — lazy, resolved per call, never captured. */
  products: CatalogProductReadPort;
  orders: OrderReadPort;
  adminUsers: AdminUserReadPort;
  /** Whether the reader may read an Order, or a Product, in the module that owns it. */
  mayRead: Pick<OwnerReadChecks, 'orders' | 'products'>;
}

/** A row of `crm_opportunity_references`, as the saving Command creates it. */
export interface StoredReference {
  opportunityId: string;
  sourceKind: CrmReferenceSourceKind;
  sourceId: string | null;
  targetType: OpportunityReferenceToken['type'];
  targetId: string;
}

/** Which rows belong to one source — what a save deletes before it writes the new ones. */
export function storedReferencesOf(source: ReferenceSource): {
  opportunityId: string;
  sourceKind: CrmReferenceSourceKind;
  sourceId: string | null;
} {
  return { opportunityId: source.opportunityId, sourceKind: source.kind, sourceId: source.sourceId };
}

/** One free text of an Opportunity: its description, or one comment. */
export interface ReferenceSource {
  opportunityId: string;
  kind: CrmReferenceSourceKind;
  /** The comment's id; `null` for the description. */
  sourceId: string | null;
}

const FALLBACK_LANGUAGE = 'en';

/**
 * Where a chip leads in the Admin UI. A person leads nowhere: the screen of an
 * administrator is `admin_users`', behind the right to manage administrators.
 */
function adminUrl(token: OpportunityReferenceToken): string | null {
  if (token.type === 'admin_user') return null;
  return token.type === 'product' ? `/catalog/products/${token.id}` : `/orders/${token.id}`;
}

/**
 * A Product's name in the reader's language: the exact locale, then any locale
 * of the same language (`pl` reads `pl-PL`), then whatever name there is, then
 * the SKU — a Product always has something to be called by.
 */
function productLabel(name: Record<string, string>, sku: string, language: string): string {
  const base = language.split('-')[0] ?? language;
  const sameLanguage = Object.keys(name).find((locale) => locale === base || locale.startsWith(`${base}-`));
  return name[language] || (sameLanguage ? name[sameLanguage] : undefined) || Object.values(name).find(Boolean) || sku;
}

/**
 * References to Products, Orders and people in an Opportunity's free text
 * (`specs/143-crm-sales-opportunities/research.md` R-21, N-M1).
 *
 * **The text is the truth and is never changed**: it is stored and returned as
 * plain text carrying `[[product:<uuid>]]` / `[[order:<uuid>]]` /
 * `[[admin_user:<uuid>]]` tokens, and nothing in it is interpreted as markup.
 *
 * **On write** the tokens of one source are stored as rows of
 * `crm_opportunity_references`, replacing that source's rows wholesale — an
 * index of who mentions what, derived from the text and rebuilt with it. This
 * service says which rows; the Command that saves the text writes them.
 *
 * **On read** the tokens are taken from the text itself and resolved in one
 * batched port call per kind mentioned, so a label is the target's *current*
 * name. The ports
 * read under the reader's tenant scope: an Order of an Organization the reader
 * does not reach is not returned, and so — like a target that is gone — comes
 * back `available: false` with no label and no URL. So does a target whose
 * owner's read permission the reader does not hold — `orders:read` for an
 * Order, `catalog:read` for a Product (research N-R13): `crm:read` lets
 * somebody read the text, not what another module would refuse to show them.
 * Nothing here remembers a name, which is what makes that leak-proof.
 *
 * A person is named to anybody who reads the text — an administrator's name is
 * what every CRM screen already shows of an author or an assignee — unless
 * they were removed or deactivated since, when the mention is unavailable like
 * any other target that is gone.
 */
export class ReferenceService {
  constructor(private readonly deps: ReferenceServiceDeps) {}

  /**
   * The rows one source's text asks for now — nothing for `null` text (a
   * cleared description, a deleted note). **This only says what they are.**
   * The write is the saving Command's own, in the service that holds it —
   * delete {@link storedReferencesOf} the source, create these — so a child
   * row is written where its parent was loaded through the scoped
   * EntityManager.
   */
  rowsFor(source: ReferenceSource, text: string | null | undefined): StoredReference[] {
    return referenceTokensOf(text).map((token) => ({
      opportunityId: source.opportunityId,
      sourceKind: source.kind,
      sourceId: source.sourceId,
      targetType: token.type,
      targetId: token.id,
    }));
  }

  /** The references of one text, for the reader. */
  async resolve(text: string | null | undefined): Promise<OpportunityReference[]> {
    const [resolved] = await this.resolveMany([text]);
    return resolved ?? [];
  }

  /**
   * The references of several texts — a page of comments — in **one** port
   * call per kind for all of them, each list in its text's own order.
   */
  async resolveMany(texts: ReadonlyArray<string | null | undefined>): Promise<OpportunityReference[][]> {
    const tokens = texts.map((text) => referenceTokensOf(text));
    const idsOf = (type: OpportunityReferenceToken['type']) => [
      ...new Set(tokens.flatMap((list) => list.filter((token) => token.type === type).map((token) => token.id))),
    ];
    const productIds = idsOf('product');
    const orderIds = idsOf('order');
    const personIds = idsOf('admin_user');
    if (productIds.length === 0 && orderIds.length === 0 && personIds.length === 0) return texts.map(() => []);

    // Asked only for a kind the texts mention; the owner's port is not asked
    // at all for a reader who could not have opened the target.
    const [mayReadProducts, mayReadOrders] = await Promise.all([
      productIds.length > 0 ? this.deps.mayRead.products() : Promise.resolve(false),
      orderIds.length > 0 ? this.deps.mayRead.orders() : Promise.resolve(false),
    ]);
    const [products, orders, people, language] = await Promise.all([
      // Live products only: one that was deleted is gone for the reader.
      mayReadProducts ? this.deps.products.findByIds(productIds, { liveOnly: true }) : Promise.resolve([]),
      mayReadOrders ? this.deps.orders.findByIds(orderIds) : Promise.resolve([]),
      personIds.length > 0 ? this.deps.adminUsers.findByIds(personIds) : Promise.resolve([]),
      mayReadProducts ? this.#viewerLanguage() : Promise.resolve(FALLBACK_LANGUAGE),
    ]);
    const labels = new Map<string, string>();
    for (const product of products) {
      labels.set(`product:${product.id}`, productLabel(product.name, product.sku, language));
    }
    for (const order of orders) labels.set(`order:${order.id}`, order.businessId);
    for (const person of people.filter(isActiveAdministrator)) {
      labels.set(
        `admin_user:${person.id}`,
        `${person.firstName} ${person.lastName}`.trim() || person.email,
      );
    }

    return tokens.map((list) =>
      list.map((token) => {
        const label = labels.get(`${token.type}:${token.id}`);
        return label === undefined
          ? { type: token.type, id: token.id, available: false, label: null, url: null }
          : { type: token.type, id: token.id, available: true, label, url: adminUrl(token) };
      }),
    );
  }

  /** The acting administrator's stored language — what the Admin UI renders in — or English. */
  async #viewerLanguage(): Promise<string> {
    const actor = getTenantContext()?.actor;
    if (actor?.kind !== 'admin' || !actor.id) return FALLBACK_LANGUAGE;
    const admin = await this.deps.adminUsers.findById(actor.id);
    return admin?.preferredLanguage ?? FALLBACK_LANGUAGE;
  }
}
