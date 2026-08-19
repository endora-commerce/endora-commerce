import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod';
import { describe, expect, it } from 'vitest';
import type { CatalogPromoAttributePort } from '@b2b/contracts';
import { registerErrorEnvelope } from '../../../src/http/error-envelope.js';
import {
  registerPromotionRoutes,
  type PromotionRoutesDeps,
} from '../../../src/modules/promotions/routes.js';

/**
 * Issue #164, the instance one layer above the service.
 *
 * `PromotionService`'s two catalog ports stopped being optional in 7540789d;
 * the Rule Builder's attribute picker kept the same shape a layer up —
 * `catalogPromoAttributes?: CatalogPromoAttributePort` on `PromotionRoutesDeps`,
 * supplied by the one call site there is (`backend.ts`, through
 * `lazyPort('catalogPromoAttributePort')`), with a branch for an absence
 * nothing produces.
 *
 * That branch was not merely dead, it answered:
 * `503 { error: { code: 'service_unavailable', message: 'Catalog port not
 * configured.' } }` — a code written nowhere else in this repository, absent
 * from `ERROR_CODES`, from both translation bundles and from every admin
 * handler. So the module published a **second spelling of one absence**, and
 * the spelling nobody could act on.
 *
 * The absence it was written for cannot happen twice over. The container
 * resolves the port for every composition; and `catalog` declares
 * `activation.nonDeactivatable` — products, variants and categories are what
 * the platform is — so the gate `providePort` puts on `catalogPromoAttributePort`
 * has no closed state to reach. That is the `OWNER LOCKED` classification the
 * port checks derive from the manifests, and it is why **no off-state case
 * belongs in this file**: a test that switched `catalog` off would be asserting
 * a state the lifecycle refuses to enter, and would go stale silently the day
 * the lock were lifted, which is exactly what D-100 keeps out of reason
 * strings.
 *
 * What is testable is the shape and the live path: the picker cannot be
 * composed without the port, and it renders what the port answers.
 */

function refusing<T extends object>(what: string): T {
  return new Proxy({} as T, {
    get: (_target, method) => () => {
      throw new Error(`the attribute picker must not call ${what}.${String(method)}`);
    },
  });
}

/**
 * Every dep the attribute picker does not use. They refuse on contact, so a
 * route reaching one fails by name instead of passing against a silent stub.
 */
function otherDeps(): Omit<PromotionRoutesDeps, 'catalogPromoAttributes'> {
  return {
    promotionService: refusing<PromotionRoutesDeps['promotionService']>('promotionService'),
    couponService: refusing<PromotionRoutesDeps['couponService']>('couponService'),
    ruleStore: refusing<PromotionRoutesDeps['ruleStore']>('ruleStore'),
    statsService: refusing<PromotionRoutesDeps['statsService']>('statsService'),
    requireAdmin: () => async () => {},
    ruleTargets: {},
  };
}

describe('promotions — the Rule Builder attribute picker over catalogPromoAttributePort', () => {
  it('renders what the port answers', async () => {
    const port: CatalogPromoAttributePort = {
      promoRuleAttributeKeys: async () => ['colour', 'gone'],
      getAttributeWithOptions: async (key) =>
        key === 'gone'
          ? null
          : {
              id: 'attr-1',
              key,
              label: { en: 'Colour' },
              labelDefault: 'Colour',
              valueType: 'select',
              isPromoRule: true,
              options: [{ value: 'red', label: { en: 'Red' }, labelDefault: 'Red' }],
            },
    };

    const app: FastifyInstance = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    registerErrorEnvelope(app);
    await registerPromotionRoutes(app, { ...otherDeps(), catalogPromoAttributes: port });
    await app.ready();

    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/promotions/rule-targets/attributes',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { items: Array<{ key: string; options?: unknown[] }> } };
      // `gone` answered null — no such attribute, which the port's return type
      // already says and the picker skips. That is the one absence this route
      // has ever been able to see.
      expect(body.data.items.map((i) => i.key)).toEqual(['colour']);
      expect(body.data.items[0]?.options).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('cannot be composed without the catalog port', () => {
    const withoutPort = otherDeps();

    // @ts-expect-error — the port is required (issue #164). The composition
    // that omits it is the one whose absent branch invented a private
    // `service_unavailable` code, and it is not a composition that exists.
    const deps: PromotionRoutesDeps = withoutPort;

    expect(deps).toBeDefined();
  });
});
