import { afterEach, describe, expect, it } from 'vitest';
import type { MfaLoginPort } from '@b2b/contracts';
import { EventBus } from '../../../src/events/bus.js';
import { createRootContainer } from '../../../src/kernel/container.js';
import { lazyPort } from '../../../src/kernel/index.js';
import { effectiveState } from '../../../src/kernel/lifecycle/effective-state.js';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import {
  createModuleContext,
  createModuleRegistrationSink,
  type ModuleContext,
} from '../../../src/kernel/module-context.js';

/**
 * The mechanism D-96.2 rules, pinned apart from its effect.
 *
 * `test/integration/mfa/off-state.test.ts` proves the *outcome* — a login
 * succeeds on the password alone while `mfa` is off. This proves **how**, and
 * the distinction is the whole ruling: the consumer decides presence and never
 * resolves, rather than resolving and catching what the gate throws. Both shapes
 * produce a password-only login; only one of them is a declared degrade, and
 * only one keeps `check:port-catches` honest.
 *
 * So there are two assertions, and the second is the one with teeth:
 *
 *  1. with `mfa` absent, the getter each consumer builds returns `undefined`
 *     and **does not throw**;
 *  2. resolving the same port *without* the probe throws `ModuleDisabledError`
 *     — which is what a `catch` would have swallowed, and what the platform
 *     answered on every login before this merge request.
 */

const OWNER = 'mfa';
const CONSUMER = 'admin_users';

function contextFor(moduleId: string, container = createRootContainer()): ModuleContext {
  return createModuleContext({
    module: { id: moduleId, version: '1.0.0' },
    container,
    eventBus: new EventBus(),
    sink: createModuleRegistrationSink(),
    log: { info: () => {}, warn: () => {}, error: () => {} },
  });
}

/** A composition with `mfa`'s gated port published, as its `backend.ts` does. */
function compose(): { consumerCtx: ModuleContext } {
  const container = createRootContainer();
  const ownerCtx = contextFor(OWNER, container);
  const port: MfaLoginPort = {
    beginLogin: async () => ({ kind: 'challenge', challengeId: 'ch-1' }),
  };
  ownerCtx.di.providePort('mfaLoginPort', ownerCtx.asFunction(() => port).transient());
  return { consumerCtx: contextFor(CONSUMER, container) };
}

afterEach(() => {
  registryCache.__setEnabledForTesting([]);
});

describe('the consumer degrades by not resolving (D-96.2)', () => {
  it('returns undefined, without throwing, while mfa is off', () => {
    const { consumerCtx } = compose();
    const mfaLoginPort = lazyPort<MfaLoginPort>(consumerCtx, 'mfaLoginPort');
    // The line both `admin_users/backend.ts` and `customer_accounts/backend.ts`
    // hand their auth service.
    const getMfaLoginPort = (): MfaLoginPort | undefined =>
      effectiveState.isPresent(OWNER) ? mfaLoginPort : undefined;

    registryCache.__setEnabledForTesting([OWNER, CONSUMER]);
    expect(getMfaLoginPort()).toBeDefined();

    registryCache.__setEnabledForTesting([OWNER, CONSUMER], { deactivated: [OWNER] });
    expect(getMfaLoginPort()).toBeUndefined();
  });

  it('and the gate it declined to open really does throw', () => {
    const { consumerCtx } = compose();
    const mfaLoginPort = lazyPort<MfaLoginPort>(consumerCtx, 'mfaLoginPort');

    registryCache.__setEnabledForTesting([OWNER, CONSUMER], { deactivated: [OWNER] });
    // Synchronously, at resolution — before any promise exists to reject. A
    // `catch` around the call site is what would have turned this into a
    // fail-open degrade, which is why `check:port-catches` refuses one.
    expect(() =>
      mfaLoginPort.beginLogin(
        { subjectType: 'admin', subjectId: 'a-1' },
        { salesChannelId: null },
      ),
    ).toThrow(ModuleDisabledError);
  });
});
