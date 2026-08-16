import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BARE_SUBSCRIPTIONS_TO_DRAIN,
  checkSubscribeSeam,
  findBareSubscriptions,
  keyOf,
} from '../../../scripts/check-subscribe-seam.js';

/**
 * The subscribe-seam rule's own test (issue #107).
 *
 * Routes and workers each had a static check; subscriptions had none, and
 * twenty-two bare `eventBus.on` registrations accumulated across nine modules
 * while every one of those modules' conversion tasks read done. A check that
 * only agreed with the tree after the sweep would prove nothing, so what is
 * proved here is that it goes **red** — on each spelling the sweep actually
 * found, and on the ledger going stale.
 *
 * Sources are synthetic and keyed by their path under `src/`, because that path
 * is what decides the owning module and whether the file is scanned at all. The
 * one test that reads the real tree derives its root from `import.meta.url`: an
 * absolute path baked into a test passes on the machine it was written on and
 * fails in CI.
 */

const BARE_IN_SERVICE = `
export class LowStockAlertService {
  attach(eventBus: EventBus): void {
    eventBus.on('inventory.adjusted.v1', (payload) => {
      void this.handleAdjusted(payload as AdjustedPayload);
    });
  }
}
`;

function tree(service: string): Map<string, string> {
  return new Map([
    ['modules/inventory/backend.ts', 'export function registerModule(ctx) {}'],
    ['modules/inventory/services/low-stock-alert-service.ts', service],
  ]);
}

describe('findBareSubscriptions — the spellings it has to see', () => {
  it('sees a bare subscription in a module service', () => {
    const found = findBareSubscriptions({ sources: tree(BARE_IN_SERVICE) });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      moduleId: 'inventory',
      event: 'inventory.adjusted.v1',
      file: 'modules/inventory/services/low-stock-alert-service.ts',
    });
  });

  it('sees it through an options object and an optional call', () => {
    const sources = new Map([
      [
        'modules/shopping_lists/plugin.ts',
        "options.eventBus?.on('customer_account.created.v1', async (p) => { await svc.ensureDefault(p); });",
      ],
    ]);
    expect(findBareSubscriptions({ sources }).map((f) => f.event)).toEqual([
      'customer_account.created.v1',
    ]);
  });

  it('sees it through a cast — the spelling `catalog` used', () => {
    const sources = new Map([
      [
        'modules/catalog/plugin.ts',
        "const off = (options.eventBus as CategoryEventBus).on('category.updated.v1', () => {});",
      ],
    ]);
    expect(findBareSubscriptions({ sources }).map((f) => f.moduleId)).toEqual(['catalog']);
  });

  it('sees a subscription whose event name is a variable', () => {
    const sources = new Map([
      [
        'modules/webhooks/services/event-bridge.ts',
        'const unsubs = types.map((eventType) => opts.eventBus.on(eventType, handler(eventType)));',
      ],
    ]);
    expect(findBareSubscriptions({ sources }).map((f) => f.event)).toEqual(['<dynamic>']);
  });

  it('accepts the same handler once it is registered through ctx.subscribe', () => {
    const sources = new Map([
      [
        'modules/inventory/backend.ts',
        "ctx.subscribe('inventory.adjusted.v1', (p) => cradle().lowStock.handleAdjusted(p));",
      ],
      [
        'modules/inventory/services/low-stock-alert-service.ts',
        'export class LowStockAlertService { async handleAdjusted(p: unknown) {} }',
      ],
    ]);
    expect(findBareSubscriptions({ sources })).toHaveLength(0);
  });

  it('leaves the kernel alone — it composes before the modules and is never off', () => {
    const sources = new Map([
      [
        'kernel/settings/settings-cache-invalidator.ts',
        "const offValue = eventBus.on('settings.value_changed', async (p) => cache.invalidate(p));",
      ],
    ]);
    expect(findBareSubscriptions({ sources })).toHaveLength(0);
  });

  it('does not read a BullMQ worker or a Redis client as a bus', () => {
    const sources = new Map([
      [
        'modules/pwa/services/push-delivery-queue.ts',
        "worker.on('completed', (job) => log(job));\n" +
          "subscriber.on('message', (channel, message) => apply(message));\n" +
          "res.on('data', (chunk) => chunks.push(chunk));",
      ],
    ]);
    expect(findBareSubscriptions({ sources })).toHaveLength(0);
  });

  it('scans overlay modules too — they are ordinary lifecycle participants', () => {
    const sources = new Map([
      [
        'apps/acme/modules/loyalty/plugin.ts',
        "eventBus.on('order.created.v1', async (p) => { await award(p); });",
      ],
    ]);
    expect(findBareSubscriptions({ sources }).map((f) => f.moduleId)).toEqual(['loyalty']);
  });
});

describe('checkSubscribeSeam — the two-way ratchet', () => {
  it('fails on an unledgered bare subscription', () => {
    const result = checkSubscribeSeam({ sources: tree(BARE_IN_SERVICE) }, {});
    expect(result.violations).toHaveLength(1);
    expect(result.stale).toHaveLength(0);
  });

  it('passes when the site is ledgered with a reason', () => {
    const key = 'modules/inventory/services/low-stock-alert-service.ts:inventory.adjusted.v1';
    const result = checkSubscribeSeam({ sources: tree(BARE_IN_SERVICE) }, { [key]: 'a reason' });
    expect(result.violations).toHaveLength(0);
    expect(result.ledgered.map(keyOf)).toEqual([key]);
  });

  it('fails on a ledger entry that no longer describes a bare subscription', () => {
    const key = 'modules/inventory/services/low-stock-alert-service.ts:inventory.adjusted.v1';
    const fixed = 'export class LowStockAlertService { async handleAdjusted(p: unknown) {} }';
    const result = checkSubscribeSeam({ sources: tree(fixed) }, { [key]: 'stale now' });
    expect(result.violations).toHaveLength(0);
    expect(result.stale).toEqual([key]);
  });
});

describe('the tree itself', () => {
  it('has no bare subscription left, and an empty ledger', () => {
    const srcRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', 'src');
    const sources = readTree(srcRoot);
    expect(sources.size, 'no sources found — a vacuous pass').toBeGreaterThan(100);
    const result = checkSubscribeSeam({ sources }, BARE_SUBSCRIPTIONS_TO_DRAIN);
    expect(result.violations.map((v) => `${v.file}:${v.event}`)).toEqual([]);
    expect(result.stale).toEqual([]);
    expect(Object.keys(BARE_SUBSCRIPTIONS_TO_DRAIN)).toEqual([]);
  });
});

function readTree(root: string): Map<string, string> {
  const sources = new Map<string, string>();
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === 'node_modules' || name === 'dist') continue;
        walk(full, `${prefix}${name}/`);
      } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
        sources.set(`${prefix}${name}`, readFileSync(full, 'utf8'));
      }
    }
  };
  walk(root, '');
  return sources;
}
