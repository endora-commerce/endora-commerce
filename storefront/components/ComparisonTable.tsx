'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  clearCompare,
  readCompareSlugs,
  subscribeCompare,
  toggleCompare,
} from '../lib/compare/store';
import type { ProductDetail } from '@b2b/contracts';

/**
 * Comparison table rendered on `/compare`. Reads slugs from localStorage,
 * fetches each product through the public catalog endpoint, and renders
 * a side-by-side attribute matrix. All client-side — there is no server
 * state to keep in sync.
 */
export function ComparisonTable(props: { apiBaseUrl: string }): ReactNode {
  const [slugs, setSlugs] = useState<string[]>([]);
  const [products, setProducts] = useState<ProductDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const refresh = (): void => setSlugs(readCompareSlugs());
    refresh();
    return subscribeCompare(refresh);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (slugs.length === 0) {
      setProducts([]);
      return () => {
        cancelled = true;
      };
    }
    (async () => {
      try {
        const fetched = await Promise.all(
          slugs.map(async (slug) => {
            const res = await fetch(
              `${props.apiBaseUrl}/api/v1/catalog/products/${encodeURIComponent(slug)}`,
              { credentials: 'include' },
            );
            if (!res.ok) throw new Error(`HTTP ${res.status} for ${slug}`);
            const body = (await res.json()) as { data: ProductDetail };
            return body.data;
          }),
        );
        if (!cancelled) {
          setProducts(fetched);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load comparison.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slugs, props.apiBaseUrl]);

  const attributeKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const p of products ?? []) {
      Object.keys(p.attributeValues).forEach((k) => keys.add(k));
    }
    return Array.from(keys).sort();
  }, [products]);

  if (slugs.length === 0) {
    return (
      <p className="muted">
        Add up to four products from the catalog to compare them side by side.
      </p>
    );
  }
  if (error) return <div className="alert alert--error">{error}</div>;
  if (!products) return <p className="muted">Loading…</p>;

  return (
    <>
      <div className="toolbar">
        <button type="button" className="btn" onClick={(): void => clearCompare()}>
          Clear all
        </button>
      </div>
      <div className="b2b-compare">
        <table className="b2b-compare__table">
          <thead>
            <tr>
              <th></th>
              {products.map((p) => (
                <th key={p.id}>
                  <a href={`/p/${p.slug}`}>{p.name}</a>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">SKU</th>
              {products.map((p) => (
                <td key={p.id}>{p.sku}</td>
              ))}
            </tr>
            <tr>
              <th scope="row">Price</th>
              {products.map((p) => (
                <td key={p.id}>{p.price ? `${p.price.amount} ${p.price.currency}` : '—'}</td>
              ))}
            </tr>
            {attributeKeys.map((key) => (
              <tr key={key}>
                <th scope="row">{key}</th>
                {products.map((p) => (
                  <td key={p.id}>{String(p.attributeValues[key] ?? '—')}</td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row"></th>
              {products.map((p) => (
                <td key={p.id}>
                  <button
                    type="button"
                    className="btn"
                    onClick={(): void => {
                      toggleCompare(p.slug);
                    }}
                  >
                    Remove
                  </button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
