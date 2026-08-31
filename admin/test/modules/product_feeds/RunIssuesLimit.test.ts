import { describe, expect, it, vi, beforeEach } from 'vitest';
import { listQuerySchema } from '@endora-commerce/contracts';

/**
 * The run-detail page loads the feed, the run and its issues in one
 * `Promise.all`, so a rejection on any leg leaves `feed` and `run` null and the
 * page renders nothing but the error. Asking for more rows than the shared
 * pagination contract allows therefore did not degrade the issue list — it hid
 * the entire run, including whether the artefact had been produced at all.
 *
 * `listQuerySchema` is the platform-wide ceiling every list endpoint inherits,
 * so it is the authority this test measures against rather than a copy of the
 * number.
 */

const get = vi.fn();

/**
 * **The client is `@endora-commerce/mod-product-feeds`' since feature 091's
 * Phase 4 (the plan's batch 7)**, so the module it takes `apiClient` from is
 * `@endora-commerce/admin-kit/lib` rather than `@/lib/api-client`, which is a
 * re-export shim the packaged file never names. The factory is spread over
 * `vi.importActual` because the same barrel also carries `apiBaseUrl`, which
 * `api.ts` reads at module scope for its download anchors — a bare factory
 * would delete every binding it does not name.
 */
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (url: string): Promise<unknown> => get(url),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
    ApiError: class extends Error {},
  };
});

const { productFeedsClient, RUN_ISSUE_PAGE_LIMIT } = await import(
  '../../../../packages/modules/product_feeds/src/admin/api'
);

/** The `limit` of the client's only request, as the server would read it. */
function requestedLimit(): number {
  const url = get.mock.calls[0]?.[0];
  expect(typeof url).toBe('string');
  const value = new URLSearchParams(String(url).split('?')[1] ?? '').get('limit');
  expect(value).not.toBeNull();
  return Number(value);
}

describe('run issue paging respects the shared list contract', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue({ data: [] });
  });

  it('requests a limit the server will accept', async () => {
    await productFeedsClient.listRunIssues('feed-1', 'run-1');
    const parsed = listQuerySchema.safeParse({ limit: requestedLimit() });
    expect(parsed.success).toBe(true);
  });

  it('asks for the full page the contract allows, not less', async () => {
    // Under-fetching is its own defect: every row not fetched is a problem the
    // operator cannot see, and the page has no second page to reach for.
    await productFeedsClient.listRunIssues('feed-1', 'run-1');
    expect(requestedLimit()).toBe(listQuerySchema.parse({ limit: 200 }).limit);
  });

  it('exports the page size so the page can tell a truncated list from a short one', () => {
    expect(RUN_ISSUE_PAGE_LIMIT).toBe(200);
  });

  it('still honours an explicit caller-supplied limit', async () => {
    await productFeedsClient.listRunIssues('feed-1', 'run-1', 25);
    expect(requestedLimit()).toBe(25);
  });
});
