import { afterEach, describe, expect, it, vi } from 'vitest';
import { GOOGLE_TAG_MANAGER_SETTING_CODES } from '@b2b/contracts';
import { googleTagManagerModule } from './plugin.js';
import type { SettingsService } from '../settings/services/settings.service.js';

/**
 * FR-009 — a configuration change must reach the storefront without waiting for
 * the 300 s cache TTL. The module subscribes to `settings.value_changed` and
 * revalidates the `gtm:config` tag for its own codes only; a neighbouring
 * module's setting must not invalidate this module's cache.
 */

const settings = {} as unknown as SettingsService;

/** The spy's own signature is irrelevant here; only the recorded calls matter. */
type FetchSpy = ReturnType<typeof vi.fn>;

function spyOnFetch(): FetchSpy {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(null, { status: 200 })) as unknown as FetchSpy;
}

function buildWithSubscription(): {
  notify: (settingCode: string) => void;
  fetchSpy: FetchSpy;
} {
  const fetchSpy = spyOnFetch();
  let handler: ((settingCode: string) => void) | undefined;
  googleTagManagerModule({
    settings,
    storefrontBaseUrl: 'http://storefront:3010',
    revalidateSecret: 'sekret',
    onSettingChanged: (h) => {
      handler = h;
    },
  });
  if (!handler) throw new Error('the module did not subscribe to setting changes');
  return { notify: handler, fetchSpy };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('googleTagManagerModule cache invalidation', () => {
  it('revalidates the gtm:config tag when one of its own settings changes', () => {
    const { notify, fetchSpy } = buildWithSubscription();

    notify(GOOGLE_TAG_MANAGER_SETTING_CODES.CONTAINER_ID);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]! as [unknown, RequestInit];
    expect(String(url)).toBe('http://storefront:3010/api/revalidate');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-revalidate-secret']).toBe('sekret');
    expect(JSON.parse(init.body as string)).toEqual({ tags: ['gtm:config'] });
  });

  it('revalidates for every google_tag_manager.* code', () => {
    const { notify, fetchSpy } = buildWithSubscription();
    for (const code of Object.values(GOOGLE_TAG_MANAGER_SETTING_CODES)) notify(code);
    expect(fetchSpy).toHaveBeenCalledTimes(
      Object.values(GOOGLE_TAG_MANAGER_SETTING_CODES).length,
    );
  });

  it('ignores another module\'s setting change', () => {
    const { notify, fetchSpy } = buildWithSubscription();

    notify('meta_ads.pixel_id');
    notify('google_analytics.measurement_id');
    // A prefix that merely starts the same must not match either.
    notify('google_tag_managers.enabled');

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('stays a no-op when the storefront revalidate endpoint is not configured', () => {
    const fetchSpy = spyOnFetch();
    let handler: ((settingCode: string) => void) | undefined;
    googleTagManagerModule({
      settings,
      onSettingChanged: (h) => {
        handler = h;
      },
    });
    handler?.(GOOGLE_TAG_MANAGER_SETTING_CODES.ENABLED);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
