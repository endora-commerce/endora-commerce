import { afterEach, describe, expect, it } from 'vitest';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import {
  presenceAwareRecorder,
  type AdminNotificationInput,
} from '../../../../packages/modules/product_feeds/src/backend/services/failed-run-notifier.js';

/**
 * D-60 — `admin_notifications` off is an **answer**, not an exception.
 *
 * All three failed-run notifiers in this tree used to wrap the bell write in a
 * `catch` and report `false`, which fused two facts an operator has to be able
 * to tell apart: "I switched notifications off" and "the notification could not
 * be written". The repair is the shape AGENTS.md gives as the worked example —
 * the degrade lives in the return type — and the decision is taken in front of
 * the gate, because a closed gate throws rather than answering.
 *
 * Two things are asserted, and either alone passes for the wrong reason: the
 * answer, and that the port is **not reached** to produce it. A recorder that
 * called the port and mapped its throw would satisfy the first while leaving
 * the presence answer somewhere a `catch` could still swallow.
 */

const INPUT: AdminNotificationInput = {
  audience: 'all_admins',
  kind: 'product_feed.run_failed',
  title: 'Product feed "Google" failed to generate',
};

afterEach(() => {
  registryCache.__setEnabledForTesting([]);
});

describe('product_feeds — the admin-notification recorder decides presence (D-60)', () => {
  it('answers `not-present` without touching the port while the bell is off', async () => {
    let calls = 0;
    const recorder = presenceAwareRecorder({
      record: async () => {
        calls += 1;
      },
    });
    registryCache.__setEnabledForTesting(['product_feeds']);

    await expect(recorder.record(INPUT)).resolves.toBe('not-present');
    expect(calls).toBe(0);
  });

  it('records and says so once the module is present', async () => {
    const seen: AdminNotificationInput[] = [];
    const recorder = presenceAwareRecorder({
      record: async (input) => {
        seen.push(input);
      },
    });
    registryCache.__setEnabledForTesting(['product_feeds', 'admin_notifications']);

    await expect(recorder.record(INPUT)).resolves.toBe('recorded');
    expect(seen).toEqual([INPUT]);
  });
});
