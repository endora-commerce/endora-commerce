import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, isProductVisibleTo } from '@endora-commerce/contracts';
import type { CartWritePort, CatalogProductReadPort, RfqCustomerPort } from '@endora-commerce/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import type { SalesChannelMembershipPort } from '../../../kernel/ports/sales-channel.js';
import {
  outOfRequestChannel,
  productIdsInRequestChannel,
} from '../../../kernel/sales-channels/request-channel-assortment.js';
import { ShoppingList } from '../entities/shopping-list.entity.js';
import { ShoppingListItem } from '../entities/shopping-list-item.entity.js';

/**
 * ShoppingListService (T201). CRUD + the two terminal converters.
 *
 * Conversions skip archived products and report them in a structured
 * `skipped` array so the UI can surface a friendly message without
 * blocking the rest of the conversion. The converters reuse the published
 * `cartWritePort` / `rfqCustomerPort` surfaces — keeping the actual cart
 * + RFQ semantics (line aggregation, draft version bumps, etc.) in one
 * place.
 *
 * Products arrive over `catalogProductReadPort` (feature 075, Phase C) rather
 * than out of `catalog`'s table. Both reads keep the *wider* lookup — no
 * `activeOnly`, no `liveOnly` — because the archived/not-found distinction is
 * this module's to make: `#partitionByProductStatus` has to tell
 * `product_archived` from `product_not_found`, and a filtered read collapses
 * the two into one.
 */

export interface CustomerContext {
  customerAccountId: string;
  organizationId: string;
}

export interface ConversionSkip {
  itemId: string;
  productId: string;
  reason: 'product_archived' | 'variant_unavailable' | 'product_not_found';
}

export interface ConvertToCartResult {
  shoppingListId: string;
  added: number;
  skipped: ConversionSkip[];
}

export interface ConvertToRfqResult {
  shoppingListId: string;
  rfqId: string | null;
  added: number;
  skipped: ConversionSkip[];
}

export class ShoppingListService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly cartService: CartWritePort,
    private readonly rfqService: RfqCustomerPort,
    /**
     * The product rows `addItem` and the two converters decide on. Gated: with
     * `catalog` switched off a save-to-list and a conversion both refuse rather
     * than reporting every line as `product_not_found`, which reads as a
     * legitimate answer and is not one.
     */
    private readonly catalogProducts: CatalogProductReadPort,
    /**
     * The sanctioned bridge accessor (Constitution XII), for the assortment
     * gate `addItem` owes (issue #259).
     */
    private readonly channelMembership: SalesChannelMembershipPort,
  ) {}

  async list(ctx: CustomerContext): Promise<ShoppingList[]> {
    const em = this.emFactory();
    return em.find(
      ShoppingList,
      { organizationId: ctx.organizationId, customerAccountId: ctx.customerAccountId },
      { orderBy: { updatedAt: 'desc' } },
    );
  }

  async getByIdWithItems(
    ctx: CustomerContext,
    listId: string,
  ): Promise<{ list: ShoppingList; items: ShoppingListItem[] }> {
    const em = this.emFactory();
    const list = await this.#owned(em, ctx, listId);
    const items = await em.find(
      ShoppingListItem,
      { shoppingListId: list.id },
      { orderBy: { createdAt: 'asc' } },
    );
    return { list, items };
  }

  async create(ctx: CustomerContext, input: { name: string }): Promise<ShoppingList> {
    // command-coverage-ignore: customer-owned personal saved list — self-service
    // convenience data; conversions delegate to the audited cart/RFQ paths.
    const em = this.emFactory();
    // The customer's first list automatically becomes their default.
    const existingCount = await em.count(ShoppingList, {
      organizationId: ctx.organizationId,
      customerAccountId: ctx.customerAccountId,
    });
    const list = em.create(ShoppingList, {
      organizationId: ctx.organizationId,
      customerAccountId: ctx.customerAccountId,
      name: input.name,
      isDefault: existingCount === 0,
    });
    await em.persistAndFlush(list);
    return list;
  }

  /**
   * Resolves the customer's default shopping list, creating/repairing it as
   * needed so every customer always has exactly one default:
   *   - returns the flagged default when present;
   *   - else promotes the earliest existing list to default;
   *   - else creates a "Default" list.
   * Idempotent — safe to call on every storefront default-list read.
   */
  async ensureDefault(ctx: CustomerContext): Promise<ShoppingList> {
    // command-coverage-ignore: customer-owned personal saved list — self-service
    // convenience data; conversions delegate to the audited cart/RFQ paths.
    const em = this.emFactory();
    const where = {
      organizationId: ctx.organizationId,
      customerAccountId: ctx.customerAccountId,
    };
    const flagged = await em.findOne(ShoppingList, { ...where, isDefault: true });
    if (flagged) return flagged;

    const earliest = await em.findOne(ShoppingList, where, { orderBy: { createdAt: 'asc' } });
    if (earliest) {
      earliest.isDefault = true;
      await em.flush();
      return earliest;
    }

    const created = em.create(ShoppingList, { ...where, name: 'Default', isDefault: true });
    await em.persistAndFlush(created);
    return created;
  }

  /** Marks `listId` as the customer's default, clearing the flag on the rest. */
  async setDefault(ctx: CustomerContext, listId: string): Promise<ShoppingList> {
    // command-coverage-ignore: customer-owned personal saved list — self-service
    // convenience data; conversions delegate to the audited cart/RFQ paths.
    const em = this.emFactory();
    const list = await this.#owned(em, ctx, listId);
    const others = await em.find(ShoppingList, {
      organizationId: ctx.organizationId,
      customerAccountId: ctx.customerAccountId,
      isDefault: true,
      id: { $ne: listId },
    });
    for (const o of others) o.isDefault = false;
    list.isDefault = true;
    await em.flush();
    return list;
  }

  /** Adds an item to the customer's default list, creating it if necessary. */
  async addItemToDefault(
    ctx: CustomerContext,
    input: { productId: string; variantId?: string; quantity: number; note?: string },
  ): Promise<{ list: ShoppingList; itemCount: number }> {
    const list = await this.ensureDefault(ctx);
    await this.addItem(ctx, list.id, input);
    const em = this.emFactory();
    const itemCount = await em.count(ShoppingListItem, { shoppingListId: list.id });
    return { list, itemCount };
  }

  async rename(ctx: CustomerContext, listId: string, name: string): Promise<ShoppingList> {
    // command-coverage-ignore: customer-owned personal saved list — self-service
    // convenience data; conversions delegate to the audited cart/RFQ paths.
    const em = this.emFactory();
    const list = await this.#owned(em, ctx, listId);
    list.name = name;
    await em.flush();
    return list;
  }

  async remove(ctx: CustomerContext, listId: string): Promise<void> {
    // command-coverage-ignore: customer-owned personal saved list — self-service
    // convenience data; conversions delegate to the audited cart/RFQ paths.
    const em = this.emFactory();
    const list = await this.#owned(em, ctx, listId);
    // The default list can be cleared but never deleted — it is the customer's
    // permanent "wishlist" anchor.
    if (list.isDefault) {
      throw new HttpError(
        409,
        ERROR_CODES.SHOPPING_LIST_CANNOT_DELETE_DEFAULT,
        'The default shopping list cannot be deleted. Clear it or set another list as default first.',
      );
    }
    // Every customer must always keep at least one shopping list. (With the
    // default guard above this only triggers for malformed data where no list
    // is flagged default, but we enforce it defensively.)
    const total = await em.count(ShoppingList, {
      organizationId: ctx.organizationId,
      customerAccountId: ctx.customerAccountId,
    });
    if (total <= 1) {
      throw new HttpError(
        409,
        ERROR_CODES.SHOPPING_LIST_CANNOT_DELETE_LAST,
        'At least one shopping list must remain.',
      );
    }
    await em.removeAndFlush(list);
  }

  async addItem(
    ctx: CustomerContext,
    listId: string,
    input: { productId: string; variantId?: string; quantity: number; note?: string },
  ): Promise<ShoppingListItem> {
    // command-coverage-ignore: customer-owned personal saved list — self-service
    // convenience data; conversions delegate to the audited cart/RFQ paths.
    const em = this.emFactory();
    const list = await this.#owned(em, ctx, listId);
    const product = await this.catalogProducts.findById(input.productId);
    // Issue #227 — the saved list renders each line's name and price on every
    // later read, so a product this buyer may not see may not be saved to it.
    // The audience comes off the same `CustomerContext` the list is owned by;
    // `organizationId` is what the allow-list is matched against.
    if (
      !product ||
      !isProductVisibleTo(product, {
        organizationId: ctx.organizationId,
        authenticated: true,
      })
    ) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }
    // Issue #259 — the channel axis, read off the request scope rather than
    // re-resolved. A saved list is read back on later visits and priced then,
    // so what may be saved is what the channel the buyer is shopping on
    // publishes; the refusal is the same 404 the visibility half above throws,
    // so the two cannot be told apart.
    if (await outOfRequestChannel(this.channelMembership, product.id)) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }
    const item = em.create(ShoppingListItem, {
      shoppingListId: list.id,
      productId: product.id,
      ...(input.variantId ? { variantId: input.variantId } : {}),
      quantity: input.quantity,
      ...(input.note ? { note: input.note } : {}),
    });
    list.updatedAt = new Date();
    await em.persistAndFlush(item);
    return item;
  }

  async updateItem(
    ctx: CustomerContext,
    listId: string,
    itemId: string,
    patch: { quantity?: number; note?: string | null },
  ): Promise<ShoppingListItem> {
    // command-coverage-ignore: customer-owned personal saved list — self-service
    // convenience data; conversions delegate to the audited cart/RFQ paths.
    const em = this.emFactory();
    const list = await this.#owned(em, ctx, listId);
    const item = await em.findOne(ShoppingListItem, { id: itemId, shoppingListId: list.id });
    if (!item) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Shopping list item not found.');
    if (patch.quantity !== undefined) item.quantity = patch.quantity;
    if (patch.note !== undefined) item.note = patch.note;
    list.updatedAt = new Date();
    await em.flush();
    return item;
  }

  async removeItem(ctx: CustomerContext, listId: string, itemId: string): Promise<void> {
    // command-coverage-ignore: customer-owned personal saved list — self-service
    // convenience data; conversions delegate to the audited cart/RFQ paths.
    const em = this.emFactory();
    const list = await this.#owned(em, ctx, listId);
    const item = await em.findOne(ShoppingListItem, { id: itemId, shoppingListId: list.id });
    if (!item) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Shopping list item not found.');
    list.updatedAt = new Date();
    await em.removeAndFlush(item);
  }

  /**
   * Removes every item from the list, keeping the list itself. Idempotent: an
   * already-empty list is a no-op. Returns the number of rows removed so the
   * caller can report it.
   */
  async clearItems(ctx: CustomerContext, listId: string): Promise<number> {
    // command-coverage-ignore: customer-owned personal saved list — self-service
    // convenience data; conversions delegate to the audited cart/RFQ paths.
    const em = this.emFactory();
    const list = await this.#owned(em, ctx, listId);
    const removed = await em.nativeDelete(ShoppingListItem, { shoppingListId: list.id });
    if (removed > 0) {
      list.updatedAt = new Date();
      await em.flush();
    }
    return removed;
  }

  /**
   * Adds the given items (or every item on the list when itemIds is omitted)
   * to the customer's authenticated cart. Archived products are skipped and
   * reported in `skipped`.
   */
  async convertToCart(
    ctx: CustomerContext,
    listId: string,
    itemIds: string[] | undefined,
  ): Promise<ConvertToCartResult> {
    const em = this.emFactory();
    const list = await this.#owned(em, ctx, listId);
    const items = await this.#selectItems(em, list.id, itemIds);
    const { skipped, kept } = await this.#partitionByProductStatus(items);

    let added = 0;
    for (const item of kept) {
      await this.cartService.addItem(
        { customer: ctx },
        {
          productId: item.productId,
          ...(item.variantId ? { variantId: item.variantId } : {}),
          quantity: item.quantity,
        },
      );
      added += 1;
    }

    return { shoppingListId: list.id, added, skipped };
  }

  /**
   * Adds the given items (or every item on the list when itemIds is omitted)
   * to the customer's draft RFQ. Returns the RFQ id so the storefront can
   * deep-link the buyer to it.
   */
  async convertToRfq(
    ctx: CustomerContext,
    listId: string,
    itemIds: string[] | undefined,
  ): Promise<ConvertToRfqResult> {
    const em = this.emFactory();
    const list = await this.#owned(em, ctx, listId);
    const items = await this.#selectItems(em, list.id, itemIds);
    const { skipped, kept } = await this.#partitionByProductStatus(items);

    let rfqId: string | null = null;
    let added = 0;
    if (kept.length > 0) {
      const rfq = await this.rfqService.createForCustomer(
        { ...ctx, isOrgAdmin: false },
        {
          items: kept.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            ...(item.variantId ? { variantId: item.variantId } : {}),
            ...(item.note ? { lineNote: item.note } : {}),
          })),
        },
      );
      rfqId = rfq.id;
      added = kept.length;
    }

    return { shoppingListId: list.id, rfqId, added, skipped };
  }

  // ------------------------------------------------------------------

  async #owned(em: EntityManager, ctx: CustomerContext, listId: string): Promise<ShoppingList> {
    const list = await em.findOne(ShoppingList, {
      id: listId,
      organizationId: ctx.organizationId,
      customerAccountId: ctx.customerAccountId,
    });
    if (!list) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Shopping list not found.');
    return list;
  }

  async #selectItems(
    em: EntityManager,
    listId: string,
    itemIds: string[] | undefined,
  ): Promise<ShoppingListItem[]> {
    if (itemIds && itemIds.length > 0) {
      return em.find(ShoppingListItem, { shoppingListId: listId, id: { $in: itemIds } });
    }
    return em.find(ShoppingListItem, { shoppingListId: listId });
  }

  /**
   * Split the selected lines into the ones a conversion may carry and the ones
   * it reports as skipped.
   *
   * The channel narrowing (issue #259) belongs **here** rather than at the two
   * conversion targets, and that is the whole reason it is here: both targets
   * already refuse an unacquirable line — `cartService.addItem` with a 404 per
   * call, `rfqService.createForCustomer` with a whole-request 404 — so leaving
   * the question to them would turn a conversion of twenty saved lines into one
   * refusal because of the twenty-first. This seam has a vocabulary for exactly
   * that case and has had it since T201: the line is skipped, reported, and the
   * rest of the conversion goes through.
   *
   * It is asked **before** the status test, so an out-of-channel line reads as
   * `product_not_found` rather than as `product_archived` — the same "it is not
   * here" every other surface gives it, and not a second answer a reader could
   * tell the two apart by.
   */
  async #partitionByProductStatus(
    items: ShoppingListItem[],
  ): Promise<{ kept: ShoppingListItem[]; skipped: ConversionSkip[] }> {
    if (items.length === 0) return { kept: [], skipped: [] };
    const productIds = Array.from(new Set(items.map((i) => i.productId)));
    const products = await this.catalogProducts.findByIds(productIds);
    const byId = new Map(products.map((p) => [p.id, p]));
    const publishedHere = await productIdsInRequestChannel(this.channelMembership, productIds);
    const skipped: ConversionSkip[] = [];
    const kept: ShoppingListItem[] = [];
    for (const item of items) {
      const product = byId.get(item.productId);
      if (!product || (publishedHere !== null && !publishedHere.has(item.productId))) {
        skipped.push({ itemId: item.id, productId: item.productId, reason: 'product_not_found' });
        continue;
      }
      if (product.status === 'inactive' || product.deletedAt) {
        skipped.push({ itemId: item.id, productId: item.productId, reason: 'product_archived' });
        continue;
      }
      kept.push(item);
    }
    return { kept, skipped };
  }
}
