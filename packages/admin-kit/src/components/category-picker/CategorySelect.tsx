import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, apiClient } from '../../lib/api-client.js';
import { useAppLanguage } from '../../i18n/app-language-context.js';
import { Combobox, type ComboboxOption } from '../../ui/combobox.js';

/**
 * Single-select catalog-category picker.
 *
 * `GET /api/v1/admin/catalog/categories` returns the full tree flat (no
 * pagination), so the list is fetched once on mount and the <Combobox>
 * filters client-side. Labels are locale-aware (admin UI language, then
 * `en-US`, then any value, then slug). The committed value is the
 * category UUID.
 *
 * For multi-select category audiences use <CategoryTreePicker>; this is
 * the flat single-pick variant for "link to one category" fields.
 */

interface AdminCategory {
  id: string;
  name: Record<string, string>;
  slug: string;
  parentCategoryId: string | null;
}

export interface CategorySelectProps {
  value: string | null;
  onChange: (categoryId: string | null) => void;
  placeholder?: string;
  emptyMessage?: string;
  clearable?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  className?: string;
}

export function CategorySelect(props: CategorySelectProps): ReactNode {
  const { language } = useAppLanguage();
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiClient
      .get<{ data: AdminCategory[] }>('/api/v1/admin/catalog/categories')
      .then((res) => {
        if (!alive) return;
        setCategories(res.data);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(
          err instanceof ApiError ? err.envelope.error.message : 'Failed to load categories.',
        );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return (): void => {
      alive = false;
    };
  }, []);

  const options = useMemo<ComboboxOption<string>[]>(() => {
    const labelFor = (c: AdminCategory): string =>
      c.name[language] ?? c.name['en-US'] ?? Object.values(c.name)[0] ?? c.slug;
    return categories.map((c) => ({ value: c.id, label: labelFor(c), description: c.slug }));
  }, [categories, language]);

  const emptyMessage = props.emptyMessage ?? error ?? 'No categories.';

  return (
    <Combobox<string>
      options={options}
      value={props.value}
      onChange={props.onChange}
      loading={loading}
      clearable={props.clearable ?? true}
      disabled={props.disabled ?? false}
      placeholder={props.placeholder ?? 'Select a category…'}
      emptyMessage={emptyMessage}
      ariaLabel={props.ariaLabel ?? 'Select category'}
      id={props.id ?? ''}
      className={props.className ?? ''}
    />
  );
}
