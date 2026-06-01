import { type ReactNode } from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import type { FulfilmentStrategy } from '@b2b/contracts';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Shared, controlled editor for a warehouse-picking (fulfilment) strategy.
 *
 * Reused by the per-product Inventory tab and the per-Organization detail
 * page (and, later, anywhere the strategy is configurable). The sales-channel
 * layer is edited through the generic Settings page, not here.
 *
 * Dumb/controlled: the parent owns `value` and the warehouse list; this
 * component only renders the strategy `<select>` and — for `defined_order` —
 * an ordered warehouse list with up/down/remove + an add-dropdown.
 */
export interface FulfilmentStrategyValue {
  strategy: FulfilmentStrategy | null;
  warehouseOrder: string[];
}

export interface FulfilmentWarehouseOption {
  id: string;
  code: string;
  name: string;
}

export interface FulfilmentStrategyPickerProps {
  value: FulfilmentStrategyValue;
  onChange: (next: FulfilmentStrategyValue) => void;
  warehouses: FulfilmentWarehouseOption[];
  /** When true, offers an "inherit" option that maps to a null strategy. */
  allowInherit?: boolean;
  disabled?: boolean;
  /** Disambiguates element ids when several pickers share a page. */
  idPrefix?: string;
}

const STRATEGIES: FulfilmentStrategy[] = [
  'any',
  'default_first',
  'lowest_stock_first',
  'highest_stock_first',
  'defined_order',
];

export function FulfilmentStrategyPicker({
  value,
  onChange,
  warehouses,
  allowInherit = false,
  disabled = false,
  idPrefix = 'fulfilment',
}: FulfilmentStrategyPickerProps): ReactNode {
  const t = useTranslation('core');
  const order = value.warehouseOrder ?? [];
  const byId = new Map(warehouses.map((w) => [w.id, w]));
  const available = warehouses.filter((w) => !order.includes(w.id));

  const setStrategy = (raw: string): void => {
    const strategy = raw === '' ? null : (raw as FulfilmentStrategy);
    onChange({ strategy, warehouseOrder: order });
  };
  const setOrder = (next: string[]): void => {
    onChange({ strategy: value.strategy, warehouseOrder: next });
  };
  const move = (index: number, delta: number): void => {
    const next = [...order];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    setOrder(next);
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}-strategy`}>{t('fulfilment.label')}</Label>
        <Select
          id={`${idPrefix}-strategy`}
          value={value.strategy ?? ''}
          disabled={disabled}
          onChange={(e): void => setStrategy(e.target.value)}
        >
          {allowInherit ? <option value="">{t('fulfilment.inherit')}</option> : null}
          {STRATEGIES.map((s) => (
            <option key={s} value={s}>
              {t(`fulfilment.strategy.${s}`)}
            </option>
          ))}
        </Select>
        <p className="text-xs text-muted-foreground">{t('fulfilment.hint')}</p>
      </div>

      {value.strategy === 'defined_order' ? (
        <div className="space-y-2 rounded-md border p-3">
          <Label>{t('fulfilment.warehouseOrder.title')}</Label>
          {order.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('fulfilment.warehouseOrder.empty')}</p>
          ) : (
            <ol className="space-y-1">
              {order.map((id, i) => {
                const wh = byId.get(id);
                return (
                  <li key={id} className="flex items-center gap-2 text-sm">
                    <span className="w-5 text-right tabular-nums text-muted-foreground">{i + 1}.</span>
                    <span className="flex-1">
                      {wh ? wh.name : id}{' '}
                      {wh ? <span className="font-mono text-xs text-muted-foreground">({wh.code})</span> : null}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={disabled || i === 0}
                      aria-label={t('fulfilment.warehouseOrder.up')}
                      onClick={(): void => move(i, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={disabled || i === order.length - 1}
                      aria-label={t('fulfilment.warehouseOrder.down')}
                      onClick={(): void => move(i, 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={disabled}
                      aria-label={t('fulfilment.warehouseOrder.remove')}
                      onClick={(): void => setOrder(order.filter((x) => x !== id))}
                    >
                      <X />
                    </Button>
                  </li>
                );
              })}
            </ol>
          )}
          {available.length > 0 ? (
            <Select
              aria-label={t('fulfilment.warehouseOrder.add')}
              value=""
              disabled={disabled}
              onChange={(e): void => {
                if (e.target.value) setOrder([...order, e.target.value]);
              }}
            >
              <option value="">{t('fulfilment.warehouseOrder.add')}</option>
              {available.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.code})
                </option>
              ))}
            </Select>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
