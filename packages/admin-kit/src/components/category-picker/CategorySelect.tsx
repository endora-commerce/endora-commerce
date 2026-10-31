import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, apiClient } from '../../lib/index.js';
import { useAppLanguage } from '../../i18n/app-language-context.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { Combobox, type ComboboxOption } from '../../ui/combobox.js';
import {
  adminLanguageToLocale,
  pickCategoryDisplayName,
} from '../category-tree-picker/category-tree-utils.js';

/**
 * Single-select catalog-category picker.
 *
 * `GET /api/v1/admin/catalog/categories` returns the full tree flat (no
 * pagination), so the list is fetched once on mount and the <Combobox>
 * filters client-side. Labels are locale-aware (the admin UI language's
 * locale, then `en-US`, then any value, then slug). The committed value is the
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
  // The server's sentence when it sent one, `null` for a failure it did not
  // explain — translated at render, so the load effect does not depend on `t`.
  const [error, setError] = useState<{ message: string | null } | null>(null);
  const t = useTranslation('core');

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
        setError({ message: err instanceof ApiError ? err.envelope.error.message : null });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return (): void => {
      alive = false;
    };
  }, []);

  const options = useMemo<ComboboxOption<string>[]>(() => {
    // Names are keyed by locale (`pl-PL`), the admin language by its short
    // code (`pl`): map one to the other rather than index by the wrong key.
    const locale = adminLanguageToLocale(language);
    return categories.map((c) => ({
      value: c.id,
      label: pickCategoryDisplayName(c.name, c.slug, locale),
      description: c.slug,
    }));
  }, [categories, language]);

  const errorMessage = error === null ? null : (error.message ?? t('categorySelect.loadError'));
  const emptyMessage = errorMessage ?? props.emptyMessage ?? t('categorySelect.empty');

  return (
    <Combobox<string>
      options={options}
      value={props.value}
      onChange={props.onChange}
      loading={loading}
      clearable={props.clearable ?? true}
      disabled={props.disabled ?? false}
      placeholder={props.placeholder ?? t('categorySelect.placeholder')}
      emptyMessage={emptyMessage}
      ariaLabel={props.ariaLabel ?? t('categorySelect.ariaLabel')}
      id={props.id ?? ''}
      className={props.className ?? ''}
    />
  );
}
