/**
 * On-demand cache revalidation endpoint (feature 049).
 *
 * The backend calls this same-origin Route Handler when data behind a tagged
 * fetch changes (e.g. Google Analytics config / custom events → `ga:config`),
 * so the storefront reflects admin changes immediately instead of waiting for
 * the time-based `revalidate` window. Secured by a shared secret
 * (`REVALIDATE_SECRET`); when the secret is unset the endpoint is disabled.
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
