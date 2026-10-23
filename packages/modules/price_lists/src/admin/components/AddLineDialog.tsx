import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import type { PriceBookTargetAttribute, PriceBookTargetCategory } from '@endora-commerce/contracts';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Button, Label, Select } from '@endora-commerce/admin-kit/ui';
import type { NewLine } from '../lib/book-edit-state.js';
import { useLocalizedName } from '../lib/localized-name.js';
import { usePriceBooksApi } from '../lib/use-price-books-api.js';

/**
 * Adding a category, an attribute-value or a category ∩ attribute-value line
 * (feature 161, FR-008). The attributes offered are the price-book targets',
 * which are only the eligible *Price list rules* attributes; categories carry
 * their path from the root, as the grid labels them.
 */

export type AddLineMode = 'category' | 'attribute' | 'category_attribute';

export function AddLineDialog(props: {
  readonly mode: AddLineMode;
  readonly onAdd: (line: NewLine) => void;
  readonly onClose: () => void;
}): ReactNode {
  const t = useTranslation('price_lists');
  const api = usePriceBooksApi();
  const localizedName = useLocalizedName();
  const id = useId();
  const [categories, setCategories] = useState<PriceBookTargetCategory[]>([]);
  const [attributes, setAttributes] = useState<PriceBookTargetAttribute[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [attributeKey, setAttributeKey] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const needsCategory = props.mode !== 'attribute';
  const needsAttribute = props.mode !== 'category';

  useEffect(() => {
    if (needsCategory) void api.targets.categories().then(setCategories).catch(() => undefined);
    if (needsAttribute) void api.targets.attributes().then(setAttributes).catch(() => undefined);
  }, [api, needsCategory, needsAttribute]);

  /** Each category's path from the root, in the admin language. */
  const paths = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c]));
    const pathOf = (c: PriceBookTargetCategory, depth = 0): string => {
      const parent = c.parentCategoryId ? byId.get(c.parentCategoryId) : undefined;
      const own = localizedName(c.name, c.slug);
      return parent && depth < 20 ? `${pathOf(parent, depth + 1)} › ${own}` : own;
    };
    return categories
      .map((c) => ({ id: c.id, path: pathOf(c) }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [categories, localizedName]);
  const attribute = attributes.find((a) => a.key === attributeKey);

  const add = (): void => {
    if ((needsCategory && !categoryId) || (needsAttribute && (!attributeKey || !value))) {
      setError(t('grid.addLine.incomplete'));
      return;
    }
    const option = attribute?.options.find((o) => o.value === value);
    props.onAdd({
      kind: props.mode,
      selection: {
        ...(needsCategory ? { categoryId } : {}),
        ...(needsAttribute ? { attribute: { key: attributeKey, value } } : {}),
      },
      labels: {
        productName: null,
        productSku: null,
        variantLabel: null,
        variantSku: null,
        categoryPath: needsCategory ? (paths.find((p) => p.id === categoryId)?.path ?? null) : null,
        attributeLabel: needsAttribute ? (attribute?.label ?? attributeKey) : null,
        attributeValueLabel: needsAttribute ? (option?.label ?? value) : null,
      },
    });
  };

  return (
    <ModalDialog
      title={t(`grid.addLine.title.${props.mode}`)}
      onClose={props.onClose}
      footer={
        <>
          <Button type="button" variant="outline" onClick={props.onClose}>
            {t('priceBooks.common.cancel')}
          </Button>
          <Button type="button" onClick={add}>
            {t('grid.addLine.add')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {needsCategory ? (
          <div className="space-y-1">
            <Label htmlFor={`${id}-category`}>{t('grid.addLine.category')}</Label>
            <Select id={`${id}-category`} value={categoryId} onChange={(event): void => setCategoryId(event.target.value)}>
              <option value="">{t('grid.addLine.choose')}</option>
              {paths.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.path}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        {needsAttribute ? (
          <>
            <div className="space-y-1">
              <Label htmlFor={`${id}-attribute`}>{t('grid.addLine.attribute')}</Label>
              <Select
                id={`${id}-attribute`}
                value={attributeKey}
                onChange={(event): void => {
                  setAttributeKey(event.target.value);
                  setValue('');
                }}
              >
                <option value="">{t('grid.addLine.choose')}</option>
                {attributes.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.label}
                  </option>
                ))}
              </Select>
              {attributes.length === 0 ? <p className="text-xs text-muted-foreground">{t('grid.addLine.noAttributes')}</p> : null}
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${id}-value`}>{t('grid.addLine.value')}</Label>
              <Select id={`${id}-value`} value={value} disabled={!attribute} onChange={(event): void => setValue(event.target.value)}>
                <option value="">{t('grid.addLine.choose')}</option>
                {(attribute?.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
          </>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </ModalDialog>
  );
}
