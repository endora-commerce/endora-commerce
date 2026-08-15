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
