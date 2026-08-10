/**
 * On-demand cache revalidation endpoint (feature 049).
 *
 * The backend calls this same-origin Route Handler when data behind a tagged
 * fetch changes (e.g. Google Analytics config / custom events → `ga:config`),
 * so the storefront reflects admin changes immediately instead of waiting for
 * the time-based `revalidate` window. Secured by a shared secret
 * (`REVALIDATE_SECRET`); when the secret is unset the endpoint is disabled.
 *
 * Feature 073 rides this untouched. The handler forwards whatever tags it is
 * given, so `modules:presence` — the tag on the storefront's effective
 * enabled-set — needs no new infrastructure and no allow-list entry: the
 * activation Command posts it right after the flip commits, and the very next
 * storefront request resolves a fresh projection with no rebuild and no cache
 * flush (FR-036). No TTL is shortened, so no page gets slower for it.
 */

import { revalidateTag } from 'next/cache';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const secret = process.env['REVALIDATE_SECRET'];
  if (!secret || request.headers.get('x-revalidate-secret') !== secret) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: { tags?: unknown };
  try {
    body = (await request.json()) as { tags?: unknown };
  } catch {
    return Response.json({ error: 'invalid_body' }, { status: 400 });
  }

  const tags = Array.isArray(body.tags)
    ? body.tags.filter((t): t is string => typeof t === 'string')
    : [];
  for (const tag of tags) revalidateTag(tag);

  return Response.json({ revalidated: true, tags });
}
