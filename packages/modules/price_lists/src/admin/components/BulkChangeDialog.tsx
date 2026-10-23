import { useId, useState, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Button, Input, Label } from '@endora-commerce/admin-kit/ui';
import { parseFactor, type BulkAction } from '../lib/bulk.js';

/**
 * Changing the selected cells at once (feature 161, FR-012; US2 scenario 11):
 * set a percentage, set an amount adjustment or multiply the fixed prices. The
 * grid applies the result as one undoable step. *Clear* is apart from the
 * primary action and styled as destructive (Fitts: distance for what removes).
 */

type Kind = Exclude<BulkAction['kind'], 'clear'>;

export function BulkChangeDialog(props: {
  readonly cells: number;
  readonly onApply: (action: BulkAction) => void;
  readonly onClose: () => void;
}): ReactNode {
  const t = useTranslation('price_lists');
  const id = useId();
  const [kind, setKind] = useState<Kind>('percent');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const apply = (): void => {
    if (value.trim() === '') {
      setError(t('grid.bulk.valueRequired'));
      return;
    }
    if (kind === 'multiply') {
      if (parseFactor(value) === null) {
        setError(t('grid.bulk.factorInvalid'));
        return;
      }
      props.onApply({ kind: 'multiply', factor: value });
      return;
    }
    props.onApply({ kind, value });
  };

  const valueLabel = t(`grid.bulk.value.${kind}`);
  return (
    <ModalDialog
      title={t('grid.bulk.title')}
      onClose={props.onClose}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="outline" className="text-destructive" onClick={(): void => props.onApply({ kind: 'clear' })}>
            <Trash2 aria-hidden="true" />
            {t('grid.bulk.clear')}
          </Button>
          <span className="flex gap-2">
            <Button type="button" variant="outline" onClick={props.onClose}>
              {t('priceBooks.common.cancel')}
            </Button>
            <Button type="button" onClick={apply}>
              {t('grid.bulk.apply')}
            </Button>
          </span>
        </div>
      }
    >
      <p className="mb-3 text-sm text-muted-foreground">{t('grid.bulk.scope', { count: props.cells })}</p>
      <fieldset className="space-y-1">
        <legend className="sr-only">{t('grid.bulk.action')}</legend>
        {(['percent', 'amount', 'multiply'] as const).map((option) => (
          <label key={option} className="flex min-h-11 items-center gap-2 text-sm sm:min-h-8">
            <input
              type="radio"
              name={`${id}-kind`}
              className="h-4 w-4 accent-primary"
              checked={kind === option}
              onChange={(): void => {
                setKind(option);
                setError(null);
              }}
            />
            {t(`grid.bulk.kind.${option}`)}
          </label>
        ))}
      </fieldset>
      <div className="mt-3 space-y-1">
        <Label htmlFor={`${id}-value`}>{valueLabel}</Label>
        <Input
          id={`${id}-value`}
          value={value}
          inputMode="decimal"
          className="max-w-40"
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`}
          onChange={(event): void => setValue(event.target.value)}
        />
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {t(`grid.bulk.help.${kind}`)}
        </p>
        {error ? (
          <p id={`${id}-error`} className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </ModalDialog>
  );
}
