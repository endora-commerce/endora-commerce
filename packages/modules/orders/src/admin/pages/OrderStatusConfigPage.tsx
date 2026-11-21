import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { DictionaryLanguagesPageResponse } from '@endora-commerce/contracts';
import { ApiError, apiClient, statusBadgeStyle } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Input, Label, PageHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@endora-commerce/admin-kit/ui';
import { ModalDialog, StatusTransitionGraph, useConfirmDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { ORDER_STATUS_DEFAULT_COLOR } from '@endora-commerce/contracts';
import { StatusColorPicker } from '../components/StatusColorPicker.js';

/**
 * List dictionary entries (feature 091, P6).
 *
 * The requests are built here rather than through `dictionaries`' own admin
 * API client: that client is another module's **code**, which is what the
 * cross-module ledger recorded, while `/api/v1/admin/dictionary/*` and the
 * `Dictionary*PageResponse` types are an HTTP path and
 * `@endora-commerce/contracts` types that both sides already compile. That is
 * the exit P2 established and `admin-kit-surface.md` R6 records.
 */
function listDictionaryLanguages(pageSize: number): Promise<DictionaryLanguagesPageResponse> {
  return apiClient.get<DictionaryLanguagesPageResponse>(
    `/api/v1/admin/dictionary/languages?pageSize=${pageSize}`,
  );
}

interface StatusDef {
  code: string;
  name: Record<string, string>;
  defaultName: string;
  isInitial: boolean;
  isTerminal: boolean;
  isSystem: boolean;
  weight: number;
  color: string;
  inUseCount: number;
}
interface TransitionDef {
  fromStatusCode: string;
  toStatusCode: string;
  isSystem: boolean;
}
interface StatusGraph {
  statuses: StatusDef[];
  transitions: TransitionDef[];
}
interface ActiveLanguage {
  code: string;
  label: string;
}

/** Resolve the admin-facing label: default name → English → first → code. */
function statusLabel(s: StatusDef): string {
  return s.defaultName || s.name['en'] || Object.values(s.name)[0] || s.code;
}

export function OrderStatusConfigPage(): ReactNode {
  const t = useTranslation('core');
  const tOrders = useTranslation('orders');
  const [graph, setGraph] = useState<StatusGraph | null>(null);
  const [languages, setLanguages] = useState<ActiveLanguage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The add-status dialog (issue #1439, DS-05): opened from the statuses card's header.
  const [adding, setAdding] = useState(false);

  // Inline edit of an existing status's names.
  const [editCode, setEditCode] = useState<string | null>(null);
  const [editDefaultName, setEditDefaultName] = useState('');
  const [editNames, setEditNames] = useState<Record<string, string>>({});
  const [editColor, setEditColor] = useState(ORDER_STATUS_DEFAULT_COLOR);

  // Status pending deletion — drives the confirmation dialog.
  const { confirm, confirmDialog } = useConfirmDialog();

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [graphRes, langRes] = await Promise.all([
        apiClient.get<{ data: StatusGraph }>('/api/v1/admin/orders/statuses'),
        // The endpoint's own maximum, not a round number: the dictionary lists
        // every ISO 639-1 language and only the active ones are kept below, so
        // a page smaller than the dictionary could cut an active language off.
        listDictionaryLanguages(250).catch(() => ({ data: [] })),
      ]);
      setGraph(graphRes.data);
      setLanguages(
        (langRes.data as Array<{ code: string; label: string; isActive: boolean }>)
          .filter((l) => l.isActive)
          .map((l) => ({ code: l.code, label: l.label })),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (fn: () => Promise<unknown>): Promise<void> => {
      setError(null);
      try {
        await fn();
        await load();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Operation failed.');
      }
    },
    [load],
  );

  const startEdit = (s: StatusDef): void => {
    setEditCode(s.code);
    setEditDefaultName(s.defaultName);
    setEditNames({ ...s.name });
    setEditColor(s.color || ORDER_STATUS_DEFAULT_COLOR);
  };

  const saveEdit = (code: string): void => {
    const defaultName = editDefaultName.trim();
    if (!defaultName) return;
    void run(async () => {
      await apiClient.patch(`/api/v1/admin/orders/statuses/${code}`, {
        name: cleanNames(editNames),
        defaultName,
        color: editColor,
      });
      setEditCode(null);
    });
  };

  // Issue #1474 (SALES-09) — asked in the kit's dialog, focus on *Cancel*.
  const confirmDelete = async (status: StatusDef): Promise<void> => {
    const ok = await confirm({
      title: t('orderStatusConfig.deleteConfirm.title'),
      message: t('orderStatusConfig.deleteConfirm.body', { name: statusLabel(status) }),
      confirmLabel: t('common.action.delete'),
      destructive: true,
    });
    if (!ok) return;
    void run(() => apiClient.delete(`/api/v1/admin/orders/statuses/${status.code}`));
  };

  const addTransition = (from: string, to: string): void => {
    if (!from || !to || from === to) return;
    void run(() =>
      apiClient.put('/api/v1/admin/orders/transitions', {
        add: [{ fromStatusCode: from, toStatusCode: to }],
      }),
    );
  };

  const removeTransition = (from: string, to: string): void => {
    void run(() =>
      apiClient.put('/api/v1/admin/orders/transitions', {
        remove: [{ fromStatusCode: from, toStatusCode: to }],
      }),
    );
  };

  // Only blank the page on the very first load; subsequent refetches (after a
  // mutation) keep the page mounted and update the table + graph in place.
  if (loading && !graph)
    return <p className="text-sm text-muted-foreground">{t('common.state.loading')}</p>;

  const statuses = graph?.statuses ?? [];

  return (
    <>
      <PageHeader
        back={{ label: t('orders.page.title'), to: '/orders' }}
        title={t('orderStatusConfig.title')}
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle>{t('orderStatusConfig.statuses')}</CardTitle>
          {/* Outline, not filled: the screen configures two things and neither add is its one
              primary (issue #1441, DS-07). It opens a dialog instead of a form drawn open under
              the table (issue #1439, DS-05; Hick). */}
          <Button variant="outline" size="sm" onClick={(): void => setAdding(true)}>
            <Plus />
            {t('orderStatusConfig.addStatus')}
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('orderStatusConfig.col.code')}</TableHead>
                <TableHead>{t('orderStatusConfig.col.name')}</TableHead>
                <TableHead>{t('orderStatusConfig.col.flags')}</TableHead>
                <TableHead>{t('orderStatusConfig.col.inUse')}</TableHead>
                <TableHead>
                  <span className="sr-only">{tOrders('statusConfig.column.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statuses.map((s) => {
                const locked = s.isSystem || s.isInitial || s.inUseCount > 0;
                const isEditing = editCode === s.code;
                return (
                  <TableRow key={s.code}>
                    <TableCell className="font-mono text-xs align-top">{s.code}</TableCell>
                    <TableCell>
                      {isEditing ? (
                        <div className="space-y-2">
                          <div className="space-y-1">
                            <Label htmlFor={`dn-${s.code}`}>
                              {t('orderStatusConfig.field.defaultName')}
                            </Label>
                            <Input
                              id={`dn-${s.code}`}
                              className="h-8 px-2"
                              value={editDefaultName}
                              onChange={(e): void => setEditDefaultName(e.target.value)}
                            />
                          </div>
                          {languages.map((lang) => (
                            <div key={lang.code} className="space-y-1">
                              <Label htmlFor={`n-${s.code}-${lang.code}`}>{lang.label}</Label>
                              <Input
                                id={`n-${s.code}-${lang.code}`}
                                className="h-8 px-2"
                                value={editNames[lang.code] ?? ''}
                                placeholder={s.defaultName}
                                onChange={(e): void =>
                                  setEditNames((prev) => ({ ...prev, [lang.code]: e.target.value }))
                                }
                              />
                            </div>
                          ))}
                          <div className="space-y-1">
                            <Label>{t('orderStatusConfig.field.color')}</Label>
                            <StatusColorPicker
                              value={editColor}
                              onChange={setEditColor}
                              label={t('orderStatusConfig.field.color')}
                              customLabel={t('orderStatusConfig.color.custom')}
                            />
                          </div>
                          <div className="flex gap-2 pt-1">
                            <Button size="sm" onClick={(): void => saveEdit(s.code)}>
                              {t('common.action.save')}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={(): void => setEditCode(null)}>
                              {t('common.action.cancel')}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Badge className="font-medium" style={statusBadgeStyle(s.color)}>
                          {statusLabel(s)}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground align-top">
                      {[
                        s.isInitial ? t('orderStatusConfig.flag.initial') : null,
                        s.isTerminal ? t('orderStatusConfig.flag.terminal') : null,
                        s.isSystem ? t('orderStatusConfig.flag.system') : null,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    </TableCell>
                    <TableCell className="tabular-nums align-top">{s.inUseCount}</TableCell>
                    <TableCell className="text-right align-top">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={tOrders('statusConfig.action.edit', { name: statusLabel(s) })}
                        onClick={(): void => startEdit(s)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={locked}
                        aria-label={tOrders('statusConfig.action.delete', { name: statusLabel(s) })}
                        onClick={(): void => void confirmDelete(s)}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('orderStatusConfig.transitions')}</CardTitle>
        </CardHeader>
        <CardContent>
          <StatusTransitionGraph
            statuses={statuses}
            transitions={graph?.transitions ?? []}
            statusLabel={statusLabel}
            onAdd={addTransition}
            onRemove={removeTransition}
          />
        </CardContent>
      </Card>

      {adding ? (
        <AddStatusDialog
          languages={languages}
          onClose={(): void => setAdding(false)}
          onCreated={async (): Promise<void> => {
            setAdding(false);
            await load();
          }}
        />
      ) : null}
      {confirmDialog}
    </>
  );
}

/** Drop empty per-language entries before sending. */
function cleanNames(names: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(names).filter(([, v]) => v.trim().length > 0));
}

/**
 * The new-status form, in the kit's dialog (issue #1439, DS-05). A refusal is
 * shown inside the dialog and keeps what was typed; the scrim does not dismiss
 * it, so a stray click cannot throw the input away.
 */
function AddStatusDialog(props: {
  languages: ActiveLanguage[];
  onClose: () => void;
  onCreated: () => Promise<void>;
}): ReactNode {
  const { languages, onClose, onCreated } = props;
  const t = useTranslation('core');
  const tOrders = useTranslation('orders');
  const id = useId();
  const [code, setCode] = useState('');
  const [defaultName, setDefaultName] = useState('');
  const [names, setNames] = useState<Record<string, string>>({});
  const [terminal, setTerminal] = useState(false);
  const [color, setColor] = useState(ORDER_STATUS_DEFAULT_COLOR);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.post('/api/v1/admin/orders/statuses', {
        code: trimmed,
        name: cleanNames(names),
        defaultName: defaultName.trim() || trimmed,
        isTerminal: terminal,
        color,
      });
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('common.state.error'));
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      title={tOrders('statusConfig.newStatus.title')}
      busy={busy}
      dismissOnScrim={false}
      onClose={onClose}
    >
      <form noValidate className="space-y-4" onSubmit={(event): void => void submit(event)}>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="space-y-1">
          <Label htmlFor={`${id}-code`}>{t('orderStatusConfig.col.code')}</Label>
          <Input
            id={`${id}-code`}
            className="font-mono"
            value={code}
            autoFocus
            onChange={(e): void => setCode(e.target.value)}
            placeholder="awaiting_stock"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${id}-defaultName`}>{t('orderStatusConfig.field.defaultName')}</Label>
          <Input
            id={`${id}-defaultName`}
            value={defaultName}
            onChange={(e): void => setDefaultName(e.target.value)}
          />
        </div>
        {languages.map((lang) => (
          <div key={lang.code} className="space-y-1">
            <Label htmlFor={`${id}-name-${lang.code}`}>{lang.label}</Label>
            <Input
              id={`${id}-name-${lang.code}`}
              value={names[lang.code] ?? ''}
              placeholder={defaultName}
              onChange={(e): void => setNames((prev) => ({ ...prev, [lang.code]: e.target.value }))}
            />
          </div>
        ))}
        <div className="space-y-1">
          <Label>{t('orderStatusConfig.field.color')}</Label>
          <StatusColorPicker
            value={color}
            onChange={setColor}
            label={t('orderStatusConfig.field.color')}
            customLabel={t('orderStatusConfig.color.custom')}
          />
        </div>
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <Checkbox checked={terminal} onChange={(e): void => setTerminal(e.target.checked)} />
          {t('orderStatusConfig.flag.terminal')}
        </label>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button className="min-h-11 sm:min-h-9" type="button" variant="outline" disabled={busy} onClick={onClose}>
            {t('common.action.cancel')}
          </Button>
          <Button className="min-h-11 sm:min-h-9" type="submit" disabled={busy || !code.trim()} aria-busy={busy}>
            <Plus />
            {busy ? t('common.state.saving') : t('orderStatusConfig.addStatus')}
          </Button>
        </div>
      </form>
    </ModalDialog>
  );
}

/**
 * The default export a route declaration's dynamic-import factory resolves
 * (feature 091, R6). The named export stays: it is the spelling this module's
 * own siblings and tests use.
 */
export default OrderStatusConfigPage;
