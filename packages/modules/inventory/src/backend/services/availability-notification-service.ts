import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type CatalogProductReadPort,
  type CustomerAccountReadPort,
  type EmailMailerPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { AvailabilityNotification } from '../entities/availability-notification.entity.js';
import { StockLevel } from '../entities/stock-level.entity.js';
import type { InventoryTemplateEmailPort } from './low-stock-alert-service.js';

export interface SubscribeInput {
  productId: string;
  variantId?: string | null;
  email: string;
  customerAccountId?: string | null;
}

export interface AdminListFilter {
  productId?: string;
  status?: 'queued' | 'notified' | 'cancelled';
  page?: number;
  pageSize?: number;
}

export interface AdminListRow {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  customerAccountId: string | null;
  email: string;
  status: 'queued' | 'notified' | 'cancelled';
  queuedAt: string;
  notifiedAt: string | null;
}

/**
 * The owner identity an `availability_notifications` row can be written from —
 * feature 087 Group B, D-187.
 *
 * The customer arm carries the organisation because
 * `availability_notifications_organization_attribution_chk` requires it, and it
 * is a type of its own rather than a second optional field on
 * {@link SubscribeInput} because the caller's identity genuinely does not
 * include it: both storefront routes read the account off the session, and the
 * organisation is a fact about that account which this service resolves through
 * `customer_accounts`' read port.
 *
 * Keeping the two apart is what makes "an owned subscription with no
 * organisation" an unrepresentable argument to {@link ownerColumns} rather than
 * a line somebody has to remember. `SubscribeInput.customerAccountId` is
 * optional and nullable and comes from a `catch` in the storefront route, so
 * the shape a forgotten stamp needs is exactly the shape the caller hands in;
 * this type is where it stops.
 */
type ResolvedNotificationOwner =
  | { kind: 'customer'; customerAccountId: string; organizationId: string }
  | { kind: 'anonymous' };

/**
 * The two attribution columns, written together from one resolved owner.
 *
 * This module has a single write — there is no association path that adopts an
 * anonymous subscription into an account later, which is what makes one
 * function enough here where `pwa` needs both directions of an upsert to go
 * through it.
 */
function ownerColumns(owner: ResolvedNotificationOwner): {
  customerAccountId: string | null;
  organizationId: string | null;
} {
  return owner.kind === 'customer'
    ? { customerAccountId: owner.customerAccountId, organizationId: owner.organizationId }
    : {
        customerAccountId: null,
        // FR-011 — an anonymous subscription belongs to no organisation, and
        // the constraint says nothing about it. `an_recipient_check` is what
        // keeps such a row addressable: its `email` is the recipient. Who it
        // *should* belong to is R-6's open question and is not answered here.
        organizationId: null,
      };
}

/**
 * AvailabilityNotificationService — feature 010 / US6 surface.
 *
 * The original foundation 001 service had a single `subscribe(customerId,
 * productId, variantId?)` entry point. Feature 010 extends it for the
 * three customer paths spelled out in spec.md US6:
 *
 *   - storefront customer signed-in → email pre-filled from the account
 *   - storefront anonymous → caller supplies the email
 *   - admin browses + cancels any queued row
 *
 * The restock fan-out lives on `AvailabilityWorker.dispatchForStockIncrease`
 * (already exists from foundation 001); the worker is rewired in US6 to
 * subscribe to `inventory.adjusted.v1` events with `before === 0 &&
 * after > 0` so a stock-bump fans out one email per queued row.
 */
export class AvailabilityNotificationService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /** `catalogProductReadPort`, owned by `catalog` (feature 075, Phase C). */
    private readonly catalogProducts: CatalogProductReadPort,
    /**
     * `customerAccountReadPort`, owned by `customer_accounts` (feature 075).
     *
     * Feature 087 / D-187 gives it a second reader: the organisation an owned
     * subscription carries. It was already **required** here before that
     * ruling and stays so — this module has exactly one construction site
     * (`plugin.ts`) and it holds the gated port, so a composition that cannot
     * answer "which organisation owns this account" cannot build the service
     * at all. Nothing had to be argued for; it is recorded because `pwa` had
     * to widen its constructor for the same read and the two modules now sit
     * in the same state.
     *
     * Resolved through `lazyPort`, so a switched-off `customer_accounts`
     * refuses at the call with the 503 `MODULE_DISABLED` envelope rather than
     * at composition time.
     */
    private readonly customerAccounts: CustomerAccountReadPort,
    private readonly mailer?: EmailMailerPort,
    private readonly templateEmail?: InventoryTemplateEmailPort,
  ) {}

  /**
   * The organisation that owns a subscription belonging to this account —
   * feature 087 Group B, D-187.
   *
   * Total, and refuses rather than returning `null`:
   * `customer_accounts.organization_id` is `NOT NULL` (D-178), so an account
   * that resolves always has one, and an account that does not resolve is a
   * caller naming a row that is not there. Either way there is no organisation
   * to stamp, and a subscription written without one is a buyer hidden from
   * the representative who serves them — which is the whole defect this column
   * exists to close. So the write stops here, where the message can name the
   * account, instead of at the constraint.
   */
  async #organizationOf(customerAccountId: string): Promise<string> {
    const account = await this.customerAccounts.findById(customerAccountId);
    if (!account) {
      throw new Error(
        `AvailabilityNotificationService: customer account ${customerAccountId} does not resolve, ` +
          'so the availability notification it would own has no organisation to carry.',
      );
    }
    return account.organizationId;
  }

  /** The caller's owner input, with the organisation a customer owner implies. */
  async #resolveOwner(
    customerAccountId: string | null | undefined,
  ): Promise<ResolvedNotificationOwner> {
    if (customerAccountId === null || customerAccountId === undefined) return { kind: 'anonymous' };
    return {
      kind: 'customer',
      customerAccountId,
      organizationId: await this.#organizationOf(customerAccountId),
    };
  }

  /**
   * Subscribe a customer / anonymous email to a product's restock signal.
   *
   * Refuses with 409 PRODUCT_IN_STOCK when cumulative on-hand > 0; with
   * 409 PRODUCT_UNMANAGED_STOCK when the product opted out of stock
   * tracking; with 409 ALREADY_SUBSCRIBED for an idempotent re-subscribe.
   */
  async subscribe(input: SubscribeInput): Promise<AvailabilityNotification> {
    // command-coverage-ignore: customer back-in-stock notification opt-in — a
    // self-service subscription record, not an audited domain-state mutation.
    const em = this.emFactory();
    const product = await this.catalogProducts.findById(input.productId, { liveOnly: true });
    if (!product) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }
    if (!product.manageStock) {
      throw new HttpError(
        409,
        'PRODUCT_UNMANAGED_STOCK',
        'Product does not track stock; subscribe is unnecessary.',
      );
    }

    // Cumulative on-hand across every warehouse — the subscribe is gated
    // platform-wide, not per channel.
    // `em.execute`, not `em.getKnex()`: a knex handle carries no transaction
    // context, so this in-stock gate would answer from outside a transaction the
    // caller holds open while the `em.findOne` below answers from inside it
    // (issue #207).
    const sumRows = (await em.execute(
      `select sum(on_hand) as on_hand from stock_levels where product_id = ?`,
      [input.productId],
    )) as Array<{ on_hand: string | null }>;
    const cumulative = Number(sumRows[0]?.on_hand ?? 0);
    if (cumulative > 0) {
      throw new HttpError(
        422,
        ERROR_CODES.PRODUCT_IN_STOCK,
        'Product is currently in stock — no notification needed.',
      );
    }

    const existing = await em.findOne(AvailabilityNotification, {
      productId: input.productId,
      variantId: input.variantId ?? null,
      email: input.email,
      notifiedAt: null,
      status: 'queued',
    });
    if (existing) return existing;

    // D-187 — resolved **before** the first managed entity is touched. `em.create`
    // registers the row with the unit of work, so a refusal raised after it
    // would leave an owned, unattributed subscription there for whatever
    // flushes this request next.
    const owner = await this.#resolveOwner(input.customerAccountId);

    const subscription = em.create(AvailabilityNotification, {
      productId: input.productId,
      ...(input.variantId !== undefined && input.variantId !== null
        ? { variantId: input.variantId }
        : {}),
      // D-187 — the only place a subscription is inserted, and the organisation
      // goes in with the account. `ownerColumns` takes a *resolved* owner, so
      // the customer branch has no shape in which the organisation could be
      // omitted; the anonymous branch has none to carry (FR-011).
      ...ownerColumns(owner),
      email: input.email,
      status: 'queued',
    });
    await em.persistAndFlush(subscription);
    return subscription;
  }

  async cancel(id: string): Promise<void> {
    // command-coverage-ignore: customer notification opt-out — flips a
    // self-service subscription to cancelled, not an audited domain mutation.
    const em = this.emFactory();
    const row = await em.findOne(AvailabilityNotification, { id });
    if (!row) {
      throw new HttpError(
        404,
        'AVAILABILITY_NOTIFICATION_NOT_FOUND',
        'Subscription not found.',
      );
    }
    row.status = 'cancelled';
    await em.flush();
  }

  async listForAdmin(filter: AdminListFilter = {}): Promise<{
    items: AdminListRow[];
    page: number;
    pageSize: number;
    total: number;
  }> {
    const em = this.emFactory();
    const page = Math.max(0, filter.page ?? 0);
    const pageSize = Math.min(Math.max(1, filter.pageSize ?? 50), 200);
    const where: Record<string, unknown> = {};
    if (filter.productId) where['productId'] = filter.productId;
    if (filter.status) where['status'] = filter.status;

    const [rows, total] = await em.findAndCount(AvailabilityNotification, where, {
      orderBy: { requestedAt: 'desc' },
      offset: page * pageSize,
      limit: pageSize,
    });
    if (rows.length === 0) return { items: [], page, pageSize, total };

    const productIds = Array.from(new Set(rows.map((r) => r.productId)));
    const products = await this.catalogProducts.findByIds(productIds);
    const productById = new Map(products.map((p) => [p.id, p]));

    const customerIds = Array.from(
      new Set(rows.map((r) => r.customerAccountId).filter((id): id is string => typeof id === 'string')),
    );
    const customers = customerIds.length
      ? await this.customerAccounts.findByIds(customerIds)
      : [];
    const customerById = new Map(customers.map((c) => [c.id, c]));

    return {
      items: rows.map((r) => {
        const p = productById.get(r.productId);
        const productName = p
          ? p.name['en-US'] ?? Object.values(p.name)[0] ?? p.sku
          : '—';
        const email =
          r.email ??
          (r.customerAccountId ? customerById.get(r.customerAccountId)?.email ?? '' : '');
        return {
          id: r.id,
          productId: r.productId,
          productName: String(productName),
          productSku: p?.sku ?? '',
          customerAccountId: r.customerAccountId ?? null,
          email,
          status: r.status,
          queuedAt: r.requestedAt.toISOString(),
          notifiedAt: r.notifiedAt ? r.notifiedAt.toISOString() : null,
        };
      }),
      page,
      pageSize,
      total,
    };
  }

  /**
   * Restock fan-out — invoked by AvailabilityWorker when cumulative on-hand
   * crosses from 0 to > 0 for a (product, variant) pair. Emits one mail
   * per queued row and flips status → 'notified'.
   */
  async processRestockedFanOut(input: {
    productId: string;
    variantId?: string | null;
  }): Promise<{ notified: number }> {
    // command-coverage-ignore: background notification delivery — flips queued
    // subscriptions to 'notified' after send, delivery bookkeeping (not domain).
    if (!this.mailer && !this.templateEmail) return { notified: 0 };
    const em = this.emFactory();
    const where: Record<string, unknown> = {
      productId: input.productId,
      status: 'queued',
      notifiedAt: null,
    };
    if (input.variantId === undefined || input.variantId === null) {
      where['variantId'] = null;
    } else {
      where['variantId'] = input.variantId;
    }
    const rows = await em.find(AvailabilityNotification, where);
    if (rows.length === 0) return { notified: 0 };

    const product = await this.catalogProducts.findById(input.productId);
    const productName = product
      ? product.name['en-US'] ?? Object.values(product.name)[0] ?? product.sku
      : 'product';
    const customerIds = Array.from(
      new Set(rows.map((r) => r.customerAccountId).filter((id): id is string => typeof id === 'string')),
    );
    const customers = customerIds.length
      ? await this.customerAccounts.findByIds(customerIds)
      : [];
    const emailById = new Map(customers.map((c) => [c.id, c.email]));

    const now = new Date();
    let notified = 0;
    for (const row of rows) {
      const to = row.email ?? (row.customerAccountId ? emailById.get(row.customerAccountId) : null);
      if (!to) {
        row.status = 'cancelled';
        row.notifiedAt = now;
        continue;
      }
      const messageId = `availability:${row.id}`;
      const meta = {
        productId: input.productId,
        variantId: input.variantId ?? null,
        notificationId: row.id,
      };
      let sentViaTemplate = false;
      if (this.templateEmail) {
        sentViaTemplate = await this.templateEmail.trySend({
          code: 'availability_back_in_stock',
          to,
          messageId,
          variables: { product: { name: productName } },
          meta,
        });
      }
      if (!sentViaTemplate && this.mailer) {
        const outcome = await this.mailer.send({
          messageId,
          to,
          subject: `Back in stock: ${productName}`,
          text: `Good news — "${productName}" is available again.`,
          kind: 'availability_back_in_stock',
          meta,
        });
        if (outcome.status !== 'sent') {
          // Still marked notified below: the transport's one suppression is an
          // already-accepted `messageId`, so this subscriber has the message.
          console.warn('[inventory] the back-in-stock e-mail was not sent', {
            notificationId: row.id,
            reason: outcome.reason,
          });
        }
      }
      row.status = 'notified';
      row.notifiedAt = now;
      notified += 1;
    }
    await em.flush();
    return { notified };
  }

  /** Stand-in helper used to keep the unused entity import alive. */
  static getStockLevelEntity(): typeof StockLevel {
    return StockLevel;
  }
}
