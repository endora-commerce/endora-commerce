'use client';

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { Field } from '@measured/puck';
import { usePageBuilderPuck } from '@b2b/page-builder-core/editor';
import { apiClient } from '@/lib/api-client';
import { cmsClient } from '../api/cms-client';

const inputClassName = '_Input-input_bsxfo_26';

function FieldShell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium opacity-80">{label}</label>
      {children}
    </div>
  );
}

interface AdminProduct {
  id: string;
  slug: string;
  name: Record<string, string> | string;
  sku: string;
}

interface AdminCategory {
  id: string;
  parentCategoryId: string | null;
  name: Record<string, string>;
  slug: string;
}

function pickName(name: Record<string, string> | string, fallback: string): string {
  if (typeof name === 'string') return name || fallback;
  return name['pl-PL'] ?? name['en-US'] ?? Object.values(name)[0] ?? fallback;
}

function flattenCategories(categories: AdminCategory[], depth = 0): { slug: string; label: string }[] {
  const byParent = new Map<string | null, AdminCategory[]>();
  for (const cat of categories) {
    const key = cat.parentCategoryId;
    const list = byParent.get(key) ?? [];
    list.push(cat);
    byParent.set(key, list);
  }
  const walk = (parentId: string | null, level: number): { slug: string; label: string }[] => {
    const nodes = byParent.get(parentId) ?? [];
    return nodes.flatMap((cat) => {
      const prefix = level > 0 ? `${'—'.repeat(level)} ` : '';
      return [
        { slug: cat.slug, label: `${prefix}${pickName(cat.name, cat.slug)}` },
        ...walk(cat.id, level + 1),
      ];
    });
  };
  return walk(null, depth);
}

function LinkSlugFieldControl({
  value,
  onChange,
  readOnly,
  label,
  linkTypeProp = 'linkType',
}: {
  value: string | undefined;
  onChange: (value: string) => void;
  readOnly?: boolean;
  label: string;
  linkTypeProp?: string;
}): ReactElement {
  const linkType = usePageBuilderPuck((s) => {
    const props = s.selectedItem?.props as Record<string, unknown> | undefined;
    const raw = props?.[linkTypeProp];
    return typeof raw === 'string' ? raw : 'url';
  });
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [categories, setCategories] = useState<{ slug: string; label: string }[]>([]);
  const [pages, setPages] = useState<{ slug: string; label: string }[]>([]);
  const [loading, setLoading] = useState(false);

  const loadProducts = useCallback(async (q: string): Promise<void> => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('pageSize', '20');
      params.set('page', '0');
      if (q.trim()) params.set('q', q.trim());
      const res = await apiClient.get<{ data: AdminProduct[] }>(
        `/api/v1/admin/catalog/products?${params.toString()}`,
      );
      setProducts(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (linkType !== 'product') return;
    const id = window.setTimeout(() => void loadProducts(query), 300);
    return (): void => window.clearTimeout(id);
  }, [linkType, query, loadProducts]);

  useEffect(() => {
    if (linkType !== 'category') return;
    let cancelled = false;
    void (async (): Promise<void> => {
      setLoading(true);
      try {
        const res = await apiClient.get<{ data: AdminCategory[] }>('/api/v1/admin/catalog/categories');
        if (!cancelled) setCategories(flattenCategories(res.data));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [linkType]);

  useEffect(() => {
    if (linkType !== 'page') return;
    let cancelled = false;
    void (async (): Promise<void> => {
      setLoading(true);
      try {
        const res = await cmsClient.listPages({ limit: 100 });
        if (!cancelled) {
          setPages(res.data.map((p) => ({ slug: p.slug, label: `${p.name} (/${p.slug})` })));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [linkType]);

  if (linkType === 'product') {
    return (
      <FieldShell label={label}>
        <div className="space-y-2">
          <input
            type="text"
            className={inputClassName}
            readOnly={readOnly}
            value={query}
            placeholder="Search products…"
            onChange={(e): void => setQuery(e.target.value)}
          />
          <select
            className={inputClassName}
            disabled={readOnly === true || loading}
            value={value ?? ''}
            onChange={(e): void => onChange(e.target.value)}
          >
            <option value="">— Select product —</option>
            {products.map((p) => (
              <option key={p.id} value={p.slug}>
                {pickName(p.name, p.sku)} ({p.slug})
              </option>
            ))}
          </select>
        </div>
      </FieldShell>
    );
  }

  if (linkType === 'category') {
    return (
      <FieldShell label={label}>
        <select
          className={inputClassName}
          disabled={readOnly === true || loading}
          value={value ?? ''}
          onChange={(e): void => onChange(e.target.value)}
        >
          <option value="">— Select category —</option>
          {categories.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.label}
            </option>
          ))}
        </select>
      </FieldShell>
    );
  }

  if (linkType === 'page') {
    return (
      <FieldShell label={label}>
        <select
          className={inputClassName}
          disabled={readOnly === true || loading}
          value={value ?? ''}
          onChange={(e): void => onChange(e.target.value)}
        >
          <option value="">— Select page —</option>
          {pages.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.label}
            </option>
          ))}
        </select>
      </FieldShell>
    );
  }

  return (
    <FieldShell label={label}>
      <input
        type="text"
        className={inputClassName}
        readOnly={readOnly}
        value={value ?? ''}
        onChange={(e): void => onChange(e.target.value)}
      />
    </FieldShell>
  );
}

export function createButtonLinkSlugField(options?: {
  label?: string;
  linkTypeProp?: string;
}): Field<string, Record<string, unknown>> {
  return {
    type: 'custom',
    label: options?.label ?? 'Link target',
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <LinkSlugFieldControl
        value={value}
        onChange={onChange}
        {...(readOnly === true ? { readOnly: true } : {})}
        label={field.label ?? options?.label ?? 'Link target'}
        linkTypeProp={options?.linkTypeProp ?? 'linkType'}
      />
    ),
  };
}
