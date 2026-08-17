import { describe, expect, it } from 'vitest';
import {
  checkPortCatches,
  findPortCatches,
  keyOf,
  PORT_CATCHES_TO_DRAIN,
} from '../../../scripts/check-port-catches.js';

/**
 * The bare-catch rule's own test (issue #84).
 *
 * The tree satisfies the rule after the sweep that introduced this check, so
 * agreeing with the tree proves nothing. What has to be proved is that the
 * check can go **red** — on each of the shapes the sweep actually found, and
 * on the ledger going stale.
 *
 * Sources are synthetic and keyed by their path under `src/`, because that path
 * is what decides both the owning module and an alias's visibility.
 */

/** A module that owns `promotionService` and hands the proxy to a service. */
const PROVIDER = `
export function registerModule(ctx: ModuleContext): void {
  ctx.di.providePort('promotionService', ctx.asFunction(() => new PromotionService()).singleton());
}
`;

/** A consumer that binds the proxy under a *different* local name. */
const CONSUMER_BACKEND = `
import { lazyPort } from '../../kernel/index.js';
export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    cartAdminService: ctx.asFunction(() => new CartAdminService(emFactory, {
      promotion: lazyPort<PromotionService>(ctx, 'promotionService'),
    })).singleton(),
  });
}
`;

function tree(consumerService: string): Map<string, string> {
  return new Map([
    ['modules/promotions/backend.ts', PROVIDER],
    ['modules/carts/backend.ts', CONSUMER_BACKEND],
    ['modules/carts/services/cart-admin-service.ts', consumerService],
  ]);
}

const BARE = `
export class CartAdminService {
  async detail() {
    let discount = 0;
    try {
      discount = (await this.deps.promotion.applyToCart({})).discountTotal;
    } catch {
      discount = 0;
    }
    return discount;
  }
}
`;

describe('findPortCatches — the shapes it has to see', () => {
  it('follows a gated port through a deps-object key with a different name', () => {
    const found = findPortCatches({ sources: tree(BARE) });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      moduleId: 'carts',
      port: 'promotion',
      handled: false,
    });
  });

  it('accepts the same catch once it re-throws unconditionally', () => {
    const found = findPortCatches({
      sources: tree(BARE.replace('      discount = 0;\n    }', '      throw err;\n    }')),
    });
    expect(found.map((entry) => entry.handled)).toEqual([true]);
  });

  it('accepts a tolerance narrowed with rethrowIfModuleDisabled', () => {
    const narrowed = BARE.replace(
      '    } catch {\n      discount = 0;',
      '    } catch (err) {\n      rethrowIfModuleDisabled(err);\n      discount = 0;',
    );
    expect(findPortCatches({ sources: tree(narrowed) }).map((e) => e.handled)).toEqual([true]);
  });

  it('refuses a conditional re-throw — that is the shape that keeps the answer', () => {
    const conditional = BARE.replace(
      '      discount = 0;\n    }',
      '      if (err instanceof HttpError) throw err;\n    }',
    ).replace('} catch {', '} catch (err) {');
    expect(findPortCatches({ sources: tree(conditional) }).map((e) => e.handled)).toEqual([false]);
  });

  it('does not read a module`s own service as its port', () => {
    // `invoices` owns `invoiceService` and never resolves its own port, so the
    // identifier in its own files is the local instance. Reading it as a port
    // was the analysis`s one false positive before the owner rule existed.
    const sources = new Map([
      [
        'modules/invoices/backend.ts',
        "export function registerModule(ctx: ModuleContext): void {\n" +
          "  ctx.di.providePort('invoiceService', ctx.asFunction(() => x).singleton());\n}",
      ],
      [
        'modules/invoices/plugin.ts',
        'const invoiceService = new InvoiceService();\n' +
          'try { await invoiceService.issue(id); } catch { /* best effort */ }',
      ],
    ]);
    expect(findPortCatches({ sources })).toHaveLength(0);
  });

  it('sees the same identifier read from another module', () => {
    const sources = new Map([
      [
        'modules/invoices/backend.ts',
        "export function registerModule(ctx: ModuleContext): void {\n" +
          "  ctx.di.providePort('invoiceService', ctx.asFunction(() => x).singleton());\n}",
      ],
      [
        'modules/ksef/services/submit.ts',
        'try { await this.deps.invoiceService.buildDetail(id); } catch { return null; }',
      ],
    ]);
    expect(findPortCatches({ sources }).map((e) => e.moduleId)).toEqual(['ksef']);
  });

  it('sees a `requireModuleEnabled` call inside a try, which throws the same error', () => {
    const sources = new Map([
      ['modules/ksef/plugin.ts', "try { requireModuleEnabled('ksef'); } catch { /* skip */ }"],
    ]);
    expect(findPortCatches({ sources }).map((e) => e.port)).toEqual(['requireModuleEnabled']);
  });
});

/**
 * The two shapes the analysis could not follow (issues #133 and #113).
 *
 * Both are the same defect seen twice: the port arrives by a route the value
 * analysis did not walk, so the `catch` around it read clean. They enter here at
 * `findPortCatches`, the top of the analysis, because the blindness was in the
 * alias table rather than in the `catch` classifier — a fixture handed a
 * pre-built alias would prove nothing (MR !550).
 */
describe('findPortCatches — a port reached one hop away (issue #133)', () => {
  /** `price_lists` owns the resolver; `carts` builds a helper around it. */
  const PRICING_PROVIDER = `
export function registerModule(ctx: ModuleContext): void {
  ctx.di.providePort('pricingService', ctx.asFunction(() => new PricingService()).singleton());
}
`;

  const CARTS_BACKEND = `
import { lazyPort } from '../../kernel/index.js';
export function registerModule(ctx: ModuleContext): void {
  ctx.routes(async (app) => {
    await registerCartRoutes(app, {
      emFactory,
      cartPricingRecompute: new CartPricingRecompute(
        emFactory,
        lazyPort<PricingServiceContract>(ctx, 'pricingService'),
        cradle.cartRecomputeCache,
      ),
    });
  });
}
`;

  const CARTS_ROUTES = (body: string): string => `
export async function registerCartRoutes(app, deps) {
  app.get('/api/v1/cart', async (request) => {
    let recomputed = null;
    try {
      recomputed = await deps.cartPricingRecompute.recompute({ cartId: '1' }, lines);
    } catch (err) {
${body}
    }
    return recomputed;
  });
}
`;

  const holderTree = (routes: string): Map<string, string> =>
    new Map([
      ['modules/price_lists/backend.ts', PRICING_PROVIDER],
      ['modules/carts/backend.ts', CARTS_BACKEND],
      ['modules/carts/routes.ts', routes],
    ]);

  it('follows the port into the holder it was constructed into', () => {
    // The `catch` wraps `CartPricingRecompute`, never the `lazyPort` call. Three
    // of these survived issue #84`s sweep on `GET /api/v1/cart` and rendered a
    // priced cart from stale snapshots with `price_lists` switched off.
    const found = findPortCatches({ sources: holderTree(CARTS_ROUTES('      recomputed = null;')) });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      file: 'modules/carts/routes.ts',
      moduleId: 'carts',
      port: 'cartPricingRecompute',
      handled: false,
    });
  });

  it('accepts the same holder once the tolerance is narrowed', () => {
    const narrowed = CARTS_ROUTES('      rethrowIfModuleDisabled(err);\n      recomputed = null;');
    expect(findPortCatches({ sources: holderTree(narrowed) }).map((e) => e.handled)).toEqual([true]);
  });

  it('does not read a holder built from no port as one', () => {
    // The widening has to stay a *value* analysis: a helper constructed from an
    // EntityManager factory alone carries no gate, and a `catch` around it is
    // nobody`s business.
    const plain = CARTS_BACKEND.replace(
      /new CartPricingRecompute\([\s\S]*?\),\n/,
      'new CartPricingRecompute(emFactory),\n',
    );
    const sources = holderTree(CARTS_ROUTES('      recomputed = null;'));
    sources.set('modules/carts/backend.ts', plain);
    expect(findPortCatches({ sources })).toHaveLength(0);
  });
});

describe('findPortCatches — a port contributed by a root (issue #113)', () => {
  /** `transactional_emails` publishes the sender accessor as a gated port. */
  const EMAIL_PROVIDER = `
export function registerModule(ctx: ModuleContext): void {
  ctx.di.providePort(
    'transactionalEmailSenderAccessor',
    ctx.asFunction(() => () => exposed.sender ?? undefined).singleton(),
  );
}
`;

  /** The root hands the port on under a name of its own — no `lazyPort` here. */
  const ROOT = `
export function composeBackend(container) {
  registerValues(container, {
    shipmentEmailSender: () => emailCradle().transactionalEmailSenderAccessor(),
  });
}
`;

  const SHIPMENTS_BACKEND = `
export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    shipmentEmailNotifier: ctx
      .asFunction(
        ({ emFactory }: ShipmentsCradle) =>
          new ShipmentEmailNotifier({
            emFactory,
            getTransactionalEmailSender: () =>
              ctx.cradle<ShipmentsCradle>().shipmentEmailSender(),
          }),
      )
      .singleton(),
  });
}
`;

  const NOTIFIER = (body: string): string => `
export class ShipmentEmailNotifier {
  async notify(orderId: string): Promise<ShipmentEmailResult> {
    try {
      const sender = this.deps.getTransactionalEmailSender();
      if (!sender) return { sent: false, reason: 'no_sender' };
      await sender.send({ code: 'shipment_created', to: orderId });
      return { sent: true };
    } catch (error) {
${body}
    }
  }
}
`;

  const contributionTree = (notifier: string): Map<string, string> =>
    new Map([
      ['modules/transactional_emails/backend.ts', EMAIL_PROVIDER],
      ['composition.ts', ROOT],
      ['modules/shipments/backend.ts', SHIPMENTS_BACKEND],
      ['modules/shipments/services/shipment-email-notifier.ts', notifier],
    ]);

  it('follows a gated port through a root contribution point', () => {
    // The five e-mail notifiers that discarded their send outcome were invisible
    // for exactly this reason: the sender reaches them through `registerValues`,
    // so the count read `catches=42 violations=0` before and after the repair.
    const found = findPortCatches({
      sources: contributionTree(NOTIFIER("      return { sent: false, reason: 'failed' };")),
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      file: 'modules/shipments/services/shipment-email-notifier.ts',
      moduleId: 'shipments',
      port: 'getTransactionalEmailSender',
      handled: false,
    });
  });

  it('accepts the same notifier once the tolerance is narrowed', () => {
    const narrowed = NOTIFIER(
      "      rethrowIfModuleDisabled(error);\n      return { sent: false, reason: 'failed' };",
    );
    expect(findPortCatches({ sources: contributionTree(narrowed) }).map((e) => e.handled)).toEqual([
      true,
    ]);
  });

  it('does not read a root value built from no port as one', () => {
    const sources = contributionTree(NOTIFIER("      return { sent: false, reason: 'failed' };"));
    sources.set('composition.ts', ROOT.replace('emailCradle().transactionalEmailSenderAccessor()', 'undefined'));
    expect(findPortCatches({ sources })).toHaveLength(0);
  });
});

describe('checkPortCatches — the two-way ratchet', () => {
  it('fails on an unledgered bare catch', () => {
    const result = checkPortCatches({ sources: tree(BARE) }, {});
    expect(result.violations).toHaveLength(1);
    expect(result.stale).toHaveLength(0);
  });

  it('passes when the site is ledgered with a reason', () => {
    const ledger = {
      'modules/carts/services/cart-admin-service.ts:promotion': 'a reason that would be real',
    };
    const result = checkPortCatches({ sources: tree(BARE) }, ledger);
    expect(result.violations).toHaveLength(0);
    expect(result.ledgered.map(keyOf)).toEqual([
      'modules/carts/services/cart-admin-service.ts:promotion',
    ]);
  });

  it('fails on a ledger entry that no longer describes a bare catch', () => {
    const ledger = { 'modules/carts/services/cart-admin-service.ts:promotion': 'stale now' };
    const fixed = BARE.replace('    } catch {\n      discount = 0;\n    }\n', '');
    const result = checkPortCatches({ sources: tree(fixed) }, ledger);
    expect(result.violations).toHaveLength(0);
    expect(result.stale).toEqual(['modules/carts/services/cart-admin-service.ts:promotion']);
  });
});

describe('PORT_CATCHES_TO_DRAIN', () => {
  it('gives a reason for every entry, not a label', () => {
    for (const [key, reason] of Object.entries(PORT_CATCHES_TO_DRAIN)) {
      expect(key, 'ledger keys are `<path under src/>:<port>`').toMatch(/^[\w./-]+\.ts:\w+$/);
      // Long enough to be an explanation. "Defensive" is not a reason, and the
      // ledger exists to be argued with rather than skimmed.
      expect(reason.length, `${key} needs a reason`).toBeGreaterThan(80);
    }
  });
});
