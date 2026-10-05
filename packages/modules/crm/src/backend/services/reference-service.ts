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

export interface ReferenceServiceDeps {
  /** Ports of other modules — lazy, resolved per call, never captured. */
  products: CatalogProductReadPort;
  orders: OrderReadPort;
  adminUsers: AdminUserReadPort;
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

/** Where a chip leads in the Admin UI. */
function adminUrl(token: OpportunityReferenceToken): string {
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
 * References to Products and Orders in an Opportunity's free text
 * (`specs/143-crm-sales-opportunities/research.md` R-21).
 *
 * **The text is the truth and is never changed**: it is stored and returned as
 * plain text carrying `[[product:<uuid>]]` / `[[order:<uuid>]]` tokens, and
 * nothing in it is interpreted as markup.
 *
 * **On write** the tokens of one source are stored as rows of
 * `crm_opportunity_references`, replacing that source's rows wholesale — an
 * index of who mentions what, derived from the text and rebuilt with it. This
 * service says which rows; the Command that saves the text writes them.
 *
 * **On read** the tokens are taken from the text itself and resolved in two
 * batched port calls, so a label is the target's *current* name. The ports
 * read under the reader's tenant scope: an Order of an Organization the reader
 * does not reach is not returned, and so — like a target that is gone — comes
 * back `available: false` with no label and no URL. Nothing here remembers a
 * name, which is what makes that leak-proof.
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
   * The references of several texts — a page of comments — in **two** port
   * calls for all of them, each list in its text's own order.
   */
  async resolveMany(texts: ReadonlyArray<string | null | undefined>): Promise<OpportunityReference[][]> {
    const tokens = texts.map((text) => referenceTokensOf(text));
    const idsOf = (type: OpportunityReferenceToken['type']) => [
      ...new Set(tokens.flatMap((list) => list.filter((token) => token.type === type).map((token) => token.id))),
    ];
    const productIds = idsOf('product');
    const orderIds = idsOf('order');
    if (productIds.length === 0 && orderIds.length === 0) return texts.map(() => []);

    const [products, orders, language] = await Promise.all([
      // Live products only: one that was deleted is gone for the reader.
      productIds.length > 0 ? this.deps.products.findByIds(productIds, { liveOnly: true }) : Promise.resolve([]),
      orderIds.length > 0 ? this.deps.orders.findByIds(orderIds) : Promise.resolve([]),
      productIds.length > 0 ? this.#viewerLanguage() : Promise.resolve(FALLBACK_LANGUAGE),
    ]);
    const labels = new Map<string, string>();
    for (const product of products) {
      labels.set(`product:${product.id}`, productLabel(product.name, product.sku, language));
    }
    for (const order of orders) labels.set(`order:${order.id}`, order.businessId);

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
