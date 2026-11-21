import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { Loader2, Plus, Trash2, Truck } from 'lucide-react';
import { ApiError, formatMoney } from '@endora-commerce/admin-kit/lib';
import { ModalDialog, useConfirmDialog, useRemovalFocus } from '@endora-commerce/admin-kit/components';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
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
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const status = useInlineStatus();
  const { confirm, confirmDialog } = useConfirmDialog();
  // After a confirmed delete, focus goes to the next row's Delete, else the create action (WCAG 2.4.3).
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

  // Issue #1439 (DS-05): the create action sits in the header and opens a dialog, rather
  // than a create card drawn open under the list (Hick); with no method yet the empty state
  // carries it instead (Von Restorff). One ref serves removal focus and the dialog's return.
  const newMethod = (
    <Button
      ref={(element: HTMLButtonElement | null) => {
        removalFocus.createRef.current = element;
      }}
      type="button"
      className="min-h-11 sm:min-h-9"
      onClick={() => {
        status.clear();
        setCreating(true);
      }}
    >
      <Plus size={16} aria-hidden="true" />
      {tr('methods.newTitle')}
    </Button>
  );
  const nothingYet = rows !== null && rows.length === 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('returns.methods.title')}
        actions={
          rows !== null && !nothingYet ? (
            <>
              <InlineStatus {...status.props} />
              {newMethod}
            </>
          ) : null
        }
      />
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
                action={newMethod}
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

      {creating ? (
        <NewDeliveryMethodDialog
          methods={methods}
          choices={choices}
          finalFocusRef={removalFocus.createRef}
          onClose={() => setCreating(false)}
          onCreated={async () => {
            await refresh();
            setCreating(false);
            status.show(tr('methods.added'));
          }}
        />
      ) : null}
      {confirmDialog}
    </div>
  );
}

interface NewDeliveryMethodDialogProps {
  /** As on the page: `undefined` while loading, `null` when they cannot be read. */
  methods: DeliveryMethodOption[] | null | undefined;
  /** The methods without a return setting yet — the only ones offered. */
  choices: DeliveryMethodOption[];
  /** Focused when the dialog closes: the create action drawn at that moment. */
  finalFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onCreated: () => Promise<void>;
}

/**
 * The new return-delivery-method form — three fields, so a dialog (DS-05). The method is
 * chosen by name; when the list cannot be read it takes the method's ID. With every method
 * already configured it says so instead of offering an empty choice.
 */
function NewDeliveryMethodDialog({ methods, choices, finalFocusRef, onClose, onCreated }: NewDeliveryMethodDialogProps): ReactNode {
  const t = useTranslation('core');
  const tr = useTranslation('returns');
  const { language } = useTranslationContext();
  const formId = useId();
  const [deliveryMethodId, setDeliveryMethodId] = useState('');
  const [returnCost, setReturnCost] = useState(0);
  const [currency, setCurrency] = useState('PLN');
  const [methodError, setMethodError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const byId = methods === null;
  const nothingLeft = Array.isArray(methods) && choices.length === 0;

  const pick = (value: string): void => {
    setDeliveryMethodId(value);
    if (methodError) setMethodError(null);
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setFailure(null);
    if (!deliveryMethodId.trim()) {
      setMethodError(byId ? tr('methods.validation.methodIdRequired') : tr('methods.validation.methodRequired'));
      return;
    }
    setMethodError(null);
    setSaving(true);
    try {
      await returnsClient.createDeliveryMethod({
        deliveryMethodId: deliveryMethodId.trim(),
        returnCost,
        currency: currency.trim().toUpperCase(),
      });
      await onCreated();
    } catch (err) {
      setFailure(err instanceof ApiError ? err.envelope.error.message : tr('admin.actionFailed'));
      setSaving(false);
    }
  };

  return (
    <ModalDialog
      title={tr('methods.newTitle')}
      onClose={onClose}
      busy={saving}
      dismissOnScrim={false}
      finalFocusRef={finalFocusRef}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            {t('common.action.cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={saving || nothingLeft} aria-busy={saving || undefined}>
            {saving ? <Loader2 size={14} aria-hidden="true" className="motion-safe:animate-spin" /> : null}
            {tr('methods.add')}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate className="space-y-4" onSubmit={(e) => void submit(e)}>
        {nothingLeft ? (
          <p className="text-sm text-muted-foreground">{tr('methods.allConfigured')}</p>
        ) : (
          <>
            {byId ? (
              <FormField label={tr('methods.field.methodId')} hint={tr('methods.field.methodIdHint')} required error={methodError}>
                <Input
                  className="font-mono"
                  spellCheck={false}
                  autoComplete="off"
                  value={deliveryMethodId}
                  onChange={(e) => pick(e.target.value)}
                />
              </FormField>
            ) : (
              <FormField label={tr('methods.field.method')} required error={methodError}>
                <Select value={deliveryMethodId} onChange={(e) => pick(e.target.value)}>
                  <option value="">{tr('methods.field.chooseMethod')}</option>
                  {choices.map((m) => (
                    <option key={m.id} value={m.id}>
                      {localizedText(m.name, language, m.code)}
                    </option>
                  ))}
                </Select>
              </FormField>
            )}
            <FormField label={tr('methods.field.cost')} hint={tr('methods.field.costHint')}>
              <Input
                type="number"
                step="0.01"
                min="0"
                className="w-32"
                value={returnCost}
                onChange={(e) => setReturnCost(Number(e.target.value))}
              />
            </FormField>
            <FormField label={tr('methods.field.currency')}>
              <Input
                maxLength={3}
                autoComplete="off"
                className="w-24 uppercase"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              />
            </FormField>
          </>
        )}
        {/* Mounted before it has text, so a refusal that arrives is announced. */}
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      </form>
    </ModalDialog>
  );
}

export default ReturnDeliveryMethodsPage;
