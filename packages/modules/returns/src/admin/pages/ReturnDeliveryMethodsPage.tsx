import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Trash2, Truck } from 'lucide-react';
import { ApiError, formatMoney } from '@endora-commerce/admin-kit/lib';
import { useConfirmDialog, useRemovalFocus } from '@endora-commerce/admin-kit/components';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  FormField,
  InlineStatus,
  Input,
  PageHeader,
  Select,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useInlineStatus,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { returnsClient } from '../api/returns-client.js';
import { deliveryMethodName, localizedText, type DeliveryMethodOption } from '../labels.js';

import type { ReturnDeliveryMethodDto } from '@endora-commerce/contracts';

/** Stable, module-level: `useRemovalFocus` keys its targets by it. */
const rowId = (r: ReturnDeliveryMethodDto): string => r.id;

/** Allowed return delivery methods + cost (feature 046, US6; translated and named in #1472). */
export function ReturnDeliveryMethodsPage(): ReactNode {
  const t = useTranslation('core');
  const tr = useTranslation('returns');
  const { language } = useTranslationContext();
  // `null` until the first answer, so the empty state does not flash while loading.
  const [rows, setRows] = useState<ReturnDeliveryMethodDto[] | null>(null);
  // The delivery methods to name and choose from: `undefined` while loading, `null`
  // when they cannot be read (`delivery_methods` off, no permission) — the form
  // then takes the method's id instead.
  const [methods, setMethods] = useState<DeliveryMethodOption[] | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [deliveryMethodId, setDeliveryMethodId] = useState('');
  const [returnCost, setReturnCost] = useState(0);
  const [currency, setCurrency] = useState('PLN');
  const [busyId, setBusyId] = useState<string | null>(null);
  const status = useInlineStatus();
  const { confirm, confirmDialog } = useConfirmDialog();
  // After a confirmed delete, focus goes to the next row's Delete, else the method field (WCAG 2.4.3).
  const removalFocus = useRemovalFocus(rows ?? [], rowId, rows !== null);

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      setRows(await returnsClient.deliveryMethods());
    } catch (err) {
      setRows((prev) => prev ?? []);
      setError(err instanceof ApiError ? err.envelope.error.message : tr('admin.loadFailed'));
    }
  }, [tr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let live = true;
    returnsClient
      .shippingMethods()
      .then((list) => {
        if (live) setMethods(Array.isArray(list) ? list : null);
      })
      .catch(() => {
        if (live) setMethods(null);
      });
    return (): void => {
      live = false;
    };
  }, []);

  const run = useCallback(
    async (fn: () => Promise<unknown>): Promise<boolean> => {
      setError(null);
      try {
        await fn();
        await refresh();
        return true;
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : tr('admin.actionFailed'));
        return false;
      }
    },
    [refresh, tr],
  );

  const nameOf = (r: ReturnDeliveryMethodDto): string | null => deliveryMethodName(r.deliveryMethodId, methods, language);
  const configured = new Set((rows ?? []).map((r) => r.deliveryMethodId));
  const choices = (methods ?? []).filter((m) => !configured.has(m.id));

  const remove = (r: ReturnDeliveryMethodDto, shown: string): void => {
    void confirm({
      title: tr('methods.deleteConfirm.title'),
      message: tr('methods.deleteConfirm.message', { method: shown }),
      confirmLabel: t('common.action.delete'),
      destructive: true,
      action: async () => {
        await returnsClient.deleteDeliveryMethod(r.id);
        setRows((prev) => prev?.filter((x) => x.id !== r.id) ?? prev);
      },
      describeError: (err: unknown) => (err instanceof ApiError ? err.envelope.error.message : tr('admin.actionFailed')),
      returnFocusTo: removalFocus.returnFocusTo(r),
    });
  };
  const setCreateTarget = (element: HTMLElement | null): void => {
    removalFocus.createRef.current = element;
  };

  const add = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!deliveryMethodId.trim()) return;
    const ok = await run(() =>
      returnsClient.createDeliveryMethod({
        deliveryMethodId: deliveryMethodId.trim(),
        returnCost,
        currency: currency.trim().toUpperCase(),
      }),
    );
    if (ok) {
      setDeliveryMethodId('');
      status.show(tr('methods.added'));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader title={t('returns.methods.title')} />
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {rows !== null && (
        <Card>
          <CardContent>
            {rows.length === 0 ? (
              <EmptyState
                icon={<Truck size={20} />}
                title={tr('methods.empty.title')}
                description={tr('methods.empty.description')}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr('methods.col.method')}</TableHead>
                    <TableHead className="text-right">{tr('methods.col.cost')}</TableHead>
                    <TableHead>{tr('methods.col.active')}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const name = nameOf(r);
                    // While the list loads, or when it cannot be read, the id is all there is.
                    const shown = name ?? (methods === null || methods === undefined ? r.deliveryMethodId : tr('methods.unknownMethod'));
                    return (
                      <TableRow key={r.id}>
                        <TableCell className={name === null && !methods ? 'font-mono text-xs' : undefined}>{shown}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.returnCost === 0 ? tr('methods.free') : formatMoney(r.returnCost, r.currency)}
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={r.isActive}
                            busy={busyId === r.id}
                            aria-label={tr('methods.activeLabel', { method: shown })}
                            onCheckedChange={(next) => {
                              setBusyId(r.id);
                              void run(() => returnsClient.updateDeliveryMethod(r.id, { isActive: next })).finally(() =>
                                setBusyId(null),
                              );
                            }}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            ref={removalFocus.targetRef(r)}
                            aria-label={tr('methods.delete', { method: shown })}
                            onClick={() => remove(r, shown)}
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{tr('methods.newTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-wrap items-start gap-4" onSubmit={(e) => void add(e)}>
            {methods === null ? (
              <FormField label={tr('methods.field.methodId')} hint={tr('methods.field.methodIdHint')} required className="w-96">
                <Input
                  ref={setCreateTarget}
                  className="font-mono"
                  spellCheck={false}
                  autoComplete="off"
                  value={deliveryMethodId}
                  onChange={(e) => {
                    setDeliveryMethodId(e.target.value);
                    status.clear();
                  }}
                />
              </FormField>
            ) : (
              <FormField label={tr('methods.field.method')} required className="w-72">
                <Select
                  ref={setCreateTarget}
                  value={deliveryMethodId}
                  onChange={(e) => {
                    setDeliveryMethodId(e.target.value);
                    status.clear();
                  }}
                >
                  <option value="">{tr('methods.field.chooseMethod')}</option>
                  {choices.map((m) => (
                    <option key={m.id} value={m.id}>
                      {localizedText(m.name, language, m.code)}
                    </option>
                  ))}
                </Select>
              </FormField>
            )}
            <FormField label={tr('methods.field.cost')} hint={tr('methods.field.costHint')} className="w-80">
              <Input
                type="number"
                step="0.01"
                min="0"
                className="w-32"
                value={returnCost}
                onChange={(e) => setReturnCost(Number(e.target.value))}
              />
            </FormField>
            <FormField label={tr('methods.field.currency')} className="w-24">
              <Input
                maxLength={3}
                autoComplete="off"
                className="uppercase"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              />
            </FormField>
            <div className="flex items-center gap-3 pt-6">
              <Button type="submit" size="sm" disabled={!deliveryMethodId.trim()}>
                {tr('methods.add')}
              </Button>
              <InlineStatus {...status.props} />
            </div>
          </form>
        </CardContent>
      </Card>
      {confirmDialog}
    </div>
  );
}
export default ReturnDeliveryMethodsPage;
