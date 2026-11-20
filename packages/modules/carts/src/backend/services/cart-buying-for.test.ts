import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { CartBuyingForService } from './cart-buying-for.js';

/**
 * `specs/182-related-payers/` T054 (FR-110 to FR-114, FR-116, A-18) — *Buying for* on a cart:
 * set and cleared through `relatedPayerPolicyPort`, the link's terms copied, every stored line
 * repriced in the same operation with a per-line summary, an unpriced line kept and reported,
 * and the engine named the payer with no customer account (A-18). A cart whose link stopped
 * being usable, or turned to the buyer's terms, is reset on its next read with a reason.
 */
const X = 'org-x';
const Y = 'org-y';
const SUBJECT = { buyerOrganizationId: X, customerAccountId: 'acc-1', salesChannelId: 'ch-1' };

function harness(opts: { terms?: 'buyer' | 'payer'; usable?: boolean } = {}) {
  const cart = { id: 'cart-1', organizationId: X, customerAccountId: 'acc-1', salesChannelId: 'ch-1', buyingForOrganizationId: null as string | null, buyingForTerms: null as 'buyer' | 'payer' | null };
  const items = [
    { id: 'i1', cartId: 'cart-1', productId: 'p1', variantId: null, quantity: 2, unitPrice: '100.0000', currency: 'PLN', priceSource: 'buyer' },
    { id: 'i2', cartId: 'cart-1', productId: 'p2', variantId: null, quantity: 1, unitPrice: '50.0000', currency: 'PLN', priceSource: 'buyer' },
  ];
  const contexts: Array<Record<string, unknown>> = [];
  let flushed = 0;
  const invalidated: string[] = [];
  const em = {
    findOneOrFail: async () => cart,
    find: async () => items,
    flush: async () => {
      flushed += 1;
    },
  };
  const usable = opts.usable ?? true;
  const terms = opts.terms ?? 'payer';
  const policy = {
    assertUsable: async (_s: unknown, payer: string) => {
      if (!usable) throw new HttpError(422, ERROR_CODES.RELATED_PAYER_NOT_USABLE, 'The payer cannot be used now.');
      return { linkId: 'link-1', payerOrganizationId: payer, payerName: 'Payer', payerTaxId: 'PL1', commercialTerms: terms, billingAddressIds: [] };
    },
    pricingContext: async (_s: unknown, payer: string) => {
      if (!usable) throw new HttpError(422, ERROR_CODES.RELATED_PAYER_NOT_USABLE, 'The payer cannot be used now.');
      return terms === 'payer' ? { organizationId: payer, customerGroupId: null } : null;
    },
  };
  const linePricing = {
    contextFor: async (_em: unknown, input: Record<string, unknown>) => {
      contexts.push(input);
      return { priced: input['pricingOrganizationId'] ?? input['organizationId'] } as never;
    },
    orderablePrices: async (ctx: { priced: string }) => {
      const out = new Map<string, unknown>();
      if (ctx.priced === Y) {
        out.set('i1', { ok: true, unitPrice: '90.0000', currency: 'PLN', source: 'price_list', priceSource: 'buyer' });
        out.set('i2', { ok: false, reason: 'unpriced' });
      } else {
        out.set('i1', { ok: true, unitPrice: '100.0000', currency: 'PLN', source: 'price_list', priceSource: 'buyer' });
        out.set('i2', { ok: true, unitPrice: '50.0000', currency: 'PLN', source: 'price_list', priceSource: 'buyer' });
      }
      return out;
    },
  };
  const service = new CartBuyingForService({
    emFactory: () => em as never,
    policy: () => policy as never,
    linePricing: linePricing as never,
    catalogProducts: { findByIds: async (ids: readonly string[]) => ids.map((id) => ({ id })) } as never,
    invalidate: async (cartId) => {
      invalidated.push(cartId);
    },
  });
  return { service, cart, items, contexts, invalidated, flushed: () => flushed };
}

describe('CartBuyingForService', () => {
  it('sets a payer on its terms: reprices every line for the payer, named with no customer account', async () => {
    const { service, cart, items, contexts, invalidated } = harness();
    const change = await service.set({ cartId: 'cart-1', subject: SUBJECT, payerOrganizationId: Y });
    expect(cart).toMatchObject({ buyingForOrganizationId: Y, buyingForTerms: 'payer' });
    expect(contexts.at(-1)).toMatchObject({ organizationId: X, pricingOrganizationId: Y, customerAccountId: null });
    expect(change.buyingFor).toEqual({ organizationId: Y, name: 'Payer', terms: 'payer' });
    expect(change.repricing.lines).toEqual([
      { lineId: 'i1', before: { amount: 100, currency: 'PLN' }, after: { amount: 90, currency: 'PLN' }, unpriced: false },
      { lineId: 'i2', before: { amount: 50, currency: 'PLN' }, after: null, unpriced: true },
    ]);
    // FR-114 — the unpriced line stays, its stored price untouched; placement refuses it.
    expect(items.map((i) => i.unitPrice)).toEqual(['90.0000', '50.0000']);
    expect(invalidated).toEqual(['cart-1']);
  });

  it('a payer on the buyer\'s terms is carried to checkout and changes no price (FR-110)', async () => {
    const { service, cart, contexts, items } = harness({ terms: 'buyer' });
    const change = await service.set({ cartId: 'cart-1', subject: SUBJECT, payerOrganizationId: Y });
    expect(cart).toMatchObject({ buyingForOrganizationId: Y, buyingForTerms: 'buyer' });
    expect(contexts.at(-1)?.['pricingOrganizationId'] ?? null).toBeNull();
    expect(change.repricing.lines.every((l) => l.before?.amount === l.after?.amount)).toBe(true);
    expect(items.map((i) => i.unitPrice)).toEqual(['100.0000', '50.0000']);
  });

  it('clearing returns the cart to the buyer\'s own prices', async () => {
    const { service, cart, items } = harness();
    await service.set({ cartId: 'cart-1', subject: SUBJECT, payerOrganizationId: Y });
    const change = await service.set({ cartId: 'cart-1', subject: SUBJECT, payerOrganizationId: null });
    expect(cart).toMatchObject({ buyingForOrganizationId: null, buyingForTerms: null });
    expect(change.buyingFor).toBeNull();
    expect(items.map((i) => i.unitPrice)).toEqual(['100.0000', '50.0000']);
  });

  it('refuses a payer that is not usable, and writes nothing', async () => {
    const { service, cart, flushed } = harness({ usable: false });
    await expect(service.set({ cartId: 'cart-1', subject: SUBJECT, payerOrganizationId: Y })).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(cart.buyingForOrganizationId).toBeNull();
    expect(flushed()).toBe(0);
  });

  it('FR-116: a read finding the link unusable resets the cart, reprices it and says why', async () => {
    const h = harness();
    await h.service.set({ cartId: 'cart-1', subject: SUBJECT, payerOrganizationId: Y });
    const broken = harness({ usable: false });
    Object.assign(broken.cart, h.cart);
    Object.assign(broken.items, h.items);
    const reset = await broken.service.resetIfUnusable({ cartId: 'cart-1', subject: SUBJECT });
    expect(reset).toEqual({ reason: 'link_not_usable', previousOrganizationId: Y });
    expect(broken.cart).toMatchObject({ buyingForOrganizationId: null, buyingForTerms: null });
    expect(broken.items.map((i) => i.unitPrice)).toEqual(['100.0000', '50.0000']);
  });

  it('FR-116: a link turned to the buyer\'s terms resets a payer\'s-terms cart', async () => {
    const h = harness();
    await h.service.set({ cartId: 'cart-1', subject: SUBJECT, payerOrganizationId: Y });
    const turned = harness({ terms: 'buyer' });
    Object.assign(turned.cart, h.cart);
    Object.assign(turned.items, h.items);
    expect(await turned.service.resetIfUnusable({ cartId: 'cart-1', subject: SUBJECT })).toEqual({
      reason: 'terms_changed',
      previousOrganizationId: Y,
    });
    expect(turned.cart.buyingForOrganizationId).toBeNull();
  });

  it('a cart in the buyer\'s own context is never reset', async () => {
    const { service } = harness({ usable: false });
    expect(await service.resetIfUnusable({ cartId: 'cart-1', subject: SUBJECT })).toBeNull();
  });
});
