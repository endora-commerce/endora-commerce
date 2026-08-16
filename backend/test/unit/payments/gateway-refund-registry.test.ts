import { describe, expect, it } from 'vitest';
import { GatewayRefundRegistry } from '../../../src/modules/payments/services/gateway-refund-registry.js';
import type { GatewayRefundHandler } from '../../../src/modules/payments/services/gateway-refund-registry.js';

/**
 * T042 (US5) — the generic gateway-refund seam: register / get / resolve.
 * `PaymentRefundProvider` uses `resolve()` to delegate `kind === 'gateway'`
 * refunds and falls back to `pending_manual` when nothing is registered.
 *
 * Feature 074 (FR-024) adds the half D-44 §7 found missing: every entry names
 * the module that contributed it, and the registry states — here, and at the
 * class — what it does with an entry whose owner is not effectively present.
 * The policy is **skip**, and the two halves of it are asserted separately
 * because either alone would pass for the wrong reason: the acting surface must
 * answer as if the handler were not registered, and the diagnostic surface must
 * keep naming it, since switching a module off is not uninstalling it.
 */
const handler = (adapterKey: string): GatewayRefundHandler => ({
  adapterKey,
  refund: async () => ({ state: 'issued', externalReference: `ref_${adapterKey}` }),
});

/** A registry in which `absent` is the one module that has been switched off. */
const withStripeOff = (): GatewayRefundRegistry =>
  new GatewayRefundRegistry(undefined, (moduleId) => moduleId !== 'stripe');

describe('GatewayRefundRegistry', () => {
  it('registers and resolves by adapter key', () => {
    const reg = new GatewayRefundRegistry();
    reg.register(handler('stripe'), 'stripe');
    expect(reg.get('stripe')?.adapterKey).toBe('stripe');
    expect(reg.resolve('stripe')?.adapterKey).toBe('stripe');
    expect(reg.list()).toEqual(['stripe']);
  });

  it('resolve() with no key returns the sole registered handler', () => {
    const reg = new GatewayRefundRegistry();
    reg.register(handler('stripe'), 'stripe');
    expect(reg.resolve()?.adapterKey).toBe('stripe');
    expect(reg.resolve(null)?.adapterKey).toBe('stripe');
  });

  it('resolve() prefers an exact key match', () => {
    const reg = new GatewayRefundRegistry();
    reg.register(handler('stripe'), 'stripe');
    reg.register(handler('other'), 'autopay');
    expect(reg.resolve('other')?.adapterKey).toBe('other');
  });

  it('resolve() does not guess another PSP for an unknown key', () => {
    const reg = new GatewayRefundRegistry();
    reg.register(handler('stripe'), 'stripe');
    reg.register(handler('autopay'), 'autopay');
    expect(reg.resolve('bank_transfer')).toBeUndefined();
    expect(reg.resolve()).toBeUndefined();
  });

  it('resolve() returns undefined when nothing is registered', () => {
    const reg = new GatewayRefundRegistry();
    expect(reg.resolve('stripe')).toBeUndefined();
    expect(reg.resolve()).toBeUndefined();
  });

  it('unregisters a handler', () => {
    const reg = new GatewayRefundRegistry();
    reg.register(handler('stripe'), 'stripe');
    reg.unregister('stripe');
    expect(reg.get('stripe')).toBeUndefined();
  });

  it('names the module that contributed each handler', () => {
    const reg = new GatewayRefundRegistry();
    reg.register(handler('stripe'), 'stripe');
    expect(reg.ownerOf('stripe')).toBe('stripe');
    expect(reg.ownerOf('nobody')).toBeNull();
  });
});

describe('the stated policy — an absent owner is skipped', () => {
  it('answers as if the handler were not registered, to everything that acts', () => {
    const reg = withStripeOff();
    reg.register(handler('stripe'), 'stripe');

    expect(reg.get('stripe')).toBeUndefined();
    expect(reg.resolve('stripe')).toBeUndefined();
    expect(reg.list()).toEqual([]);
  });

  it('does not fall back to a switched-off gateway when the key is missing', () => {
    // `resolve(null)` answers with the sole registered handler, and a refund
    // whose order names no adapter would otherwise be routed into a PSP the
    // operator switched off — the sharpest form of the fail-open, because it
    // happens on the path that already has an obligation to settle.
    const reg = withStripeOff();
    reg.register(handler('stripe'), 'stripe');

    expect(reg.resolve()).toBeUndefined();
    expect(reg.resolve(null)).toBeUndefined();
  });

  it('keeps naming the contributor, so the reason stays visible', () => {
    const reg = withStripeOff();
    reg.register(handler('stripe'), 'stripe');

    // Presence-blind on purpose: this is what tells a caller "registered, but
    // its module is off" rather than "no PSP integration at all", and the two
    // are different sentences on a settlement screen.
    expect(reg.ownerOf('stripe')).toBe('stripe');
    expect(reg.listAll()).toEqual(['stripe']);
  });

  it('serves the handler again once the module is switched back on', () => {
    let off = true;
    const reg = new GatewayRefundRegistry(undefined, () => !off);
    reg.register(handler('stripe'), 'stripe');
    expect(reg.resolve('stripe')).toBeUndefined();

    off = false;

    // The probe is asked per call, so the answer follows the operator rather
    // than the moment of registration.
    expect(reg.resolve('stripe')?.adapterKey).toBe('stripe');
  });

  it('defaults to always-present, so a registry a test builds is unaffected', () => {
    const reg = new GatewayRefundRegistry();
    reg.register(handler('stripe'), 'stripe');
    expect(reg.resolve('stripe')?.adapterKey).toBe('stripe');
  });
});
