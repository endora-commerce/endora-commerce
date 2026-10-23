import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import type { PriceBookRowPrice } from '@endora-commerce/contracts';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Button, Input, Label } from '@endora-commerce/admin-kit/ui';
import type { CellView, EditLine } from '../lib/book-edit-state.js';
import { refusalText } from '../lib/grid-labels.js';
import { formatPriceCell, parsePriceCell, type PriceCellLanguage } from '../lib/price-cell.js';

/**
 * One cell in full (feature 161, FR-010, FR-037): its price, its own quantity
 * window when it should not follow the columns (25–49, say), what it inherits
 * when it is empty, a link to the explanation for a product or variant line,
 * and a way to clear it — set apart from *Apply*.
 */
export function CellDetailDialog(props: {
  readonly title: string;
  readonly line: EditLine;
  readonly start: number;
  readonly view: CellView;
  readonly bookId: string;
  readonly language: PriceCellLanguage;
  readonly onApply: (detail: { readonly price: PriceBookRowPrice; readonly min: number; readonly max: number | null }) => void;
  readonly onClear: () => void;
  readonly onClose: () => void;
}): ReactNode {
  const t = useTranslation('price_lists');
  const id = useId();
  const { view } = props;
  const [price, setPrice] = useState(view.invalid ? view.invalid.text : view.price ? formatPriceCell(view.price, props.language) : '');
  const [min, setMin] = useState(String(view.window?.min ?? props.start));
  const [max, setMax] = useState(view.window?.max === null || view.window === null ? '' : String(view.window.max));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const apply = (): void => {
    const found: Record<string, string> = {};
    const parsed = parsePriceCell(price, { selection: props.line.selection });
    if (parsed.kind === 'empty') found['price'] = t('grid.detail.priceRequired');
    if (parsed.kind === 'invalid') found['price'] = refusalText(t, parsed);
    const from = Number(min);
    const to = max.trim() === '' ? null : Number(max);
    if (!Number.isInteger(from) || from < 1) found['min'] = t('grid.detail.minInvalid');
    if (to !== null && (!Number.isInteger(to) || to < from)) found['max'] = t('grid.detail.maxInvalid');
    setErrors(found);
    if (Object.keys(found).length > 0 || parsed.kind !== 'price') return;
    props.onApply({ price: parsed.price, min: from, max: to });
  };

  const productId = props.line.selection.productId;
  const variantId = props.line.selection.variantId;
  const explain =
    productId !== null
      ? `/price-lists/explain?${new URLSearchParams({ productId, ...(variantId ? { variantId } : {}), bookId: props.bookId }).toString()}`
      : null;

  const field = (key: string, label: string, input: ReactNode): ReactNode => (
    <div className="space-y-1">
      <Label htmlFor={`${id}-${key}`}>{label}</Label>
      {input}
      {errors[key] ? (
        <p id={`${id}-${key}-error`} className="text-xs text-destructive">
          {errors[key]}
        </p>
      ) : null}
    </div>
  );
  const invalid = (key: string) => (errors[key] ? { 'aria-invalid': true, 'aria-describedby': `${id}-${key}-error` } : {});

  return (
    <ModalDialog
      title={props.title}
      onClose={props.onClose}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          {view.price || view.invalid ? (
            <Button type="button" variant="outline" className="text-destructive" onClick={props.onClear}>
              <Trash2 aria-hidden="true" />
              {t('grid.detail.clear')}
            </Button>
          ) : (
            <span />
          )}
          <span className="flex gap-2">
            <Button type="button" variant="outline" onClick={props.onClose}>
              {t('priceBooks.common.cancel')}
            </Button>
            <Button type="button" onClick={apply}>
              {t('grid.detail.apply')}
            </Button>
          </span>
        </div>
      }
    >
      <div className="space-y-4">
        {view.price === null && !view.invalid ? (
          <p className="text-sm text-muted-foreground">
            {view.inherited
              ? t('grid.detail.inherits', { from: view.inherited.from, price: formatPriceCell(view.inherited.price, props.language) })
              : t('grid.detail.notPriced')}
          </p>
        ) : null}
        {field('price', t('grid.detail.price'), (
          <Input id={`${id}-price`} value={price} onChange={(event): void => setPrice(event.target.value)} {...invalid('price')} />
        ))}
        <div className="grid gap-4 sm:grid-cols-2">
          {field('min', t('grid.detail.min'), (
            <Input id={`${id}-min`} inputMode="numeric" value={min} onChange={(event): void => setMin(event.target.value)} {...invalid('min')} />
          ))}
          {field('max', t('grid.detail.max'), (
            <Input id={`${id}-max`} inputMode="numeric" value={max} onChange={(event): void => setMax(event.target.value)} {...invalid('max')} />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t('grid.detail.windowHelp')}</p>
        {explain ? (
          <Link to={explain} className="text-sm underline underline-offset-2">
            {t('grid.detail.explain')}
          </Link>
        ) : null}
      </div>
    </ModalDialog>
  );
}
