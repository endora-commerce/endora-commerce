'use client';

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import type { Field } from '@measured/puck';
import { PB_DATA_METADATA } from '@endora-commerce/page-builder-core';
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { normalize } from '@/lib/text-normalization';

const inputClassName = '_Input-input_bsxfo_26';
/** Match shadcn Button `h-9` — Puck's input padding is taller by default. */
const pickerInputClassName = `${inputClassName} !box-border !h-9 !min-h-9 !py-0 !px-3 !text-sm leading-9`;
const pickerButtonClass = 'h-9 shrink-0 px-3';

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

/** Stable key so modal draft sync does not reset on new array identities each render. */
function slugsKey(slugs: string[]): string {
  return slugs.join('\0');
}

interface AdminProduct {
  id: string;
  slug: string;
  name: Record<string, string> | string;
  sku: string;
  status?: string;
}

interface AdminCategory {
  id: string;
  parentCategoryId: string | null;
  name: Record<string, string>;
  slug: string;
  sortOrder: number;
}

function pickName(name: Record<string, string> | string, fallback: string): string {
  if (typeof name === 'string') return name || fallback;
  return name['pl-PL'] ?? name['en-US'] ?? Object.values(name)[0] ?? fallback;
}

function flattenCategories(categories: AdminCategory[]): { slug: string; label: string }[] {
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
  return walk(null, 0);
}

function useCategoryOptions(): { categories: { slug: string; label: string }[]; loading: boolean } {
  const [categories, setCategories] = useState<{ slug: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
  }, []);

  return { categories, loading };
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}): ReactElement {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return (): void => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border bg-background shadow-lg"
        onClick={(e): void => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

function ProductSearchModal({
  open,
  selectedSlugs,
  multiple = true,
  onClose,
  onApply,
}: {
  open: boolean;
  selectedSlugs: string[];
  multiple?: boolean;
  onClose: () => void;
  onApply: (slugs: string[]) => void;
}): ReactElement | null {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'draft' | 'inactive'>('active');
  const [page, setPage] = useState(0);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<string[]>(selectedSlugs);
  const pageSize = 20;

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      if (query.trim()) params.set('q', query.trim());
      if (status !== 'all') params.set('status', status);
      const res = await apiClient.get<{
        data: AdminProduct[];
        pagination: { total: number };
      }>(`/api/v1/admin/catalog/products?${params.toString()}`);
      setProducts(res.data);
      setTotal(res.pagination.total);
    } finally {
      setLoading(false);
    }
  }, [page, query, status]);

  const selectedKey = slugsKey(selectedSlugs);

  useEffect(() => {
    if (!open) return;
    setDraft(selectedKey ? selectedKey.split('\0') : []);
    setPage(0);
  }, [open, selectedKey]);

  useEffect(() => {
    if (!open) return undefined;
    const id = window.setTimeout(() => void load(), 250);
    return (): void => window.clearTimeout(id);
  }, [open, load]);

  const toggle = (slug: string): void => {
    if (multiple) {
      setDraft((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));
      return;
    }
    // Single-select: apply immediately (same UX as asset picker).
    onApply([slug]);
    onClose();
  };

  if (!open) return null;

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <ModalShell title="Select products" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 opacity-50" />
            <input
              className={`${inputClassName} pl-8`}
              value={query}
              onChange={(e): void => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder="Search by name, SKU or slug…"
            />
          </div>
          <select
            className={inputClassName}
            value={status}
            onChange={(e): void => {
              setStatus(e.target.value as typeof status);
              setPage(0);
            }}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        <div className="rounded-md border">
          {loading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          ) : products.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No products found.</p>
          ) : (
            <ul className="divide-y">
              {products.map((product) => {
                const checked = draft.includes(product.slug);
                return (
                  <li key={product.id}>
                    <label className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-muted/40">
                      <input
                        type={multiple ? 'checkbox' : 'radio'}
                        name="product-pick"
                        className="mt-1"
                        checked={checked}
                        onChange={(): void => toggle(product.slug)}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {pickName(product.name, product.slug)}
                        </span>
                        <span className="block font-mono text-xs text-muted-foreground">
                          {product.sku} · {product.slug}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {draft.length} selected · page {page + 1} / {pageCount}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={page <= 0} onClick={(): void => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page + 1 >= pageCount}
              onClick={(): void => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t pt-3">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {multiple ? (
            <Button
              type="button"
              onClick={(): void => {
                onApply(draft);
                onClose();
              }}
            >
              Apply selection
            </Button>
          ) : null}
        </div>
      </div>
    </ModalShell>
  );
}

function CategorySearchModal({
  open,
  selectedSlugs,
  multiple,
  onClose,
  onApply,
}: {
  open: boolean;
  selectedSlugs: string[];
  multiple: boolean;
  onClose: () => void;
  onApply: (slugs: string[]) => void;
}): ReactElement | null {
  const { categories, loading } = useCategoryOptions();
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<string[]>(selectedSlugs);

  const selectedKey = slugsKey(selectedSlugs);

  useEffect(() => {
    if (!open) return;
    setDraft(selectedKey ? selectedKey.split('\0') : []);
    setQuery('');
  }, [open, selectedKey]);

  const filtered = useMemo(() => {
    const needle = normalize(query);
    if (!needle) return categories;
    return categories.filter(
      (c) => normalize(c.label).includes(needle) || normalize(c.slug).includes(needle),
    );
  }, [categories, query]);

  if (!open) return null;

  const toggle = (slug: string): void => {
    if (multiple) {
      setDraft((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));
      return;
    }
    onApply([slug]);
    onClose();
  };

  return (
    <ModalShell title={multiple ? 'Select categories' : 'Select category'} onClose={onClose}>
      <div className="space-y-3">
        <input
          className={inputClassName}
          value={query}
          onChange={(e): void => setQuery(e.target.value)}
          placeholder="Filter categories…"
        />
        <div className="max-h-80 overflow-y-auto rounded-md border">
          {loading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No categories found.</p>
          ) : (
            <ul className="divide-y">
              {filtered.map((cat) => {
                const checked = draft.includes(cat.slug);
                return (
                  <li key={cat.slug}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/40">
                      <input
                        type={multiple ? 'checkbox' : 'radio'}
                        name="category-pick"
                        checked={checked}
                        onChange={(): void => toggle(cat.slug)}
                      />
                      <span className="text-sm">{cat.label}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {multiple ? (
            <Button
              type="button"
              onClick={(): void => {
                onApply(draft);
                onClose();
              }}
            >
              Apply
            </Button>
          ) : null}
        </div>
      </div>
    </ModalShell>
  );
}

function SelectedItemsList({
  items,
  onRemove,
  emptyLabel,
}: {
  items: { slug: string; label: string }[];
  onRemove: (slug: string) => void;
  emptyLabel: string;
}): ReactElement {
  const [open, setOpen] = useState(items.length > 0);

  useEffect(() => {
    if (items.length > 0) setOpen(true);
  }, [items.length]);

  return (
    <div className="rounded-md border">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium"
        onClick={(): void => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Selected ({items.length})
      </button>
      {open ? (
        <ul className="max-h-40 divide-y overflow-y-auto border-t">
          {items.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">{emptyLabel}</li>
          ) : (
            items.map((item) => (
              <li key={item.slug} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <button
                  type="button"
                  className="shrink-0 rounded p-0.5 hover:bg-muted"
                  aria-label={`Remove ${item.label}`}
                  onClick={(): void => onRemove(item.slug)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

function ProductSlugsFieldControl({
  value,
  onChange,
  readOnly,
  label,
}: {
  value: string[] | undefined;
  onChange: (v: string[]) => void;
  readOnly?: boolean;
  label: string;
}): ReactElement {
  const selected = Array.isArray(value) ? value : [];
  const [modalOpen, setModalOpen] = useState(false);
  const [labels, setLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    if (selected.length === 0) {
      setLabels({});
      return;
    }
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const params = new URLSearchParams();
        params.set('pageSize', '50');
        const res = await apiClient.get<{ data: AdminProduct[] }>(
          `/api/v1/admin/catalog/products?${params.toString()}`,
        );
        if (cancelled) return;
        const next: Record<string, string> = {};
        for (const product of res.data) {
          if (selected.includes(product.slug)) {
            next[product.slug] = `${pickName(product.name, product.slug)} (${product.sku})`;
          }
        }
        for (const slug of selected) {
          if (!next[slug]) next[slug] = slug;
        }
        setLabels(next);
      } catch {
        if (!cancelled) {
          setLabels(Object.fromEntries(selected.map((slug) => [slug, slug])));
        }
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [selected]);

  const listItems = selected.map((slug) => ({ slug, label: labels[slug] ?? slug }));

  return (
    <FieldShell label={label}>
      <div className="space-y-2">
        <Button
          type="button"
          variant="outline"
          className={pickerButtonClass}
          disabled={readOnly === true}
          onClick={(): void => setModalOpen(true)}
        >
          Select products
        </Button>
        <SelectedItemsList
          items={listItems}
          emptyLabel="No products selected yet."
          onRemove={(slug): void => onChange(selected.filter((s) => s !== slug))}
        />
      </div>
      <ProductSearchModal
        open={modalOpen}
        selectedSlugs={selected}
        onClose={(): void => setModalOpen(false)}
        onApply={onChange}
      />
    </FieldShell>
  );
}

function CategorySlugsFieldControl({
  value,
  onChange,
  readOnly,
  label,
}: {
  value: string[] | undefined;
  onChange: (v: string[]) => void;
  readOnly?: boolean;
  label: string;
}): ReactElement {
  const selected = Array.isArray(value) ? value : [];
  const { categories } = useCategoryOptions();
  const [modalOpen, setModalOpen] = useState(false);
  const labelBySlug = useMemo(() => new Map(categories.map((c) => [c.slug, c.label])), [categories]);
  const listItems = selected.map((slug) => ({ slug, label: labelBySlug.get(slug) ?? slug }));

  return (
    <FieldShell label={label}>
      <div className="space-y-2">
        <Button
          type="button"
          variant="outline"
          className={pickerButtonClass}
          disabled={readOnly === true}
          onClick={(): void => setModalOpen(true)}
        >
          Select categories
        </Button>
        <SelectedItemsList
          items={listItems}
          emptyLabel="No categories selected yet."
          onRemove={(slug): void => onChange(selected.filter((s) => s !== slug))}
        />
      </div>
      <CategorySearchModal
        open={modalOpen}
        selectedSlugs={selected}
        multiple
        onClose={(): void => setModalOpen(false)}
        onApply={onChange}
      />
    </FieldShell>
  );
}

function SingleCategoryFieldControl({
  value,
  onChange,
  readOnly,
  label,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
  readOnly?: boolean;
  label: string;
}): ReactElement {
  const { categories, loading } = useCategoryOptions();
  const [modalOpen, setModalOpen] = useState(false);
  const selected = typeof value === 'string' ? value : '';
  const selectedLabel = categories.find((c) => c.slug === selected)?.label ?? selected;

  const selectedSlugs = useMemo(() => (selected ? [selected] : []), [selected]);

  return (
    <FieldShell label={label}>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <input
            className={`${pickerInputClassName} min-w-0 flex-1`}
            readOnly
            value={selectedLabel || '— Not selected —'}
          />
          <Button
            type="button"
            variant="outline"
            className={pickerButtonClass}
            disabled={readOnly === true || loading}
            onClick={(): void => setModalOpen(true)}
          >
            Select
          </Button>
        </div>
      </div>
      <CategorySearchModal
        open={modalOpen}
        selectedSlugs={selectedSlugs}
        multiple={false}
        onClose={(): void => setModalOpen(false)}
        onApply={(slugs): void => onChange(slugs[0] ?? '')}
      />
    </FieldShell>
  );
}

function SingleProductFieldControl({
  value,
  onChange,
  readOnly,
  label,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
  readOnly?: boolean;
  label: string;
}): ReactElement {
  const selected = typeof value === 'string' ? value : '';
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState(selected);

  useEffect(() => {
    if (!selected) {
      setSelectedLabel('');
      return;
    }
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const params = new URLSearchParams();
        params.set('q', selected);
        params.set('pageSize', '5');
        const res = await apiClient.get<{ data: AdminProduct[] }>(
          `/api/v1/admin/catalog/products?${params.toString()}`,
        );
        const product = res.data.find((p) => p.slug === selected);
        if (!cancelled) {
          setSelectedLabel(
            product ? `${pickName(product.name, product.slug)} (${product.sku})` : selected,
          );
        }
      } catch {
        if (!cancelled) setSelectedLabel(selected);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [selected]);

  const selectedSlugs = useMemo(() => (selected ? [selected] : []), [selected]);

  return (
    <FieldShell label={label}>
      <div className="flex items-center gap-2">
        <input
          className={`${pickerInputClassName} min-w-0 flex-1`}
          readOnly
          value={selectedLabel || '— Not selected —'}
        />
        <Button
          type="button"
          variant="outline"
          className={pickerButtonClass}
          disabled={readOnly === true}
          onClick={(): void => setModalOpen(true)}
        >
          Select
        </Button>
      </div>
      <ProductSearchModal
        open={modalOpen}
        selectedSlugs={selectedSlugs}
        multiple={false}
        onClose={(): void => setModalOpen(false)}
        onApply={(slugs): void => onChange(slugs[0] ?? '')}
      />
    </FieldShell>
  );
}

export function createProductSlugField(): Field<string, Record<string, unknown>> {
  return {
    type: 'custom',
    label: 'Product',
    metadata: PB_DATA_METADATA,
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <SingleProductFieldControl
        value={value}
        onChange={onChange}
        {...(readOnly === true ? { readOnly: true } : {})}
        label={field.label ?? 'Product'}
      />
    ),
  };
}

export function createProductSlugsField(): Field<string[], Record<string, unknown>> {
  return {
    type: 'custom',
    label: 'Products',
    metadata: PB_DATA_METADATA,
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <ProductSlugsFieldControl
        value={value}
        onChange={onChange}
        {...(readOnly === true ? { readOnly: true } : {})}
        label={field.label ?? 'Products'}
      />
    ),
  };
}

export function createCategorySlugField(): Field<string, Record<string, unknown>> {
  return {
    type: 'custom',
    label: 'Category',
    metadata: PB_DATA_METADATA,
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <SingleCategoryFieldControl
        value={value}
        onChange={onChange}
        {...(readOnly === true ? { readOnly: true } : {})}
        label={field.label ?? 'Category'}
      />
    ),
  };
}

export function createCategorySlugsField(): Field<string[], Record<string, unknown>> {
  return {
    type: 'custom',
    label: 'Categories',
    metadata: PB_DATA_METADATA,
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <CategorySlugsFieldControl
        value={value}
        onChange={onChange}
        {...(readOnly === true ? { readOnly: true } : {})}
        label={field.label ?? 'Categories'}
      />
    ),
  };
}
