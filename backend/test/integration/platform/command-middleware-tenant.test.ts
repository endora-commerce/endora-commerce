import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
import { enterPlatformScope } from '../../../src/kernel/scope.js';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import {
  commandMiddlewareFixtureObserved,
  type CommandMiddlewareFixtureRecord,
} from '../../../src/apps/example/modules/command_middleware_fixture/backend.js';

/**
 * `specs/189-command-middleware/` T023 (FR-024) — an `observe` command
 * middleware runs in the run's ambient tenant context, and the platform never
 * widens it for the observer.
 *
 * On the composed `example` platform, a Command is run under a context pinned
 * to one Organization (`single-org`), with a request id carrying the fixture's
 * marker. The fixture's `record-marked` observer keeps the context it was
 * called in, which this file reads after the caller has its answer: it must be
 * that Organization's, never `system` or `all`.
 */

describe('observe runs in the caller’s tenant context (189 T023)', () => {
  let h: BackendServerHandle;
  const stamp = Date.now().toString().slice(-8);

  beforeAll(async () => {
    h = await setupBackendServer({ deployment: 'example' });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const probe: Command<string> = {
    action: 'organization.middleware_probe',
    objectType: 'organization',
    objectId: `probe-${stamp}`,
    async run() {
      return { result: 'ok', skipAudit: true };
    },
  };

  function recordFor(requestId: string): CommandMiddlewareFixtureRecord | undefined {
    return commandMiddlewareFixtureObserved().find((record) => record.outcome.root.requestMeta.requestId === requestId);
  }

  it('observes under the single-org context the Command ran in', async () => {
    const bus = (h.container.cradle as unknown as { commandBus: CommandBus }).commandBus;
    const requestId = `cmdmw-tenant-${stamp}`;
    const organizationId = '00000000-0000-4000-8000-000000000189';
    const result = await enterPlatformScope(
      { mode: 'single-org', organizationId, actor: { kind: 'customer', id: 'customer-189' }, customerAccountId: 'customer-189' },
      () => bus.run(probe),
      { requestMeta: { requestId, ipAddress: '203.0.113.9', userAgent: 'integration' }, container: h.container },
    );
    expect(result).toBe('ok');
    await vi.waitFor(() => expect(recordFor(requestId)).toBeDefined(), { timeout: 5000 });
    const record = recordFor(requestId)!;
    expect(record.tenant).toEqual({ mode: 'single-org', organizationId });
    expect(record.outcome).toMatchObject({ committed: true, root: { organizationId, action: 'organization.middleware_probe' } });
  });
});
