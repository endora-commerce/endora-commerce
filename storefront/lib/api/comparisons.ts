'use client';

import type {
  ComparisonOwnerView,
  ComparisonDisplayMode,
} from '@b2b/contracts';

/**
 * Client-side fetch helpers for the comparisons backend module
 * (feature 007 / T029). All functions run in the browser; cookies
 * (notably `compare_token`) are threaded automatically via
 * `credentials: 'include'`.
 *
 * The dev setup either shares a domain (reverse proxy) or accepts
 * cross-origin credentials — same setup the cart and account flows
 * already rely on.
 */

const apiBase =
  process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

export class ComparisonApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ComparisonApiError';
  }
}

interface ErrorEnvelope {
  error: { code: string; message: string };
}

async function call<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T | null> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${apiBase}${path}`, {
    method,
    credentials: 'include',
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    let envelope: ErrorEnvelope | undefined;
    try {
      envelope = (await res.json()) as ErrorEnvelope;
    } catch {
      // Non-JSON error — fall through.
    }
    throw new ComparisonApiError(
      res.status,
      envelope?.error.code ?? 'UNKNOWN',
      envelope?.error.message ?? `HTTP ${res.status}`,
    );
  }
  const json = (await res.json()) as { data: T };
  return json.data;
}

export async function getMyComparison(): Promise<ComparisonOwnerView | null> {
  return call<ComparisonOwnerView>('GET', '/api/v1/comparisons/me');
}

export async function addProductToCompare(
  productId: string,
): Promise<ComparisonOwnerView> {
  const view = await call<ComparisonOwnerView>(
    'POST',
    '/api/v1/comparisons/me/products',
    { productId },
  );
  if (!view) throw new Error('expected ComparisonOwnerView');
  return view;
}

export async function removeProductFromCompare(
  productId: string,
): Promise<ComparisonOwnerView> {
  const view = await call<ComparisonOwnerView>(
    'DELETE',
    `/api/v1/comparisons/me/products/${encodeURIComponent(productId)}`,
  );
  if (!view) throw new Error('expected ComparisonOwnerView');
  return view;
}

export async function setComparisonDisplayMode(
  mode: ComparisonDisplayMode,
): Promise<ComparisonOwnerView> {
  const view = await call<ComparisonOwnerView>('PATCH', '/api/v1/comparisons/me', {
    displayMode: mode,
  });
  if (!view) throw new Error('expected ComparisonOwnerView');
  return view;
}

export async function deleteMyComparison(): Promise<void> {
  await call('DELETE', '/api/v1/comparisons/me');
}
