import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CMS_CONTENT_CHANGED_EVENT,
  MEGAMENU_STOREFRONT_CACHE_TAG,
  type CmsContentChange,
} from '@endora-commerce/contracts';
import { composeModuleForTest, type ComposedModule } from '@endora-commerce/test-kit/module';
import { registerModule } from './index.js';

/**
 * A menu payload inlines CMS content — an embedded block's tree, a linked
 * page's slug — and is cached twice, in this module's Redis cache and in the
 * storefront's Data Cache. Neither can learn the content moved except from
 * `cms`, which publishes `cms.content_changed.v1`.
 *
 * This file holds what `megamenu` does with that event: drop its Redis
 * entries, *then* post its tag at the storefront, for the two kinds of content
 * a menu can hold — and nothing at all while the module is off (Constitution
 * XVII). The end-to-end reading, through a real block save, is the host's
 * `backend/test/integration/cms/storefront-revalidation.test.ts`.
 */

const MODULE_ID = 'megamenu';

/** Every composition a case made; `afterEach` disposes them, presence included. */
const composed: ComposedModule[] = [];

function build(present: boolean): {
  emit: (change: CmsContentChange) => void;
  log: string[];
} {
  process.env['STOREFRONT_BASE_URL'] = 'http://storefront:3010';
  process.env['REVALIDATE_SECRET'] = 'sekret';

  const log: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const { tags } = JSON.parse(String(init?.body)) as { tags: string[] };
    log.push(`post:${tags.join(',')}`);
    return new Response(null, { status: 200 });
  });

  // The two commands `MegamenuCache.invalidateAll` issues, and nothing else.
  const redis = {
    scan: async (_cursor: string, _match: string, pattern: string) => {
      log.push(`scan:${pattern}`);
      return ['0', ['megamenu:v2:default:en-US']];
    },
    del: async (...keys: string[]) => {
      log.push(`del:${keys.join(',')}`);
      return keys.length;
    },
  };

  const handle = composeModuleForTest({
    module: { id: MODULE_ID, registerModule },
    values: {
      emFactory: () => {
        throw new Error('the subscription must not open a database connection');
      },
      // Every menu write runs on the bus since feature 168; the subscription writes nothing.
      commandBus: {
        run: () => {
          throw new Error('the subscription must not run a command');
        },
      },
      redis,
    },
  });
  handle.registryCache.setEnabled(present ? [MODULE_ID] : []);
  composed.push(handle);
  const bus = handle.eventBus;

  return {
    emit: (change) =>
      bus.emit(CMS_CONTENT_CHANGED_EVENT, {
        eventId: 'e-1',
        occurredAt: new Date().toISOString(),
        ...change,
      } as never),
    log,
  };
}

const ORIGINAL_ENV = {
  url: process.env['STOREFRONT_BASE_URL'],
  secret: process.env['REVALIDATE_SECRET'],
};

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

afterEach(() => {
  vi.restoreAllMocks();
  for (const handle of composed.splice(0)) handle.dispose();
  if (ORIGINAL_ENV.url === undefined) delete process.env['STOREFRONT_BASE_URL'];
  else process.env['STOREFRONT_BASE_URL'] = ORIGINAL_ENV.url;
  if (ORIGINAL_ENV.secret === undefined) delete process.env['REVALIDATE_SECRET'];
  else process.env['REVALIDATE_SECRET'] = ORIGINAL_ENV.secret;
});

describe('megamenu follows CMS content changes', () => {
  it.each<[string, CmsContentChange]>([
    ['a block a panel may embed', { kind: 'block', codes: ['hero'] }],
    ['a page an item may link to', { kind: 'page', slugs: ['about'] }],
  ])('drops its Redis entries, then revalidates its tag, for %s', async (_name, change) => {
    const { emit, log } = build(true);

    emit(change);
    await settle();

    expect(log).toEqual([
      'scan:megamenu:v2:*',
      'del:megamenu:v2:default:en-US',
      `post:${MEGAMENU_STOREFRONT_CACHE_TAG}`,
    ]);
  });

  it.each<[string, CmsContentChange]>([
    ['a template', { kind: 'template' }],
    ['a hook', { kind: 'hook', codes: ['home.top'] }],
  ])('ignores %s — neither is in a menu payload', async (_name, change) => {
    const { emit, log } = build(true);

    emit(change);
    await settle();

    expect(log).toEqual([]);
  });

  it('does nothing while the module is off', async () => {
    const { emit, log } = build(false);

    emit({ kind: 'block', codes: ['hero'] });
    await settle();

    expect(log).toEqual([]);
  });
});
