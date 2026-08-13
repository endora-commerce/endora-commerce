import { asValue } from 'awilix';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GOOGLE_TAG_MANAGER_SETTING_CODES } from '@b2b/contracts';
import {
  createModuleContext,
  createModuleRegistrationSink,
  createRootContainer,
} from '../../kernel/index.js';
import { EventBus } from '../../events/bus.js';
import { registryCache } from '../_lifecycle/services/registry-cache.js';
import type { SettingsService } from '../../kernel/settings/settings.service.js';
import { registerModule } from './backend.js';

/**
 * FR-009 — a configuration change must reach the storefront without waiting for
 * the 300 s cache TTL. This module subscribes to `settings.value_changed` and
 * revalidates the `gtm:config` tag for its own codes only; a neighbouring
 * module's setting must not invalidate this module's cache.
 *
 * Feature 072 (T103) moved the subscription from an `onSettingChanged` option a
 * root supplied into `ctx.subscribe`, so this test moves with it — same
 * assertions, driven through the EventBus the module now subscribes to rather
 * than through a callback the caller handed it.
 *
 * The last case is new and is the reason the conversion happened: the module's
 * subscription is `subscribeForModule`, so it stops when the module is off. It
 * used to be a bare `eventBus.on` and kept POSTing to the storefront no matter
 * what the operator had switched off.
 */

const MODULE_ID = 'google_tag_manager';

type FetchSpy = ReturnType<typeof vi.fn>;

function spyOnFetch(): FetchSpy {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(null, { status: 200 })) as unknown as FetchSpy;
}

function build(env: { storefront?: string; secret?: string } = {}): {
  emit: (settingCode: string) => void;
  fetchSpy: FetchSpy;
} {
  if (env.storefront === undefined) delete process.env['STOREFRONT_BASE_URL'];
  else process.env['STOREFRONT_BASE_URL'] = env.storefront;
  if (env.secret === undefined) delete process.env['REVALIDATE_SECRET'];
  else process.env['REVALIDATE_SECRET'] = env.secret;

  const fetchSpy = spyOnFetch();
  const container = createRootContainer();
  container.register({
    settingsReadPort: asValue({} as unknown as SettingsService),
    // No queue in this composition — the same statement the harness makes.
    moduleQueueRedis: asValue(undefined),
  });
  const bus = new EventBus();
  const ctx = createModuleContext({
    module: { id: MODULE_ID, version: '1.0.0' },
    container,
    eventBus: bus,
    sink: createModuleRegistrationSink(),
    log: { info: () => {}, warn: () => {}, error: () => {} },
  });
  registerModule(ctx);

  // The environment stays as set until `afterEach`: the module reads it when
  // its services are first resolved, and that happens on the first event below,
  // not during `registerModule`.
  return {
    emit: (settingCode) =>
      bus.emit('settings.value_changed', { settingCode } as never),
    fetchSpy,
  };
}

const ORIGINAL_ENV = {
  url: process.env['STOREFRONT_BASE_URL'],
  secret: process.env['REVALIDATE_SECRET'],
};

afterEach(() => {
  vi.restoreAllMocks();
  registryCache.__setEnabledForTesting([]);
  if (ORIGINAL_ENV.url === undefined) delete process.env['STOREFRONT_BASE_URL'];
  else process.env['STOREFRONT_BASE_URL'] = ORIGINAL_ENV.url;
  if (ORIGINAL_ENV.secret === undefined) delete process.env['REVALIDATE_SECRET'];
  else process.env['REVALIDATE_SECRET'] = ORIGINAL_ENV.secret;
});

describe('google_tag_manager cache invalidation', () => {
  it('revalidates the gtm:config tag when one of its own settings changes', async () => {
    registryCache.__setEnabledForTesting([MODULE_ID]);
    const { emit, fetchSpy } = build({ storefront: 'http://storefront:3010', secret: 'sekret' });

    emit(GOOGLE_TAG_MANAGER_SETTING_CODES.CONTAINER_ID);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]! as [unknown, RequestInit];
    expect(String(url)).toBe('http://storefront:3010/api/revalidate');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-revalidate-secret']).toBe('sekret');
    expect(JSON.parse(init.body as string)).toEqual({ tags: ['gtm:config'] });
  });

  it("ignores another module's setting change", async () => {
    registryCache.__setEnabledForTesting([MODULE_ID]);
    const { emit, fetchSpy } = build({ storefront: 'http://storefront:3010', secret: 'sekret' });

    emit('meta_ads.pixel_id');
    emit('google_analytics.measurement_id');
    // A prefix that merely starts the same must not match either.
    emit('google_tag_managers.enabled');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('stays a no-op when the storefront revalidate endpoint is not configured', async () => {
    registryCache.__setEnabledForTesting([MODULE_ID]);
    const { emit, fetchSpy } = build();

    emit(GOOGLE_TAG_MANAGER_SETTING_CODES.ENABLED);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not reach the storefront at all while the module is off', async () => {
    // The whole point of the conversion. Before it, this subscription was a
    // bare `eventBus.on` and fired regardless of the operator's choice.
    registryCache.__setEnabledForTesting([]);
    const { emit, fetchSpy } = build({ storefront: 'http://storefront:3010', secret: 'sekret' });

    emit(GOOGLE_TAG_MANAGER_SETTING_CODES.CONTAINER_ID);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
