// T004 — the dictionaries module exports the shape the kernel composes.
//
// This used to assert `dictionariesModule` returned `{ plugin, handle }` with a
// `validator` and a `reconcile`. Feature 072 (T112) replaced that factory with
// `registerModule(ctx)`, so the contract worth pinning changed with it: the
// module now *registers* its validator rather than handing one back, and the
// seed reconciler runs from a boot hook rather than from a handle a caller
// remembers to call.
//
// `reconcile()` behaviour is exercised end-to-end in
// `test/integration/dictionaries/seed.idempotent.test.ts` (T010), which calls
// `runDictionarySeedReconciler` directly now that no handle wraps it.

import { asValue } from 'awilix';
import { describe, it, expect } from 'vitest';
import { createRootContainer } from '@endora-commerce/platform/composition';
import {
  createModuleContext,
  createModuleRegistrationSink,
} from '@endora-commerce/platform/composition';
import { EventBus } from '@endora-commerce/platform/events';
import { registerModule } from '../../../../packages/modules/dictionaries/src/backend/index.js';

describe('dictionaries — what the module registers', () => {
  it('provides the validator port and a boot hook, and subscribes to every announcement it caches for', () => {
    const container = createRootContainer();
    container.register({
      emFactory: asValue(() => ({}) as never),
      auditLogService: asValue({} as never),
      redis: asValue(undefined),
    });
    const sink = createModuleRegistrationSink();
    const ctx = createModuleContext({
      module: { id: 'dictionaries', version: '1.0.0' },
      container,
      eventBus: new EventBus(),
      sink,
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });

    registerModule(ctx);

    expect(container.hasRegistration('dictionaryValidator')).toBe(true);
    expect(container.hasRegistration('dictionaryInvalidator')).toBe(true);
    // `countryReferenceRegistry` — the ungated contribution seam four modules
    // push their "who still points at this country" descriptors into, and the
    // orphan report reads. A plain registration on purpose: a contributor
    // resolves it from a boot hook, and a boot hook that asked a transient gate
    // would stop the backend from starting whenever this module was off.
    expect(container.hasRegistration('countryReferenceRegistry')).toBe(true);
    // Two boot hooks, and the split is the point (D-62/D-68): one **contributes**
    // this module's `countries.default_currency_code` descriptor to `currencies`
    // and must run whatever this module's state, the other **works** — it seeds
    // the ISO reference data. A single mixed hook cannot answer both, which is
    // why `blog`, `cms` and `product_feeds` all ship the same pair.
    expect(sink.bootHooks).toHaveLength(2);
    // `currencies.changed` and `languages.changed` — the two announcements that
    // make this module drop its own caches. They used to be subscribed by each
    // composition root reaching into this module's handle.
    //
    // Issue #101 added the two sales-channel announcements. The registry is
    // scoped to a channel — its languages, its currencies, its defaults — so a
    // channel write invalidates this cache exactly as a currency write does,
    // and nothing was subscribed to say so.
    expect(sink.unsubscribes).toHaveLength(4);
  });
});
