import { createHash } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';
import { ERROR_CODES, type ApiPlaceOrderRequest } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Product } from '../../catalog/entities/product.entity.js';
import { Organization } from '../../organizations/entities/organization.entity.js';
import { SalesChannel } from '../../sales_channels/entities/sales-channel.entity.js';
import type { SalesChannelMembershipService } from '../../sales_channels/services/sales-channel-membership.service.js';
import type { PricingService } from '../../price_lists/services/pricing-service.js';
import type { CartService } from '../../carts/services/cart-service.js';
import type { AddressService } from '../../addresses/services/address-service.js';
import type { AuditLogService } from '../../audit_logs/services/audit-log-service.js';
import { Order } from '../entities/order.entity.js';
import { OrderPlacementIntent } from '../entities/order-placement-intent.entity.js';
import type { OrderService } from './order-service.js';

/**
 * OrderApiIntakeService — feature 062 (research §R8, contracts/orders-api-key-intake.md §1).
 *
 * Order intake for BOUND api keys: line items by SKU + quantity, durable
 * idempotency, and the org capability envelope inherited BY CONSTRUCTION —
 * the service seeds the designated service account's cart via the injected
 * `CartService` and delegates to `OrderService.placeOrder` (the
 * `OrderCreationAdminService` pattern), so every guard the org's own buyer is
 * subject to runs unchanged: transact-status, address ownership, method
 * activity + usability, org restriction allow-lists, stock reservation,
 * credit-limit reservation, minimum-order-value gate, promotions recompute.
 * No bypass parameter exists on this surface (FR-021).
 */

export interface ApiKeyOrderBinding {
  apiKeyId: string;
  organizationId: string;
  salesChannelId: string;
  customerAccountId: string;
}

export interface OrderApiIntakeDeps {
  emFactory: () => EntityManager;
  cartService: CartService;
  orderService: OrderService;
  addressService: AddressService;
  /**
   * Sanctioned bridge accessor (feature 052 pattern) — the bound channel's
   * published assortment gate. Absent (legacy rigs) ⇒ fail closed: every SKU
   * is out of assortment.
   */
  salesChannelMembership?: SalesChannelMembershipService | undefined;
  /**
   * The SAME resolver cart pricing uses. Absent ⇒ the `defaultPrice` fallback
   * below is the only price source (mirrors CartService's legacy path).
   */
  pricingService?: PricingService | undefined;
  /** Per-key intake lock (research §R8 step 2). Absent ⇒ no serialization. */
  redis?: Redis | undefined;
  /**
   * Feature 026 US4 — the org's method allow-lists (empty list = no
   * restriction). The customer flow enforces these at the storefront listing
   * / preflight seam; this surface has no listing step, so the same rule is
   * applied here with the customer flow's method-unavailable refusal.
   */
  resolveOrganizationMethodAllowLists?: ((organizationId: string) => Promise<{
    paymentMethodIds: string[];
    deliveryMethodIds: string[];
  } | null>) | undefined;
  /** Audit attribution of key placements (`order.place_via_api_key`). */
  auditLogService?: AuditLogService | undefined;
}

export interface IntakeResult {
  order: Order;
  /** True when this response replays an already-succeeded intent (HTTP 200). */
  replayed: boolean;
}

const LOCK_TTL_MS = 30_000;

export class OrderApiIntakeService {
  constructor(private readonly deps: OrderApiIntakeDeps) {}

  async place(
    binding: ApiKeyOrderBinding,
    idempotencyKey: string | undefined,
    body: ApiPlaceOrderRequest,
  ): Promise<IntakeResult> {
    // command-coverage-ignore: the domain write is delegated to
    // OrderService.placeOrder (its guards + audit apply); local mutations are
    // the intent bookkeeping rows, audited via `order.place_via_api_key`.
    const key = idempotencyKey?.trim() ?? '';
    if (key.length === 0 || key.length > 128) {
      throw new HttpError(
        422,
        ERROR_CODES.IDEMPOTENCY_KEY_REQUIRED,
        'The Idempotency-Key header is required (1..128 characters).',
      );
    }

    const fingerprint = payloadFingerprint(body);
    const lockKey = `b2b:orders:api-intake:${binding.apiKeyId}`;
    const lockToken = await this.#acquireLock(lockKey);
    try {
      // Durable idempotency (FR-012) — one row per (api_key_id, idempotency_key).
      const em = this.deps.emFactory();
      let intent = await em.findOne(OrderPlacementIntent, {
        apiKeyId: binding.apiKeyId,
        idempotencyKey: key,
      });
      if (intent && intent.payloadFingerprint !== fingerprint) {
        throw new HttpError(
          409,
          ERROR_CODES.IDEMPOTENCY_KEY_REUSED,
          'This Idempotency-Key was already used with a different payload.',
        );
      }
      if (intent && intent.status === 'succeeded') {
        const order = intent.orderId ? await em.findOne(Order, { id: intent.orderId }) : null;
        if (order) return { order, replayed: true };
        // The original order vanished (deleted out-of-band) — fall through and
        // re-attempt under the same intent.
      }
      if (!intent) {
        intent = em.create(OrderPlacementIntent, {
          apiKeyId: binding.apiKeyId,
          organizationId: binding.organizationId,
          idempotencyKey: key,
          payloadFingerprint: fingerprint,
          status: 'pending',
        });
        await em.persistAndFlush(intent);
      } else {
        intent.status = 'pending';
        intent.lastError = null;
        await em.flush();
      }

      try {
        const order = await this.#placeGuarded(binding, body);
        await this.#settleIntent(intent.id, { status: 'succeeded', orderId: order.id });
        await this.#auditPlacement(binding, order);
        return { order, replayed: false };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.#settleIntent(intent.id, { status: 'failed', lastError: message });
        throw err;
      }
    } finally {
      await this.#releaseLock(lockKey, lockToken);
    }
  }

  /**
   * Line resolution + cart seed + delegation to `placeOrder` — the
   * OrderCreationAdminService pattern, including inline-address create/cleanup.
   */
  async #placeGuarded(binding: ApiKeyOrderBinding, body: ApiPlaceOrderRequest): Promise<Order> {
    const em = this.deps.emFactory();
    const channel = await em.findOne(SalesChannel, { id: binding.salesChannelId });
    const organization = await em.findOne(Organization, { id: binding.organizationId });

    // FR-021 — the org's method allow-lists (feature 026 US4). The customer
    // flow never offers a disallowed method; this surface refuses it with the
    // same method-unavailable error the customer submit guard emits.
    const allowLists = await this.deps
      .resolveOrganizationMethodAllowLists?.(binding.organizationId)
      .catch(() => null);
    if (allowLists) {
      if (
        allowLists.paymentMethodIds.length > 0 &&
        !allowLists.paymentMethodIds.includes(body.paymentMethodId)
      ) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          'The selected payment method is not available for this order.',
        );
      }
      if (
        allowLists.deliveryMethodIds.length > 0 &&
        !allowLists.deliveryMethodIds.includes(body.deliveryMethodId)
      ) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          'The selected shipping method is not available for this order.',
        );
      }
    }

    // Step 4 — SKU → product + bound-channel assortment + resolvable price.
    // Refusals are whole-order 422 with per-line issues; nothing persists.
    const skus = Array.from(new Set(body.lines.map((l) => l.sku)));
    const products = await em.find(Product, {
      sku: { $in: skus },
      deletedAt: null,
      status: 'active',
    });
    const productBySku = new Map(products.map((p) => [p.sku, p]));
    const inChannel = new Set<string>();
    for (const product of products) {
      const channels = this.deps.salesChannelMembership
        ? await this.deps.salesChannelMembership.listChannelsForEntity('product', product.id)
        : [];
      if (channels.some((c) => c.id === binding.salesChannelId)) inChannel.add(product.id);
    }

    const issues: Array<{ path: string; issue: string; sku: string }> = [];
    const resolvedLines: Array<{ productId: string; quantity: number }> = [];
    for (const [index, line] of body.lines.entries()) {
      const product = productBySku.get(line.sku);
      if (!product || !inChannel.has(product.id)) {
        // Unknown / inactive / unpublished are indistinguishable — no leak.
        issues.push({
          path: `lines.${index}.sku`,
          issue: ERROR_CODES.SKU_NOT_IN_ASSORTMENT,
          sku: line.sku,
        });
        continue;
      }
      const priced = await this.#hasResolvablePrice(product, organization, channel, line.quantity);
      if (!priced) {
        issues.push({
          path: `lines.${index}.sku`,
          issue: ERROR_CODES.PRICE_UNAVAILABLE,
          sku: line.sku,
        });
        continue;
      }
      resolvedLines.push({ productId: product.id, quantity: line.quantity });
    }
    if (issues.length > 0) {
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'One or more order lines were refused.',
        issues,
      );
    }

    const customerCtx = {
      customerAccountId: binding.customerAccountId,
      organizationId: binding.organizationId,
    };

    // Address sides — an existing org address id OR an inline address created
    // in the org book (so placeOrder can snapshot it); one-time addresses are
    // soft-deleted again after placement (admin-create pattern).
    const transientAddressIds: string[] = [];
    const resolveAddress = async (
      kind: 'delivery' | 'billing',
      id: string | undefined,
      inline: ApiPlaceOrderRequest['deliveryAddress'],
    ): Promise<string> => {
      if (id) return id;
      if (!inline) {
        throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, `Missing ${kind} address.`);
      }
      const created = await this.deps.addressService.createAddress(binding.organizationId, {
        kind,
        recipientName: inline.recipientName,
        street: inline.street,
        city: inline.city,
        postalCode: inline.postalCode,
        country: inline.country,
        ...(inline.phone ? { phone: inline.phone } : {}),
        isDefault: false,
      });
      if (!inline.saveToAddressBook) transientAddressIds.push(created.id);
      return created.id;
    };
    const cleanupTransient = async (): Promise<void> => {
      for (const addressId of transientAddressIds) {
        try {
          await this.deps.addressService.deleteAddress(binding.organizationId, addressId);
        } catch {
          // best-effort cleanup; a leftover soft-deletable row is harmless.
        }
      }
    };

    let order: Order;
    try {
      const deliveryAddressId = await resolveAddress(
        'delivery',
        body.deliveryAddressId,
        body.deliveryAddress,
      );
      const billingAddressId = await resolveAddress(
        'billing',
        body.billingAddressId,
        body.billingAddress,
      );

      // Seed the service account's cart (single-active-cart model) with real
      // org pricing, then run the FULL placement pipeline.
      await this.deps.cartService.clearForCustomer(customerCtx);
      for (const line of resolvedLines) {
        await this.deps.cartService.addItem(
          { customer: customerCtx },
          { productId: line.productId, quantity: line.quantity },
        );
      }

      order = await this.deps.orderService.placeOrder(customerCtx, {
        deliveryAddressId,
        billingAddressId,
        deliveryMethodId: body.deliveryMethodId,
        paymentMethodId: body.paymentMethodId,
        salesChannelId: binding.salesChannelId,
        ...(body.customerReference ? { customerNote: body.customerReference } : {}),
      });
    } catch (err) {
      await cleanupTransient();
      throw err;
    }
    await cleanupTransient();
    return order;
  }

  /**
   * "No resolvable org price" probe (contract §4 `PRICE_UNAVAILABLE`): the
   * pricing-engine resolution at the requested quantity, with the same
   * catalog `defaultPrice` fallback the storefront cart applies — a product
   * the org's own buyer can put in a cart is never refused here.
   */
  async #hasResolvablePrice(
    product: Product,
    organization: Organization | null,
    channel: SalesChannel | null,
    quantity: number,
  ): Promise<boolean> {
    if (this.deps.pricingService && channel) {
      try {
        const resolved = await this.deps.pricingService.resolveLinePrice({
          product,
          context: {
            quantity,
            organization,
            salesChannel: { id: channel.id, defaultCurrency: channel.defaultCurrency },
          },
        });
        if (resolved) return true;
      } catch {
        // fall through to the catalog default below
      }
    }
    const fallback = product.attributeValues['defaultPrice'] ?? product.attributeValues['price'];
    return fallback !== undefined && fallback !== null;
  }

  /** Settle the intent on a FRESH em — the placement error may have aborted the caller's. */
  async #settleIntent(
    intentId: string,
    patch: { status: 'succeeded'; orderId: string } | { status: 'failed'; lastError: string },
  ): Promise<void> {
    // command-coverage-ignore: idempotency bookkeeping row (queue-state class),
    // not domain state; the order write itself is audited in placeOrder.
    const em = this.deps.emFactory();
    const intent = await em.findOne(OrderPlacementIntent, { id: intentId });
    if (!intent) return;
    intent.status = patch.status;
    if (patch.status === 'succeeded') {
      intent.orderId = patch.orderId;
      intent.lastError = null;
    } else {
      intent.lastError = patch.lastError.slice(0, 2000);
    }
    await em.flush();
  }

  async #auditPlacement(binding: ApiKeyOrderBinding, order: Order): Promise<void> {
    if (!this.deps.auditLogService) return;
    try {
      await this.deps.auditLogService.record({
        action: 'order.place_via_api_key',
        objectType: 'order',
        objectId: order.id,
        stateBefore: null,
        stateAfter: {
          apiKeyId: binding.apiKeyId,
          organizationId: binding.organizationId,
          customerAccountId: binding.customerAccountId,
          businessId: order.businessId,
        },
      });
    } catch {
      // Attribution is best-effort; the order itself is already committed.
    }
  }

  async #acquireLock(lockKey: string): Promise<string | null> {
    if (!this.deps.redis) return null;
    const token = createHash('sha256')
      .update(`${lockKey}:${Date.now()}:${Math.random()}`)
      .digest('hex');
    const ok = await this.deps.redis.set(lockKey, token, 'PX', LOCK_TTL_MS, 'NX');
    if (ok !== 'OK') {
      throw new HttpError(
        409,
        ERROR_CODES.VALIDATION_FAILED,
        'Another order intake for this API key is in progress; retry with the same Idempotency-Key.',
        { code: 'intake_busy' },
      );
    }
    return token;
  }

  async #releaseLock(lockKey: string, token: string | null): Promise<void> {
    if (!this.deps.redis || token === null) return;
    try {
      // Compare-and-delete so an expired lock taken over by another intake is
      // never released by the original holder.
      await this.deps.redis.eval(
        `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`,
        1,
        lockKey,
        token,
      );
    } catch {
      // TTL guards a failed release.
    }
  }
}

/** SHA-256 hex over a stable (recursively key-sorted) JSON canonicalization. */
export function payloadFingerprint(body: unknown): string {
  return createHash('sha256').update(canonicalize(body), 'utf8').digest('hex');
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
  return `{${entries.join(',')}}`;
}
