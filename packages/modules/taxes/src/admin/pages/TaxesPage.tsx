import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Percent, Plus } from 'lucide-react';
import { ApiError, apiClient, cn, useSurfaceVisibility } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, Checkbox, EmptyState, InlineStatus, Input, Label, Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, useInlineStatus } from '@endora-commerce/admin-kit/ui';
import {
  CountryPicker,
  ListPage,
  ModalDialog,
  RowActionMenu,
  RowActionMenuItem,
  RowActionMenuSeparator,
  useConfirmDialog,
  type ListPageLoad,
} from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

interface AdminTax {
  id: string;
  code: string;
  name: string;
  rate: number;
  country: string | null;
  productType: string | null;
  appliesToVatStatuses: string[];
  isDefault: boolean;
  priority: number;
}

const PRODUCT_TYPES = ['simple', 'variant', 'grouped', 'virtual'] as const;
const VAT_STATUSES = ['vat_payer', 'vat_exempt', 'reverse_charge'] as const;

export function TaxesPage(): ReactNode {
  const t = useTranslation('core');
  const { confirm, confirmDialog } = useConfirmDialog();
  /**
   * The screen's own gate (2026-08-28), on the codes its routes now enforce.
   *
   * `taxes` used to borrow `catalog:write` — on all four routes, the two reads
   * included — so this page had no permission of its own to check and the
   * sidebar entry beside it carried the catalogue's write code. Both moved
   * together; hiding the screen rather than letting it 403 is the treatment the
   * sidebar, the palette and the dashboard already apply to a denied
   * destination, and `AppShell.tsx`'s `PALETTE_ITEMS` comment argues it at
   * length. The module half is asked too, because the admin router carries no
   * guard of its own: a module the platform is not running must contribute no
   * surface at all (Constitution XVII item 5), and a permission gate alone
   * leaves this screen rendering and answering 503.
   *
   * `useSurfaceVisibility` is the predicate the sidebar, the palette and the
   * dashboard already share, so the two axes are one expression rather than two
   * that can drift.
   */
  const isVisible = useSurfaceVisibility();
  const canRead = isVisible({ module: 'taxes', requiredPermission: 'taxes:read' });
  /**
   * The write half, which is new rather than moved: until this change there was
   * no read-only role to have, because reading the table required the code that
   * rewrites it. Now there is, so the upsert form and the per-row delete are
   * hidden from it — hidden and not disabled, for the reason the screen itself
   * is, and hidden rather than left to 403 on submit.
   */
  const canWrite = isVisible({ module: 'taxes', requiredPermission: 'taxes:write' });
  const [rows, setRows] = useState<AdminTax[]>([]);
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  // A saved rule is said beside "New rule", where the dialog hands focus back, in
  // a region mounted before it has text — not a success banner (#1499, DEC-12 a).
  const { props: statusProps, show: showStatus, clear: clearStatus } = useInlineStatus();
  /**
   * The rule in the upsert dialog (issue #1501, SHELL-14): `'new'` for a blank
   * form, a row to edit it, `null` while the dialog is closed. The form used to
   * be drawn open above the list, pushing the rules below the fold.
   */
  const [editing, setEditing] = useState<AdminTax | 'new' | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    // A page that renders nothing has no reason to ask the API a question it
    // will be refused.
    if (!canRead) return;
    // A reload after a write keeps the rows on screen rather than flashing the skeleton.
    setLoad((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
    try {
      const res = await apiClient.get<{ data: AdminTax[] }>('/api/v1/admin/taxes');
      setRows(res.data);
      setLoad({ kind: 'ready' });
    } catch (err) {
      setLoad({ kind: 'error', message: err instanceof ApiError ? err.envelope.error.message : t('taxes.error.load') });
    }
  }, [canRead, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Throws on a refused save, so the dialog stays open and says why. */
  const handleUpsert = useCallback(
    async (input: AdminTax): Promise<void> => {
      clearStatus();
      await apiClient.put<{ data: AdminTax }>(`/api/v1/admin/taxes/${encodeURIComponent(input.code)}`, {
        code: input.code,
        name: input.name,
        rate: input.rate,
        country: input.country,
        productType: input.productType,
        appliesToVatStatuses: input.appliesToVatStatuses,
        isDefault: input.isDefault,
        priority: input.priority,
      });
      setEditing(null);
      showStatus(t('taxes.success.save', { code: input.code }));
      await refresh();
    },
    [refresh, t, clearStatus, showStatus],
  );

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      clearStatus();
      // The request runs inside the dialog, so a refusal is read where the operator is looking.
      const ok = await confirm({
        message: t('taxes.deleteConfirm'),
        confirmLabel: t('taxes.action.delete'),
        destructive: true,
        action: () => apiClient.delete<void>(`/api/v1/admin/taxes/${id}`),
        describeError: (err) => (err instanceof ApiError ? err.envelope.error.message : t('taxes.error.delete')),
      });
      if (ok) await refresh();
    },
    [refresh, t, confirm, clearStatus],
  );

  const newRuleButton = (variant: 'default' | 'outline'): ReactNode => (
    <Button type="button" variant={variant} onClick={(): void => setEditing('new')}>
      <Plus aria-hidden="true" />
      {t('taxes.action.new')}
    </Button>
  );

  if (!canRead) {
    return (
      <Alert>
        <AlertDescription>{t('taxes.noPermission')}</AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      <ListPage
        title={t('taxes.page.title')}
        actions={
          canWrite ? (
            <div className="flex items-center gap-3">
              <InlineStatus {...statusProps} />
              {newRuleButton('default')}
            </div>
          ) : undefined
        }
        load={load}
        onRetry={(): void => void refresh()}
      >
        {rows.length === 0 ? (
          <EmptyState
            icon={<Percent size={20} />}
            title={t('taxes.empty')}
            {...(canWrite ? { action: newRuleButton('outline') } : {})}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('taxes.column.code')}</TableHead>
                <TableHead>{t('taxes.column.name')}</TableHead>
                <TableHead>{t('taxes.column.rate')}</TableHead>
                <TableHead>{t('taxes.column.country')}</TableHead>
                <TableHead>{t('taxes.column.productType')}</TableHead>
                <TableHead>{t('taxes.column.vatStatuses')}</TableHead>
                <TableHead>{t('taxes.column.default')}</TableHead>
                <TableHead>{t('taxes.column.priority')}</TableHead>
                {canWrite ? <TableHead className="w-12" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <code className="font-mono text-xs">{r.code}</code>
                  </TableCell>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="tabular-nums">{(r.rate * 100).toFixed(1)}%</TableCell>
                  <TableCell>{r.country ?? '—'}</TableCell>
                  <TableCell>{r.productType ?? '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.appliesToVatStatuses.join(', ') || '—'}
                  </TableCell>
                  <TableCell>
                    {r.isDefault ? <Badge variant="default">{t('taxes.badge.default')}</Badge> : null}
                  </TableCell>
                  <TableCell>{r.priority}</TableCell>
                  {canWrite ? (
                    <TableCell className="text-right">
                      <RowActionMenu label={t('taxes.rowActions', { code: r.code })}>
                        <RowActionMenuItem onSelect={(): void => setEditing(r)}>{t('taxes.action.edit')}</RowActionMenuItem>
                        <RowActionMenuSeparator />
                        <RowActionMenuItem destructive onSelect={(): void => void handleDelete(r.id)}>
                          {t('taxes.action.delete')}
                        </RowActionMenuItem>
                      </RowActionMenu>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ListPage>
      {canWrite && editing !== null ? (
        <UpsertDialog
          initial={editing === 'new' ? null : editing}
          onClose={(): void => setEditing(null)}
          onSubmit={handleUpsert}
        />
      ) : null}
      {confirmDialog}
    </>
  );
}

/**
 * The upsert form in a dialog (issue #1501, SHELL-14). `PUT /taxes/:code`
 * creates or replaces by code, so editing a row is the same form prefilled,
 * with the code read-only — a changed code would write a second rule rather
 * than rename this one. A refused save keeps the dialog open with the
 * server's message and the typed values.
 */
function UpsertDialog({
  initial,
  onClose,
  onSubmit,
}: {
  initial: AdminTax | null;
  onClose: () => void;
  onSubmit: (input: AdminTax) => Promise<void>;
}): ReactNode {
  const t = useTranslation('core');
  const formId = useId();
  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [rate, setRate] = useState(initial ? String(initial.rate) : '0.23');
  const [country, setCountry] = useState(initial?.country ?? '');
  const [productType, setProductType] = useState<string>(initial?.productType ?? '');
  const [vatStatuses, setVatStatuses] = useState<Set<string>>(new Set(initial?.appliesToVatStatuses ?? []));
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? false);
  const [priority, setPriority] = useState(initial ? String(initial.priority) : '0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await onSubmit({
        id: initial?.id ?? '',
        code: code.trim(),
        name: name.trim(),
        rate: Number(rate),
        country: country || null,
        productType: productType || null,
        appliesToVatStatuses: Array.from(vatStatuses),
        isDefault,
        priority: Number(priority),
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('taxes.error.save'));
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      title={initial ? t('taxes.upsert.editTitle', { code: initial.code }) : t('taxes.upsert.createTitle')}
      onClose={onClose}
      busy={busy}
      dismissOnScrim={false}
      widthClassName="max-w-2xl"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t('common.action.cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={busy} aria-busy={busy}>
            {t('taxes.action.save')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        onSubmit={(e: FormEvent): void => {
          void submit(e);
        }}
      >
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="tcode">{t('taxes.field.code')}</Label>
            <Input
              id="tcode"
              value={code}
              onChange={(e): void => setCode(e.target.value)}
              readOnly={initial !== null}
              className={cn('font-mono', initial !== null && 'bg-muted')}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tname">{t('taxes.field.name')}</Label>
            <Input id="tname" value={name} onChange={(e): void => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="trate">{t('taxes.field.rate')}</Label>
            <Input
              id="trate"
              type="number"
              step="0.001"
              min="0"
              value={rate}
              onChange={(e): void => setRate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tctry">{t('taxes.field.country')}</Label>
            <CountryPicker
              id="tctry"
              value={country}
              onChange={(e): void => setCountry(e.target.value)}
              includeBlank
              blankLabel={t('taxes.option.any')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tptype">{t('taxes.field.productType')}</Label>
            <Select
              id="tptype"
              value={productType}
              onChange={(e): void => setProductType(e.target.value)}
            >
              <option value="">{t('taxes.option.any')}</option>
              {PRODUCT_TYPES.map((pt) => (
                <option key={pt} value={pt}>
                  {pt}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tprio">{t('taxes.field.priority')}</Label>
            <Input
              id="tprio"
              type="number"
              value={priority}
              onChange={(e): void => setPriority(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label>{t('taxes.field.vatStatuses')}</Label>
          <div className="flex flex-wrap gap-3">
            {VAT_STATUSES.map((v) => (
              <label key={v} className="inline-flex items-center gap-2 text-sm">
                <Checkbox
                  checked={vatStatuses.has(v)}
                  onChange={(e): void =>
                    setVatStatuses((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(v);
                      else next.delete(v);
                      return next;
                    })
                  }
                />
                {v}
              </label>
            ))}
          </div>
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <Checkbox
            checked={isDefault}
            onChange={(e): void => setIsDefault(e.target.checked)}
          />
          {t('taxes.field.isDefault')}
        </label>
      </form>
    </ModalDialog>
  );
}
export default TaxesPage;
