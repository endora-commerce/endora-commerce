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
import {
  createModuleContext,
  createModuleRegistrationSink,
  createRootContainer,
} from '../../../src/kernel/index.js';
import { EventBus } from '../../../src/events/bus.js';
import { registerModule } from '../../../src/modules/dictionaries/backend.js';

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
    // The seed reconciler moved off the handle and onto the boot hook, so it
    // runs whether or not a composition root remembers it.
    expect(sink.bootHooks).toHaveLength(1);
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
